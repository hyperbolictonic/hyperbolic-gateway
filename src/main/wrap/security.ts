/**
 * Outbound request policy.
 *
 * Wrappers point at arbitrary APIs, so the executor — not the agent — decides
 * what a legal destination is. HTTPS is the default, credentials in URLs are
 * rejected, and every DNS answer is checked against private, loopback,
 * link-local, and metadata ranges before a connection is attempted.
 *
 * A local development API is legitimate, but it is opt-in: set
 * `KUANG_WRAP_ALLOW_PRIVATE=1` or pass `allowPrivateHosts` explicitly.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

export class WrapSecurityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WrapSecurityError';
    this.code = code;
  }
}

export interface UrlPolicy {
  allowPrivateHosts?: boolean;
  allowHttp?: boolean;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export async function assertSafeUrl(rawUrl: string, policy: UrlPolicy = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WrapSecurityError('INVALID_URL', `"${rawUrl}" is not a valid URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WrapSecurityError('BLOCKED_PROTOCOL', `Only http and https are allowed (got ${url.protocol}).`);
  }

  if (url.protocol === 'http:' && !policy.allowHttp && !policy.allowPrivateHosts) {
    throw new WrapSecurityError(
      'BLOCKED_PROTOCOL',
      'Plain http is only allowed for an explicitly allowed local host. Use https, or set KUANG_WRAP_ALLOW_HTTP=1.',
    );
  }

  if (url.username || url.password) {
    throw new WrapSecurityError('BLOCKED_URL_CREDENTIALS', 'Credentials in a URL are not allowed; use a secret.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new WrapSecurityError('INVALID_URL', 'The URL has no host.');

  if (policy.allowPrivateHosts) return url;

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new WrapSecurityError(
      'BLOCKED_HOST',
      `"${hostname}" is a private host. Set KUANG_WRAP_ALLOW_PRIVATE=1 to allow local APIs.`,
    );
  }

  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const resolve = policy.resolveHost || defaultResolveHost;
      addresses = await resolve(hostname);
    } catch (err: any) {
      throw new WrapSecurityError('DNS_LOOKUP_FAILED', `Could not resolve "${hostname}": ${err?.message || err}`);
    }
  }

  if (addresses.length === 0) {
    throw new WrapSecurityError('DNS_LOOKUP_FAILED', `"${hostname}" resolved to no addresses.`);
  }

  const blocked = addresses.filter((address) => isPrivateAddress(address));
  if (blocked.length > 0) {
    throw new WrapSecurityError(
      'BLOCKED_ADDRESS',
      `"${hostname}" resolves to a private address (${blocked.join(', ')}). ` +
        'Set KUANG_WRAP_ALLOW_PRIVATE=1 to allow local APIs.',
    );
  }

  return url;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (net.isIPv4(value)) return isPrivateV4(value);
  if (net.isIPv6(value)) return isPrivateV6(value);

  // A malformed answer is not something to connect to.
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  const [a, b] = parts;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  if (a === 255 && b === 255) return true;

  return false;
}

function isPrivateV6(address: string): boolean {
  if (address === '::' || address === '::1') return true;

  // IPv4-mapped and IPv4-compatible forms.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);

  const hexMapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPrivateV4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }

  const first = address.split(':')[0];
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(first)) return true; // link local
  if (first.startsWith('ff')) return true; // multicast
  if (address.startsWith('2001:db8:')) return true; // documentation

  return false;
}
