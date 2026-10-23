/**
 * Constant-time checks for the local wrap bridge capability token.
 *
 * The bridge binds to 127.0.0.1, but loopback is shared: without this gate any
 * local process could create wrappers or spend an API budget. The token is
 * deliberately separate from API credentials and carries no upstream rights.
 */

import crypto from 'node:crypto';

export function tokenFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const authorization = headers.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  const alternate = headers['x-kuang-wrap-token'];
  if (typeof alternate === 'string') return alternate.trim();
  if (Array.isArray(alternate)) return String(alternate[0] || '').trim();
  return '';
}

export function isWrapAuthorized(supplied: string, expected: string): boolean {
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
