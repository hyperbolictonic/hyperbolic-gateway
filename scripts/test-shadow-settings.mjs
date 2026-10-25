#!/usr/bin/env node
/**
 * Shadow Walk settings enforcement (live bridge).
 *
 * The app reads `data/shadow-walk.json` on each guarded call, so this test flips the file and
 * checks the structured refusals without restarting. Writes inside the app remain IPC-only; this
 * test is the one deliberate outside writer and restores the file in `finally`.
 *
 * Requires the Cyberdeck app (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when it is down.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  DEFAULT_SHADOW_WALK_SETTINGS,
  SHADOW_WALK_SETTINGS_FILE,
} from '../src/main/shadow-walk/settings.ts';

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

const PAGE = `<!doctype html><html><head><title>Shadow Settings</title></head>
<body style="margin:0;padding:10px;font:16px sans-serif">
<button id="main-btn">Main button</button>
<iframe src="/child" width="400" height="120"></iframe>
</body></html>`;

async function main() {
  try {
    await req('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const original = fs.existsSync(SHADOW_WALK_SETTINGS_FILE)
    ? fs.readFileSync(SHADOW_WALK_SETTINGS_FILE, 'utf8')
    : null;

  const server = http.createServer((request, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(String(request.url || '') === '/child' ? '<!doctype html><body><button>Child button</button></body>' : PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    writeSettings();
    await req('/window/visibility', 'POST', { visible: true });
    const created = await req('/tabs/new', 'POST', { url: `http://127.0.0.1:${port}/` });
    tabId = created?.tab?.id || null;
    await sleep(900);

    const defaults = await req('/health');
    check(
      'health exposes the Shadow Walk state',
      defaults.shadowWalk?.enabled === true && defaults.shadowWalk?.axSealed === true && defaults.shadowWalk?.frames?.geometry === true,
      JSON.stringify(defaults.shadowWalk)
    );

    const allowed = await req('/find', 'POST', { sealed: true });
    check('sealed discovery is allowed under defaults', allowed.status === 200 && allowed.success === true, `status=${allowed.status}`);

    writeSettings({ shadow: { axSealed: false } });
    const sealedOff = await req('/find', 'POST', { sealed: true });
    check(
      'axSealed off refuses sealed discovery with a structured code',
      sealedOff.status === 400 && sealedOff.code === 'SEALED_DISABLED',
      `${sealedOff.status} ${sealedOff.code || sealedOff.error}`
    );

    writeSettings({ shadow: { tabWalk: false } });
    const tabOff = await req('/focus_walk', 'POST', { selector: '#nope' });
    check(
      'tabWalk off refuses the walk',
      tabOff.status === 400 && tabOff.code === 'TAB_WALK_DISABLED',
      `${tabOff.status} ${tabOff.code || tabOff.error}`
    );

    writeSettings({ frames: { geometry: false } });
    const framesOff = await req('/frames', 'POST', {});
    check(
      'frame geometry off refuses frame discovery',
      framesOff.status === 400 && framesOff.code === 'FRAMES_DISABLED',
      `${framesOff.status} ${framesOff.code || framesOff.error}`
    );

    writeSettings({ enabled: false });
    const masterSealed = await req('/find', 'POST', { sealed: true });
    const masterTab = await req('/focus_walk', 'POST', { selector: '#nope' });
    const masterFrames = await req('/frames', 'POST', {});
    check(
      'the master switch refuses every surface',
      [masterSealed, masterTab, masterFrames].every((r) => r.status === 400 && r.code === 'SHADOW_WALK_DISABLED'),
      [masterSealed, masterTab, masterFrames].map((r) => r.code).join(', ')
    );
    const masterHealth = await req('/health');
    check('health reports the master switch off', masterHealth.shadowWalk?.enabled === false, `enabled=${masterHealth.shadowWalk?.enabled}`);

    writeSettings({ enabled: true, frames: { screenshots: false } });
    const noShots = await req('/frames', 'POST', { screenshots: true, include_controls: false });
    check(
      'screenshots off returns frames without images',
      noShots.status === 200 && (noShots.images || []).length === 0 && (noShots.notes || []).some((n) => /screenshots are off/i.test(n)),
      `images=${(noShots.images || []).length} notes=${(noShots.notes || []).join(' | ')}`
    );

    writeSettings({ enabled: true, frames: { controls: false } });
    const noControls = await req('/frames', 'POST', { include_controls: true });
    check(
      'controls off returns frames without controls',
      noControls.status === 200 && (noControls.frames || []).every((f) => f.controls === undefined),
      `frames=${(noControls.frames || []).length} notes=${(noControls.notes || []).join(' | ')}`
    );

    writeSettings({ enabled: true, frames: { maxFrames: 1 } });
    const capped = await req('/frames', 'POST', { max_frames: 6, include_controls: false });
    check('maxFrames clamps the frame list', capped.status === 200 && (capped.frames || []).length === 1, `frames=${(capped.frames || []).length}`);

    writeSettings();
    const restored = await req('/find', 'POST', { sealed: true });
    const restoredHealth = await req('/health');
    check(
      'restoring the defaults re-enables the paths',
      restored.status === 200 && restored.success === true && restoredHealth.shadowWalk?.enabled === true,
      `status=${restored.status} enabled=${restoredHealth.shadowWalk?.enabled}`
    );
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
