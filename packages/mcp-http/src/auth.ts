import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { McpHttpAuth, McpHttpAuthorize } from './types.ts';

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/** Read a bearer token from the Authorization header. */
export function readBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = BEARER_PATTERN.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Constant-time comparison for equal-length tokens. */
export function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Build an authorizer that reads the expected token on every request.
 * Reading per request lets the app rotate the token without restarting the host.
 */
export function createBearerAuthorizer(
  readExpectedToken: () => string | undefined,
  subject = 'remote',
): McpHttpAuthorize {
  return (request: IncomingMessage): McpHttpAuth | null => {
    const actual = readBearerToken(request);
    const expected = readExpectedToken();
    if (!actual || !expected || !tokensMatch(actual, expected)) return null;
    return { subject };
  };
}
