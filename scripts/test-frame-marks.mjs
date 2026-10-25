#!/usr/bin/env node
/**
 * Frame control marks (live bridge).
 *
 * Fixture: a same-site iframe and a cross-site (OOPIF) iframe, each with a button and an input.
 * Proves `find(include_frames:true)` returns 100+ ids, `act(mark_id)` resolves and clicks/types
 * inside both frame types, and `frames` exposes the same ids.
 *
 * Requires the Cyberdeck app (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when it is down.
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
  if (!res.ok || json.success === false) throw new Error(`${pathname} -> ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
  return json;
}

const MAIN = (crossUrl) => `<!doctype html><html><head><title>Frame Marks</title></head>
<body style="margin:0;padding:10px;font:16px sans-serif">
<button id="main">Main button</button>
<table><thead><tr><th>Main column</th></tr></thead><tbody><tr><td>Main row</td></tr></tbody></table>
<iframe src="/same" width="420" height="150" style="display:block;border:1px solid #ccc"></iframe>
<iframe src="${crossUrl}" width="420" height="150" style="display:block;border:1px solid #ccc"></iframe>
</body></html>`;

const CHILD = (label, key) => `<!doctype html><html><head><title>${label}</title></head>
<body style="margin:0;padding:10px;font:16px sans-serif">
<frame-widget part="card" exportparts="button:frame-button" style="--frame:#0af">
  <button id="btn">${label} Button</button>
</frame-widget>
<input id="field" aria-label="${label} Field" />
<table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>${label}</td><td>10</td></tr></tbody></table>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${label} Product"}</script>
<script>
class FrameWidget extends HTMLElement {}
customElements.define('frame-widget', FrameWidget);
document.getElementById('btn').addEventListener('click', () => {
  document.documentElement.setAttribute('data-${key}-click', '1');
});
document.getElementById('field').addEventListener('input', (e) => {
  document.documentElement.setAttribute('data-${key}-value', e.target.value);
});
</script></body></html>`;

async function main() {
  try {
    await call('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  await call('/window/visibility', 'POST', { visible: true });
  await sleep(300);

  let port = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const path = String(req.url || '');
    if (path === '/same') return res.end(CHILD('Same Frame', 'same'));
    if (path === '/cross') return res.end(CHILD('Cross Frame', 'cross'));
    return res.end(MAIN(`http://127.0.0.2:${port}/cross`));
  });
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  port = server.address().port;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const created = await call('/tabs/new', 'POST', { url: `http://127.0.0.1:${port}/` });
    tabId = created?.tab?.id || null;
    await sleep(1300);

    const plain = await call('/find', 'POST', { name: 'Frame Button' });
    check('find without include_frames stays main-frame only', (plain.count || 0) === 0, `count=${plain.count}`);

    const found = await call('/find', 'POST', { name: 'Frame Button', include_frames: true, limit: 20 });
    const marks = Array.isArray(found.marks) ? found.marks : [];
    const frameMarks = marks.filter((m) => typeof m.id === 'number' && m.id >= 100);
    const same = frameMarks.find((m) => /Same Frame Button/.test(m.text || ''));
    const cross = frameMarks.find((m) => /Cross Frame Button/.test(m.text || ''));
    check('find(include_frames) returns both child buttons with 100+ ids', frameMarks.length === 2 && !!same && !!cross, frameMarks.map((m) => `#${m.id}:${m.text}`).join(' | '));
    check('frame marks carry the frame identity', !!same?.frameId && !!cross?.frameId && same.frameId !== cross.frameId, `same=${same?.frameId} cross=${cross?.frameId}`);
    check(
      'frame marks carry the host component signature',
      /^frame-widget:[0-9a-f]{8}$/.test(String(same?.component?.signature)) &&
        same?.component?.part?.includes('card') &&
        same?.component?.exportparts?.includes('button:frame-button'),
      JSON.stringify(same?.component || null)
    );

    const observed = await call('/observe', 'POST', { as: 'components', include_frames: true, include_offscreen: true });
    const frameComponents = (observed.components || []).filter((c) => typeof c.id === 'number' && c.id >= 100);
    check(
      'observe(components) merges child-frame controls',
      frameComponents.length >= 2 && frameComponents.some((c) => c.frameId),
      `frame components=${frameComponents.length} total=${(observed.components || []).length}`
    );

    const som = await call('/observe', 'POST', { as: 'som', include_frames: true, include_offscreen: true });
    const somMarks = (som.marks || []).filter((m) => typeof m.id === 'number' && m.id >= 100);
    check('observe(som) merges child-frame marks', somMarks.length >= 2, `frame marks=${somMarks.length}`);

    const extracted = await call('/extract', 'POST', { kind: 'table', include_frames: true });
    const extractFrames = Array.isArray(extracted.frames) ? extracted.frames : [];
    check(
      'extract(table) returns per-frame tables',
      extractFrames.length >= 2 && extractFrames.every((f) => f.ok && f.value?.kind === 'table'),
      extractFrames.map((f) => `${f.url}:${f.ok}`).join(' | ')
    );
    check(
      'extract(table) exposes merged frameRecords with frame identity',
      (extracted.frameRecords || []).length >= 2 && extracted.frameRecords.every((r) => r.frameId && r.frameUrl),
      `${(extracted.frameRecords || []).length} records`
    );

    const ld = await call('/extract', 'POST', { kind: 'schema_org', type: 'Product', include_frames: true });
    const ldFrames = Array.isArray(ld.frames) ? ld.frames : [];
    const ldNames = ldFrames.flatMap((f) => f.value?.items || []).map((i) => i.data?.name);
    check('extract(schema_org) reads JSON-LD inside frames', ldNames.includes('Same Frame Product') && ldNames.includes('Cross Frame Product'), ldNames.join(', '));

    if (same && cross) {
      await call('/act', 'POST', { mark_id: same.id, action: 'click' });
      await call('/act', 'POST', { mark_id: cross.id, action: 'click' });
      const clicked = await call('/evaluate', 'POST', {
        frames: true,
        script: `({ title: document.title, same: document.documentElement.getAttribute('data-same-click'), cross: document.documentElement.getAttribute('data-cross-click') })`,
      });
      const sameFrame = (clicked.frames || []).find((f) => f.value?.title === 'Same Frame');
      const crossFrame = (clicked.frames || []).find((f) => f.value?.title === 'Cross Frame');
      check('act(mark_id) clicks a same-site frame control', sameFrame?.value?.same === '1', `value=${sameFrame?.value?.same || 'none'}`);
      check('act(mark_id) clicks an OOPIF control', crossFrame?.value?.cross === '1', `value=${crossFrame?.value?.cross || 'none'}`);
    } else {
      check('act(mark_id) clicks a same-site frame control', false, 'mark missing');
      check('act(mark_id) clicks an OOPIF control', false, 'mark missing');
    }

    const typed = await call('/find', 'POST', { name: 'Cross Frame Field', include_frames: true, limit: 20 });
    const field = (typed.marks || []).find((m) => /Cross Frame Field/.test(m.text || ''));
    if (field) {
      await call('/act', 'POST', { mark_id: field.id, action: 'type', text: 'hello', clear_first: true });
      const value = await call('/evaluate', 'POST', {
        frames: true,
        script: `({ title: document.title, value: document.documentElement.getAttribute('data-cross-value') })`,
      });
      const crossFrame = (value.frames || []).find((f) => f.value?.title === 'Cross Frame');
      check('type_mark types inside an OOPIF', crossFrame?.value?.value === 'hello', `value=${crossFrame?.value?.value || 'none'}`);
    } else {
      check('type_mark types inside an OOPIF', false, 'field mark missing');
    }

    const inventory = await call('/frames', 'POST', { include_controls: true, max_frames: 6 });
    const frameControls = (inventory.frames || []).flatMap((f) => f.controls || []);
    check(
      'frames exposes the same 100+ control ids',
      frameControls.length > 0 && frameControls.every((c) => typeof c.id === 'number' && c.id >= 100),
      frameControls.map((c) => `#${c.id}`).join(',')
    );
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
