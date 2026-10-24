/**
 * Encrypted, host-bound credentials for Kuang Wrap.
 *
 * The MCP process only ever holds a *secret name*. Values are entered through
 * Settings, encrypted by Electron's OS-backed `safeStorage`, and resolved in
 * main at request time. A secret is useless unless the request host matches one
 * of its human-authored `allowedHosts`.
 *
 * The cipher is injected so this module stays testable without Electron.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertSafeUrl } from './security.ts';

export type WrapSecretKind = 'static' | 'oauth2';

export interface WrapOAuthMetadata {
  tokenUrl: string;
  clientId: string;
  scope?: string;
  audience?: string;
  /** When the cached access token expires (ISO). The token itself never leaves main. */
  tokenExpiresAt?: string;
}

export interface WrapSecretMetadata {
  name: string;
  allowedHosts: string[];
  header: string;
  prefix: string;
  createdAt: string;
  updatedAt: string;
  /** `static` (default) or `oauth2` client-credentials. */
  kind: WrapSecretKind;
  oauth2?: WrapOAuthMetadata;
}

export interface WrapSecretInput {
  name: string;
  value: string;
  allowedHosts: string[] | string;
  header?: string;
  prefix?: string;
  kind?: WrapSecretKind;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  audience?: string;
}

export interface SecretCipher {
  available(): boolean;
  warning?: string;
  encrypt(value: string): string;
  decrypt(payload: string): string;
}

export interface SecretResolution {
  ok: boolean;
  header?: string;
  value?: string;
  code?: string;
  message?: string;
  /** True when the credential is an OAuth2 token that can be re-minted. */
  refreshable?: boolean;
}

export interface TokenRequest {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}

export interface TokenResult {
  accessToken: string;
  /** Lifetime in seconds. */
  expiresIn: number;
  tokenType?: string;
}

export type TokenMinter = (input: TokenRequest) => Promise<TokenResult>;

export interface SecretStoreOptions {
  /** Injected for tests; defaults to a policy-checked POST to the token URL. */
  mintToken?: TokenMinter;
  /** Injected clock (ms) for token-expiry tests. */
  now?: () => number;
}

interface SecretRecord extends WrapSecretMetadata {
  /** Static value, or the OAuth2 client secret. */
  ciphertext: string;
  /** Cached OAuth2 access token (encrypted). */
  tokenCiphertext?: string;
}

interface SecretFile {
  schemaVersion: 1;
  secrets: SecretRecord[];
}

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const HEADER_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'cookie', 'set-cookie']);
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export class SecretStore {
  readonly dir: string;
  private readonly cipher: SecretCipher;
  private readonly options: SecretStoreOptions;

  constructor(dir: string, cipher: SecretCipher, options: SecretStoreOptions = {}) {
    this.dir = dir;
    this.cipher = cipher;
    this.options = options;
  }

  available(): boolean {
    try {
      return this.cipher.available();
    } catch {
      return false;
    }
  }

  warning(): string {
    return this.cipher.warning || '';
  }

  count(): number {
    return this.readFile().secrets.length;
  }

  list(): WrapSecretMetadata[] {
    return this.readFile()
      .secrets.map((secret) => metadataOf(secret))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  set(input: WrapSecretInput): { ok: boolean; secret?: WrapSecretMetadata; errors: string[] } {
    const errors: string[] = [];
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const value = typeof input?.value === 'string' ? input.value : '';

    if (!this.available()) {
      return {
        ok: false,
        errors: [
          this.warning() ||
            'OS-backed encryption is unavailable, so secrets are disabled. On Linux, install a keyring and restart.',
        ],
      };
    }

    if (!NAME_PATTERN.test(name) || name.length > 64) {
      errors.push('name must start with a lowercase letter and use only lowercase letters, numbers, dot, dash, or underscore');
    }

    const file = this.readFile();
    const existing = file.secrets.find((secret) => secret.name === name);
    const keepExisting = Boolean(existing) && value === '';
    if (!value && !keepExisting) errors.push('value is required');
    if (value.length > 20_000) errors.push('value must be 20000 characters or fewer');
    if (/[\r\n]/.test(value)) errors.push('value must not contain newlines');

    const hosts = normalizeHosts(input?.allowedHosts);
    if (hosts.length === 0) errors.push('allowedHosts must contain at least one host');
    if (hosts.length > 20) errors.push('allowedHosts must contain at most 20 hosts');
    for (const host of hosts) {
      if (!HOST_PATTERN.test(host) || host.includes('..') || host.length > 253) {
        errors.push(`allowedHosts entry "${host}" is not a valid hostname`);
      }
    }

    const header = typeof input?.header === 'string' && input.header.trim() ? input.header.trim() : 'Authorization';
    if (!HEADER_PATTERN.test(header)) errors.push('header must be a valid HTTP header name');
    if (FORBIDDEN_HEADERS.has(header.toLowerCase())) errors.push(`header "${header}" cannot carry a secret`);

    const prefix =
      typeof input?.prefix === 'string'
        ? input.prefix
        : header.toLowerCase() === 'authorization'
          ? 'Bearer '
          : '';
    if (header.toLowerCase() === 'authorization' && !/^[A-Za-z]+\s+$/.test(prefix)) {
      errors.push('prefix for Authorization must be a scheme followed by a space, such as "Bearer "');
    }
    if (/[\r\n]/.test(prefix)) errors.push('prefix must not contain newlines');
    if (prefix.length > 80) errors.push('prefix must be 80 characters or fewer');

    const kind: WrapSecretKind = input?.kind === 'oauth2' ? 'oauth2' : 'static';
    let oauth2: WrapOAuthMetadata | undefined;
    if (kind === 'oauth2') {
      const tokenUrl = typeof input?.tokenUrl === 'string' ? input.tokenUrl.trim() : '';
      const clientId = typeof input?.clientId === 'string' ? input.clientId.trim() : '';
      const scope = typeof input?.scope === 'string' ? input.scope.trim() : '';
      const audience = typeof input?.audience === 'string' ? input.audience.trim() : '';

      try {
        const parsed = new URL(tokenUrl);
        if (parsed.protocol !== 'https:') errors.push('tokenUrl must use https');
        if (parsed.username || parsed.password) errors.push('tokenUrl must not contain credentials');
      } catch {
        errors.push('tokenUrl must be an absolute https URL');
      }
      if (!clientId) errors.push('clientId is required for an OAuth2 credential');
      if (clientId.length > 500) errors.push('clientId must be 500 characters or fewer');
      if (/[\r\n]/.test(clientId)) errors.push('clientId must not contain newlines');
      if (scope.length > 1_000 || /[\r\n]/.test(scope)) errors.push('scope must be at most 1000 characters and single-line');
      if (audience.length > 500 || /[\r\n]/.test(audience)) errors.push('audience must be at most 500 characters and single-line');

      oauth2 = { tokenUrl, clientId, ...(scope ? { scope } : {}), ...(audience ? { audience } : {}) };
    }

    if (errors.length > 0) return { ok: false, errors };

    let ciphertext: string;
    if (keepExisting && existing) {
      ciphertext = existing.ciphertext;
    } else {
      try {
        ciphertext = this.cipher.encrypt(value);
      } catch (err: any) {
        return { ok: false, errors: [`Could not encrypt the secret: ${err?.message || err}`] };
      }
    }

    const now = new Date().toISOString();
    // Keep a cached OAuth2 token only when the token endpoint and client id are unchanged.
    const sameOAuth =
      existing?.kind === 'oauth2' &&
      existing.oauth2?.tokenUrl === oauth2?.tokenUrl &&
      existing.oauth2?.clientId === oauth2?.clientId;

    const record: SecretRecord = {
      name,
      allowedHosts: hosts,
      header,
      prefix,
      kind,
      ...(oauth2 ? { oauth2 } : {}),
      ciphertext,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (kind === 'oauth2' && sameOAuth && existing?.tokenCiphertext) {
      record.tokenCiphertext = existing.tokenCiphertext;
      if (existing.oauth2?.tokenExpiresAt) {
        record.oauth2 = { ...(record.oauth2 as WrapOAuthMetadata), tokenExpiresAt: existing.oauth2.tokenExpiresAt };
      }
    }

    const secrets = existing
      ? file.secrets.map((secret) => (secret.name === name ? record : secret))
      : [...file.secrets, record].sort((a, b) => a.name.localeCompare(b.name));

    try {
      this.writeFile({ schemaVersion: 1, secrets });
    } catch (err: any) {
      return { ok: false, errors: [`Could not save the secret: ${err?.message || err}`] };
    }

    return { ok: true, secret: metadataOf(record), errors: [] };
  }

  delete(name: string): boolean {
    const file = this.readFile();
    const next = file.secrets.filter((secret) => secret.name !== name);
    if (next.length === file.secrets.length) return false;
    try {
      this.writeFile({ schemaVersion: 1, secrets: next });
      return true;
    } catch {
      return false;
    }
  }

  async resolve(
    name: string,
    host: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<SecretResolution> {
    const record = this.readFile().secrets.find((secret) => secret.name === name);
    if (!record) {
      return { ok: false, code: 'SECRET_NOT_FOUND', message: `No secret named "${name}". Ask a human to add it in Settings → Wrappers.` };
    }

    if (!this.available()) {
      return {
        ok: false,
        code: 'SECRETS_UNAVAILABLE',
        message: this.warning() || 'OS-backed encryption is unavailable, so the secret cannot be decrypted.',
      };
    }

    if (!hostAllowed(record.allowedHosts, host)) {
      return {
        ok: false,
        code: 'SECRET_HOST_MISMATCH',
        message: `Secret "${name}" is not bound to ${host}. Only a human can change the allowed hosts.`,
      };
    }

    if (record.kind === 'oauth2') return await this.resolveOAuth(record, options);

    try {
      const value = this.cipher.decrypt(record.ciphertext);
      return { ok: true, header: record.header, value: `${record.prefix}${value}` };
    } catch (err: any) {
      return { ok: false, code: 'SECRET_DECRYPT_FAILED', message: `Could not decrypt secret "${name}": ${err?.message || err}` };
    }
  }

  /** Mint or reuse a client-credentials token. Cached until ~60s before expiry. */
  private async resolveOAuth(record: SecretRecord, options: { forceRefresh?: boolean }): Promise<SecretResolution> {
    const oauth = record.oauth2;
    if (!oauth) {
      return { ok: false, code: 'SECRET_INVALID', message: `Credential "${record.name}" is OAuth2 but has no token URL.` };
    }

    const now = this.options.now ? this.options.now() : Date.now();
    const cached = this.cachedToken(record, now, Boolean(options.forceRefresh));
    if (cached) {
      return { ok: true, header: record.header, value: `${record.prefix}${cached}`, refreshable: true };
    }

    let clientSecret: string;
    try {
      clientSecret = this.cipher.decrypt(record.ciphertext);
    } catch (err: any) {
      return { ok: false, code: 'SECRET_DECRYPT_FAILED', message: `Could not decrypt secret "${record.name}": ${err?.message || err}` };
    }

    const mint = this.options.mintToken ?? defaultMintToken;
    let token: TokenResult;
    try {
      token = await mint({
        tokenUrl: oauth.tokenUrl,
        clientId: oauth.clientId,
        clientSecret,
        scope: oauth.scope,
        audience: oauth.audience,
      });
    } catch (err: any) {
      return {
        ok: false,
        code: 'TOKEN_REQUEST_FAILED',
        message: `Could not obtain an OAuth2 token for "${record.name}": ${err?.message || err}`,
        refreshable: true,
      };
    }

    const expiresAt = new Date(now + Math.max(1, token.expiresIn) * 1000).toISOString();
    this.cacheToken(record.name, token.accessToken, expiresAt);
    return { ok: true, header: record.header, value: `${record.prefix}${token.accessToken}`, refreshable: true };
  }

  private cachedToken(record: SecretRecord, now: number, force: boolean): string | null {
    if (force || !record.tokenCiphertext) return null;
    const expiresAt = record.oauth2?.tokenExpiresAt ? Date.parse(record.oauth2.tokenExpiresAt) : 0;
    // Refresh 60s early so a token cannot expire mid-request.
    if (!Number.isFinite(expiresAt) || expiresAt - now < 60_000) return null;
    try {
      return this.cipher.decrypt(record.tokenCiphertext);
    } catch {
      return null;
    }
  }

  private cacheToken(name: string, accessToken: string, expiresAt: string): void {
    try {
      const file = this.readFile();
      const next = file.secrets.map((secret) => {
        if (secret.name !== name || !secret.oauth2) return secret;
        return {
          ...secret,
          tokenCiphertext: this.cipher.encrypt(accessToken),
          oauth2: { ...secret.oauth2, tokenExpiresAt: expiresAt },
        };
      });
      this.writeFile({ schemaVersion: 1, secrets: next });
    } catch {
      // A cache write failure only costs a re-mint next time.
    }
  }

  private filePath(): string {
    return path.join(this.dir, 'secrets.json');
  }

  private readFile(): SecretFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath(), 'utf8'));
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.secrets)) return { schemaVersion: 1, secrets: [] };
      return {
        schemaVersion: 1,
        secrets: parsed.secrets.filter(isRecord).map((secret: SecretRecord) => ({ ...secret, kind: secret.kind ?? 'static' })),
      };
    } catch {
      return { schemaVersion: 1, secrets: [] };
    }
  }

  private writeFile(file: SecretFile): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const target = this.filePath();
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Windows uses ACLs.
    }
  }
}

function metadataOf(record: SecretRecord): WrapSecretMetadata {
  return {
    name: record.name,
    allowedHosts: [...record.allowedHosts],
    header: record.header,
    prefix: record.prefix,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    kind: record.kind ?? 'static',
    ...(record.oauth2 ? { oauth2: { ...record.oauth2 } } : {}),
  };
}

function normalizeHosts(input: string[] | string | undefined): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\s]+/) : [];
  const hosts = raw
    .map((host) => String(host || '').trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return [...new Set(hosts)];
}

function hostAllowed(allowedHosts: string[], host: string): boolean {
  const target = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!target) return false;
  return allowedHosts.some((pattern) => {
    if (pattern === target) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return false;
  });
}

function isRecord(value: unknown): value is SecretRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    Array.isArray(record.allowedHosts) &&
    record.allowedHosts.every((host) => typeof host === 'string') &&
    typeof record.header === 'string' &&
    typeof record.prefix === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.kind === undefined || record.kind === 'static' || record.kind === 'oauth2') &&
    (record.oauth2 === undefined ||
      (typeof record.oauth2 === 'object' &&
        record.oauth2 !== null &&
        typeof (record.oauth2 as any).tokenUrl === 'string' &&
        typeof (record.oauth2 as any).clientId === 'string'))
  );
}

/**
 * Default token minter: a policy-checked POST to the human-authored token URL with the
 * `client_credentials` grant. The client secret and the resulting token never leave main.
 */
async function defaultMintToken(input: TokenRequest): Promise<TokenResult> {
  const url = await assertSafeUrl(input.tokenUrl, {
    allowHttp: false,
    allowPrivateHosts: process.env.KUANG_WRAP_ALLOW_PRIVATE === '1',
  });

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.scope) form.set('scope', input.scope);
  if (input.audience) form.set('audience', input.audience);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok || typeof json?.access_token !== 'string') {
      const detail = json?.error_description || json?.error || (text ? text.slice(0, 200) : '');
      throw new Error(`Token endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const expiresIn = Number(json.expires_in);
    return {
      accessToken: json.access_token,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
      tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Token request timed out after 15000 ms.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
