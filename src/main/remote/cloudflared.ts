import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COMMON_PATHS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
  '/usr/bin/cloudflared',
  path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
];

function usable(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Find cloudflared without installing or downloading it. */
export function findCloudflared(explicit?: string, managedPath?: string): string | undefined {
  const configured = explicit?.trim();
  if (configured) {
    if (configured.includes(path.sep) || configured.includes('/')) {
      return usable(configured) ? configured : undefined;
    }
    const fromPath = searchPath(configured);
    return fromPath || (usable(configured) ? configured : undefined);
  }

  if (managedPath && usable(managedPath)) return managedPath;
  const fromPath = searchPath('cloudflared');
  if (fromPath) return fromPath;
  return COMMON_PATHS.find(usable);
}

function searchPath(command: string): string | undefined {
  const raw = process.env.PATH || '';
  const names =
    process.platform === 'win32'
      ? command.toLowerCase().endsWith('.exe')
        ? [command]
        : [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];
  for (const directory of raw.split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (usable(candidate)) return candidate;
    }
  }
  return undefined;
}
