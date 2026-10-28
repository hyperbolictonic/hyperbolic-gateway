import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperbolic-devlogs-'));
const logDir = path.join(tempDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(
  path.join(logDir, 'remote-server.log'),
  [
    'gateway_started',
    `auth token ${'a'.repeat(64)}`,
    'Authorization: Bearer super-secret-token',
    'oauth_authorize_state_invalid requestLength=0 expired=false',
  ].join('\n') + '\n',
);
fs.writeFileSync(path.join(logDir, 'quick-tunnel.log'), 'tunnel started\nhttps://example.trycloudflare.com\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(process.cwd(), 'bin', 'devlogs-server.cjs')],
  env: {
    ...process.env,
    HB_DEV_LOGS: '1',
    HB_DEVLOGS_DIR: logDir,
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'devlogs-test', version: '0.1.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['list_logs', 'read_log', 'search_logs'],
  );

  const list = await client.callTool({ name: 'list_logs', arguments: {} });
  assert.match(textOf(list), /remote-server\.log/);
  assert.match(textOf(list), /quick-tunnel\.log/);

  const read = await client.callTool({
    name: 'read_log',
    arguments: { name: 'remote-server.log', tail: 20 },
  });
  const output = textOf(read);
  assert.match(output, /oauth_authorize_state_invalid/);
  assert.equal(output.includes('a'.repeat(64)), false);
  assert.equal(output.includes('super-secret-token'), false);

  const search = await client.callTool({
    name: 'search_logs',
    arguments: { query: 'oauth_authorize_state_invalid' },
  });
  assert.match(textOf(search), /remote-server\.log/);

  console.log('devlogs smoke passed');
} finally {
  await client.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function textOf(result) {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.map((part) => (part && part.type === 'text' ? part.text : '')).join('\n');
}
