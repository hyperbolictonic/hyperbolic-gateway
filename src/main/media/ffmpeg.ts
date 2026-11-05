/**
 * ffmpeg resolution and the optional managed install.
 *
 * Modes:
 *  - `auto`    configured binary → managed copy → `ffmpeg` on PATH
 *  - `path`    only the configured binary
 *  - `managed` only the copy downloaded into `<userData>/media/bin/ffmpeg`
 *
 * Without ffmpeg yt-dlp still downloads a single-file MP4 and an audio-only
 * stream. Merging `bestvideo+bestaudio` and any transcoding need it, and those
 * capabilities are reported rather than promised.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import type { FfmpegMode, MediaSettings } from '../../shared/media.ts';

const execFileAsync = promisify(execFile);

const RELEASE = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;

/** Pinned managed builds. SHA-256 computed from the release `.gz` assets. */
const MANAGED: Record<string, { ffmpeg: string; ffprobe: string; license: string }> = {
  'win32-x64': {
    ffmpeg: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    ffprobe: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
    license: 'win32-x64.LICENSE',
  },
  'linux-x64': {
    ffmpeg: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
    ffprobe: '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067',
    license: 'linux-x64.LICENSE',
  },
  'darwin-arm64': {
    ffmpeg: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
    ffprobe: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
    license: 'darwin-arm64.LICENSE',
  },
};

export type FfmpegSource = 'configured' | 'managed' | 'system';

export interface FfmpegInfo {
  readonly available: boolean;
  readonly version: string | null;
  readonly source: FfmpegSource | null;
  readonly path: string | null;
  readonly mode: FfmpegMode;
  readonly installing: boolean;
  readonly error: string | null;
}

export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function managedFfmpegDir(rootDir: string): string {
  return path.join(rootDir, 'bin', 'ffmpeg');
}

export function ffmpegFileName(platform: string = process.platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

export function managedFfmpegPath(rootDir: string, platform: string = process.platform): string {
  return path.join(managedFfmpegDir(rootDir), ffmpegFileName(platform));
}

/** `ffmpeg version 6.1.1-...` → `6.1.1-...` */
export function parseFfmpegVersion(output: string): string | null {
  const match = output.match(/^ffmpeg version (\S+)/imu);
  return match ? match[1] : null;
}

async function probe(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['-version'], { timeout: 10_000, windowsHide: true });
    return parseFfmpegVersion(stdout);
  } catch {
    return null;
  }
}

async function findConfigured(settings: MediaSettings): Promise<{ path: string; version: string } | null> {
  const candidate = settings.ffmpegPath.trim();
  if (candidate === '') return null;
  const version = await probe(candidate);
  return version === null ? null : { path: candidate, version };
}

async function findManaged(rootDir: string): Promise<{ path: string; version: string } | null> {
  const candidate = managedFfmpegPath(rootDir);
  if (!fs.existsSync(candidate)) return null;
  const version = await probe(candidate);
  return version === null ? null : { path: candidate, version };
}

async function findSystem(): Promise<{ path: string; version: string } | null> {
  const version = await probe('ffmpeg');
  return version === null ? null : { path: 'ffmpeg', version };
}

/**
 * Resolve ffmpeg for the current settings. `installing` is supplied by the
 * service so a status poll during a managed download says so.
 */
export async function detectFfmpeg(
  settings: MediaSettings,
  rootDir: string,
  installing = false,
): Promise<FfmpegInfo> {
  const mode = settings.ffmpegMode;
  const base = { mode, installing };

  if (mode === 'path') {
    const found = await findConfigured(settings);
    return found
      ? { ...base, available: true, source: 'configured', path: found.path, version: found.version, error: null }
      : {
          ...base,
          available: false,
          source: null,
          path: null,
          version: null,
          error: 'ffmpegPath is not set to a runnable ffmpeg binary.',
        };
  }

  if (mode === 'managed') {
    const found = await findManaged(rootDir);
    return found
      ? { ...base, available: true, source: 'managed', path: found.path, version: found.version, error: null }
      : {
          ...base,
          available: false,
          source: null,
          path: null,
          version: null,
          error: 'The managed ffmpeg is not installed. Use "Install ffmpeg" in Settings → Media.',
        };
  }

  const configured = await findConfigured(settings);
  if (configured) {
    return { ...base, available: true, source: 'configured', path: configured.path, version: configured.version, error: null };
  }
  const managed = await findManaged(rootDir);
  if (managed) {
    return { ...base, available: true, source: 'managed', path: managed.path, version: managed.version, error: null };
  }
  const system = await findSystem();
  if (system) {
    return { ...base, available: true, source: 'system', path: system.path, version: system.version, error: null };
  }
  return {
    ...base,
    available: false,
    source: null,
    path: null,
    version: null,
    error: 'No ffmpeg found. Merging and transcoding are unavailable until one is configured or installed.',
  };
}

async function downloadVerified(url: string, expectedSha256: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(compressed).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`checksum mismatch for ${path.basename(url)}: expected ${expectedSha256}, got ${actual}`);
  }
  await fsp.writeFile(destination, zlib.gunzipSync(compressed));
  if (process.platform !== 'win32') await fsp.chmod(destination, 0o755);
}

let inFlightInstall: Promise<FfmpegInfo> | null = null;

/**
 * Download the pinned managed build for this platform. Idempotent while a
 * download is running, so a second click or a status poll cannot start two.
 */
export async function installManagedFfmpeg(settings: MediaSettings, rootDir: string): Promise<FfmpegInfo> {
  if (inFlightInstall) return inFlightInstall;

  const key = platformKey();
  const entry = MANAGED[key];
  if (!entry) {
    return {
      available: false,
      version: null,
      source: null,
      path: null,
      mode: settings.ffmpegMode,
      installing: false,
      error: `No managed ffmpeg build for ${key}. Set a path or install ffmpeg yourself.`,
    };
  }

  inFlightInstall = (async () => {
    const dir = managedFfmpegDir(rootDir);
    await fsp.mkdir(dir, { recursive: true });
    const ffmpeg = path.join(dir, ffmpegFileName());
    const ffprobe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

    await downloadVerified(`${BASE}/ffmpeg-${key}.gz`, entry.ffmpeg, `${ffmpeg}.install`);
    await downloadVerified(`${BASE}/ffprobe-${key}.gz`, entry.ffprobe, `${ffprobe}.install`);
    await fsp.rename(`${ffmpeg}.install`, ffmpeg);
    await fsp.rename(`${ffprobe}.install`, ffprobe);

    try {
      const license = await fetch(`${BASE}/${entry.license}`, { redirect: 'follow' });
      if (license.ok) await fsp.writeFile(path.join(dir, 'LICENSE-ffmpeg.txt'), await license.text());
    } catch {
      // The licence text is documentation; its absence must not fail the install.
    }

    return detectFfmpeg(settings, rootDir, false);
  })().finally(() => {
    inFlightInstall = null;
  });

  return inFlightInstall;
}
