#!/usr/bin/env node
/**
 * DOM probe foundation test (live bridge).
 *
 * Covers the two reusable pieces added in 1.4.82:
 *   /dom/facts        — one injected expression describing controls (marks/find/guard/recipes)
 *   /evaluate{frames} — CDP isolated worlds, so cross-origin child frames are readable
 *
 * Fixture: a card div with an inline onclick (no role), a button covered by an overlay, a plain
 * button, and an iframe served from a second port (a different origin).
 *
 * Requires the Cyberdeck app (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when it is down.
 *
 * Usage: node scripts/test-dom-probe.mjs
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${pathname} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const MAIN = `<!doctype html>
<html><head><meta charset="utf-8"><title>Probe Main</title></head>
<body>
  <main>
    <h1>Probe fixture</h1>
    <div id="card" onclick="window.__card=1" style="width:300px;height:60px;background:#eee">Heartbreaker Build card</div>
    <button id="plain">Plain button</button>
    <div style="position:relative;display:inline-block">
      <button id="covered">Covered button</button>
      <div id="cover" style="position:absolute;inset:0;background:rgba(0,0,0,.01)"></div>
    </div>
    <input id="hidden-field" type="text" style="display:none">
    <iframe id="child" src="CHILD_URL" width="400" height="200"></iframe>
  </main>
</body></html>`;

const CHILD = `<!doctype html><html><head><title>Probe Child</title></head>
<body><h1>Child frame</h1><button id="child-btn">Child accept</button></body></html>`;

async function main() {
  try {
    await call('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  await call('/window/visibility', 'POST', { visible: true });
  await sleep(300);

  // Child frame on its own port: same host, different origin.
  const childServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(CHILD);
  });
  await new Promise((r) => childServer.listen(0, '127.0.0.1', r));
  const childPort = childServer.address().port;

  const mainServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MAIN.replace('CHILD_URL', `http://127.0.0.1:${childPort}/child.html`));
  });
  await new Promise((r) => mainServer.listen(0, '127.0.0.1', r));
  const port = mainServer.address().port;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const created = await call('/tabs/new', 'POST', { url: `http://127.0.0.1:${port}/main.html` });
    tabId = created?.tab?.id || null;
    // Wait for the child frame to be present and loaded.
    await sleep(1200);

    // --- /dom/facts ---------------------------------------------------------
    const facts = await call('/dom/facts', 'POST', { skip_hit_test: false });
    const controls = Array.isArray(facts.controls) ? facts.controls : [];
    check('dom/facts returns controls', controls.length > 0, `${controls.length} controls`);

    const card = controls.find((c) => /Heartbreaker Build card/.test(c.name || ''));
    check(
      'clickable div with onclick is described (no role needed)',
      !!card && Array.isArray(card.actions) && card.actions.includes('click') && card.region === 'main',
      card ? `role=${card.role} actions=${card.actions.join(',')} region=${card.region}` : 'not found'
    );

    const plain = controls.find((c) => c.name === 'Plain button');
    check('plain button is visible and not occluded', !!plain && plain.visible === true && plain.occluded === false, plain ? `visible=${plain.visible} occluded=${plain.occluded}` : 'not found');

    const covered = controls.find((c) => c.name === 'Covered button');
    check('covered button reports occluded=true', !!covered && covered.occluded === true, covered ? `occluded=${covered.occluded}` : 'not found');

    const hidden = controls.find((c) => /hidden-field/.test(c.name || '') || c.tag === 'input');
    check(
      'hidden field is reported with visible=false (not silently dropped)',
      !!hidden && hidden.visible === false,
      hidden ? `name="${hidden.name}" visible=${hidden.visible}` : 'not found'
    );

    const typed = controls.filter((c) => c.actions.includes('type')).map((c) => c.tag);
    check('text inputs accept type', typed.includes('input') || typed.includes('textarea'), `typed tags: ${[...new Set(typed)].join(',') || 'none'}`);

    // --- /evaluate frames ---------------------------------------------------
    const frameEval = await call('/evaluate', 'POST', {
      frames: true,
      max_frames: 6,
      script: `({ title: document.title, buttons: document.querySelectorAll('button').length })`,
    });
    const frames = Array.isArray(frameEval.frames) ? frameEval.frames : [];
    const mainFrame = frames.find((f) => /Probe Main/.test(f.value?.title || ''));
    const childFrame = frames.find((f) => /Probe Child/.test(f.value?.title || ''));
    check('frame eval reads the main frame', !!mainFrame && mainFrame.ok === true, mainFrame ? `buttons=${mainFrame.value.buttons}` : `${frames.length} frames`);
    check(
      'frame eval reads a cross-origin child frame',
      !!childFrame && childFrame.ok === true && childFrame.value?.buttons === 1,
      childFrame ? `${childFrame.url} buttons=${childFrame.value?.buttons}` : 'child frame missing'
    );
    check(
      'frame eval reports per-frame failures instead of throwing',
      frames.every((f) => typeof f.ok === 'boolean'),
      `${frames.filter((f) => f.ok).length}/${frames.length} ok`
    );
    check(
      'blank frames are skipped by default',
      frames.every((f) => !f.ok || !/^about:/.test(String(f.url || ''))),
      frames.filter((f) => /^about:/.test(String(f.url || ''))).length + ' blank'
    );
  } finally {
    if (tabId) await call('/tabs/close', 'POST', { tab_id: tabId }).catch(() => {});
    childServer.close();
    mainServer.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAILED: ${err.stack || err.message}`);
  process.exit(1);
});
