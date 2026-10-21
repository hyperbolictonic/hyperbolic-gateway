#!/usr/bin/env node
/**
 * Late consent overlays (live, local fixture).
 *
 * The field-note case: a cookie wall that mounts *after* the page has loaded (hydration, redirect,
 * or post-login — Reddit's appears after sign-in), so a single dismiss at 1.8 s missed it.
 *
 * Asserts:
 *   1. A consent wall injected 1.5 s after load is dismissed by the sweep.
 *   2. An ordinary dialog ("Continue") is NOT auto-dismissed — the sweep is consent-only.
 *
 * Requires the Cyberdeck app + bridge on 127.0.0.1:4111. SKIPs cleanly when the bridge is down.
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (p, b) => {
  const res = await fetch(BRIDGE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const get = async (p) => (await fetch(BRIDGE + p)).json();
const evaluate = async (script) => (await post('/evaluate', { script })).json?.result;

const CONSENT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Late consent</title></head><body>
<h1>Fixture</h1>
<div id="wall" style="display:none"><p>We value your privacy.</p><button id="onetrust-accept-btn-handler">Accept all</button></div>
<script>
  setTimeout(() => { document.getElementById('wall').style.display = 'block'; }, 1500);
  document.getElementById('onetrust-accept-btn-handler').addEventListener('click', () => {
    document.getElementById('wall').style.display = 'none';
  });
</script>
</body></html>`;

const DIALOG_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Ordinary dialog</title></head><body>
<h1>Fixture</h1>
<div id="dialog" role="dialog"><p>Your session will expire in 5 minutes.</p><button id="stay">Stay signed in</button></div>
</body></html>`;

async function waitForActive(fragment, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const h = await get('/health');
    if ((h.info?.url || '').includes(fragment)) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  try {
    await get('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}).`);
    process.exit(0);
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end((req.url || '').startsWith('/dialog') ? DIALOG_PAGE : CONSENT_PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const tabIds = [];
  try {
    const created = await post('/tabs/new', { url: `${origin}/consent.html` });
    tabIds.push(created.json?.tab?.id || created.json?.tab?.tabId);
    await waitForActive('consent.html');

    // Sweep attempts run at 0.9 s / 2.6 s / 6 s; the wall appears at 1.5 s, so the 2.6 s attempt is
    // the first that can see it. Allow a margin.
    await sleep(5000);
    const wallState = await evaluate(`(() => { const w = document.getElementById('wall'); return w ? w.style.display : 'missing'; })()`);
    check('a consent wall that appears after load is dismissed', wallState === 'none' || wallState === 'missing', `wall display="${wallState}"`);

    const created2 = await post('/tabs/new', { url: `${origin}/dialog.html` });
    tabIds.push(created2.json?.tab?.id || created2.json?.tab?.tabId);
    await waitForActive('dialog.html');
    await sleep(4000);
    const dialogState = await evaluate(`(() => { const d = document.getElementById('dialog'); return d ? getComputedStyle(d).display : 'missing'; })()`);
    check('an ordinary dialog is left alone', dialogState !== 'none' && dialogState !== 'missing', `dialog display="${dialogState}"`);
  } catch (err) {
    check('consent sweep run', false, err.message);
  } finally {
    for (const tabId of tabIds) {
      try { if (tabId) await post('/tabs/close', { tabId }); } catch {}
    }
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
