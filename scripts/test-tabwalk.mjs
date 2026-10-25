#!/usr/bin/env node
/**
 * Tab walk (live bridge).
 *
 * Fixture: a light-DOM host with tabindex=0 and a closed root containing two buttons and an
 * input, plus a delegatesFocus host. Proves:
 *   - trusted Tab enters the closed root and AX confirms the inner control
 *   - the walk stops when focus leaves the host or the step budget is spent
 *   - Enter activates the landed button
 *   - Shift+Tab goes backward; a failed walk restores focus to the host
 *   - a delegatesFocus host is already on its inner control (initial step)
 *   - human cadence (median step gap >= 80ms)
 *   - page JavaScript still cannot see the closed root
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
  if (!res.ok || json.success === false) throw new Error(`${pathname} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const PAGE = `<!doctype html><html><head><title>Tab Walk</title></head>
<body style="margin:0;font:16px sans-serif;padding:10px">
<button id="before">Before</button>
<host-one id="host" tabindex="0"></host-one>
<button id="after">After</button>
<host-delegates id="delegated" tabindex="0"></host-delegates>
<script>
class HostOne extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<button id="inside">Inside Sealed</button>' +
      '<button id="second">Second Sealed</button>' +
      '<input id="field" aria-label="Sealed Input" style="width:140px" />';
    root.getElementById('inside').addEventListener('click', () => {
      document.documentElement.setAttribute('data-inside', '1');
    });
  }
}
class HostDelegates extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed', delegatesFocus: true });
    root.innerHTML = '<button id="delegated">Delegated Sealed</button>';
  }
}
customElements.define('host-one', HostOne);
customElements.define('host-delegates', HostDelegates);
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

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
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
    const created = await call('/tabs/new', 'POST', { url: `http://127.0.0.1:${port}/` });
    tabId = created?.tab?.id || null;
    await sleep(900);

    const probe = await call('/evaluate', 'POST', {
      script: `({
        host: !!document.querySelector('#host'),
        closed: document.querySelector('#host').shadowRoot === null,
        delegatedClosed: document.querySelector('#delegated').shadowRoot === null,
      })`,
    });
    check('both hosts expose a closed root to page JS', probe.result?.closed === true && probe.result?.delegatedClosed === true, JSON.stringify(probe.result));

    // --- forward walk -------------------------------------------------------
    const walk = await call('/focus_walk', 'POST', { selector: '#host', max_steps: 5 });
    const steps = Array.isArray(walk.steps) ? walk.steps : [];
    const names = steps.map((s) => s.name);
    check('the Tab walk enters the closed root', walk.started === true && walk.landed === true && names.includes('Inside Sealed'), names.join(' | '));
    check(
      'it walks the sequential controls and stops when focus leaves the host',
      names.includes('Second Sealed') && walk.reason === 'left-host',
      `reason=${walk.reason} steps=${steps.length}`
    );
    check(
      'the steps are a human cadence, not a burst',
      Number(walk.medianStepGapMs) >= 80,
      `median=${walk.medianStepGapMs}ms gaps=${steps.map((s) => s.gapMs).join(',')}`
    );

    // --- step budget + Enter ------------------------------------------------
    const one = await call('/focus_walk', 'POST', { selector: '#host', max_steps: 1 });
    const first = (one.steps || [])[0];
    check(
      'max_steps stops on the first inner control',
      first?.name === 'Inside Sealed' && one.reason === 'max-steps',
      first ? `${first.name} reason=${one.reason}` : 'no step'
    );
    await call('/act', 'POST', { action: 'press', text: 'Enter' });
    await sleep(150);
    const activated = await call('/evaluate', 'POST', { script: `document.documentElement.getAttribute('data-inside')` });
    check('Enter activates the control the walk landed on', activated.result === '1', `data-inside=${activated.result || 'none'}`);

    // --- backward failure + restore ----------------------------------------
    const back = await call('/focus_walk', 'POST', { selector: '#host', direction: 'backward', max_steps: 1 });
    check(
      'Shift+Tab leaves the host and reports no landing',
      back.started === true && back.landed === false && back.reason === 'left-host',
      `reason=${back.reason} steps=${(back.steps || []).length}`
    );
    check('a failed walk restores focus to the host', back.restored === true, `restored=${back.restored}`);
    const active = await call('/evaluate', 'POST', { script: `document.activeElement && document.activeElement.id` });
    check('focus is actually back on the host', active.result === 'host', `activeElement=#${active.result || 'none'}`);

    // --- delegatesFocus -----------------------------------------------------
    const delegated = await call('/focus_walk', 'POST', { selector: '#delegated', max_steps: 2 });
    const dSteps = delegated.steps || [];
    check(
      'a delegatesFocus host is already on its inner control',
      dSteps[0]?.index === 0 && dSteps[0]?.name === 'Delegated Sealed',
      dSteps.map((s) => `${s.index}:${s.name}`).join(' | ')
    );
    check('the walk still stops when focus leaves the delegatesFocus host', delegated.reason === 'left-host', `reason=${delegated.reason}`);
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
