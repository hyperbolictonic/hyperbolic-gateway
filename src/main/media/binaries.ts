/**
 * yt-dlp binary resolution for the installed app.
 *
 * Two copies exist:
 *  - the seed shipped with the build (`resources/app.asar.unpacked/bin/media/<key>`),
 *    which is read-only on macOS and on AppImage mounts;
 *  - a writable copy in `<userData>/media/bin/`, which the updater replaces.
 *
 * The writable copy wins once it exists. It is refreshed from the seed only when
 * the source is missing or when the app ships a *newer* yt-dlp than the copy, so
 * a runtime update is never undone by the next launch.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

import { compareYtDlpVersions, mediaPlatformKey, ytDlpFileName } from './platform.ts';

const execFileAsync = promisify(execFile);

export type MediaBinarySource = 'bundled' | 'user-data';

export interface MediaBinary {
  readonly path: string;
  readonly version: string | null;
  readonly source: MediaBinarySource;
}

export interface MediaBinaryError {
  readonly ok: false;
  readonly code: 'BINARY_MISSING' | 'BINARY_BROKEN';
  readonly error: string;
}

export function bundledYtDlpPath(): string {
  const key = mediaPlatformKey();
  const name = ytDlpFileName();
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'media', key, name)
    : path.join(app.getAppPath(), 'bin', 'media', key, name);
}

export function writableYtDlpPath(): string {
  return path.join(app.getPath('userData'), 'media', 'bin', ytDlpFileName());
}

/** Run `<binary> --version`; null means it did not execute or printed nothing. */
export async function readYtDlpVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 15_000, windowsHide: true });
    const version = stdout.trim();
    return version === '' ? null : version;
  } catch {
    return null;
  }
}

async function copySeed(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.seed`;
  await fsp.copyFile(source, temp);
  if (process.platform !== 'win32') await fsp.chmod(temp, 0o755);
  await fsp.rename(temp, target);
}

/**
 * The yt-dlp this process should run, or a typed error when neither copy works.
 *
 * Copying is idempotent: it only happens when the writable copy is missing, or
 * when the seed is newer than it.
 */
export async function ensureYtDlp(): Promise<MediaBinary | MediaBinaryError> {
  const seed = bundledYtDlpPath();
  const writable = writableYtDlpPath();
  const seedExists = fs.existsSync(seed);
  const writableExists = fs.existsSync(writable);

  if (!seedExists && !writableExists) {
    return {
      ok: false,
      code: 'BINARY_MISSING',
      error: 'yt-dlp is not present in this build. Run "npm run fetch:media" before packaging.',
    };
  }

  if (!writableExists) {
    if (!seedExists) {
      return { ok: false, code: 'BINARY_MISSING', error: 'The yt-dlp seed binary is missing.' };
    }
    await copySeed(seed, writable);
  } else if (seedExists) {
    const [writableVersion, seedVersion] = await Promise.all([readYtDlpVersion(writable), readYtDlpVersion(seed)]);
    if (compareYtDlpVersions(seedVersion, writableVersion) > 0) {
      await copySeed(seed, writable);
    }
  }

  const version = await readYtDlpVersion(writable);
  if (version !== null) return { path: writable, version, source: 'user-data' };

  // A writable copy that no longer runs (interrupted update, bad permissions):
  // fall back to the seed and repair the copy.
  if (seedExists) {
    const seedVersion = await readYtDlpVersion(seed);
    if (seedVersion !== null) {
      await copySeed(seed, writable);
      return { path: writable, version: seedVersion, source: 'user-data' };
    }
    return { path: seed, version: null, source: 'bundled' };
  }

  return {
    ok: false,
    code: 'BINARY_BROKEN',
    error: 'The yt-dlp binary exists but cannot be executed.',
  };
}

export function isMediaBinary(value: MediaBinary | MediaBinaryError): value is MediaBinary {
  return (value as MediaBinaryError).ok !== false;
}
