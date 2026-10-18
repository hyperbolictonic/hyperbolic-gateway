#!/usr/bin/env node
/**
 * MCP-level smoke test for the primitives tool layer.
 *
 * Validates the *real* path an agent uses: it spawns bin/mcp-server.cjs over stdio,
 * lists tools (which exercises every zod schema in the catalogue), then calls the
 * new primitives tools end-to-end against a local fixture page.
 *
 * Requires the Cyberdeck app running (bridge on 127.0.0.1:4111). Prints SKIP and
 * exits 0 when the bridge is down.
 *
 * Usage: node scripts/test-mcp-primitives.mjs   (needs `npm run build:mcp` first)
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEW_TOOLS = [
  'wait_for', 'observe', 'extract', 'collect_all', 'find', 'expect', 'act',
  'page_state', 'diff', 'bridge_health', 'export_har',
  'context_save', 'context_open', 'context_list', 'context_delete', 'focus_window',
];

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>MCP Primitives Fixture</title></head>
<body>
  <h1>MCP fixture</h1>
  <div id="cards">
    <div class="card"><a href="/a" aria-label="Alpha Airways option 1 £412">Alpha £412</a></div>
    <div class="card"><a href="/b" aria-label="Beta Air option 2 £419">Beta £419</a></div>
    <div class="card"><a href="/c" aria-label="Gamma Jets option 3 £425">Gamma £425</a></div>
  </div>
  <label>Query <input id="q" aria-label="Search query" /></label>
  <p id="echo"></p>
  <button id="go">Go now</button>
  <script>
    document.getElementById('q').addEventListener('input', function (e) {
      document.getElementById('echo').textContent = 'Echo: ' + e.target.value;
    });
    document.getElementById('go').addEventListener('click', function () {
      setTimeout(function () { var d = document.createElement('p'); d.id = 'done'; d.textContent = 'Done!'; document.body.appendChild(d); }, 200);
    });
  </script>
</body></html>`;

async function bridge(path, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

const textOf = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

async function main() {
  const health = await bridge('/health').catch(() => null);
  if (!health || health.status !== 'ok') {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE}. Start the app and re-run.`);
    process.exit(0);
  }

  // Real synthetic input only lands while the window is on-screen (a hidden window
  // reports a 0x0 viewport). Same requirement as test-harvest / test-primitives.
  await bridge('/window/visibility', 'POST', { visible: true });
  await sleep(500);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/fixture.html`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const transport = new StdioClientTransport({ command: 'node', args: ['./bin/mcp-server.cjs'], cwd: process.cwd() });
  const client = new Client({ name: 'mark-eleven-mcp-primitives', version: '1.0.0' }, { capabilities: {} });
  let tabId = null;

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    const missing = NEW_TOOLS.filter((n) => !names.includes(n));
    check('tools/list exposes every new primitive (schemas valid)', missing.length === 0, `total=${names.length}${missing.length ? `, missing: ${missing.join(',')}` : ''}`);

    const healthRes = await client.callTool({ name: 'bridge_health', arguments: {} });
    const healthText = textOf(healthRes);
    check('bridge_health returns capability JSON', /"capabilities"/.test(healthText) && /"revision"/.test(healthText), healthText.split('\n')[0]);

    const created = await bridge('/tabs/new', 'POST', { url });
    tabId = created?.tab?.id || null;
    for (let i = 0; i < 40; i++) {
      const h = await bridge('/health');
      if ((h?.info?.url || '').includes(`127.0.0.1:${port}`)) break;
      await sleep(250);
    }
    // A freshly created tab can briefly report a 0x0 viewport (window hidden or still
    // laying out); real synthetic input only registers once there is a real viewport.
    for (let i = 0; i < 40; i++) {
      const r = await bridge('/evaluate', 'POST', { script: '({ w: window.innerWidth, h: window.innerHeight })' });
      if ((r?.result?.w || 0) > 0 && (r?.result?.h || 0) > 0) break;
      await sleep(250);
    }
    await sleep(300);

    const wf = await client.callTool({ name: 'wait_for', arguments: { conditions: [{ type: 'count', selector: '.card', min: 3 }], timeout_ms: 4000 } });
    check('MCP wait_for returns READY', /READY/.test(textOf(wf)), textOf(wf).split('\n')[0]);

    const ex = await client.callTool({ name: 'extract', arguments: { kind: 'list', selector: '#cards' } });
    check('MCP extract(list) returns rows', /Alpha £412/.test(textOf(ex)) && /3 items/.test(textOf(ex)));

    const exTable = await client.callTool({ name: 'extract', arguments: { kind: 'table', selector: '#cards' } });
    check('MCP extract(table) degrades gracefully', typeof textOf(exTable) === 'string' && textOf(exTable).length > 0);

    const ob = await client.callTool({ name: 'observe', arguments: { as: 'markdown' } });
    check('MCP observe(markdown) harvests fixture', /MCP fixture/.test(textOf(ob)));

    const find = await client.callTool({ name: 'find', arguments: { name: 'Search query' } });
    const findText = textOf(find);
    const markId = (findText.match(/\[#(\d+)\]/) || [])[1];
    check('MCP find returns a mark ref', Boolean(markId), findText.split('\n')[0]);

    const act = await client.callTool({
      name: 'act',
      arguments: { mark_id: Number(markId), action: 'type', text: 'mcp', await_conditions: [{ type: 'text', text: 'Echo: mcp' }] },
    });
    const actOk = /READY/.test(textOf(act));
    let actDiag = '';
    if (!actOk) {
      const d = await bridge('/evaluate', 'POST', { script: `(() => { const el = document.querySelector('[data-mark-id="${markId}"]'); return { value: el && el.value, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName), echo: (document.getElementById('echo')||{}).textContent, ih: window.innerHeight }; })()` });
      actDiag = JSON.stringify(d?.result);
    }
    check('MCP act(type) + await succeeds', actOk, actOk ? textOf(act) : `${textOf(act)} | diag=${actDiag}`);

    const ex2 = await client.callTool({ name: 'expect', arguments: { conditions: [{ type: 'selector', selector: '#done' }] } });
    check('MCP expect reports FAIL before click', /^FAIL/.test(textOf(ex2)), textOf(ex2).split('\n')[0]);

    const btnFind = await client.callTool({ name: 'find', arguments: { name: 'Go now' } });
    const btnId = ((textOf(btnFind).match(/\[#(\d+)\]/) || [])[1]);
    const click = await client.callTool({ name: 'act', arguments: { mark_id: Number(btnId), action: 'click', await_conditions: [{ type: 'selector', selector: '#done' }] } });
    check('MCP act(click) + await succeeds', /READY/.test(textOf(click)), textOf(click).split(' · ').slice(-1)[0]);

    const st = await client.callTool({ name: 'page_state', arguments: {} });
    check('MCP page_state returns JSON state', /"revision"/.test(textOf(st)));

    const diff = await client.callTool({ name: 'diff', arguments: {} });
    check('MCP diff returns change report', /(Changed|No change)/.test(textOf(diff)), textOf(diff).split('\n')[0]);

    const ctx = await client.callTool({ name: 'context_list', arguments: {} });
    check('MCP context_list responds', typeof textOf(ctx) === 'string');

    const focus = await client.callTool({ name: 'focus_window', arguments: {} });
    check('MCP focus_window reports focus state', /"focused"/.test(textOf(focus)), textOf(focus));
  } catch (err) {
    check('MCP primitives run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    try { await client.close(); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
