#!/usr/bin/env node
/**
 * Markdown presentation test (live, local fixture).
 *
 * Guards the construct envelope and the things that made `observe(as:"markdown")`
 * hard to use in the field (see docs/FIELD_NOTES_2026-10-20_SIGNUP.md):
 *
 *   1. Shadow DOM was invisible — `outerHTML` stops at the shadow boundary, so a
 *      signup form serialised as empty custom-element tags and the construct came
 *      back as a skip-link and a heading.
 *   2. The envelope wasted lines on constant/vain metadata (`designation`,
 *      `harvested_at`, `raw_bytes`, `compression_ratio`) and included a timestamp
 *      that made two harvests of one page non-identical (unusable for diffing and
 *      for paging across calls).
 *   3. The 25k cut happened inside the harvester, so `budget`/`next_cursor`
 *      paging could never reach the remainder.
 *   4. A page with no readable text said nothing about why.
 *
 * Requires the Cyberdeck app + bridge on 127.0.0.1:4111. Prints SKIP and exits 0
 * when the bridge is unreachable.
 *
 * Usage: node scripts/test-markdown-presentation.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const SENTINEL = 'FINALSENTINEL9F3A';

const SHADOW_PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shadow Signup</title></head><body>',
  '<h1>Signup fixture</h1>',
  '<x-signup></x-signup>',
  '<script>',
  'class XSignup extends HTMLElement {',
  '  connectedCallback() {',
  '    const root = this.attachShadow({ mode: "open" });',
  '    root.innerHTML = [',
  '      "<h2>Create your account</h2>",',
  '      "<label>Email</label>",',
  '      "<input type=\\"email\\" aria-label=\\"Email\\" placeholder=\\"you@example.com\\">",',
  '      "<label>Password</label>",',
  '      "<input type=\\"password\\" aria-label=\\"Password\\">",',
  '      "<label>Day</label>",',
  '      "<select aria-label=\\"Day\\"><option>1</option><option selected>2</option><option>3</option></select>",',
  '      "<button id=\\"go\\">Create account</button>",',
  '      "<a href=\\"/home\\">Home</a>"',
  '    ].join("");',
  '    root.querySelector("input[type=email]").value = "user@example.com";',
  '    root.querySelector("input[type=password]").value = "hunter2secret";',
  '  }',
  '}',
  'customElements.define("x-signup", XSignup);',
  '</script>',
  // Unrendered tokens are noise, not content: a hidden CSRF field and the
  // recaptcha response textarea (multi-KB in the wild) must not reach the construct.
  '<form>',
  '<input type="hidden" name="csrf" value="CSRFTOKENSHOULDNOTAPPEAR">',
  '<textarea name="g-recaptcha-response" style="display:none">RECAPTCHATOKENSHOULDNOTAPPEAR</textarea>',
  '</form>',
  '</body></html>',
].join('\n');

function bigPage() {
  const paras = [];
  for (let i = 0; i < 1400; i++) {
    paras.push(`<p>Paragraph ${i}: the quick brown fox jumps over the lazy dog while the harvest keeps every one of these words in order.</p>`);
  }
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Big Page</title></head><body>',
    '<article><h1>Big page</h1>',
    paras.join('\n'),
    `<p>${SENTINEL}</p>`,
    '</article></body></html>',
  ].join('\n');
}

const EMPTY_PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Canvas Only</title></head><body>',
  '<canvas id="c" width="400" height="300"></canvas>',
  '<script>document.getElementById("c").getContext("2d").fillRect(0,0,10,10);</script>',
  '</body></html>',
].join('\n');

async function bridge(path, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${json.error || json.message || 'unknown error'}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForActiveUrl(fragment, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await bridge('/health');
      const activeUrl = health?.info?.url || '';
      if (activeUrl.includes(fragment)) return activeUrl;
    } catch {
      // bridge busy while the tab loads
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for active URL to include "${fragment}"`);
}

async function openTab(url, fragment) {
  const created = await bridge('/tabs/new', 'POST', { url });
  await waitForActiveUrl(fragment);
  return created?.tab?.id || created?.tab?.tabId || null;
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const body = url.startsWith('/big') ? bigPage() : url.startsWith('/empty') ? EMPTY_PAGE : SHADOW_PAGE;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
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
    // ---- 1. Shadow DOM is part of the construct -----------------------------
    tabIds.push(await openTab(`${origin}/shadow.html`, 'shadow.html'));
    await sleep(400);
    const shadow = await bridge('/observe', 'POST', { as: 'markdown' });
    const md = shadow.text || '';

    check('shadow-root text is harvested', md.includes('Create your account'), 'custom element <x-signup> shadow content');
    check('shadow-root button is harvested', md.includes('Create account'));
    check('shadow input values are baked in', md.includes('user@example.com'), 'live property value, not attribute');
    check('password values are never serialised', !md.includes('hunter2secret') && md.includes('filled="13"'), 'length only');
    check(
      'unrendered tokens stay out of the construct',
      !md.includes('CSRFTOKENSHOULDNOTAPPEAR') && !md.includes('RECAPTCHATOKENSHOULDNOTAPPEAR'),
      'hidden input + display:none recaptcha textarea'
    );
    check('select renders its current value', md.includes('<select') && md.includes('value="2"'), 'Day = 2');
    check('controls use label="…" not a bare quoted string', md.includes('label="Email"') && !md.includes('type="email" "Email"'));
    check('relative links are absolute', md.includes(`${origin}/home`), `resolved against ${origin}`);
    check('shadow_roots is reported', Number(shadow.shadowRoots) >= 1, `shadow_roots=${shadow.shadowRoots}`);
    check('coverage numbers are comparable', Number(shadow.extractedChars) > 0 && Number(shadow.pageChars) > 0 && Number(shadow.extractedChars) <= Number(shadow.pageChars), `${shadow.extractedChars}/${shadow.pageChars}`);

    // ---- 2. Envelope is minimal and stable ----------------------------------
    check('envelope drops vanity metadata', !md.includes('compression_ratio') && !md.includes('raw_bytes') && !md.includes('designation'));
    check('envelope has no timestamp', !md.includes('harvested_at'));
    check('envelope names the extraction path', /^reader: "(readability|full-body)"$/m.test(md));
    const first = await bridge('/markdown?include_marks=false');
    await sleep(150);
    const second = await bridge('/markdown?include_marks=false');
    check(
      'two harvests of an unchanged page are identical',
      (first?.construct?.content || '') === (second?.construct?.content || '') && Boolean(first?.construct?.content),
      'no timestamp → diffable, pageable'
    );

    // ---- 3. Markdown paging actually reaches the end ------------------------
    tabIds.push(await openTab(`${origin}/big.html`, 'big.html'));
    await sleep(400);
    const def = await bridge('/observe', 'POST', { as: 'markdown' });
    check('default view is capped', def.truncated === true && def.total > 25000, `chars=${(def.text || '').length} of ${def.total}`);
    check('capped view reports a cursor', Boolean(def.next_cursor), `next_cursor=${def.next_cursor}`);
    check('capped view stops before the end', !(def.text || '').includes(SENTINEL));

    let cursor = def.next_cursor;
    let acc = def.text || '';
    let guard = 0;
    while (cursor && guard < 40) {
      const page = await bridge('/observe', 'POST', { as: 'markdown', budget: 8000, cursor });
      acc += page.text || '';
      cursor = page.truncated ? page.next_cursor : null;
      guard++;
    }
    check('paging recovers the whole construct', acc.length === def.total && acc.includes(SENTINEL), `${acc.length}/${def.total} chars, ${guard} pages`);

    const whole = await bridge('/observe', 'POST', { as: 'markdown', budget: 0 });
    check('budget=0 returns everything', whole.truncated === false && (whole.text || '').includes(SENTINEL), `${(whole.text || '').length} chars`);

    // ---- 4. Empty pages explain themselves ---------------------------------
    tabIds.push(await openTab(`${origin}/empty.html`, 'empty.html'));
    await sleep(400);
    const empty = await bridge('/observe', 'POST', { as: 'markdown' });
    check('text-free page says so', (empty.text || '').includes('no text content'), 'instead of an empty body');
  } catch (err) {
    check('markdown presentation run', false, err.message);
  } finally {
    for (const tabId of tabIds) {
      try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    }
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
