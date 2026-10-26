import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

const require =
  typeof __filename === 'string' ? createRequire(__filename) : createRequire(import.meta.url);

/**
 * The writable root for runtime data (downloads, Cortex, recipes, settings, logs).
 *
 * Installed apps are often started with `process.cwd()` pointing at a read-only location
 * (Program Files, System32, an installer temp dir). Writing `data/` relative to cwd then crashes
 * the main process before the window exists. Packaged builds therefore use Electron's userData
 * directory. Development keeps the repo-local `data/` folder.
 *
 * Tests run under plain Node, where `require('electron')` is a path string rather than the API;
 * those fall back to cwd/data exactly as before.
 */
function packagedUserDataDir(): string | null {
  try {
    const electron = require('electron') as {
      app?: { isPackaged?: boolean; getPath?: (name: string) => string };
    };
    if (electron?.app?.isPackaged && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch {
    // Not running inside Electron.
  }
  return null;
}

function migrateLegacyData(target: string, legacy: string): void {
  if (path.resolve(target) === path.resolve(legacy)) return;
  if (!fs.existsSync(legacy) || fs.existsSync(target)) return;
  // Only migrate a directory that actually looks like Kuang's data. The working directory can be
  // the user's home or `/` on macOS/Linux, where a generic `data` folder may belong to something else.
  const markers = ['cortex', 'sessions', 'recipes.json', 'shadow-walk.json', 'input-profile.json', 'decision.json'];
  if (!markers.some((name) => fs.existsSync(path.join(legacy, name)))) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(legacy, target, { recursive: true, force: false, errorOnExist: false });
  } catch {
    // Migration is best-effort; a fresh data directory is still usable.
  }
}

function ensureWritable(candidate: string): string | null {
  try {
    fs.mkdirSync(candidate, { recursive: true });
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch {
    return null;
  }
}

let cachedRoot: string | null = null;

export function dataRoot(): string {
  if (cachedRoot) return cachedRoot;

  const override = process.env.KUANG_DATA_DIR?.trim();
  if (override) {
    cachedRoot = path.resolve(override);
    fs.mkdirSync(cachedRoot, { recursive: true });
    return cachedRoot;
  }

  const userData = packagedUserDataDir();
  if (userData) {
    const target = path.join(userData, 'data');
    migrateLegacyData(target, path.join(process.cwd(), 'data'));
    const writable = ensureWritable(target);
    if (writable) {
      cachedRoot = writable;
      return cachedRoot;
    }
  }

  const cwdData = ensureWritable(path.join(process.cwd(), 'data'));
  if (cwdData) {
    cachedRoot = cwdData;
    return cachedRoot;
  }

  // Last resort for standalone MCP processes launched from a read-only cwd.
  const temporary = ensureWritable(path.join(os.tmpdir(), 'kuang-data'));
  if (temporary) {
    cachedRoot = temporary;
    return cachedRoot;
  }

  throw new Error('No writable runtime data directory is available.');
}

export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}
