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
    <button id="disabled-btn" disabled>Disabled action</button>
    <div style="position:relative;display:inline-block">
      <button id="covered">Covered button</button>
      <div id="cover" style="position:absolute;inset:0;background:rgba(0,0,0,.01)"></div>
    </div>
    <input id="hidden-field" type="text" style="display:none">
    <iframe id="child" src="CHILD_URL" width="400" height="200"></iframe>
    <iframe id="consent-frame" src="CONSENT_URL" style="position:fixed;left:640px;top:40px;width:420px;height:220px;border:1px solid #ccc"></iframe>
  </main>
</body></html>`;

const CHILD = `<!doctype html><html><head><title>Probe Child</title></head>
<body><h1>Child frame</h1><button id="child-btn">Child accept</button></body></html>`;

const CONSENT_CHILD = `<!doctype html><html><head><title>Consent Child</title></head>
<body style="margin:0;font:14px sans-serif;background:#fff">
  <div role="dialog" id="consent-banner" style="padding:16px">
    <h3 style="margin:0 0 8px">We value your privacy</h3>
    <p style="margin:0 0 12px">We and our partners store cookies.</p>
    <button id="ck-reject" style="padding:8px 12px;margin-right:8px">Reject all</button>
    <button id="ck-accept" style="padding:8px 12px">Accept all</button>
  </div>
  <script>
    document.getElementById('ck-reject').addEventListener('click', () => {
      document.documentElement.setAttribute('data-consent-choice', 'reject');
    });
    document.getElementById('ck-accept').addEventListener('click', () => {
      document.documentElement.setAttribute('data-consent-choice', 'accept');
    });
  </script>
</body></html>`;

async function main() {
  try {
    await call('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  await call('/window/visibility', 'POST', { visible: true });
  await sleep(300);

  // Child frames on their own port: same host, different origin.
  const childServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(String(req.url || '').includes('consent') ? CONSENT_CHILD : CHILD);
  });
  await new Promise((r) => childServer.listen(0, '127.0.0.1', r));
  const childPort = childServer.address().port;

  const mainServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      MAIN.replace('CHILD_URL', `http://127.0.0.1:${childPort}/child.html`).replace(
        'CONSENT_URL',
        `http://127.0.0.1:${childPort}/consent.html`
      )
    );
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

    // --- act(target_text): semantics-free controls ---------------------------
    const byText = await call('/act', 'POST', { target_text: 'Plain button', action: 'click' }).catch((e) => ({ error: String(e) }));
    check('act target_text clicks a semantics-free element', !byText?.error, byText?.error ? String(byText.error).slice(0, 80) : `address=${byText.target?.text || ''}`);

    const ambiguous = await call('/act', 'POST', { target_text: 'button', action: 'click' }).catch((e) => ({ error: String(e) }));
    check('act target_text refuses an ambiguous match', Boolean(ambiguous?.error), String(ambiguous?.error || 'did not refuse').slice(0, 90));

    // --- find(): disabled / region facts ------------------------------------
    const found = await call('/find', 'POST', { contains: 'Disabled action', limit: 3 });
    const foundText = String(found.text || '');
    check('find annotates a disabled match', /disabled/.test(foundText), foundText.slice(0, 80));
    const foundMark = Array.isArray(found.marks) ? found.marks[0] : null;
    check(
      'find returns structured facts alongside the mark',
      !!foundMark?.facts && foundMark.facts.disabled === true && typeof foundMark.facts.occluded === 'boolean',
      foundMark?.facts ? JSON.stringify(foundMark.facts) : 'no facts'
    );

    // --- frame-scoped consent (Phase 3) -------------------------------------
    const consent = await call('/shield/dismiss', 'POST', {}).catch((e) => ({ error: String(e) }));
    check(
      'consent inside a cross-origin iframe is answered',
      consent?.result?.dismissed === true && consent?.result?.frame === 'child',
      consent?.result ? `${consent.result.intent} via ${consent.result.delivery}, frame=${consent.result.frame}` : String(consent?.error || '')
    );
    check(
      'consent pick is the least-invasive control (reject before accept)',
      consent?.result?.intent === 'reject',
      String(consent?.result?.intent || 'none')
    );
    const childChoice = await call('/evaluate', 'POST', {
      frames: true,
      max_frames: 6,
      script: `document.documentElement.getAttribute('data-consent-choice')`,
    });
    const rejected = (childChoice.frames || []).some((f) => f.ok && f.value === 'reject');
    check('the click actually landed inside the child frame', rejected, rejected ? 'child recorded reject' : 'child saw no click');

    // --- human takeover (Phase 4) -------------------------------------------
    const humanBefore = await call('/human/status');
    check('human status endpoint reports idle before any input', humanBefore.active === false, JSON.stringify(humanBefore.last || null));

    // Our own synthetic click must NOT register as a human takeover.
    await call('/act', 'POST', { target_text: 'Plain button', action: 'click' });
    await sleep(300);
    const afterSynthetic = await call('/human/status');
    check('synthetic input never counts as human', afterSynthetic.active === false, `active=${afterSynthetic.active}`);

    // A page-script (untrusted) pointer event must be ignored too.
    await call('/evaluate', 'POST', {
      script: `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
    });
    await sleep(250);
    const afterScript = await call('/human/status');
    check('untrusted page events never count as human', afterScript.active === false, `active=${afterScript.active}`);

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
