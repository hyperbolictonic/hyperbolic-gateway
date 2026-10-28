import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function remoteTokenFile(remoteDir: string): string {
  return path.join(remoteDir, 'token');
}

/** Create a remote-gateway capability token. The caller owns the directory. */
export function createRemoteToken(remoteDir: string): string {
  fs.mkdirSync(remoteDir, { recursive: true });
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const target = remoteTokenFile(remoteDir);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Windows uses ACLs; the userData directory is already user-private.
  }
  return token;
}

/** Read and validate a token file. A missing, malformed or empty file returns undefined. */
export function readRemoteToken(file: string): string | undefined {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return TOKEN_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
