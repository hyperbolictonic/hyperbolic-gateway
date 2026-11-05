/**
 * Download jobs for the media surface.
 *
 * One yt-dlp process at a time by default. A job is enqueued and returns
 * immediately; the agent polls `media jobs`. Progress is parsed from yt-dlp's
 * `--newline` output rather than scraped from a rendered terminal.
 *
 * Files land in `<userData>/media/<jobId>/` through a temp directory, so a
 * cancelled job never leaves a half file in the library because the whole job
 * directory is removed on cancel, and yt-dlp writes partials to `.tmp`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ytdlpRuntimeOptions } from './platform.ts';
import { needsLogin } from './auth.ts';
import type { MediaBinary, MediaBinaryError } from './binaries.ts';

export type MediaKind = 'video' | 'audio';
export type MediaQuality = 'best' | '1080' | '720' | '480' | 'worst';
export type MediaJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface MediaJobFile {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
}

export interface MediaProgress {
  readonly percent: number | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly speedBytesPerSecond: number | null;
  readonly etaSeconds: number | null;
  readonly stage: 'starting' | 'downloading' | 'merging' | 'postprocessing' | 'finalising';
}

export interface MediaJob {
  readonly id: string;
  readonly url: string;
  readonly kind: MediaKind;
  readonly quality: MediaQuality;
  state: MediaJobState;
  title: string | null;
  progress: MediaProgress | null;
  files: MediaJobFile[];
  error: { readonly code: string; readonly message: string } | null;
  readonly createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface MediaJobInput {
  readonly url: string;
  readonly kind?: MediaKind;
  readonly quality?: MediaQuality;
}

const MAX_JOBS = 50;
const MAX_CONCURRENT = 1;
const IDLE_TIMEOUT_MS = 120_000;
const TOTAL_TIMEOUT_MS = 45 * 60_000;
const MAX_FILESIZE = '2G';

const QUALITY_HEIGHT: Record<Exclude<MediaQuality, 'best' | 'worst'>, number> = {
  '1080': 1080,
  '720': 720,
  '480': 480,
};

/**
 * Format selector for one job.
 *
 * Without ffmpeg yt-dlp cannot merge separate video and audio streams, so the
 * selector asks for a single-file result that already contains both. The
 * `ffmpeg` argument is where the merge path lands once that mode ships.
 */
export function buildFormatSelector(kind: MediaKind, quality: MediaQuality, ffmpeg: boolean): string {
  if (kind === 'audio') {
    return ffmpeg ? 'bestaudio' : 'bestaudio[ext=m4a]/bestaudio';
  }
  if (quality === 'best') {
    return ffmpeg ? 'bestvideo+bestaudio/best' : 'best[ext=mp4]/best';
  }
  if (quality === 'worst') {
    return ffmpeg ? 'worstvideo+worstaudio/worst' : 'worst[ext=mp4]/worst';
  }
  const height = QUALITY_HEIGHT[quality];
  return ffmpeg
    ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`
    : `best[height<=${height}][ext=mp4]/best[height<=${height}]`;
}

/** yt-dlp arguments for a job. Every value is built here, never passed through. */
export function buildDownloadArgs(input: {
  url: string;
  kind: MediaKind;
  quality: MediaQuality;
  home: string;
  temp: string;
  ffmpeg: boolean;
  ffmpegDir?: string;
  cookies?: string;
}): string[] {
  const runtime = ytdlpRuntimeOptions();
  return [
    ...runtime.args,
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--no-color',
    '--no-mtime',
    '--socket-timeout',
    '20',
    '--max-filesize',
    MAX_FILESIZE,
    '--retries',
    '3',
    '--paths',
    `home:${input.home}`,
    '--paths',
    `temp:${input.temp}`,
    ...(input.ffmpegDir === undefined ? [] : ['--ffmpeg-location', input.ffmpegDir]),
    '--output',
    '%(title).140B [%(id)s].%(ext)s',
    '--format',
    buildFormatSelector(input.kind, input.quality, input.ffmpeg),
    ...(input.cookies === undefined ? [] : ['--cookies', input.cookies]),
    '--',
    input.url,
  ];
}

/** Parse one `--newline` progress line. Returns null for lines that are not progress. */
export function parseProgressLine(line: string): Partial<MediaProgress> | null {
  const percent = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/u);
  if (percent) {
    const size = line.match(/of\s+~?\s*([\d.]+)([KMG]?i?B)/u);
    const speed = line.match(/at\s+([\d.]+)([KMG]?i?B)\/s/u);
    const eta = line.match(/ETA\s+(\d+(?::\d+){1,2})/u);
    const totalBytes = size ? toBytes(Number.parseFloat(size[1]), size[2]) : null;
    const percentValue = Number.parseFloat(percent[1]);
    return {
      stage: 'downloading',
      percent: percentValue,
      // yt-dlp prints the total and the percentage, not the running byte count.
      downloadedBytes: totalBytes === null ? null : Math.round((totalBytes * percentValue) / 100),
      totalBytes,
      speedBytesPerSecond: speed ? toBytes(Number.parseFloat(speed[1]), speed[2]) : null,
      etaSeconds: eta ? toSeconds(eta[1]) : null,
    };
  }
  if (/^\[Merger\]/u.test(line)) return { stage: 'merging' };
  if (/^\[(ExtractAudio|VideoConvertor|FixupM4a|FixupM3u8)/u.test(line)) return { stage: 'postprocessing' };
  if (/^\[download\]\s+(Destination|100%)/u.test(line)) return { stage: 'finalising' };
  return null;
}

function toBytes(value: number, unit: string): number {
  const scale: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
  };
  return Math.round(value * (scale[unit] ?? 1));
}

function toSeconds(value: string): number {
  return value.split(':').reduce((total, part) => total * 60 + Number.parseInt(part, 10), 0);
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }, 5_000).unref();
}

function nowIso(): string {
  return new Date().toISOString();
}

function newJobId(): string {
  return `mj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listFiles(dir: string): Promise<MediaJobFile[]> {
  const out: MediaJobFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (/\.(part|ytdl|tmp)$/u.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fsp.stat(full);
      out.push({ name: entry.name, path: full, bytes: stat.size });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

export interface MediaJobsOptions {
  readonly rootDir: string;
  readonly resolveBinary: () => Promise<MediaBinary | MediaBinaryError>;
  readonly maxConcurrent?: number;
  /** One-run cookie file for a URL, when the session setting is on. */
  readonly cookieFileFor?: (url: string) => Promise<{ path: string; cleanup(): Promise<void> } | null>;
  /** Called once when a job fails because the site wants a signed-in session. */
  readonly onLoginRequired?: (job: MediaJob) => void;
  /** Base folder for job output. Defaults to `rootDir`. */
  readonly outputDir?: () => string;
  /** Resolved ffmpeg, so the selector can merge and paths can be passed explicitly. */
  readonly resolveFfmpeg?: () => Promise<{ available: boolean; path: string | null }>;
}

export class MediaJobs {
  private readonly jobs = new Map<string, MediaJob>();
  private readonly running = new Map<string, ChildProcess>();
  private readonly queue: string[] = [];
  private readonly rootDir: string;
  private readonly maxConcurrent: number;
  private readonly resolveBinary: () => Promise<MediaBinary | MediaBinaryError>;
  private readonly cookieFileFor?: MediaJobsOptions['cookieFileFor'];
  private readonly onLoginRequired?: MediaJobsOptions['onLoginRequired'];
  private readonly outputDir?: MediaJobsOptions['outputDir'];
  private readonly resolveFfmpeg?: MediaJobsOptions['resolveFfmpeg'];
  private readonly cookieCleanups = new Map<string, () => Promise<void>>();
  private persistTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: MediaJobsOptions) {
    this.rootDir = options.rootDir;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? MAX_CONCURRENT);
    this.resolveBinary = options.resolveBinary;
    this.cookieFileFor = options.cookieFileFor;
    this.onLoginRequired = options.onLoginRequired;
    this.outputDir = options.outputDir;
    this.resolveFfmpeg = options.resolveFfmpeg;
    this.load();
  }

  list(): MediaJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): MediaJob | undefined {
    return this.jobs.get(id);
  }

  counts(): { queued: number; running: number; completed: number; failed: number; cancelled: number } {
    const counts = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const job of this.jobs.values()) counts[job.state] += 1;
    return counts;
  }

  enqueue(input: MediaJobInput): MediaJob {
    const job: MediaJob = {
      id: newJobId(),
      url: input.url,
      kind: input.kind ?? 'video',
      quality: input.quality ?? 'best',
      state: 'queued',
      title: null,
      progress: null,
      files: [],
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.prune();
    this.persistSoon();
    queueMicrotask(() => void this.pump());
    return { ...job };
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.state === 'queued') {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      job.state = 'cancelled';
      job.finishedAt = nowIso();
      this.persistSoon();
      return true;
    }

    if (job.state === 'running') {
      const child = this.running.get(id);
      job.state = 'cancelled';
      job.finishedAt = nowIso();
      this.persistSoon();
      if (child) terminate(child);
      return true;
    }

    return false;
  }

  /** Kill every child and stop accepting work (app quit). */
  shutdown(): void {
    this.closed = true;
    for (const [id, child] of this.running) {
      const job = this.jobs.get(id);
      if (job) {
        job.state = 'cancelled';
        job.finishedAt = nowIso();
        job.error = { code: 'APP_QUIT', message: 'The app exited while this job was running.' };
      }
      terminate(child);
      void this.cleanupCookies(id);
    }
    this.running.clear();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  private async pump(): Promise<void> {
    if (this.closed) return;
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      void this.run(job);
    }
  }

  private async run(job: MediaJob): Promise<void> {
    const binary = await this.resolveBinary();
    if ((binary as MediaBinaryError).ok === false) {
      const error = binary as MediaBinaryError;
      this.finish(job, 'failed', { code: error.code, message: error.error });
      return;
    }

    const home = path.join(this.outputDir?.().trim() || this.rootDir, job.id);
    const temp = path.join(this.rootDir, '.tmp', job.id);
    try {
      await fsp.mkdir(home, { recursive: true });
      await fsp.mkdir(temp, { recursive: true });
    } catch (error) {
      this.finish(job, 'failed', {
        code: 'OUTPUT_DIR',
        message: `Could not create the output folder: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    const ffmpeg = await this.resolveFfmpeg?.().catch(() => ({ available: false, path: null }));
    const ffmpegDir =
      ffmpeg?.available && ffmpeg.path !== null && path.isAbsolute(ffmpeg.path) ? path.dirname(ffmpeg.path) : undefined;

    const cookies = await this.cookieFileFor?.(job.url).catch(() => null);
    if (cookies) this.cookieCleanups.set(job.id, cookies.cleanup);

    const args = buildDownloadArgs({
      url: job.url,
      kind: job.kind,
      quality: job.quality,
      home,
      temp,
      ffmpeg: ffmpeg?.available === true,
      ffmpegDir,
      cookies: cookies?.path,
    });
    const runtime = ytdlpRuntimeOptions();

    job.state = 'running';
    job.startedAt = nowIso();
    job.progress = { percent: 0, downloadedBytes: null, totalBytes: null, speedBytesPerSecond: null, etaSeconds: null, stage: 'starting' };
    this.persistSoon();

    const child = spawn((binary as MediaBinary).path, args, {
      env: runtime.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.running.set(job.id, child);

    let stderrTail = '';
    let idleTimer: NodeJS.Timeout;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        stderrTail += `\nNo progress for ${IDLE_TIMEOUT_MS / 1000}s.`;
        terminate(child);
      }, IDLE_TIMEOUT_MS);
    };
    resetIdle();

    const totalTimer = setTimeout(() => {
      stderrTail += `\nJob exceeded ${TOTAL_TIMEOUT_MS / 60_000} minutes.`;
      terminate(child);
    }, TOTAL_TIMEOUT_MS);

    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trimEnd();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        const update = parseProgressLine(line);
        if (update) {
          job.progress = { ...(job.progress ?? { percent: null, downloadedBytes: null, totalBytes: null, speedBytesPerSecond: null, etaSeconds: null, stage: 'starting' }), ...update };
          resetIdle();
        }
        const destination = line.match(/^\[download\]\s+Destination:\s+(.+)$/u);
        if (destination) job.title = path.basename(destination[1]).replace(/\.[^.]+$/u, '');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4_000);
    });

    child.on('error', (error) => {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      this.running.delete(job.id);
      void this.cleanupCookies(job.id);
      this.finish(job, 'failed', { code: 'SPAWN_FAILED', message: error.message });
    });

    child.on('close', (code) => {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      this.running.delete(job.id);
      void this.complete(job, home, temp, code, stderrTail, () => void this.pump());
    });
  }

  private async complete(
    job: MediaJob,
    home: string,
    temp: string,
    code: number | null,
    stderr: string,
    next: () => void,
  ): Promise<void> {
    await this.cleanupCookies(job.id);

    if (job.state === 'cancelled') {
      await fsp.rm(home, { recursive: true, force: true });
      await fsp.rm(temp, { recursive: true, force: true });
      this.persistSoon();
      next();
      return;
    }

    await fsp.rm(temp, { recursive: true, force: true });

    if (code === 0) {
      const files = await listFiles(home);
      if (files.length === 0) {
        this.finish(job, 'failed', { code: 'NO_OUTPUT', message: 'yt-dlp reported success but wrote no file.' }, next);
        return;
      }
      job.files = files;
      job.progress = {
        ...(job.progress ?? { percent: null, downloadedBytes: null, totalBytes: null, speedBytesPerSecond: null, etaSeconds: null, stage: 'finalising' }),
        percent: 100,
        stage: 'finalising',
      };
      this.finish(job, 'completed', null, next);
      return;
    }

    const detail = stderr.trim().split(/\r?\n/u).filter(Boolean).slice(-3).join(' ').slice(0, 500);
    const loginRequired = needsLogin(stderr);
    this.finish(
      job,
      'failed',
      {
        code: loginRequired ? 'LOGIN_REQUIRED' : 'DOWNLOAD_FAILED',
        message: detail || `yt-dlp exited with code ${code ?? 'unknown'}`,
      },
      next,
    );
    if (loginRequired) this.onLoginRequired?.(job);
  }

  private async cleanupCookies(id: string): Promise<void> {
    const cleanup = this.cookieCleanups.get(id);
    if (!cleanup) return;
    this.cookieCleanups.delete(id);
    await cleanup();
  }

  private finish(job: MediaJob, state: 'completed' | 'failed' | 'cancelled', error: { code: string; message: string } | null, next?: () => void): void {
    job.state = state;
    job.error = error;
    job.finishedAt = nowIso();
    this.persistSoon();
    next?.();
  }

  private prune(): void {
    const finished = this.list().filter((job) => job.state !== 'queued' && job.state !== 'running');
    for (const job of finished.slice(MAX_JOBS)) {
      this.jobs.delete(job.id);
      void fsp.rm(path.join(this.rootDir, job.id), { recursive: true, force: true });
    }
  }

  private load(): void {
    const file = path.join(this.rootDir, 'jobs.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { jobs?: MediaJob[] };
      for (const stored of parsed.jobs ?? []) {
        if (!stored || typeof stored.id !== 'string') continue;
        // A job that was running when the app died cannot be resumed.
        const job: MediaJob = stored.state === 'running' || stored.state === 'queued'
          ? { ...stored, state: 'failed', error: { code: 'INTERRUPTED', message: 'The app exited while this job was pending.' }, finishedAt: nowIso() }
          : stored;
        this.jobs.set(job.id, job);
      }
    } catch {
      // No history yet, or unreadable: start empty.
    }
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 250);
    this.persistTimer.unref?.();
  }

  private persist(): void {
    try {
      fs.mkdirSync(this.rootDir, { recursive: true });
      const payload = { jobs: this.list().slice(0, MAX_JOBS) };
      const file = path.join(this.rootDir, 'jobs.json');
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, file);
    } catch {
      // History is a convenience; never fail a job because it could not be saved.
    }
  }
}
