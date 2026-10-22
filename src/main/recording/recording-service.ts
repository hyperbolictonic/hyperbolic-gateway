/**
 * Timelapse recorder — main-process side.
 *
 * The capture and encoding happen in the renderer (desktopCapturer streams and WebCodecs only
 * exist there); this service owns configuration, the window source, the file, and the registry of
 * recordings. It also exposes the finished path, which is the point of the feature: an agent can
 * take a timelapse and then type that absolute path into a file-upload field.
 *
 * Frames are captured every `intervalMs` and stamped as if they were `fps` apart, so a 10-minute
 * session becomes a ~20-second video at the default 1 fps / 30 fps settings. MediaRecorder cannot
 * do that (it always stamps in real time), which is why the renderer uses VideoEncoder directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';

export interface RecordingConfig {
  /** Whether the recorder is available at all (the REC button and the tools). */
  enabled: boolean;
  /**
   * Human-only master switch for the MCP recording tools. Not exposed to any tool or HTTP
   * route that an agent can reach: it is only written from the Settings panel over IPC.
   */
  toolsEnabled: boolean;
  /** Absolute directory for finished files. */
  outputDir: string;
  /** Real milliseconds between captured frames. */
  intervalMs: number;
  /** Playback frame rate of the timelapse. */
  fps: number;
  /** Downscale width (height follows the window aspect). */
  maxWidth: number;
  /** Video bitrate in bits/second. */
  bitrate: number;
}

export interface RecordingResult {
  path: string;
  filename: string;
  bytes: number;
  frames: number;
  durationMs: number;
  /** Seconds of video produced (frames / fps). */
  videoSeconds: number;
  /** Playback speed-up factor relative to real time. */
  speedup: number;
}

export interface RecordingStatus {
  recording: boolean;
  enabled: boolean;
  /** Human-only switch; false means the recording tools are hidden and refused. */
  toolsEnabled: boolean;
  filename?: string;
  startedAt?: number;
  frames?: number;
  lastResult?: RecordingResult;
  error?: string;
}

const DEFAULT_CONFIG = (): RecordingConfig => ({
  enabled: true,
  toolsEnabled: true,
  outputDir: path.join(app.getPath('userData'), 'recordings'),
  intervalMs: 1000,
  fps: 30,
  maxWidth: 1280,
  bitrate: 3_000_000,
});

function configPath(): string {
  return path.join(app.getPath('userData'), 'recording.json');
}

let mainWindow: BrowserWindow | null = null;
let config: RecordingConfig = DEFAULT_CONFIG();
let status: RecordingStatus = { recording: false, enabled: true, toolsEnabled: true };
let statusListener: ((s: RecordingStatus) => void) | null = null;
let pending: { filename: string; startedAt: number; resolve: (r: RecordingResult) => void; reject: (e: Error) => void } | null = null;
let pendingStart: {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
} | null = null;
let startBarrier: Promise<void> | null = null;

export function onRecordingStatus(cb: (s: RecordingStatus) => void): void {
  statusListener = cb;
}

function setStatus(next: Partial<RecordingStatus>): void {
  status = { ...status, ...next };
  try {
    statusListener?.(getRecordingStatus());
  } catch {
    // A UI listener must never break the recorder.
  }
}

export function setRecordingWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function loadRecordingConfig(): RecordingConfig {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...DEFAULT_CONFIG(), ...stored };
  } catch {
    config = DEFAULT_CONFIG();
  }
  status.enabled = config.enabled;
  status.toolsEnabled = config.toolsEnabled;
  return config;
}

export function getRecordingConfig(): RecordingConfig {
  return { ...config };
}

export function saveRecordingConfig(input: Partial<RecordingConfig>): RecordingConfig {
  const next: RecordingConfig = {
    ...config,
    ...input,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : config.enabled,
    toolsEnabled: typeof input.toolsEnabled === 'boolean' ? input.toolsEnabled : config.toolsEnabled,
    intervalMs: clamp(Number(input.intervalMs ?? config.intervalMs), 200, 60_000),
    fps: clamp(Number(input.fps ?? config.fps), 5, 60),
    maxWidth: clamp(Number(input.maxWidth ?? config.maxWidth), 480, 1920),
    bitrate: clamp(Number(input.bitrate ?? config.bitrate), 500_000, 20_000_000),
  };
  if (typeof next.outputDir === 'string' && next.outputDir.trim()) {
    next.outputDir = path.resolve(next.outputDir.trim());
  } else {
    next.outputDir = DEFAULT_CONFIG().outputDir;
  }
  config = next;
  status.enabled = next.enabled;
  status.toolsEnabled = next.toolsEnabled;
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.mkdirSync(next.outputDir, { recursive: true });
  } catch {
    // Keep the in-memory config even if the file cannot be written.
  }
  return { ...config };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getRecordingStatus(): RecordingStatus {
  return { ...status };
}

export async function pickRecordingDir(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose where timelapses are saved',
    defaultPath: config.outputDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Start recording the Cyberdeck window. Resolves when the renderer has the stream running. */
export async function startRecording(name?: string): Promise<{ filename: string; config: RecordingConfig }> {
  if (!config.enabled) throw new Error('Recording is disabled in Settings.');
  if (status.recording) throw new Error('Already recording.');
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('No window to record.');

  fs.mkdirSync(config.outputDir, { recursive: true });
  const filename = `${timestamp()}${name ? `-${slug(name)}` : ''}.webm`;
  const startedAt = Date.now();

  const sourceId = mainWindow.getMediaSourceId();

  // Do not report success until the renderer has a live encoder. `record_start` becomes an
  // honest "the recording is running" signal, and a stop racing ahead of capture is impossible.
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingStart) {
        pendingStart = null;
        startBarrier = null;
        failRecording('Timed out starting the recording.');
      }
      reject(new Error('Timed out starting the recording.'));
    }, 15_000);
    timer.unref?.();
    pendingStart = { resolve, reject, timer };
  });
  startBarrier = ready.catch(() => undefined);

  mainWindow.webContents.send('recording:begin', {
    sourceId,
    filename,
    intervalMs: config.intervalMs,
    fps: config.fps,
    maxWidth: config.maxWidth,
    bitrate: config.bitrate,
  });

  setStatus({ recording: true, enabled: config.enabled, filename, startedAt, frames: 0, error: undefined });

  try {
    await ready;
  } finally {
    startBarrier = null;
  }
  return { filename, config: { ...config } };
}

/** Called by the renderer once the stream and encoder are actually running. */
export function readyRecording(): void {
  const start = pendingStart;
  if (!start) return;
  pendingStart = null;
  clearTimeout(start.timer);
  start.resolve();
}

/** Ask the renderer to finalise; the file is written when it calls `saveRecording`. */
export async function stopRecording(): Promise<RecordingResult> {
  // A stop can arrive while the renderer is still opening the capture stream. Wait for that
  // handshake instead of failing (and instead of leaving an orphaned recording running).
  if (startBarrier) {
    await startBarrier;
  }
  if (!status.recording) {
    if (status.lastResult) return status.lastResult;
    throw new Error(status.error || 'Not recording.');
  }
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Window disappeared.');

  const startedAt = status.startedAt || Date.now();
  const filename = status.filename || `${timestamp()}.webm`;

  return new Promise<RecordingResult>((resolve, reject) => {
    pending = { filename, startedAt, resolve, reject };
    mainWindow!.webContents.send('recording:stop');
    setTimeout(() => {
      if (pending && pending.filename === filename) {
        pending = null;
        setStatus({ recording: false, error: 'timed out finalising the recording' });
        reject(new Error('Timed out finalising the recording.'));
      }
    }, 30_000).unref?.();
  });
}

/** Called from the renderer with the finished WebM bytes. */
export function saveRecording(buffer: ArrayBuffer, frames: number): RecordingResult {
  const active = pending;
  if (!active) throw new Error('No recording to save.');
  pending = null;

  const data = Buffer.from(buffer);
  const target = path.join(config.outputDir, active.filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);

  const durationMs = Date.now() - active.startedAt;
  const videoSeconds = frames / Math.max(1, config.fps);
  const result: RecordingResult = {
    path: target,
    filename: active.filename,
    bytes: data.length,
    frames,
    durationMs,
    videoSeconds: Number(videoSeconds.toFixed(2)),
    speedup: videoSeconds > 0 ? Number((durationMs / 1000 / videoSeconds).toFixed(1)) : 0,
  };
  setStatus({ recording: false, frames, lastResult: result, error: undefined });
  active.resolve(result);
  return result;
}

export function failRecording(message: string): void {
  setStatus({ recording: false, error: message });
  const start = pendingStart;
  pendingStart = null;
  if (start) {
    clearTimeout(start.timer);
    start.reject(new Error(message));
  }
  const active = pending;
  pending = null;
  active?.reject(new Error(message));
}

/** Finished recordings, newest first. Paths are absolute and ready for a file-upload field. */
export function listRecordings(limit = 50): Array<{ path: string; filename: string; bytes: number; modified: number }> {
  try {
    fs.mkdirSync(config.outputDir, { recursive: true });
    return fs
      .readdirSync(config.outputDir)
      .filter((name) => name.toLowerCase().endsWith('.webm'))
      .map((name) => {
        const full = path.join(config.outputDir, name);
        const stat = fs.statSync(full);
        return { path: full, filename: name, bytes: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified)
      .slice(0, Math.max(1, Math.min(limit, 500)));
  } catch {
    return [];
  }
}
