#!/usr/bin/env node
/**
 * Media MCP surface check.
 *
 * Drives the real stdio server against a running Cyberdeck and asserts the
 * `media` group is advertised and answers. Prints SKIP and exits 0 when the
 * bridge is down, like the other live suites.
 *
 * Usage: node scripts/test-media-mcp.mjs
 *        HB_BRIDGE_URL=http://127.0.0.1:4113 node scripts/test-media-mcp.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BRIDGE = (process.env.HB_BRIDGE_URL || process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '');
const SAMPLE = process.env.HB_MEDIA_SAMPLE_URL || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

try {
  const health = await fetch(`${BRIDGE}/health`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch (error) {
  console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${error.message}).`);
  process.exit(0);
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./bin/mcp-server.cjs'],
  env: { ...process.env, HB_BRIDGE_URL: BRIDGE },
});
const client = new Client({ name: 'media-mcp-test', version: '0.0.0' }, { capabilities: {} });

await client.connect(transport);
try {
  const { tools } = await client.listTools();
  const media = tools.find((tool) => tool.name === 'media');
  record('media group is advertised', Boolean(media));

  const status = await client.callTool({ name: 'media', arguments: { action: 'status' } });
  const statusPayload = JSON.parse(status.content?.[0]?.text ?? '{}');
  record(
    'status reports the binary and runtime',
    statusPayload.success === true && typeof statusPayload.binary?.version === 'string',
    `yt-dlp ${statusPayload.binary?.version} · runtime ${statusPayload.runtime?.kind}`,
  );

  const info = await client.callTool({ name: 'media', arguments: { action: 'info', url: SAMPLE } });
  const infoPayload = JSON.parse(info.content?.[0]?.text ?? '{}');
  record(
    'info returns metadata without downloading',
    infoPayload.success === true && typeof infoPayload.media?.title === 'string',
    infoPayload.success
      ? `${infoPayload.media.title} · ${infoPayload.media.formatCount} formats`
      : infoPayload.error,
  );
} finally {
  await client.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} — ${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
