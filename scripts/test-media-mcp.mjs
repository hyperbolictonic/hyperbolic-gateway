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

  const preview = await client.callTool({
    name: 'media',
    arguments: { action: 'preview', url: SAMPLE, max_chars: 300 },
  });
  const previewParts = preview.content ?? [];
  const previewText = previewParts.find((part) => part.type === 'text')?.text ?? '';
  record(
    'preview returns metadata, a transcript excerpt and an image',
    previewText.includes('Transcript') && previewParts.some((part) => part.type === 'image'),
    `${previewParts.filter((part) => part.type === 'image').length} image(s)`,
  );

  const transcript = await client.callTool({
    name: 'media',
    arguments: { action: 'transcript', url: SAMPLE, max_chars: 200 },
  });
  const transcriptPayload = JSON.parse(transcript.content?.[0]?.text ?? '{}');
  record(
    'transcript returns text without downloading',
    transcriptPayload.success === true && typeof transcriptPayload.text === 'string',
    transcriptPayload.success ? `${transcriptPayload.chars} chars` : transcriptPayload.error,
  );

  if (process.env.HB_MEDIA_LIVE_DOWNLOAD === '1') {
    const start = await client.callTool({
      name: 'media',
      arguments: { action: 'download', url: SAMPLE, kind: 'audio', quality: 'best' },
    });
    const started = JSON.parse(start.content?.[0]?.text ?? '{}');
    record('download queues a job', started.success === true && typeof started.job?.id === 'string', started.job?.id);

    const id = started.job?.id;
    let job = null;
    const deadline = Date.now() + 180_000;
    while (id && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const listing = await client.callTool({ name: 'media', arguments: { action: 'jobs' } });
      const payload = JSON.parse(listing.content?.[0]?.text ?? '{}');
      job = (payload.jobs ?? []).find((entry) => entry.id === id) ?? null;
      if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break;
    }

    record(
      'download completes with a file',
      job?.state === 'completed' && job.files?.length > 0,
      job ? `${job.state} · ${job.files?.[0]?.bytes ?? 0} bytes` : 'no job seen',
    );

    const library = await client.callTool({ name: 'media', arguments: { action: 'list' } });
    const libraryPayload = JSON.parse(library.content?.[0]?.text ?? '{}');
    record('list shows the completed download', libraryPayload.count > 0, `${libraryPayload.count} item(s)`);
  } else {
    console.log('  SKIP  live download (set HB_MEDIA_LIVE_DOWNLOAD=1 to include it)');
  }
} finally {
  await client.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} — ${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
