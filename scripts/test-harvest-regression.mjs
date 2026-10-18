#!/usr/bin/env node
/**
 * Harvest regression test (deterministic, offline).
 *
 * Guards two bugs that previously made the "TIER 1" harvest path useless on
 * aggregator/list pages (Skyscanner and friends):
 *
 *   1. `Readability.parse()` mutates the JSDOM document in place, so the
 *      aggregator fallback read an already-pruned body and silently dropped
 *      virtualized list/card results from `get_page_markdown()`.
 *   2. Set-of-Marks skipped everything outside the current viewport, so
 *      below-the-fold result cards never got a mark (and thus could not be
 *      clicked).
 *
 * It serves a local fixture with 8 result cards (3 above a spacer, 5 below the
 * fold), points the Cyberdeck bridge at it in a NEW tab, and asserts:
 *   - markdown contains every fare price;
 *   - default marks include only the visible subset;
 *   - include_offscreen=1 marks all 8.
 *
 * Requires the Cyberdeck Electron app running (bridge on 127.0.0.1:4111) and its
 * window visible — the test restores it first, because Set-of-Marks' viewport
 * filter relies on window.innerHeight, which is 0 while the window is minimized.
 * If the bridge is down the test prints SKIP and exits 0 (so CI without a
 * display does not fail).
 *
 * Usage: node scripts/test-harvest-regression.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

const PRICES = [412, 419, 425, 431, 438, 444, 451, 459];
const VISIBLE_COUNT = 3;
const AIRLINES = ['Alpha Airways', 'Beta Air', 'Gamma Jets', 'Delta Wings'];

function card(i) {
  const price = PRICES[i];
  const airline = AIRLINES[i % AIRLINES.length];
  return `
    <div data-testid="ticket" class="ticket">
      <a href="/select/${i}" aria-label="${airline} Flight option ${i + 1}: Total cost £${price}">
        <span class="airline">${airline}</span>
        <span class="time">1${i}:0${i % 6}</span>
        <span class="price">£${price}</span>
      </a>
    </div>`;
}

function fixtureHtml() {
  const above = PRICES.slice(0, VISIBLE_COUNT).map((_, i) => card(i)).join('');
  const below = PRICES.slice(VISIBLE_COUNT).map((_, i) => card(i + VISIBLE_COUNT)).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Results</title></head>
<body>
  <nav><a href="/home">Home</a> <a href="/about">About</a></nav>
  <main>
    <h1>Fixture flight results</h1>
    <div class="results">${above}</div>
    <div style="height:1600px" aria-hidden="true"></div>
    <div class="results">${below}</div>
  </main>
  <footer><a href="/privacy">Privacy</a></footer>
</body>
</html>`;
}

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

async function waitFor(fn, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch {
      // bridge momentarily busy while the tab loads
    }
    await sleep(250);
  }
  return false;
}

async function waitForActiveUrl(fragment, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await bridge('/health');
      const activeUrl = health?.info?.url || '';
      if (activeUrl.includes(fragment)) return activeUrl;
    } catch {
      // bridge momentarily busy while loading a tab
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for active URL to include "${fragment}"`);
}

function countTickets(marks) {
  return (marks || []).filter((m) => /Flight option/.test(m.text || '')).length;
}

// A brand-new tab can briefly report a 0x0 viewport before layout; the marks viewport
// filter then treats every element as off-screen. Wait for a real viewport so the
// "visible subset" assertion is meaningful (it is skipped if one never appears).
async function waitForRealViewport(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await bridge('/evaluate', 'POST', { script: '({ h: window.innerHeight, w: window.innerWidth })' });
      if ((r?.result?.h || 0) > 0 && (r?.result?.w || 0) > 0) return true;
    } catch {
      // tab still settling
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  // 1. Bridge reachable?
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  // Ensure the window is on-screen: Set-of-Marks' viewport filter depends on
  // window.innerHeight, which is 0 while the window is minimized/hidden.
  await bridge('/window/visibility', 'POST', { visible: true });
  await sleep(600);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/fixture.html`;
  const fragment = `127.0.0.1:${port}`;

  const results = [];
  const check = (name, ok, detail, skip = false) => {
    results.push({ name, ok, detail, skip });
    console.log(`${skip ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const created = await bridge('/tabs/new', 'POST', { url });
    tabId = created?.tab?.id || created?.tab?.tabId || null;
    await waitForActiveUrl(fragment);

    // Wait until the fixture has fully rendered all cards — measured through the SoM
    // path (not raw JS) so this also exercises include_offscreen on every poll.
    const rendered = await waitFor(async () => {
      const r = await bridge('/marks/screenshot?text_only=1&include_offscreen=1');
      return countTickets(r.marks) === PRICES.length;
    });
    check('fixture rendered before assertions', rendered, rendered ? `${PRICES.length} cards visible to SoM` : 'timed out waiting for cards');

    // 2. Markdown must contain every fare (regression: Readability mutation).
    const mdRes = await bridge('/markdown?include_marks=true&include_offscreen=true');
    const md = mdRes?.construct?.content || '';
    const missing = PRICES.filter((p) => !md.includes(`£${p}`));
    check(
      'markdown harvests all fares',
      missing.length === 0,
      missing.length === 0 ? `${PRICES.length}/${PRICES.length} prices present` : `missing: £${missing.join(', £')}`
    );

    // 3. Default marks include only the visible subset (skipped if the tab has no real viewport).
    const viewportKnown = await waitForRealViewport();
    const defRes = await bridge('/marks/screenshot?text_only=1');
    const defCount = countTickets(defRes.marks);
    check(
      'default marks exclude below-the-fold cards',
      !viewportKnown || (defCount >= 1 && defCount < PRICES.length),
      viewportKnown ? `${defCount} ticket marks (expected ${VISIBLE_COUNT}±1)` : 'skipped: page reported a 0x0 viewport',
      !viewportKnown
    );

    // 4. include_offscreen marks all cards.
    const offRes = await bridge('/marks/screenshot?text_only=1&include_offscreen=1');
    const offCount = countTickets(offRes.marks);
    check(
      'include_offscreen marks every card',
      offCount === PRICES.length,
      `${offCount}/${PRICES.length} ticket marks`
    );
  } catch (err) {
    check('harvest regression run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok && !r.skip);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
