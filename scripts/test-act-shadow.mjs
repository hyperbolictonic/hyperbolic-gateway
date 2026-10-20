#!/usr/bin/env node
/**
 * Shadow-DOM interaction test (live, local fixture).
 *
 * Guards the failure that blocked the 2026-10-20 signup run
 * (see docs/FIELD_NOTES_2026-10-20_SIGNUP.md §2.2 and §2.3):
 *
 *   - `act({selector})` on a web component used to click the *host's* centre and then
 *     apply `el.focus()` to the host, so typing went nowhere and the call still reported
 *     success. Selectors now resolve to the control a mouse would hit, through shadow roots.
 *   - Typing that provably had no effect is no longer reported as success: `act` returns
 *     `ok:false` with `error.code = "TYPE_NO_EFFECT"`, the evidence (`typing`), and a hint
 *     that separates "our input never arrived" from "the control refused it".
 *
 * Requires the Cyberdeck app + bridge on 127.0.0.1:4111. Prints SKIP and exits 0 when the
 * bridge is unreachable.
 *
 * Usage: node scripts/test-act-shadow.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

const PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shadow Act</title></head><body>',
  '<h1>Act fixture</h1>',
  '<x-signup></x-signup>',
  '<x-otp></x-otp>',
  '<script>',
  'window.__clicks = 0;',
  'class XSignup extends HTMLElement {',
  '  connectedCallback() {',
  '    const root = this.attachShadow({ mode: "open" });',
  '    root.innerHTML = [',
  '      "<input id=\\"email\\" aria-label=\\"Email\\" type=\\"email\\">",',
  '      "<button id=\\"go\\">Create account</button>"',
  '    ].join("");',
  '    root.getElementById("go").addEventListener("click", () => { window.__clicks++; });',
  '  }',
  '}',
  'class XOtp extends HTMLElement {',
  '  connectedCallback() {',
  '    const root = this.attachShadow({ mode: "open" });',
  '    root.innerHTML = "<input id=\\"otp\\" aria-label=\\"Code\\" inputmode=\\"numeric\\">";',
  '    // A one-time-code control that reverts whatever arrives — the field-notes case.',
  '    root.getElementById("otp").addEventListener("input", (e) => { e.target.value = ""; });',
  '  }',
  '}',
  'customElements.define("x-signup", XSignup);',
  'customElements.define("x-otp", XOtP);',
  '</script></body></html>',
].join('\n').replace('XOtP', 'XOtp');

async function bridge(p, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${json.error || json.message || 'unknown'}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForActiveUrl(fragment, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await bridge('/health');
      if ((health?.info?.url || '').includes(fragment)) return true;
    } catch {
      // bridge busy while the tab loads
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for the active URL to include "${fragment}"`);
}

const evaluate = async (script) => (await bridge('/evaluate', 'POST', { script })).result;

/**
 * A freshly-created tab can report a 0x0 viewport until layout settles; geometry-based
 * addressing is meaningless then (and the product now refuses to act on it). Wait for a
 * real viewport *and* for the fixture's shadow button to have a real box.
 */
async function waitForLayout(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const vp = await evaluate('({ w: innerWidth, h: innerHeight })');
      if (vp?.w > 0 && vp?.h > 0) {
        const box = await evaluate(`(() => {
          const root = document.querySelector('x-signup') && document.querySelector('x-signup').shadowRoot;
          const b = root && root.getElementById('go');
          const r = b && b.getBoundingClientRect();
          return r ? { w: r.width, h: r.height, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) } : null;
        })()`);
        if (box && box.w > 0 && box.h > 0 && box.cy >= 0 && box.cy <= vp.h) return true;
      }
    } catch {
      // tab still settling
    }
    await sleep(250);
  }
  return false;
}

async function ledgerRecord(address, predicate, timeoutMs = 4000) {
  const file = path.join(process.cwd(), 'data', 'transitions.jsonl');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const rec = JSON.parse(lines[i]);
        if (rec.address === address && (!predicate || predicate(rec))) return rec;
      }
    } catch {
      // ledger file not written yet
    }
    await sleep(250);
  }
  return null;
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const created = await bridge('/tabs/new', 'POST', { url: `${origin}/act.html` });
    tabId = created?.tab?.id || created?.tab?.tabId || null;
    await waitForActiveUrl(`${origin}/act.html`);
    const laidOut = await waitForLayout();
    check('fixture is laid out before acting', laidOut, laidOut ? 'real viewport + real control box' : 'timed out waiting for layout');

    // ---- 1. Typing through a custom-element host actually lands -------------
    const hostType = await bridge('/act', 'POST', { selector: 'x-signup', action: 'type', text: 'kuangmarkeleven' });
    check('typing at a custom-element host reports success', hostType.ok === true, `ok=${hostType.ok}`);
    check(
      'the host selector resolves to the inner control',
      hostType.target?.field?.tag === 'input' && hostType.target?.field?.inShadowRoot === true,
      `field=<${hostType.target?.field?.tag}> "${hostType.target?.field?.name}"`
    );
    check(
      'the verdict is reported, not assumed',
      hostType.typing?.landed === true && hostType.typing?.beforeLength === 0,
      `landed=${hostType.typing?.landed} ${hostType.typing?.beforeLength}→${hostType.typing?.afterLength}`
    );
    const emailValue = await evaluate('document.querySelector("x-signup").shadowRoot.getElementById("email").value');
    check('the shadow input really holds the text', emailValue === 'kuangmarkeleven', JSON.stringify(emailValue));

    // ---- 2. Selectors pierce shadow roots for clicks ------------------------
    const goClick = await bridge('/act', 'POST', { selector: '#go', action: 'click' });
    const clicks = await evaluate('window.__clicks');
    check('a selector inside a shadow root actuates the control', clicks === 1, `clicks=${clicks}, ok=${goClick.ok}`);

    // ---- 3. A field that refuses input is a structured failure --------------
    const otp = await bridge('/act', 'POST', { selector: '#otp', action: 'type', text: '740106' });
    check('a controlled field that reverts input returns ok:false', otp.ok === false, `ok=${otp.ok}`);
    check('the failure names the cause', otp.error?.code === 'TYPE_NO_EFFECT', `code=${otp.error?.code}`);
    check(
      'the evidence separates "never arrived" from "refused"',
      otp.typing?.keydowns > 0 && otp.typing?.landed === false,
      `keydowns=${otp.typing?.keydowns}, landed=${otp.typing?.landed}`
    );
    check('the hint points at the human', /request_human_intervention/.test(otp.error?.hint || ''), 'OTP → hand over');

    const record = await ledgerRecord('#otp');
    check(
      'the ledger records the no-op',
      record?.ok === false && record?.typing?.landed === false,
      record ? `ok=${record.ok} landed=${record.typing?.landed}` : 'no record found'
    );

    // ---- 4. clear_first, including an identical retype ---------------------
    const cleared = await bridge('/act', 'POST', { selector: 'x-signup', action: 'type', text: 'xyz', clear_first: true });
    const afterClear = await evaluate('document.querySelector("x-signup").shadowRoot.getElementById("email").value');
    check('clear_first replaces the value in a shadow control', cleared.ok === true && afterClear === 'xyz', JSON.stringify(afterClear));

    const retyped = await bridge('/act', 'POST', { selector: 'x-signup', action: 'type', text: 'xyz', clear_first: true });
    check(
      'an identical retype is not mistaken for a no-op',
      retyped.ok === true && retyped.typing?.landed === true,
      `landed=${retyped.typing?.landed} changed=${retyped.typing?.changed}`
    );

    // ---- 5. Unresolvable targets still fail loudly -------------------------
    let noTarget = null;
    try {
      noTarget = await bridge('/act', 'POST', { selector: '#does-not-exist', action: 'click' });
    } catch (err) {
      noTarget = { error: err.message };
    }
    check('an unresolvable selector is an error, not a silent success', /NO_TARGET|no visible element|not found/i.test(JSON.stringify(noTarget)), String(noTarget?.error?.code || noTarget?.message || ''));
  } catch (err) {
    check('shadow interaction run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
