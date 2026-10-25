#!/usr/bin/env node
/**
 * Force-open (live bridge).
 *
 * Fixture: a custom element whose constructor calls attachShadow({mode:'closed'}). Proves:
 *   - default: page JS sees shadowRoot === null; marks cannot reach the inner button
 *   - forceOpen armed: after reload the host is open; marks reach the button; the page can detect
 *     the patch (host.shadowRoot !== null and attachShadow is no longer native)
 *   - forceOpen disabled: after reload the boundary is restored
 *   - master off disarms force-open even when the lever is set
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

const PAGE = `<!doctype html><html><head><title>Force Open</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif">
<host-one></host-one>
<script>
class HostOne extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML = '<button id="sealed">Sealed Action</button>';
  }
}
customElements.define('host-one', HostOne);
const host = document.querySelector('host-one');
document.documentElement.setAttribute('data-shadow', host && host.shadowRoot ? 'open' : 'closed');
</script></body></html>`;

function writeSettings(patch = {}) {
  const base = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  const merged = {
    ...base,
    ...patch,
    shadow: { ...base.shadow, ...(patch.shadow || {}) },
    frames: { ...base.frames, ...(patch.frames || {}) },
    cloneLab: { ...base.cloneLab, ...(patch.cloneLab || {}) },
  };
  fs.mkdirSync(path.dirname(SHADOW_WALK_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SHADOW_WALK_SETTINGS_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

async function reload() {
  return req('/history', 'POST', { action: 'reload' });
}

async function probe() {
  return req('/evaluate', 'POST', {
    script: `(() => {
      const host = document.querySelector('host-one');
      const t = document.createElement('div');
      const root = t.attachShadow({ mode: 'closed' });
      const source = Function.prototype.toString.call(Element.prototype.attachShadow);
      return {
        pageShadowRoot: host && host.shadowRoot ? 'open' : 'closed',
        probeShadowRootIsNull: t.shadowRoot === null,
        attachShadowNative: /native code/.test(source),
        source: String(source).slice(0, 80),
      };
    })()`,
  });
}

async function main() {
  try {
    await req('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const original = fs.existsSync(SHADOW_WALK_SETTINGS_FILE) ? fs.readFileSync(SHADOW_WALK_SETTINGS_FILE, 'utf8') : null;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    writeSettings();
    await req('/window/visibility', 'POST', { visible: true });
    const created = await req('/tabs/new', 'POST', { url });
    tabId = created?.tab?.id || null;
    await sleep(900);

    const closed = await probe();
    const closedMarks = await req('/find', 'POST', { name: 'Sealed Action' });
    const closedSealed = await req('/find', 'POST', { sealed: true, name: 'Sealed Action' });
    check('default: page JS sees a closed root', closed.result?.pageShadowRoot === 'closed' && closed.result?.probeShadowRootIsNull === true, JSON.stringify(closed.result));
    check('default: marks cannot reach the inner button', (closedMarks.count || 0) === 0, `marks=${closedMarks.count}`);
    check('default: sealed discovery can name it', (closedSealed.sealedTotal || 0) >= 1, `sealed=${closedSealed.sealedTotal}`);

    writeSettings({ shadow: { forceOpen: true } });
    await reload();
    await sleep(1100);
    const open = await probe();
    const openMarks = await req('/find', 'POST', { name: 'Sealed Action' });
    const health = await req('/health');
    check('force-open: the page sees an open root after reload', open.result?.pageShadowRoot === 'open', JSON.stringify(open.result));
    check('force-open: the page can detect the patch', open.result?.attachShadowNative === false && open.result?.probeShadowRootIsNull === false, `native=${open.result?.attachShadowNative}`);
    check('force-open: marks now reach the inner button', (openMarks.count || 0) >= 1, `marks=${openMarks.count}`);
    check('force-open: health reports it armed and enabled', health.shadowWalk?.forceOpen === true && health.shadowWalk?.forceOpenArmed === true, JSON.stringify(health.shadowWalk));

    writeSettings({ shadow: { forceOpen: false } });
    await reload();
    await sleep(1100);
    const restored = await probe();
    const restoredHealth = await req('/health');
    check('disable: the boundary is restored after reload', restored.result?.pageShadowRoot === 'closed' && restored.result?.probeShadowRootIsNull === true, JSON.stringify(restored.result));
    check('disable: health reports it disarmed', restoredHealth.shadowWalk?.forceOpen === false && restoredHealth.shadowWalk?.forceOpenArmed === false, JSON.stringify(restoredHealth.shadowWalk));

    writeSettings({ enabled: false, shadow: { forceOpen: true } });
    await reload();
    await sleep(1100);
    const master = await probe();
    const masterHealth = await req('/health');
    check('master off disarms force-open', master.result?.pageShadowRoot === 'closed' && masterHealth.shadowWalk?.forceOpenArmed === false, `page=${master.result?.pageShadowRoot} armed=${masterHealth.shadowWalk?.forceOpenArmed}`);
  } finally {
    if (tabId) await req('/tabs/close', 'POST', { tab_id: tabId }).catch(() => {});
    if (original === null) fs.rmSync(SHADOW_WALK_SETTINGS_FILE, { force: true });
    else fs.writeFileSync(SHADOW_WALK_SETTINGS_FILE, original, 'utf8');
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
