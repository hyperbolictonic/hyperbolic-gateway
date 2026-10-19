#!/usr/bin/env node
/**
 * Primitives regression test (deterministic, offline).
 *
 * Exercises the new orthogonal layer end-to-end through the Cyberdeck HTTP bridge:
 *   wait_for · expect · observe(budget/cursor) · extract(list/table/app_data)
 *   collect_all · find · act(+await, +delta, +dry_run, +STALE_REF) · page_state · diff
 *   bridge_health · get_network_traffic(since) · export_har
 *
 * Serves a local fixture exercising the awkward cases: a late-injected element,
 * a reveal-after-click button, an infinite-scroll feed, a table, JSON-LD /
 * __NEXT_DATA__ blobs, and a live input.
 *
 * Requires the Cyberdeck Electron app running (bridge on 127.0.0.1:4111). Prints
 * SKIP and exits 0 when the bridge is down.
 *
 * Usage: node scripts/test-primitives.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Primitives Fixture</title>
  <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"fares":[{"p":412},{"p":419}]}}}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Fares"}</script>
</head>
<body>
  <nav><a href="/home">Home</a></nav>
  <main id="main">
    <h1>Fixture flight results</h1>

    <div id="cards">
      <div class="card"><a href="/select/0" aria-label="Alpha Airways Flight option 1: total £412"><span class="price">£412</span></a></div>
      <div class="card"><a href="/select/1" aria-label="Beta Air Flight option 2: total £419"><span class="price">£419</span></a></div>
      <div class="card"><a href="/select/2" aria-label="Gamma Jets Flight option 3: total £425"><span class="price">£425</span></a></div>
      <div class="card"><a href="/select/3" aria-label="Delta Wings Flight option 4: total £431"><span class="price">£431</span></a></div>
      <div class="card"><a href="/select/4" aria-label="Alpha Airways Flight option 5: total £438"><span class="price">£438</span></a></div>
    </div>

    <table id="tbl">
      <thead><tr><th>Route</th><th>Airline</th><th>Price</th></tr></thead>
      <tbody>
        <tr><td>LHR-MLE</td><td>Etihad</td><td>£556</td></tr>
        <tr><td>LHR-MLE</td><td>Qatar</td><td>£612</td></tr>
      </tbody>
    </table>

    <div id="feed" style="height:200px;overflow:auto;border:1px solid #ccc"></div>

    <label>Search <input id="q" aria-label="Search query" /></label>
    <p id="echo"></p>
    <button id="clickme">Click me</button>
    <button id="clickme2">Click me too</button>
  </main>

  <script>
    window.__APP_STATE__ = { count: 3 };

    // 1. Late-injected element (wait_for selector/text)
    setTimeout(function () {
      var p = document.createElement('p');
      p.id = 'late';
      p.textContent = 'Late content ready';
      document.getElementById('main').appendChild(p);
    }, 900);

    // 2. Reveal-after-click (act + await_conditions)
    document.getElementById('clickme').addEventListener('click', function () {
      setTimeout(function () {
        var d = document.createElement('p');
        d.id = 'clicked';
        d.textContent = 'Clicked!';
        document.body.appendChild(d);
      }, 300);
    });

    // 2b. Second reveal target (act by coordinate — no badge involved)
    document.getElementById('clickme2').addEventListener('click', function () {
      setTimeout(function () {
        var d = document.createElement('p');
        d.id = 'clicked2';
        d.textContent = 'Clicked too!';
        document.body.appendChild(d);
      }, 300);
    });

    // 3. Live input echo (act type)
    document.getElementById('q').addEventListener('input', function (e) {
      document.getElementById('echo').textContent = 'Echo: ' + e.target.value;
    });

    // 4. Infinite-scroll feed (collect_all)
    var feed = document.getElementById('feed');
    var n = 0;
    function item(i) {
      var d = document.createElement('div');
      d.className = 'feed-item';
      d.style.padding = '20px 8px';
      d.innerHTML = '<a href="/feed/' + i + '">Feed item ' + i + ': price £' + (100 + i) + '</a>';
      return d;
    }
    for (; n < 5; n++) feed.appendChild(item(n));
    var loading = false;
    feed.addEventListener('scroll', function () {
      if (loading) return;
      if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 5) {
        loading = true;
        setTimeout(function () {
          for (var k = 0; k < 5 && n < 25; k++, n++) feed.appendChild(item(n));
          loading = false;
        }, 150);
      }
    });
  </script>
</body>
</html>`;

async function bridge(path, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${json.error || json.message || 'unknown error'}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Returns {status, json} without throwing on non-2xx. */
async function bridgeRaw(path, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function waitForActiveUrl(fragment, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await bridge('/health');
      if ((health?.info?.url || '').includes(fragment)) return health.info.url;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for active URL to include "${fragment}"`);
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  await bridge('/window/visibility', 'POST', { visible: true });
  await sleep(500);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/fixture.html`;
  const fragment = `127.0.0.1:${port}`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const created = await bridge('/tabs/new', 'POST', { url });
    tabId = created?.tab?.id || created?.tab?.tabId || null;
    await waitForActiveUrl(fragment);
    await sleep(400);

    // --- bridge_health ------------------------------------------------------
    const health = await bridge('/health');
    check(
      'bridge_health advertises capabilities + revision',
      Array.isArray(health.capabilities) && health.capabilities.includes('wait_for') && typeof health.revision === 'number',
      `rev=${health.revision}, caps=${(health.capabilities || []).length}`
    );
    check(
      'bridge_health + /window/visibility expose window focus state',
      typeof health.window?.visible === 'boolean' && typeof health.window?.focused === 'boolean',
      `visible=${health.window?.visible}, focused=${health.window?.focused}`
    );

    // --- wait_for: late element --------------------------------------------
    const wf = await bridge('/wait-for', 'POST', { conditions: [{ type: 'selector', selector: '#late' }], timeout_ms: 5000 });
    check('wait_for selector finds late-injected element', wf.ok === true && wf.waitedMs >= 500, `waited ${wf.waitedMs}ms in ${wf.attempts} polls`);

    const wfText = await bridge('/wait-for', 'POST', { conditions: [{ type: 'text', text: 'Late content ready' }], timeout_ms: 3000 });
    check('wait_for text condition', wfText.ok === true, `waited ${wfText.waitedMs}ms`);

    const wfTimeout = await bridge('/wait-for', 'POST', { conditions: [{ type: 'selector', selector: '#does-not-exist' }], timeout_ms: 1200 });
    check('wait_for times out cleanly (ok=false)', wfTimeout.ok === false, `waited ${wfTimeout.waitedMs}ms`);

    const wfCount = await bridge('/wait-for', 'POST', { conditions: [{ type: 'count', selector: '.card', min: 5 }], timeout_ms: 2000 });
    check('wait_for count condition', wfCount.ok === true, wfCount.results?.[0]?.evidence);

    // --- expect -------------------------------------------------------------
    const expFail = await bridge('/expect', 'POST', { conditions: [{ type: 'text', text: 'zzz-not-present-zzz' }] });
    check('expect reports failure honestly', expFail.ok === false, `${expFail.results?.[0]?.type}=${expFail.results?.[0]?.ok}`);
    const expPass = await bridge('/expect', 'POST', { conditions: [{ type: 'text', text: 'Fixture flight results' }, { type: 'count', selector: '.card', equals: 5 }] });
    check('expect passes on true conditions', expPass.ok === true, `${expPass.results.filter((r) => r.ok).length}/${expPass.results.length}`);

    // --- extract: list ------------------------------------------------------
    const list = await bridge('/extract', 'POST', { kind: 'list', selector: '#cards' });
    const listOk = list.count === 5 && list.rows.every((r) => /£\d+/.test(r.text)) && list.rows[0].href.includes('/select/0');
    check('extract list resolves 5 cards with hrefs', listOk, `count=${list.count}, sig=${list.container?.sig}`);

    // --- extract: table -----------------------------------------------------
    const table = await bridge('/extract', 'POST', { kind: 'table', selector: '#tbl' });
    const tableOk = table.count === 2 && table.headers.join(',') === 'Route,Airline,Price' && table.records[0].Airline === 'Etihad';
    check('extract table returns headers + records', tableOk, `${table.count} rows, headers=${(table.headers || []).join('|')}`);

    // --- extract: app_data --------------------------------------------------
    const appData = await bridge('/extract', 'POST', { kind: 'app_data' });
    const names = (appData.sources || []).map((s) => s.source);
    const appOk = names.some((n) => n === '__NEXT_DATA__') && names.some((n) => n.startsWith('ld+json')) && names.some((n) => n === '__APP_STATE__');
    check('extract app_data finds JSON blobs', appOk, names.join(', '));
    const nextSrc = (appData.sources || []).find((s) => s.source === '__NEXT_DATA__');
    check('app_data JSON is parsed', nextSrc?.parsed === true && nextSrc.data?.props?.pageProps?.fares?.[0]?.p === 412);

    // --- observe: markdown --------------------------------------------------
    const md = await bridge('/observe', 'POST', { as: 'markdown' });
    const mdOk = /Fixture flight results/.test(md.text || '') && /£412/.test(md.text || '');
    check('observe(markdown) harvests page content', mdOk, `${(md.text || '').length} chars`);

    // --- observe: text + budget + cursor paging -----------------------------
    const page1 = await bridge('/observe', 'POST', { as: 'text', budget: 120 });
    const page2 = await bridge('/observe', 'POST', { as: 'text', budget: 120, cursor: page1.next_cursor });
    const pageOk = page1.truncated === true && page1.next_cursor && page2.offset > 0 && page2.text !== page1.text && (page2.total === page1.total);
    check('observe(text) pages with budget + cursor', pageOk, `total=${page1.total}, p1=${page1.text.length}, p2 offset=${page2.offset}`);

    // --- observe: som -------------------------------------------------------
    const som = await bridge('/observe', 'POST', { as: 'som' });
    check('observe(som) returns mark refs', som.count >= 5 && typeof som.marks[0].id === 'number', `${som.count} marks`);

    // --- collect_all over the infinite feed ---------------------------------
    const collected = await bridge('/collect', 'POST', { selector: '#feed', step: 600, delay_ms: 200, max_scrolls: 25, max: 40 });
    check('collect_all scrolls the infinite feed', collected.count === 25, `${collected.count} rows after ${collected.scrolls} scrolls${collected.count === 25 ? '' : ` diag=${JSON.stringify(collected.diag)}`}`);

    // --- find ---------------------------------------------------------------
    const found = await bridge('/find', 'POST', { role: 'link', name: 'Alpha Airways' });
    const findOk = found.count >= 1 && /Alpha Airways/.test(found.marks[0].text);
    check('find resolves semantic query to a mark ref', findOk, `#${found.marks[0]?.id} "${found.marks[0]?.text?.slice(0, 40)}"`);

    const findInput = await bridge('/find', 'POST', { name: 'Search query' });
    check('find locates the input by accessible name', findInput.count === 1, `#${findInput.marks[0]?.id}`);

    // --- act: dry_run -------------------------------------------------------
    const dry = await bridge('/act', 'POST', { mark_id: findInput.marks[0].id, action: 'type', text: 'hello', dry_run: true });
    check('act dry_run resolves target without acting', dry.dryRun === true && dry.wouldType === 'hello');

    // --- act: type + await --------------------------------------------------
    const typed = await bridge('/act', 'POST', {
      mark_id: findInput.marks[0].id,
      action: 'type',
      text: 'hello',
      await_conditions: [{ type: 'text', text: 'Echo: hello' }],
      timeout_ms: 4000,
    });
    const typedOk = typed.awaited?.ok === true && typed.delta.revisionAfter > typed.delta.revisionBefore;
    check('act(type) types and awaits the resulting text', typedOk, `rev ${typed.delta.revisionBefore}->${typed.delta.revisionAfter}, awaited=${typed.awaited?.ok}`);

    // --- act: click + await -------------------------------------------------
    const btn = await bridge('/find', 'POST', { name: 'Click me' });
    const clicked = await bridge('/act', 'POST', {
      mark_id: btn.marks[0].id,
      action: 'click',
      await_conditions: [{ type: 'selector', selector: '#clicked' }],
      timeout_ms: 4000,
    });
    check('act(click) clicks and awaits the reveal', clicked.awaited?.ok === true && clicked.delta.urlChanged === false, `awaited ${clicked.awaited?.waitedMs}ms`);

    // --- act: structured STALE_REF error ------------------------------------
    const stale = await bridgeRaw('/act', 'POST', { mark_id: 987654, action: 'click' });
    check('act on a bad ref returns a structured STALE_REF error', stale.status === 400 && stale.json.code === 'STALE_REF', `${stale.status} ${stale.json.code}`);

    // --- act: selector addressing (no badge) --------------------------------
    const bySelector = await bridge('/act', 'POST', {
      selector: '#q',
      action: 'type',
      text: 'by-selector',
      await_conditions: [{ type: 'text', text: 'by-selector' }],
      timeout_ms: 4000,
    });
    check('act(selector) addresses a CSS selector', bySelector.awaited?.ok === true && bySelector.target?.selector === '#q', `${bySelector.address} rev ${bySelector.delta?.revisionBefore}->${bySelector.delta?.revisionAfter}`);

    // --- act: selector dry_run resolves without acting ----------------------
    const drySel = await bridge('/act', 'POST', { selector: '#clickme2', action: 'click', dry_run: true });
    check('act(selector) dry_run resolves the centre without acting', drySel.dryRun === true && drySel.target?.selector === '#clickme2' && typeof drySel.target?.center?.x === 'number');

    // --- act: coordinate addressing ----------------------------------------
    const cx = drySel.target.center.x;
    const cy = drySel.target.center.y;
    const byCoords = await bridge('/act', 'POST', {
      x: cx,
      y: cy,
      action: 'click',
      await_conditions: [{ type: 'selector', selector: '#clicked2' }],
      timeout_ms: 4000,
    });
    check('act(x,y) clicks by viewport coordinates', byCoords.awaited?.ok === true && byCoords.address === `(${cx}, ${cy})`, `awaited ${byCoords.awaited?.waitedMs}ms`);

    // --- act: missing target is a structured BAD_REQUEST --------------------
    const noTarget = await bridgeRaw('/act', 'POST', { action: 'click' });
    check('act without a target returns BAD_REQUEST', noTarget.status === 400 && noTarget.json.code === 'BAD_REQUEST', `${noTarget.status} ${noTarget.json.code}`);

    // --- page_state + diff --------------------------------------------------
    const state = await bridge('/page-state', 'POST', {});
    const diff = await bridge('/diff', 'POST', { since: 0 });
    const diffOk = typeof state.state?.revision === 'number' && state.state.textLen > 0 && diff.changed === true && diff.to.revision >= state.state.revision - 1;
    check('page_state + diff report a coherent change', diffOk, `rev=${state.state.revision}, textLen=${state.state.textLen}, changed=${diff.changed}`);

    // --- network: since + har ----------------------------------------------
    const traffic = await bridge('/network/traffic', 'POST', { limit: 20, since: 'last_action' });
    check('get_network_traffic accepts since=last_action', Array.isArray(traffic.traffic) && typeof traffic.count === 'number', `${traffic.count} since last action`);

    const har = await bridge('/network/har', 'POST', { limit: 10 });
    check('export_har returns a HAR 1.2 log', har.har?.log?.version === '1.2' && Array.isArray(har.har.log.entries), `${har.entries} entries`);
  } catch (err) {
    check('primitives run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
