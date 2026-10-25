#!/usr/bin/env node
/**
 * Sealed shadow-root discovery (live bridge).
 *
 * Fixture:
 *   - `<host-one>` with a closed root: button, text input, nested closed button, and two
 *     controls that must be absent (`display:none`, `aria-hidden`).
 *   - a same-site iframe with its own closed root.
 *   - a cross-site (OOPIF) iframe with its own closed root.
 *
 * Proves: AX finds closed controls with real coordinates; page JS still cannot see the root;
 * clicks and typing work through coordinates; values are never returned; hidden controls are
 * absent; the second call is cached; an explicit stream of scans hits the rate limit.
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
  if (!res.ok || json.success === false) {
    const err = new Error(`${pathname} -> ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function health() {
  return call('/health');
}

const CHILD = (label, key) => `<!doctype html><html><head><title>${label}</title></head>
<body style="margin:0;font:16px sans-serif">
<host-child data-label="${label}"></host-child>
<script>
class HostChild extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML = '<button id="b" style="margin:8px">${label}</button>';
    root.getElementById('b').addEventListener('click', () => {
      document.documentElement.setAttribute('data-${key}', '1');
    });
  }
}
customElements.define('host-child', HostChild);
</script></body></html>`;

const MAIN = (crossUrl) => `<!doctype html><html><head><title>Sealed Main</title></head>
<body style="margin:0;font:16px sans-serif">
<host-one part="card" exportparts="button:pay-button" style="--brand:#0af"></host-one>
<iframe id="same" src="/same" style="display:block;width:420px;height:140px;border:1px solid #ccc"></iframe>
<iframe id="cross" src="${crossUrl}" style="display:block;width:420px;height:140px;border:1px solid #ccc"></iframe>
<script>
class HostTwo extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML = '<button id="deep">Deep Sealed</button>';
    root.getElementById('deep').addEventListener('click', () => {
      document.documentElement.setAttribute('data-deep', '1');
    });
  }
}
class HostOne extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>:host{display:block;padding:10px}</style>' +
      '<button id="pay">Sealed Pay</button> ' +
      '<input id="secret" aria-label="Secret Field" value="hunter2" /> ' +
      '<button id="hidden" style="display:none">Hidden Sealed</button>' +
      '<button id="aria" aria-hidden="true">Aria Hidden Sealed</button>' +
      '<host-two></host-two>';
    root.getElementById('pay').addEventListener('click', () => {
      document.documentElement.setAttribute('data-sealed-click', '1');
    });
    root.getElementById('secret').addEventListener('input', (e) => {
      document.documentElement.setAttribute('data-sealed-value', e.target.value);
    });
  }
}
customElements.define('host-two', HostTwo);
customElements.define('host-one', HostOne);
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
    if (String(req.url || '') === '/same') return res.end(CHILD('Same Frame Sealed', 'same'));
    if (String(req.url || '') === '/cross') return res.end(CHILD('Cross Frame Sealed', 'cross'));
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
    await sleep(1600);

    // --- quiet by default: ordinary reads do not touch AX -------------------
    await call('/metrics/reset', 'POST', {});
    await call('/dom/facts', 'POST', {});
    await call('/find', 'POST', { contains: 'Sealed' });
    await call('/evaluate', 'POST', { script: '1 + 1' });
    await call('/screenshot?max_width=320');
    const after = await call('/metrics');
    const quiet = after.counters || {};
    check(
      'no sealed scan or AX work before it is requested',
      (quiet['sealed.scan'] || 0) === 0 && (quiet['cdp.ax'] || 0) === 0,
      `sealed.scan=${quiet['sealed.scan'] || 0} cdp.ax=${quiet['cdp.ax'] || 0}`
    );

    const pageProbe = await call('/evaluate', 'POST', {
      script: `(() => {
        const host = document.querySelector('host-one');
        return {
          closed: !!host && host.shadowRoot === null,
          clicked: document.documentElement.getAttribute('data-sealed-click'),
          value: document.documentElement.getAttribute('data-sealed-value'),
        };
      })()`,
    });
    check('the page still cannot see its own closed root', pageProbe.result?.closed === true, `shadowRoot=${pageProbe.result?.closed === true ? 'null' : 'readable'}`);

    // --- first sealed scan --------------------------------------------------
    const found = await call('/find', 'POST', { sealed: true, contains: 'Sealed', limit: 20 });
    const sealed = Array.isArray(found.sealed) ? found.sealed : [];
    const names = sealed.map((c) => c.name);
    check('sealed find returns closed-root controls', sealed.length >= 4, `${sealed.length} sealed, total=${found.sealedTotal}`);
    check(
      'the top closed root, nested closed root, and both frames are represented',
      ['Sealed Pay', 'Deep Sealed', 'Same Frame Sealed', 'Cross Frame Sealed'].every((n) => names.includes(n)),
      names.join(' | ')
    );
    check(
      'hidden and aria-hidden controls are absent',
      !names.includes('Hidden Sealed') && !names.includes('Aria Hidden Sealed'),
      names.filter((n) => /Hidden/.test(n)).join(', ') || 'absent'
    );
    check(
      'every sealed result has coordinates and the AX source',
      sealed.every((c) => c.source === 'ax' && c.rect && c.rect.width > 0 && c.rect.height > 0),
      sealed.map((c) => `${c.name}@${Math.round(c.rect.x)},${Math.round(c.rect.y)}`).join(' | ')
    );
    check(
      'sealed results never carry input values',
      sealed.every((c) => c.value === undefined) && !JSON.stringify(sealed).includes('hunter2'),
      'value absent'
    );
    const payComponent = sealed.find((c) => c.name === 'Sealed Pay')?.component;
    check(
      'sealed results carry the host component signature',
      /^host-one:[0-9a-f]{8}$/.test(String(payComponent?.signature)) &&
        payComponent?.part?.includes('card') &&
        payComponent?.exportparts?.includes('button:pay-button') &&
        payComponent?.cssVars?.includes('--brand'),
      JSON.stringify(payComponent || null)
    );
    check('the first scan is not cached', found.sealedCached === false, `cached=${found.sealedCached}`);

    // --- cache --------------------------------------------------------------
    const scansBefore = (await call('/metrics')).counters?.['sealed.scan'] || 0;
    const again = await call('/find', 'POST', { sealed: true, contains: 'Sealed', limit: 20 });
    const scansAfter = (await call('/metrics')).counters?.['sealed.scan'] || 0;
    check(
      'a repeat scan uses the identity cache',
      again.sealedCached === true && scansAfter === scansBefore,
      `cached=${again.sealedCached} scans ${scansBefore}->${scansAfter}`
    );

    // --- click a closed-root button ----------------------------------------
    const pay = (again.sealed || []).find((c) => c.name === 'Sealed Pay');
    const centre = (c) => ({ x: Math.round(c.rect.x + c.rect.width / 2), y: Math.round(c.rect.y + c.rect.height / 2) });
    if (pay) {
      const p = centre(pay);
      await call('/act', 'POST', { x: p.x, y: p.y, action: 'click' });
      const probe = await call('/evaluate', 'POST', { script: `document.documentElement.getAttribute('data-sealed-click')` });
      check('clicking the sealed button actuates the component', probe.result === '1', `clicked (${p.x}, ${p.y})`);
    } else {
      check('clicking the sealed button actuates the component', false, 'Sealed Pay not found');
    }

    // --- type into a closed-root input -------------------------------------
    const typed = await call('/find', 'POST', { sealed: true, name: 'Secret Field', limit: 5, refresh: true });
    const secret = (typed.sealed || [])[0];
    if (secret) {
      const p = centre(secret);
      await call('/act', 'POST', {
        x: p.x,
        y: p.y,
        action: 'type',
        text: 'replaced',
        clear_first: true,
      });
      const probe = await call('/evaluate', 'POST', { script: `document.documentElement.getAttribute('data-sealed-value')` });
      check('typing with clear_first replaces the sealed field value', probe.result === 'replaced', `value=${probe.result}`);
    } else {
      check('typing with clear_first replaces the sealed field value', false, 'Secret Field not found');
    }

    // --- nested closed root and both frames --------------------------------
    const deep = (again.sealed || []).find((c) => c.name === 'Deep Sealed');
    if (deep) {
      const p = centre(deep);
      await call('/act', 'POST', { x: p.x, y: p.y, action: 'click' });
      const probe = await call('/evaluate', 'POST', { script: `document.documentElement.getAttribute('data-deep')` });
      check('clicking a control in a nested closed root works', probe.result === '1', `clicked (${p.x}, ${p.y})`);
    } else {
      check('clicking a control in a nested closed root works', false, 'Deep Sealed not found');
    }

    const frameStates = await call('/evaluate', 'POST', {
      frames: true,
      script: `({ same: document.documentElement.getAttribute('data-same'), cross: document.documentElement.getAttribute('data-cross'), title: document.title })`,
    });
    const same = (frameStates.frames || []).find((f) => f.value?.title === 'Same Frame Sealed');
    const cross = (frameStates.frames || []).find((f) => f.value?.title === 'Cross Frame Sealed');
    check('the same-site closed frame is reachable for evaluation', !!same && same.ok === true, same ? `oopif=${same.oopif}` : 'missing');
    check('the cross-site closed frame is reachable for evaluation', !!cross && cross.ok === true && cross.oopif === true, cross ? `oopif=${cross.oopif}` : 'missing');

    if (same && cross) {
      const sameCtl = (again.sealed || []).find((c) => c.name === 'Same Frame Sealed');
      const crossCtl = (again.sealed || []).find((c) => c.name === 'Cross Frame Sealed');
      if (sameCtl) {
        const p = centre(sameCtl);
        await call('/act', 'POST', { x: p.x, y: p.y, action: 'click' });
      }
      if (crossCtl) {
        const p = centre(crossCtl);
        await call('/act', 'POST', { x: p.x, y: p.y, action: 'click' });
      }
      const states = await call('/evaluate', 'POST', {
        frames: true,
        script: `({ same: document.documentElement.getAttribute('data-same'), cross: document.documentElement.getAttribute('data-cross') })`,
      });
      const sameAfter = (states.frames || []).find((f) => /\/same$/.test(String(f.url || '')))?.value?.same;
      const crossAfter = (states.frames || []).find((f) => /\/cross$/.test(String(f.url || '')))?.value?.cross;
      check('clicking a sealed control inside a same-site frame lands', sameAfter === '1', `same=${sameAfter || 'none'}`);
      check('clicking a sealed control inside a cross-site frame lands', crossAfter === '1', `cross=${crossAfter || 'none'}`);
    } else {
      check('clicking a sealed control inside a same-site frame lands', false, 'frame missing');
      check('clicking a sealed control inside a cross-site frame lands', false, 'frame missing');
    }

    // --- rate limit (last: it exhausts the per-tab budget) ------------------
    let limited = null;
    for (let i = 0; i < 7; i++) {
      try {
        await call('/find', 'POST', { sealed: true, contains: 'Sealed', limit: 5, refresh: true });
      } catch (err) {
        if (err.status === 429) {
          limited = err;
          break;
        }
      }
    }
    check(
      'repeated forced scans are rate-limited with a retry hint',
      !!limited && Number(limited.body?.retry_after) > 0,
      limited ? `429 retry_after=${limited.body.retry_after}s` : 'no 429'
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
