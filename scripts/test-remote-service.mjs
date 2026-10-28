import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RemoteService } from '../src/main/remote/service.ts';

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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperbolic-remote-service-'));
const port = await freePort();
const service = new RemoteService({
  serverPath: path.join(process.cwd(), 'bin', 'remote-server.cjs'),
  bridgeUrl: 'http://127.0.0.1:1',
  port,
  dataDir: tempDir,
  cwd: process.cwd(),
  runtimePath: process.execPath,
  cloudflaredPath: process.execPath,
  cloudflaredArgsPrefix: [path.join(process.cwd(), 'packages', 'quick-tunnel', 'test', 'fake-cloudflared.mjs')],
});

try {
  const initial = service.getInfo();
  assert.equal(initial.status.running, false);
  assert.equal(initial.token.length, 64);
  assert.match(initial.config, /"httpUrl"/);

  const oauthMode = await service.setAuthMode('oauth');
  assert.equal(oauthMode.authMode, 'oauth');
  assert.ok(service.getInfo().oauthClient?.clientId.startsWith('hg_'));
  await service.setAuthMode('bearer');

  const enabled = await service.setEnabled(true);
  assert.equal(enabled.running, true);
  assert.equal(enabled.url, `http://127.0.0.1:${port}/mcp/browser`);

  const client = new Client({ name: 'remote-service-test', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(enabled.url), {
    requestInit: { headers: { Authorization: `Bearer ${service.getToken()}` } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.length >= 60);
  } finally {
    await client.close();
  }

  const rotated = await service.rotateToken();
  assert.equal(rotated.running, true);
  assert.notEqual(service.getToken(), initial.token);

  const tunneled = await service.setTunnelEnabled(true);
  assert.equal(tunneled.tunnel.running, true);
  assert.equal(tunneled.tunnel.url, 'https://fake-quick-tunnel.trycloudflare.com');
  assert.match(service.getConfig(), /fake-quick-tunnel\.trycloudflare\.com/);

  const automatic = await service.setCloudflaredUpdateMode('automatic');
  assert.equal(automatic.cloudflared.updateMode, 'automatic');
  await service.setCloudflaredUpdateMode('manual');

  const disconnected = await service.disconnectSessions();
  assert.equal(disconnected.running, true);

  const stopped = await service.setEnabled(false);
  assert.equal(stopped.running, false);
  assert.equal(stopped.tunnel.running, false);
  console.log('remote service test passed');
} finally {
  await service.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
