/**
 * Browser-session cookies for yt-dlp.
 *
 * A download that needs a signed-in session gets a scoped Netscape cookie file
 * written for exactly one run, passed with `--cookies`, and deleted by the
 * caller. The file is a credential: 0600 on POSIX, never logged, never kept
 * after the call, and never stored in job history.
 *
 * Scope is the requested URL, so yt-dlp sees the cookies the browser would send
 * to that host and nothing else.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { session as electronSession, type Cookie, type Session } from 'electron';

import { toNetscape } from './cookie-format.ts';

export interface CookieFile {
  readonly path: string;
  readonly count: number;
  cleanup(): Promise<void>;
}

/**
 * Write the cookies for `url` (the browser would send this host) to a temp file.
 * Returns null when there is nothing to send.
 */
export async function writeCookieFile(
  url: string,
  dir: string,
  browserSession: Session = electronSession.defaultSession,
): Promise<CookieFile | null> {
  let cookies: Cookie[];
  try {
    cookies = await browserSession.cookies.get({ url });
  } catch {
    return null;
  }
  if (cookies.length === 0) return null;

  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `cookies-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.txt`);
  await fsp.writeFile(file, toNetscape(cookies), { mode: 0o600 });
  if (process.platform !== 'win32') await fsp.chmod(file, 0o600);

  return {
    path: file,
    count: cookies.length,
    cleanup: async () => {
      await fsp.rm(file, { force: true }).catch(() => undefined);
    },
  };
}
