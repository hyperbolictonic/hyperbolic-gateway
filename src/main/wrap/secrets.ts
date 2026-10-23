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

export interface WrapSecretMetadata {
  name: string;
  allowedHosts: string[];
  header: string;
  prefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface WrapSecretInput {
  name: string;
  value: string;
  allowedHosts: string[] | string;
  header?: string;
  prefix?: string;
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
}

interface SecretRecord extends WrapSecretMetadata {
  ciphertext: string;
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

  constructor(dir: string, cipher: SecretCipher) {
    this.dir = dir;
    this.cipher = cipher;
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
    const record: SecretRecord = {
      name,
      allowedHosts: hosts,
      header,
      prefix,
      ciphertext,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

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

  resolve(name: string, host: string): SecretResolution {
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

    try {
      const value = this.cipher.decrypt(record.ciphertext);
      return { ok: true, header: record.header, value: `${record.prefix}${value}` };
    } catch (err: any) {
      return { ok: false, code: 'SECRET_DECRYPT_FAILED', message: `Could not decrypt secret "${name}": ${err?.message || err}` };
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
        secrets: parsed.secrets.filter(isRecord),
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
    typeof record.updatedAt === 'string'
  );
}
