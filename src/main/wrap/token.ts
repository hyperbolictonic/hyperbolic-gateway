/**
 * The wrap bridge token.
 *
 * The token is rotated on every app start and written to `<userData>/wrap/token`
 * with owner-only permissions. The MCP server is given the *path* through
 * `KUANG_WRAP_TOKEN_FILE`, not the value, so a long-lived MCP process keeps
 * working across app restarts without copying a new secret into its config.
 *
 * This is a local capability token, not an API credential. It protects the
 * bridge from unrelated local processes; it does not replace the human-only
 * secret store that arrives with S2.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function tokenFile(wrapDir: string): string {
  return path.join(wrapDir, 'token');
}

export function createWrapToken(wrapDir: string): string {
  fs.mkdirSync(wrapDir, { recursive: true });
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const target = tokenFile(wrapDir);
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

export function readWrapToken(wrapDir: string): string | undefined {
  try {
    const value = fs.readFileSync(tokenFile(wrapDir), 'utf8').trim();
    return TOKEN_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
