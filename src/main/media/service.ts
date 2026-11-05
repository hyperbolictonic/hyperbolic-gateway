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

import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

import { isMediaBinary, ensureYtDlp, readYtDlpVersion, writableYtDlpPath, type MediaBinary, type MediaBinaryError } from './binaries.ts';
import { needsLogin } from './auth.ts';
import { writeCookieFile } from './cookies.ts';
import { detectFfmpeg, installManagedFfmpeg, type FfmpegInfo } from './ffmpeg.ts';
import { fetchArtifacts, type SubtitleArtifacts } from './transcript.ts';
import { MediaJobs, type MediaJob, type MediaJobInput, type MediaKind, type MediaQuality } from './jobs.ts';
import { runYtDlpProcess } from './exec.ts';
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

export type MediaTranscriptResult =
  | {
      readonly ok: true;
      readonly language: string;
      readonly automatic: boolean;
      readonly text: string;
      readonly chars: number;
      readonly totalChars: number;
      readonly truncated: boolean;
      readonly nextCursor: number | null;
      readonly availableLanguages: readonly string[];
    }
  | { readonly ok: false; readonly code: string; readonly error: string };

export interface MediaPreviewImage {
  readonly name: string;
  readonly mimeType: string;
  readonly base64: string;
}

export type MediaPreviewResult =
  | {
      readonly ok: true;
      readonly media: MediaInfo;
      readonly transcript: {
        readonly language: string;
        readonly automatic: boolean;
        readonly text: string;
        readonly chars: number;
        readonly totalChars: number;
        readonly truncated: boolean;
      } | null;
      readonly warnings: readonly string[];
      readonly images: readonly MediaPreviewImage[];
    }
  | { readonly ok: false; readonly code: string; readonly error: string };

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
  private readonly transcriptCache = new Map<string, { at: number; artifacts: SubtitleArtifacts }>();
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

  private pickLanguage(media: MediaInfo, requested?: string): string {
    const explicit = (requested ?? '').trim();
    if (explicit !== '') return explicit;
    // Prefer English when it exists, then a manual track, then auto captions.
    const manual = media.subtitleLanguages;
    const auto = media.automaticCaptionLanguages;
    const english = (codes: readonly string[]): string | undefined =>
      codes.find((code) => code === 'en') ?? codes.find((code) => code.startsWith('en'));
    return english(manual) ?? english(auto) ?? manual[0] ?? auto[0] ?? 'en';
  }

  private cacheArtifacts(key: string, artifacts: SubtitleArtifacts): void {
    this.transcriptCache.set(key, { at: Date.now(), artifacts });
    if (this.transcriptCache.size > 20) {
      const oldest = [...this.transcriptCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.transcriptCache.delete(oldest[0]);
    }
  }

  private async artifactsFor(
    url: string,
    lang: string,
    includeThumbnail: boolean,
  ): Promise<
    | { readonly ok: true; readonly artifacts: SubtitleArtifacts; readonly images: MediaPreviewImage[] }
    | { readonly ok: false; readonly code: string; readonly error: string }
  > {
    const binary = await this.resolveBinary();
    if (!isMediaBinary(binary)) return { ok: false, code: binary.code, error: binary.error };

    const cookies = await this.cookieFileFor(url);
    const dir = path.join(
      this.rootDir,
      '.preview',
      `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    );

    try {
      const result = await fetchArtifacts(binary, url, dir, {
        lang,
        includeThumbnail,
        ...(cookies === null ? {} : { cookiesPath: cookies.path }),
      });
      if (!result.ok) return result;

      const images: MediaPreviewImage[] = [];
      for (const image of result.artifacts.images) {
        try {
          const stat = await fsp.stat(image.path);
          if (stat.size > 4_000_000) continue;
          const data = await fsp.readFile(image.path);
          images.push({ name: image.name, mimeType: image.mimeType, base64: data.toString('base64') });
        } catch {
          // A thumbnail that cannot be read should not fail the preview.
        }
      }

      return { ok: true, artifacts: result.artifacts, images };
    } finally {
      await cookies?.cleanup();
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Captions as text, without downloading the media. Paged with
   * `maxChars`/`cursor`, and cached for ten minutes per URL + language.
   */
  async transcript(
    rawUrl: string,
    options: { lang?: string; maxChars?: number; cursor?: number } = {},
  ): Promise<MediaTranscriptResult> {
    const info = await this.info(rawUrl);
    if (!info.ok) return { ok: false, code: info.code, error: info.error };

    const url = rawUrl.trim();
    const lang = this.pickLanguage(info.media, options.lang);
    const key = `${url}|${lang}`;
    const cached = this.transcriptCache.get(key);
    let artifacts: SubtitleArtifacts | null =
      cached !== undefined && Date.now() - cached.at < 10 * 60_000 ? cached.artifacts : null;

    if (artifacts === null) {
      const fetched = await this.artifactsFor(url, lang, false);
      if (!fetched.ok) return { ok: false, code: fetched.code, error: fetched.error };
      artifacts = fetched.artifacts;
      this.cacheArtifacts(key, artifacts);
    }

    const total = artifacts.text.length;
    const max = Math.min(20_000, Math.max(500, Math.round(options.maxChars ?? 8_000)));
    const cursor = Math.min(total, Math.max(0, Math.round(options.cursor ?? 0)));
    const text = artifacts.text.slice(cursor, cursor + max);
    const nextCursor = cursor + text.length < total ? cursor + text.length : null;

    return {
      ok: true,
      language: artifacts.language,
      automatic: artifacts.automatic,
      text,
      chars: text.length,
      totalChars: total,
      truncated: nextCursor !== null,
      nextCursor,
      availableLanguages: artifacts.availableLanguages,
    };
  }

  /**
   * A no-download preview: metadata, a transcript excerpt, and the poster image
   * (returned as image content by the MCP layer).
   */
  async preview(
    rawUrl: string,
    options: { lang?: string; maxChars?: number; thumbnail?: boolean } = {},
  ): Promise<MediaPreviewResult> {
    const info = await this.info(rawUrl);
    if (!info.ok) return { ok: false, code: info.code, error: info.error };

    const url = rawUrl.trim();
    const lang = this.pickLanguage(info.media, options.lang);
    const fetched = await this.artifactsFor(url, lang, options.thumbnail !== false);
    const warnings = [...info.warnings];

    if (!fetched.ok) {
      if (fetched.code === 'LOGIN_REQUIRED') return { ok: false, code: fetched.code, error: fetched.error };
      warnings.push(fetched.code);
      return { ok: true, media: info.media, transcript: null, warnings, images: [] };
    }

    if (fetched.artifacts.text !== '') this.cacheArtifacts(`${url}|${lang}`, fetched.artifacts);

    const total = fetched.artifacts.text.length;
    const text = fetched.artifacts.text.slice(0, Math.min(8_000, Math.max(200, Math.round(options.maxChars ?? 1_200))));

    return {
      ok: true,
      media: info.media,
      warnings,
      transcript:
        total === 0
          ? null
          : {
              language: fetched.artifacts.language,
              automatic: fetched.artifacts.automatic,
              text,
              chars: text.length,
              totalChars: total,
              truncated: text.length < total,
            },
      images: fetched.images.slice(0, 2),
    };
  }

  async download(input: MediaJobInput): Promise<MediaDownloadResult> {    const url = typeof input?.url === 'string' ? input.url.trim() : '';
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
      const result = await runYtDlpProcess(binary.path, args, {
        timeoutMs: INFO_TIMEOUT_MS,
        maxStdoutBytes: INFO_MAX_STDOUT_BYTES,
        env: runtime.env,
      });

      if (result.timedOut) {
        return { ok: false, code: 'TIMEOUT', error: `The downloader did not answer within ${INFO_TIMEOUT_MS / 1000}s` };
      }
      if (result.overflowed) {
        return { ok: false, code: 'RESPONSE_TOO_LARGE', error: 'Metadata exceeded the 16 MB limit' };
      }

      if (result.code !== 0) {
        const detail = result.stderr.trim().split(/\r?\n/u).slice(-4).join(' ').slice(0, 500);
        const loginRequired = needsLogin(result.stderr);
        if (loginRequired) this.notifyLoginRequired();
        return {
          ok: false,
          code: loginRequired ? 'LOGIN_REQUIRED' : 'EXTRACT_FAILED',
          error: detail === '' ? `The downloader exited with code ${result.code ?? 'unknown'}` : detail,
        };
      }

      let payload: Record<string, any>;
      try {
        payload = JSON.parse(result.stdout) as Record<string, any>;
      } catch {
        return { ok: false, code: 'INVALID_RESPONSE', error: 'The downloader returned metadata that is not JSON' };
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
