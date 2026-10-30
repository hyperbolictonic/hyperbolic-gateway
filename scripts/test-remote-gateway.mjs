import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRemoteToken, readRemoteToken } from '../src/main/remote/token.ts';

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

async function waitForUnauthorized(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.status === 401) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`remote gateway did not become ready at ${url}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperbolic-remote-'));
const tokenFile = path.join(tempDir, 'token');
const logFile = path.join(tempDir, 'remote.log');
const token = createRemoteToken(tempDir);
assert.equal(readRemoteToken(tokenFile), token);
assert.equal(readRemoteToken(path.join(tempDir, 'missing')), undefined, 'missing token must be rejected');

const port = await freePort();
const url = `http://127.0.0.1:${port}/mcp/browser`;
const child = spawn(process.execPath, ['bin/remote-server.cjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HB_REMOTE_TOKEN_FILE: tokenFile,
    HB_REMOTE_PORT: String(port),
    HB_REMOTE_LOG_FILE: logFile,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

let toolCount = 0;
try {
  await waitForUnauthorized(url);

  const unauthorized = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 401);

  const wrongPath = await fetch(`http://127.0.0.1:${port}/wrap/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(wrongPath.status, 404);

  const client = new Client({ name: 'remote-gateway-test', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.length >= 15, `expected the consolidated browser surface, got ${tools.tools.length}`);
    assert.ok(tools.tools.some((tool) => tool.name === 'devtools'));
    assert.ok(tools.tools.some((tool) => tool.name === 'human_in_loop'));
    toolCount = tools.tools.length;
  } finally {
    await client.close();
  }

  console.log(`remote gateway smoke passed (${toolCount} tools)`);
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(tempDir, { recursive: true, force: true });
}
