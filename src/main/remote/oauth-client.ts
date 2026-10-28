import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  createdAt: string;
}

const CLIENT_ID_PATTERN = /^hg_[a-f0-9]{32}$/i;
const SECRET_PATTERN = /^[a-f0-9]{64}$/i;

export function oauthClientFile(remoteDir: string): string {
  return path.join(remoteDir, 'oauth-client.json');
}

export function readOAuthClient(file: string): OAuthClientCredentials | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<OAuthClientCredentials>;
    if (
      typeof parsed.clientId !== 'string' ||
      typeof parsed.clientSecret !== 'string' ||
      !CLIENT_ID_PATTERN.test(parsed.clientId) ||
      !SECRET_PATTERN.test(parsed.clientSecret)
    ) {
      return undefined;
    }
    return {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function createOAuthClient(file: string): OAuthClientCredentials {
  const client: OAuthClientCredentials = {
    clientId: `hg_${crypto.randomBytes(16).toString('hex')}`,
    clientSecret: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(client, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows uses ACLs; the userData directory is already user-private.
  }
  return client;
}

export function ensureOAuthClient(file: string): OAuthClientCredentials {
  const existing = readOAuthClient(file);
  if (existing) return existing;
  return createOAuthClient(file);
}
