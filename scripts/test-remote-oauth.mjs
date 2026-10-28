import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRemoteToken } from '../src/main/remote/token.ts';
import { createOAuthClient } from '../src/main/remote/oauth-client.ts';

const VERIFIER = 'b'.repeat(64);
const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForMetadata(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`remote OAuth server did not start at ${url}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperbolic-remote-oauth-'));
const tokenFile = path.join(tempDir, 'token');
const clientFile = path.join(tempDir, 'oauth-client.json');
createRemoteToken(tempDir);
const oauthClient = createOAuthClient(clientFile);
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['bin/remote-server.cjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HB_REMOTE_TOKEN_FILE: tokenFile,
    HB_REMOTE_AUTH_MODE: 'oauth',
    HB_OAUTH_CLIENT_FILE: clientFile,
    HB_REMOTE_PORT: String(port),
    HB_REMOTE_LOG_FILE: path.join(tempDir, 'remote.log'),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await waitForMetadata(`${base}/.well-known/oauth-protected-resource/mcp/browser`);
  const metadata = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
  assert.equal(metadata.authorization_endpoint, `${base}/oauth/authorize`);
  assert.equal(metadata.token_endpoint, `${base}/oauth/token`);
  assert.equal(metadata.registration_endpoint, undefined);

  const redirect = `${base}/callback`;
  const authorizeUrl = new URL(`${base}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', oauthClient.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirect);
  authorizeUrl.searchParams.set('scope', 'mcp');
  authorizeUrl.searchParams.set('code_challenge', challengeFor(VERIFIER));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  const page = await fetch(authorizeUrl);
  const html = await page.text();
  const requestToken = html.match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(requestToken);
  const approval = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request: requestToken, decision: 'approve' }),
  });
  assert.equal(approval.status, 200);
  const approvalHtml = await approval.text();
  const location = approvalHtml.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(location);
  const code = new URL(location).searchParams.get('code');
  assert.ok(code);

  const tokenResponse = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${oauthClient.clientId}:${oauthClient.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      code_verifier: VERIFIER,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();

  const staticToken = fs.readFileSync(tokenFile, 'utf8').trim();
  const staticAttempt = await fetch(`${base}/mcp/browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staticToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(staticAttempt.status, 401);

  const client = new Client({ name: 'oauth-smoke', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/browser`), {
    requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.length >= 60);
  } finally {
    await client.close();
  }
  console.log('remote OAuth smoke passed');
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(tempDir, { recursive: true, force: true });
}
