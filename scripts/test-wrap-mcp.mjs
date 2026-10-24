#!/usr/bin/env node
/**
 * Kuang Wrap — generated-tool lifecycle test (S4).
 *
 * Proves the S4 gate against the real `kuang-wrap` MCP server over stdio:
 *   - a wrapper with `exposeAsTool: true` becomes a generated `wrap_<id>` tool,
 *   - its declared arguments arrive as a typed input schema,
 *   - the generated tool executes the saved wrapper,
 *   - creating/deleting a wrapper emits `notifications/tools/list_changed`,
 *   - deleting it removes the tool again.
 *
 * Needs the Cyberdeck app running (bridge + token file). Prints SKIP and exits 0 when
 * either is unavailable. Writes one temporary wrapper (`tmp.mcp.demo`) and removes it.
 *
 * Usage: node scripts/test-wrap-mcp.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const WRAPPER_ID = 'tmp.mcp.demo';
const TOOL = 'wrap_tmp_mcp_demo';

function tokenFile() {
  if (process.env.KUANG_WRAP_TOKEN_FILE) return process.env.KUANG_WRAP_TOKEN_FILE;
  const app = 'kuang-grade-mark-eleven';
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, app, 'wrap', 'token');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', app, 'wrap', 'token');
  }
  return path.join(os.homedir(), '.config', app, 'wrap', 'token');
}

let token = '';
try {
  token = fs.readFileSync(tokenFile(), 'utf8').trim();
} catch (err) {
  console.log(`SKIP: could not read the wrap bridge token (${err.message}).`);
  process.exit(0);
}

const bridgeHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const bridge = async (endpoint, method = 'GET', body) => {
  const response = await fetch(BRIDGE + endpoint, {
    method,
    headers: bridgeHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json().catch(() => ({}));
};

try {
  const health = await fetch(`${BRIDGE}/health`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch (err) {
  console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}).`);
  process.exit(0);
}

const wrapper = {
  schemaVersion: 1,
  id: WRAPPER_ID,
  name: 'MCP demo user',
  description: 'Fetch one DummyJSON user by id.',
  request: { method: 'GET', url: 'https://dummyjson.com/users/{{id}}' },
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 1, maximum: 100, description: 'DummyJSON user id' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  response: {
    schemaVersion: 1,
    select: '$',
    mode: 'document',
    fields: { Name: 'firstName', Email: 'email' },
    record: { id: 'id', email: 'email' },
  },
  exposeAsTool: true,
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Pre-clean so a previous failed run cannot poison the baseline.
await bridge('/wrap/wrappers', 'POST', { action: 'delete', id: WRAPPER_ID }).catch(() => {});

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./bin/wrap-server.cjs'],
  env: { ...process.env, KUANG_WRAP_TOKEN_FILE: tokenFile(), KUANG_MCP_LOG: '0' },
});
const client = new Client(
  { name: 'wrap-mcp-test', version: '0.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

let listChanged = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
  listChanged++;
});

const waitFor = async (predicate, ms = 3000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

try {
  await client.connect(transport);
  console.log('\n▶ generated tool lifecycle');

  const before = await client.listTools();
  check('meta-tools are present at startup', before.tools.some((tool) => tool.name === 'wrap_run'), `${before.tools.length} tools`);
  check('the generated tool does not exist yet', !before.tools.some((tool) => tool.name === TOOL));

  const created = await client.callTool({ name: 'wrap_create', arguments: { wrapper } });
  check('wrap_create(exposeAsTool) succeeds', !created.isError, (created.content?.[0]?.text || '').slice(0, 80));

  const afterCreate = await client.listTools();
  const generated = afterCreate.tools.find((tool) => tool.name === TOOL);
  check('the generated tool appears without a restart', !!generated, `${afterCreate.tools.length} tools`);
  check('it advertises the wrapper input schema', generated?.inputSchema?.properties?.id?.type === 'integer', JSON.stringify(generated?.inputSchema?.properties?.id || null));
  check('the client received tools/list_changed', listChanged >= 1, `notifications=${listChanged}`);

  const called = await client.callTool({ name: TOOL, arguments: { id: 2 } });
  const calledText = called.content?.[0]?.text || '';
  check('the generated tool executes the saved wrapper', !called.isError && /Michael/.test(calledText), calledText.replace(/\s+/g, ' ').slice(0, 80));

  const invalid = await client.callTool({ name: TOOL, arguments: { id: 0 } });
  check('typed arguments are enforced before the call', !!invalid.isError, (invalid.content?.[0]?.text || '').split('\n')[0].slice(0, 80));

  const beforeDelete = listChanged;
  const deleted = await client.callTool({ name: 'wrap_delete', arguments: { id: WRAPPER_ID } });
  check('wrap_delete succeeds', !deleted.isError, (deleted.content?.[0]?.text || '').slice(0, 60));

  const gone = await waitFor(async () => !(await client.listTools()).tools.some((tool) => tool.name === TOOL));
  check('the generated tool disappears after delete', gone);
  check('delete emitted another tools/list_changed', listChanged > beforeDelete, `notifications=${listChanged}`);
} catch (err) {
  check('wrap-mcp run', false, err.message);
} finally {
  await bridge('/wrap/wrappers', 'POST', { action: 'delete', id: WRAPPER_ID }).catch(() => {});
  await client.close().catch(() => {});
}

// ── configurable cap ─────────────────────────────────────────────────────────
console.log('\n▶ generated-tool cap (KUANG_WRAP_MAX_TOOLS)');
const CAPPED = ['tmp.mcp.a', 'tmp.mcp.b'];
for (const id of CAPPED) await bridge('/wrap/wrappers', 'POST', { action: 'delete', id }).catch(() => {});

const cappedTransport = new StdioClientTransport({
  command: 'node',
  args: ['./bin/wrap-server.cjs'],
  env: { ...process.env, KUANG_WRAP_TOKEN_FILE: tokenFile(), KUANG_MCP_LOG: '0', KUANG_WRAP_MAX_TOOLS: '1' },
});
const capped = new Client(
  { name: 'wrap-mcp-cap-test', version: '0.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

try {
  await capped.connect(cappedTransport);

  const first = await capped.callTool({
    name: 'wrap_create',
    arguments: { wrapper: { ...wrapper, id: CAPPED[0], name: 'cap probe a', exposeAsTool: true } },
  });
  const firstText = first.content?.[0]?.text || '';
  check('the first exposed wrapper is registered', !first.isError && !/Not registered/.test(firstText), firstText.slice(0, 70));

  const second = await capped.callTool({
    name: 'wrap_create',
    arguments: { wrapper: { ...wrapper, id: CAPPED[1], name: 'cap probe b', exposeAsTool: true } },
  });
  const secondText = second.content?.[0]?.text || '';
  check(
    'the wrapper beyond the cap is warned about',
    !second.isError && /cap is full/.test(secondText) && /KUANG_WRAP_MAX_TOOLS/.test(secondText),
    secondText.split('\n').filter(Boolean).slice(-1)[0].slice(0, 100),
  );

  const tools = await capped.listTools();
  const names = tools.tools.map((tool) => tool.name);
  check(
    'only the first wrapper is a generated tool',
    names.includes('wrap_tmp_mcp_a') && !names.includes('wrap_tmp_mcp_b'),
    names.filter((name) => name.startsWith('wrap_tmp')).join(', '),
  );

  const listed = await capped.callTool({ name: 'wrap_list', arguments: {} });
  const listedText = listed.content?.[0]?.text || '';
  check(
    'wrap_list reports the cap and marks the over-cap wrapper',
    /generated 1\/1/.test(listedText) && /tmp\.mcp\.b.*over cap/.test(listedText),
    listedText.split('\n').find((line) => line.includes('tmp.mcp.b'))?.slice(0, 110) || '',
  );
} catch (err) {
  check('generated-tool cap run', false, err.message);
} finally {
  for (const id of CAPPED) await bridge('/wrap/wrappers', 'POST', { action: 'delete', id }).catch(() => {});
  await capped.close().catch(() => {});
}

const failed = results.filter((result) => !result.ok);
const verdict = failed.length === 0 ? 'ALL CHECKS PASSED' : failed.length + ' CHECK(S) FAILED';
console.log('\n' + verdict + ' (' + results.length + ' total)');
process.exit(failed.length === 0 ? 0 : 1);
