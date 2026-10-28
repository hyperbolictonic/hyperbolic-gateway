import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createBearerAuthorizer,
  createMcpHttpHost,
  McpSessionStore,
  type McpHttpSession,
} from '../src/index.ts';

const TOKEN = 'test-token-0123456789';

function createTestServer(): McpServer {
  const server = new McpServer({ name: 'mcp-http-test', version: '0.1.0' });
  server.tool(
    'echo',
    'Return the supplied text.',
    { text: z.string() },
    async ({ text }) => ({ content: [{ type: 'text', text }] }),
  );
  return server;
}

test('rejects requests without a bearer token', async () => {
  const host = createMcpHttpHost({
    port: 0,
    path: '/mcp',
    createServer: createTestServer,
    authorize: createBearerAuthorizer(() => TOKEN),
  });
  await host.start();
  try {
    const response = await fetch(`http://127.0.0.1:${host.status().port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(response.status, 401);
  } finally {
    await host.stop();
  }
});

test('accepts a real MCP client and serves a tool call', async () => {
  const host = createMcpHttpHost({
    port: 0,
    path: '/mcp',
    createServer: createTestServer,
    authorize: createBearerAuthorizer(() => TOKEN),
    enableJsonResponse: true,
    allowSse: false,
    idleTimeoutMs: 60_000,
  });
  await host.start();
  const url = new URL(`http://127.0.0.1:${host.status().port}/mcp`);
  const client = new Client({ name: 'mcp-http-test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ['echo']);

    const result = await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.equal(content[0].type, 'text');
    assert.equal(content[0].text, 'hello');
  } finally {
    await client.close();
    await host.stop();
  }
});

test('does not expose non-MCP paths', async () => {
  const host = createMcpHttpHost({
    port: 0,
    path: '/mcp',
    createServer: createTestServer,
    authorize: createBearerAuthorizer(() => TOKEN),
  });
  await host.start();
  try {
    const response = await fetch(`http://127.0.0.1:${host.status().port}/wrap/manifest`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 404);
  } finally {
    await host.stop();
  }
});

test('session store expires idle sessions and is bounded by its owner', async () => {
  const expired: string[] = [];
  const store = new McpSessionStore(1, 10, async (session) => {
    expired.push(session.id);
  });
  const session: McpHttpSession = {
    id: 'session-a',
    server: {} as McpHttpSession['server'],
    transport: {} as McpHttpSession['transport'],
    lastUsedAt: 0,
    closed: false,
  };
  store.add(session);
  assert.equal(store.size, 1);
  store.sweep(11);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.size, 0);
  assert.deepEqual(expired, ['session-a']);
  store.stop();
});
