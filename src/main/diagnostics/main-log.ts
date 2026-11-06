import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../data-paths.js';

/**
 * Append-only diagnostics for failures that would otherwise leave a packaged
 * Windows build with no trace: renderer crashes, GPU/utility process exits,
 * unresponsive windows and the automatic recovery that follows.
 *
 * Kept deliberately tiny and synchronous: the main process may be about to
 * exit, and this file is the only evidence a user can send back.
 */
let logFile: string | null = null;

function resolveFile(): string {
  if (logFile) return logFile;
  const dir = dataPath('logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'main.log');
  return logFile;
}

export function mainLogFile(): string {
  try {
    return resolveFile();
  } catch {
    return '';
  }
}

export function logMainEvent(kind: string, details: Record<string, unknown> = {}): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), kind, ...details })}\n`;
  try {
    const file = resolveFile();
    try {
      if (fs.statSync(file).size > 2 * 1024 * 1024) fs.writeFileSync(file, '');
    } catch {
      // First write, or a locked/renamed file: append will create it.
    }
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    // Diagnostics must never take the app down.
  }
  try {
    console.error(`[hypagon:${kind}] ${line.trim()}`);
  } catch {
    // A closed stdout/stderr pipe is not an application error.
  }
}
