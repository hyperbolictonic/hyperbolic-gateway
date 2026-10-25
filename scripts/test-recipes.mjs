#!/usr/bin/env node
/**
 * Navigation recipe test (live bridge).
 *
 * Covers Phase 5: save a 3-step path, reload the page, replay it with no model calls, then confirm
 * the page really reached the expected state. Also checks listing, metrics and deletion.
 *
 * Requires the Cyberdeck app (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when it is down.
 *
 * Usage: node scripts/test-recipes.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(pathname, method = 'GET', body) {
  const res = await fetch(`${BRIDGE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Recipe Fixture</title></head>
<body>
  <h1>Recipe fixture</h1>
  <button id="open" onclick="document.getElementById('form').style.display='block'">Open settings</button>
  <div id="form" style="display:none">
    <input id="name" placeholder="Your name" />
    <button id="save" onclick="document.getElementById('out').textContent='Saved for ' + document.getElementById('name').value">Save</button>
  </div>
  <p id="out"></p>
</body></html>`;

async function main() {
  const health = await call('/health').catch(() => null);
  if (!health?.json?.status) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE}. Start the app and re-run.`);
    process.exit(0);
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/settings`;

  await call('/window/visibility', 'POST', { visible: true });
  await sleep(300);

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  let recipeId = null;
  try {
    const created = await call('/tabs/new', 'POST', { url });
    tabId = created.json?.tab?.id || null;
    await sleep(900);

    // --- save ---------------------------------------------------------------
    const saved = await call('/recipes', 'POST', {
      action: 'save',
      url,
      name: 'Fill the settings form',
      steps: [
        { action: 'click', target: 'Open settings' },
        { action: 'type', target: 'Your name', value: 'Kuang' },
        { action: 'click', target: 'Save', expect: [{ type: 'text', text: 'Saved for Kuang' }] },
      ],
    });
    recipeId = saved.json?.recipe?.id || null;
    check('a recipe can be saved with descriptor steps', saved.json?.success === true && !!recipeId, recipeId || JSON.stringify(saved.json).slice(0, 100));
    check('save validates required fields', saved.json?.recipe?.steps?.length === 3, `${saved.json?.recipe?.steps?.length} steps`);

    const badSave = await call('/recipes', 'POST', { action: 'save', url, steps: [{ action: 'type', target: 'x' }] });
    check('a type step without a value is rejected', badSave.status === 400 && /value/.test(JSON.stringify(badSave.json)), `status=${badSave.status}`);

    // --- reload, then replay ------------------------------------------------
    await call('/navigate', 'POST', { url });
    await sleep(900);
    const before = await call('/find', 'POST', { contains: 'Saved for', limit: 3 });
    check('page starts in its initial state', (before.json?.count ?? 0) === 0, `matches=${before.json?.count}`);

    const replay = await call('/recipes', 'POST', { action: 'replay', id: recipeId });
    check('replay succeeds with no model calls', replay.json?.success === true && replay.json?.result?.status === 'ok', replay.json?.result?.message);
    check('every step is reported', (replay.json?.result?.steps || []).length === 3, `${(replay.json?.result?.steps || []).length} steps`);
    check('replay is fast (no decision model)', (replay.json?.result?.ms ?? 99999) < 12000, `${replay.json?.result?.ms}ms`);

    const after = await call('/evaluate', 'POST', { script: `document.getElementById('out').textContent` });
    check('the page really reached the expected state', String(after.json?.result || '').includes('Saved for Kuang'), String(after.json?.result || '(empty)'));

    // --- metrics + list -----------------------------------------------------
    const listed = await call('/recipes', 'POST', { action: 'list', url });
    const entry = (listed.json?.recipes || []).find((r) => r.id === recipeId);
    check('replay records attempts and successes', !!entry && entry.attempts >= 1 && entry.successes >= 1, entry ? `${entry.successes}/${entry.attempts}` : 'not listed');

    // --- failure path: a stale recipe stops and is recorded ------------------
    const stale = await call('/recipes', 'POST', {
      action: 'save',
      url,
      name: 'Stale path',
      path: '/stale-*',
      steps: [{ action: 'click', target: 'A control that does not exist' }],
    });
    const staleReplay = await call('/recipes', 'POST', { action: 'replay', id: stale.json?.recipe?.id });
    check('a stale recipe fails at the first step', staleReplay.json?.result?.status === 'failed' && staleReplay.json?.result?.failedAt === 0, staleReplay.json?.result?.message);

    // --- delete -------------------------------------------------------------
    const removed = await call('/recipes', 'POST', { action: 'delete', id: recipeId });
    check('a recipe can be deleted', removed.json?.success === true, `removed=${removed.json?.removed}`);
    await call('/recipes', 'POST', { action: 'delete', id: stale.json?.recipe?.id });
  } finally {
    if (tabId) await call('/tabs/close', 'POST', { tab_id: tabId }).catch(() => {});
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAILED: ${err.stack || err.message}`);
  process.exit(1);
});
