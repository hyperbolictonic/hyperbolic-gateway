#!/usr/bin/env node
/**
 * Component signatures + recipe anchors (live bridge).
 *
 * Fixture: a light-DOM custom element (`<pay-widget part exportparts>`) wrapping a button. Proves:
 *   - find/observe attach the host's signature
 *   - a recipe stores the signature and replays while the surface is unchanged
 *   - changing `part` produces SIGNATURE_MISMATCH and retires the recipe (not three silent tries)
 *   - turning component signatures off removes them and reports SIGNATURE_UNAVAILABLE
 *
 * Requires the Cyberdeck app (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when it is down.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { SHADOW_WALK_SETTINGS_FILE, DEFAULT_SHADOW_WALK_SETTINGS } from '../src/main/shadow-walk/settings.ts';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(pathname, method = 'GET', body) {
  const res = await fetch(`${BRIDGE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

const PAGE = `<!doctype html><html><head><title>Component Signature</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif">
<pay-widget part="card" exportparts="button:pay-button, label:pay-label" style="--brand:#0af;--radius:8px">
  <button id="pay" onclick="document.documentElement.setAttribute('data-paid','1')">Pay now</button>
</pay-widget>
<open-widget></open-widget>
<script>
class PayWidget extends HTMLElement {}
customElements.define('pay-widget', PayWidget);
class OpenWidget extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="open-action">Open Shadow Action</button>';
  }
}
customElements.define('open-widget', OpenWidget);
</script>
</body></html>`;

function writeSettings(patch = {}) {
  const base = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  const merged = {
    ...base,
    ...patch,
    shadow: { ...base.shadow, ...(patch.shadow || {}) },
    frames: { ...base.frames, ...(patch.frames || {}) },
  };
  fs.mkdirSync(path.dirname(SHADOW_WALK_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SHADOW_WALK_SETTINGS_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

async function main() {
  try {
    await req('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const originalSettings = fs.existsSync(SHADOW_WALK_SETTINGS_FILE) ? fs.readFileSync(SHADOW_WALK_SETTINGS_FILE, 'utf8') : null;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  const recipeIds = [];
  try {
    writeSettings();
    await req('/window/visibility', 'POST', { visible: true });
    const created = await req('/tabs/new', 'POST', { url: pageUrl });
    tabId = created?.tab?.id || null;
    await sleep(800);

    const observed = await req('/observe', 'POST', { as: 'components' });
    const pay = (observed.components || []).find((c) => c.name === 'Pay now');
    const signature = pay?.signature;
    check('observe exposes the host component signature', /^pay-widget:[0-9a-f]{8}$/.test(String(signature)), String(signature || 'missing'));
    check(
      'the signature carries the exported surface',
      pay?.component?.tag === 'pay-widget' &&
        pay?.component?.part?.includes('card') &&
        pay?.component?.exportparts?.includes('button:pay-button') &&
        pay?.component?.cssVars?.includes('--brand'),
      JSON.stringify(pay?.component || null)
    );

    const found = await req('/find', 'POST', { name: 'Pay now' });
    const mark = (found.marks || [])[0];
    check('find attaches the same signature to its mark', mark?.component?.signature === signature, mark?.component?.signature || 'missing');

    const saved = await req('/recipes', 'POST', {
      action: 'save',
      url: pageUrl,
      name: 'signature-test',
      steps: [{ action: 'click', target: 'Pay now', signature }],
    });
    if (saved.recipe?.id) recipeIds.push(saved.recipe.id);
    check('a recipe stores the component signature', saved.status === 200 && saved.recipe?.steps?.[0]?.signature === signature, saved.recipe?.steps?.[0]?.signature || 'not saved');

    const replayed = await req('/recipes', 'POST', { action: 'replay', id: saved.recipe?.id });
    const paid = await req('/evaluate', 'POST', { script: `document.documentElement.getAttribute('data-paid')` });
    check('a matching signature replays the step', replayed.status === 200 && paid.result === '1', `status=${replayed.status} paid=${paid.result}`);

    await req('/evaluate', 'POST', { script: `document.querySelector('pay-widget').setAttribute('part','card-alt')` });
    const mismatch = await req('/recipes', 'POST', { action: 'replay', id: saved.recipe?.id });
    check(
      'a changed exported surface fails with SIGNATURE_MISMATCH',
      mismatch.status === 409 && mismatch.code === 'SIGNATURE_MISMATCH',
      `${mismatch.status} ${mismatch.code || mismatch.error}`
    );
    check(
      'a structural mismatch retires the recipe immediately',
      Number(mismatch.recipe?.consecutiveFailures) >= 3,
      `consecutiveFailures=${mismatch.recipe?.consecutiveFailures}`
    );

    const openDefault = await req('/find', 'POST', { name: 'Open Shadow Action' });
    check('deepOpenRoots on finds controls inside open roots', (openDefault.marks || []).some((m) => m.text === 'Open Shadow Action'), `count=${openDefault.count}`);
    writeSettings({ shadow: { deepOpenRoots: false } });
    const openOff = await req('/find', 'POST', { name: 'Open Shadow Action' });
    check('deepOpenRoots off keeps marks in the light DOM', (openOff.count || 0) === 0, `count=${openOff.count}`);
    writeSettings();
    writeSettings({ shadow: { partHighlight: true } });
    const highlightedShot = await req('/screenshot?max_width=320');
    check('partHighlight does not break a screenshot capture', highlightedShot.status === 200 && !!highlightedShot.screenshot?.base64Image, `status=${highlightedShot.status}`);
    writeSettings();

    writeSettings({ shadow: { componentSurface: false } });
    const without = await req('/observe', 'POST', { as: 'components' });
    const payOff = (without.components || []).find((c) => c.name === 'Pay now');
    check('componentSurface off omits the signature', payOff && payOff.signature === undefined, `signature=${payOff?.signature}`);

    const savedOff = await req('/recipes', 'POST', {
      action: 'save',
      url: pageUrl,
      name: 'signature-off-test',
      steps: [{ action: 'click', target: 'Pay now', signature }],
    });
    if (savedOff.recipe?.id) recipeIds.push(savedOff.recipe.id);
    const unavailable = await req('/recipes', 'POST', { action: 'replay', id: savedOff.recipe?.id });
    check(
      'componentSurface off reports SIGNATURE_UNAVAILABLE, not a silent click',
      unavailable.status === 409 && unavailable.code === 'SIGNATURE_UNAVAILABLE',
      `${unavailable.status} ${unavailable.code || unavailable.error}`
    );
  } finally {
    for (const id of recipeIds) await req('/recipes', 'POST', { action: 'delete', id }).catch(() => {});
    if (tabId) await req('/tabs/close', 'POST', { tab_id: tabId }).catch(() => {});
    if (originalSettings === null) fs.rmSync(SHADOW_WALK_SETTINGS_FILE, { force: true });
    else fs.writeFileSync(SHADOW_WALK_SETTINGS_FILE, originalSettings, 'utf8');
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
