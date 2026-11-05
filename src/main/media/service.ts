/**
 * Media reads for the agent surface.
 *
 * `info` asks yt-dlp for metadata without downloading anything. Execution lives
 * in the main process: the binary is local, the runtime is Electron itself, and
 * later slices add a job queue and the browser-session cookie handoff here.
 *
 * The downloader is never given agent-supplied flags. Every argument is built in
 * this file, and `--ignore-config` keeps a stray yt-dlp config file from adding
 * `--exec` or anything else.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

import { isMediaBinary, ensureYtDlp, readYtDlpVersion, writableYtDlpPath, type MediaBinary, type MediaBinaryError } from './binaries.ts';
import { needsLogin } from './auth.ts';
import { writeCookieFile } from './cookies.ts';
import { detectFfmpeg, installManagedFfmpeg, type FfmpegInfo } from './ffmpeg.ts';
import { MediaJobs, type MediaJob, type MediaJobInput, type MediaKind, type MediaQuality } from './jobs.ts';
import { ytdlpRuntimeOptions } from './platform.ts';
import { MediaSettingsStore } from './settings.ts';
import { MediaUpdater, type MediaUpdaterOptions } from './updater.ts';
import type { MediaSettings, MediaSettingsSnapshot, MediaUpdaterState } from '../../shared/media.ts';
import { assertSafeUrl, WrapSecurityError } from '../wrap/security.ts';

const INFO_TIMEOUT_MS = 45_000;
const INFO_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const INFO_MAX_STDERR_BYTES = 256 * 1024;

export interface MediaRuntimeStatus {
  readonly kind: 'electron-node' | 'none';
  readonly node: string | null;
}

export interface MediaStatus {
  readonly binary: {
    readonly available: boolean;
    readonly version: string | null;
    readonly source: 'bundled' | 'user-data' | null;
  };
  readonly runtime: MediaRuntimeStatus;
  readonly capabilities: {
    readonly info: boolean;
    readonly download: boolean;
    readonly merge: boolean;
    readonly transcode: boolean;
  };
  readonly jobs: {
    readonly queued: number;
    readonly running: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
  };
  readonly cookies: {
    readonly useSession: boolean;
  };
  readonly ffmpeg: FfmpegInfo;
  readonly updater: MediaUpdaterState;
}

export interface MediaInfo {
  readonly id: string | null;
  readonly title: string | null;
  readonly durationSeconds: number | null;
  readonly uploader: string | null;
  readonly extractor: string | null;
  readonly webpageUrl: string | null;
  readonly thumbnail: string | null;
  readonly isLive: boolean;
  readonly ageLimit: number | null;
  readonly formatCount: number;
  readonly maxHeight: number | null;
  readonly audioOnly: boolean;
  readonly subtitleLanguages: readonly string[];
  readonly automaticCaptionLanguages: readonly string[];
}

export type MediaInfoResult =
  | {
      readonly ok: true;
      readonly media: MediaInfo;
      readonly runtime: MediaRuntimeStatus;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly code: string; readonly error: string };

export type MediaServiceError = MediaBinaryError;

interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly overflowed: boolean;
}

/**
 * Run the downloader once with a fixed argument list.
 *
 * A timeout or a runaway stdout kills the process. The job runner in a later
 * slice will reuse this and add tree-kill and progress parsing.
 */
async function runYtDlp(
  binary: string,
  args: readonly string[],
  options: { timeoutMs: number; maxStdoutBytes: number; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, [...args], {
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.byteLength;
      if (outBytes > options.maxStdoutBytes) {
        overflowed = true;
        child.kill();
        return;
      }
      out.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (errBytes >= INFO_MAX_STDERR_BYTES) return;
      errBytes += chunk.byteLength;
      err.push(chunk.subarray(0, Math.max(0, INFO_MAX_STDERR_BYTES - (errBytes - chunk.byteLength))));
    });

    child.on('error', (error) => {
      finish({
        code: null,
        signal: null,
        stdout: '',
        stderr: error.message,
        timedOut,
        overflowed,
      });
    });

    child.on('close', (code, signal) => {
      finish({
        code,
        signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        overflowed,
      });
    });
  });
}

function warningCodes(stderr: string): string[] {
  const warnings: string[] = [];
  if (/No supported JavaScript runtime/i.test(stderr)) warnings.push('js_runtime_missing');
  if (/ffmpeg not found/i.test(stderr)) warnings.push('ffmpeg_missing');
  return warnings;
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function languageKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function buildInfo(payload: Record<string, any>): MediaInfo {
  const formats: any[] = Array.isArray(payload.formats) ? payload.formats : [];
  const heights = formats
    .map((format) => numberOrNull(format?.height))
    .filter((height): height is number => height !== null);

  return {
    id: scalar(payload.id),
    title: scalar(payload.title),
    durationSeconds: numberOrNull(payload.duration),
    uploader: scalar(payload.uploader) ?? scalar(payload.channel) ?? scalar(payload.creator),
    extractor: scalar(payload.extractor_key) ?? scalar(payload.extractor),
    webpageUrl: scalar(payload.webpage_url) ?? scalar(payload.original_url),
    thumbnail: scalar(payload.thumbnail),
    isLive: payload.is_live === true,
    ageLimit: numberOrNull(payload.age_limit),
    formatCount: formats.length,
    maxHeight: heights.length > 0 ? Math.max(...heights) : null,
    audioOnly: formats.length > 0 && formats.every((format) => format?.vcodec === 'none'),
    subtitleLanguages: languageKeys(payload.subtitles),
    automaticCaptionLanguages: languageKeys(payload.automatic_captions),
  };
}

export type MediaDownloadResult =
  | { readonly ok: true; readonly job: MediaJob }
  | { readonly ok: false; readonly code: string; readonly error: string };

const MEDIA_KINDS: readonly MediaKind[] = ['video', 'audio'];
const MEDIA_QUALITIES: readonly MediaQuality[] = ['best', '1080', '720', '480', 'worst'];

export class MediaService {
  private binaryPromise: Promise<MediaBinary | MediaBinaryError> | null = null;
  private readonly rootDir: string;
  private readonly settingsStore: MediaSettingsStore;
  private readonly notify?: (notice: { title: string; message: string }) => void;
  private lastLoginNoticeAt = 0;
  private ffmpegCache: { at: number; info: FfmpegInfo } | null = null;
  private ffmpegInstalling = false;
  readonly jobs: MediaJobs;
  readonly updater: MediaUpdater;

  constructor(options: { rootDir?: string; notify?: (notice: { title: string; message: string }) => void } = {}) {
    this.rootDir = options.rootDir ?? path.join(app.getPath('userData'), 'media');
    this.notify = options.notify;
    this.settingsStore = new MediaSettingsStore(path.join(this.rootDir, 'settings.json'));
    this.jobs = new MediaJobs({
      rootDir: this.rootDir,
      resolveBinary: () => this.resolveBinary(),
      cookieFileFor: (url) => this.cookieFileFor(url),
      onLoginRequired: () => this.notifyLoginRequired(),
      outputDir: () => this.settingsStore.load().outputDir || this.rootDir,
      resolveFfmpeg: () => this.ffmpegInfo(),
    });
    this.updater = new MediaUpdater({
      binaryPath: writableYtDlpPath,
      readVersion: readYtDlpVersion,
      settings: () => this.settingsStore.load(),
      hasRunningJobs: () => this.jobs.counts().running > 0,
      onUpdated: () => this.invalidateBinary(),
    });
  }

  /** A one-run cookie file, only when the human enabled the browser session. */
  private async cookieFileFor(url: string): Promise<{ path: string; cleanup(): Promise<void> } | null> {
    if (!this.settingsStore.load().useSessionCookies) return null;
    try {
      return await writeCookieFile(url, path.join(this.rootDir, '.cookies'));
    } catch {
      // A cookie-store failure must not fail the request; it may still work anonymously.
      return null;
    }
  }

  private notifyLoginRequired(): void {
    const now = Date.now();
    if (now - this.lastLoginNoticeAt < 60_000) return;
    this.lastLoginNoticeAt = now;
    const enabled = this.settingsStore.load().useSessionCookies;
    const message = enabled
      ? 'A media request was refused for authentication even with the browser session. Sign in again in the browser, then retry.'
      : 'A media request needs a signed-in session. Enable Settings → Media → "Use browser session", then retry.';
    this.notify?.({ title: 'Media needs your browser session', message });
  }

  /** Resolve once per process; the updater will invalidate this when it installs. */
  resolveBinary(): Promise<MediaBinary | MediaBinaryError> {
    this.binaryPromise ??= ensureYtDlp();
    return this.binaryPromise;
  }

  invalidateBinary(): void {
    this.binaryPromise = null;
  }

  shutdown(): void {
    this.updater.stop();
    this.jobs.shutdown();
  }

  startUpdater(): void {
    this.updater.start();
  }

  mediaSettings(): MediaSettings {
    return this.settingsStore.load();
  }

  saveMediaSettings(patch: unknown): MediaSettingsSnapshot {
    const settings = this.settingsStore.save(patch);
    this.ffmpegCache = null;
    return { settings, updater: this.updater.state() };
  }

  settingsSnapshot(): MediaSettingsSnapshot {
    return { settings: this.settingsStore.load(), updater: this.updater.state() };
  }

  checkForUpdate(force = true): Promise<MediaUpdaterState> {
    return this.updater.check(force);
  }

  /** ffmpeg for the current settings. Cached briefly so status polls stay cheap. */
  async ffmpegInfo(force = false): Promise<FfmpegInfo> {
    const now = Date.now();
    if (!force && this.ffmpegCache !== null && now - this.ffmpegCache.at < 30_000) {
      return { ...this.ffmpegCache.info, installing: this.ffmpegInstalling };
    }
    const info = await detectFfmpeg(this.settingsStore.load(), this.rootDir, this.ffmpegInstalling);
    this.ffmpegCache = { at: now, info };
    return info;
  }

  async installFfmpeg(): Promise<FfmpegInfo> {
    this.ffmpegInstalling = true;
    this.ffmpegCache = null;
    try {
      return await installManagedFfmpeg(this.settingsStore.load(), this.rootDir);
    } finally {
      this.ffmpegInstalling = false;
      this.ffmpegCache = null;
    }
  }

  async status(): Promise<MediaStatus> {
    const binary = await this.resolveBinary();
    const runtime = ytdlpRuntimeOptions();
    const available = isMediaBinary(binary);
    const ffmpeg = await this.ffmpegInfo();
    return {
      binary: {
        available,
        version: available ? binary.version : null,
        source: available ? binary.source : null,
      },
      runtime: { kind: runtime.kind, node: runtime.node },
      capabilities: {
        info: available,
        download: available,
        merge: ffmpeg.available,
        transcode: ffmpeg.available,
      },
      jobs: this.jobs.counts(),
      cookies: { useSession: this.settingsStore.load().useSessionCookies },
      ffmpeg,
      updater: this.updater.state(),
    };
  }

  async download(input: MediaJobInput): Promise<MediaDownloadResult> {
    const url = typeof input?.url === 'string' ? input.url.trim() : '';
    if (url === '') return { ok: false, code: 'BAD_REQUEST', error: 'url is required' };

    try {
      await assertSafeUrl(url);
    } catch (error) {
      if (error instanceof WrapSecurityError) return { ok: false, code: error.code, error: error.message };
      return { ok: false, code: 'INVALID_URL', error: error instanceof Error ? error.message : String(error) };
    }

    const binary = await this.resolveBinary();
    if (!isMediaBinary(binary)) return { ok: false, code: binary.code, error: binary.error };

    const kind = MEDIA_KINDS.includes(input.kind as MediaKind) ? (input.kind as MediaKind) : 'video';
    const quality = MEDIA_QUALITIES.includes(input.quality as MediaQuality)
      ? (input.quality as MediaQuality)
      : 'best';

    return { ok: true, job: this.jobs.enqueue({ url, kind, quality }) };
  }

  cancel(id: string): { ok: boolean; cancelled: boolean } {
    return { ok: true, cancelled: this.jobs.cancel(id) };
  }

  /** Completed jobs with their files, newest first. */
  library(): MediaJob[] {
    return this.jobs.list().filter((job) => job.state === 'completed');
  }

  async info(rawUrl: string): Promise<MediaInfoResult> {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (url === '') {
      return { ok: false, code: 'BAD_REQUEST', error: 'url is required' };
    }

    try {
      await assertSafeUrl(url);
    } catch (error) {
      if (error instanceof WrapSecurityError) {
        return { ok: false, code: error.code, error: error.message };
      }
      return { ok: false, code: 'INVALID_URL', error: error instanceof Error ? error.message : String(error) };
    }

    const binary = await this.resolveBinary();
    if (!isMediaBinary(binary)) return { ok: false, code: binary.code, error: binary.error };

    const runtime = ytdlpRuntimeOptions();
    const cookies = await this.cookieFileFor(url);
    const args = [
      ...runtime.args,
      '--ignore-config',
      '--no-playlist',
      '--skip-download',
      '--dump-single-json',
      '--no-color',
      '--socket-timeout',
      '20',
      ...(cookies === null ? [] : ['--cookies', cookies.path]),
      '--',
      url,
    ];

    try {
      const result = await runYtDlp(binary.path, args, {
        timeoutMs: INFO_TIMEOUT_MS,
        maxStdoutBytes: INFO_MAX_STDOUT_BYTES,
        env: runtime.env,
      });

      if (result.timedOut) {
        return { ok: false, code: 'TIMEOUT', error: `yt-dlp did not answer within ${INFO_TIMEOUT_MS / 1000}s` };
      }
      if (result.overflowed) {
        return { ok: false, code: 'RESPONSE_TOO_LARGE', error: 'yt-dlp metadata exceeded the 16 MB limit' };
      }

      if (result.code !== 0) {
        const detail = result.stderr.trim().split(/\r?\n/u).slice(-4).join(' ').slice(0, 500);
        const loginRequired = needsLogin(result.stderr);
        if (loginRequired) this.notifyLoginRequired();
        return {
          ok: false,
          code: loginRequired ? 'LOGIN_REQUIRED' : 'EXTRACT_FAILED',
          error: detail === '' ? `yt-dlp exited with code ${result.code ?? 'unknown'}` : detail,
        };
      }

      let payload: Record<string, any>;
      try {
        payload = JSON.parse(result.stdout) as Record<string, any>;
      } catch {
        return { ok: false, code: 'INVALID_RESPONSE', error: 'yt-dlp returned metadata that is not JSON' };
      }

      return {
        ok: true,
        media: buildInfo(payload),
        runtime: { kind: runtime.kind, node: runtime.node },
        warnings: warningCodes(result.stderr),
      };
    } finally {
      await cookies?.cleanup();
    }
  }
}
