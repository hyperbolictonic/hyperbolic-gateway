#!/usr/bin/env node
/**
 * LLM-friendly site discovery regression test (TODO_RESEARCH_CRAWL.md §5, Feature 6).
 *
 * Guards the two contracts that make this feature safe to expose:
 *   1. `llm_surface` discovers /llms.txt, /llms-full.txt, /sitemap.xml and a page-level
 *      `<link rel="alternate">`, and reports `recommended` ("rendered" when there is none).
 *   2. `llm_fetch` is GATED — it refuses (NO_LLM_SURFACE) on an origin with no advertised
 *      surface, and only ever fetches an advertised URL. Advertised per-page alternates are
 *      loaded via a real document navigation (`via: "navigation"`), not a synthetic fetch.
 *
 * Runs against two local fixture origins, so it needs no external network — but it does need
 * the Cyberdeck app running (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when down.
 *
 * Usage: node scripts/test-llm-surface.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const MARK = `lm${Date.now().toString(36)}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

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

async function bridgeRaw(path, method = 'POST', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Starts a tiny static fixture origin on an ephemeral port. */
function startFixture(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const r = routes[path];
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(r.status || 200, { 'Content-Type': r.type });
      res.end(req.method === 'HEAD' ? undefined : r.body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const friendly = await startFixture({
    '/': { type: 'text/html', body: '<!doctype html><title>plain</title><p>no llm surface here</p>' },
    '/llms.txt': { type: 'text/plain; charset=utf-8', body: `# llms.txt\n\n- [Docs](/docs)\n\nMARKER-LLMS ${MARK}\n` },
    '/llms-full.txt': { type: 'text/plain; charset=utf-8', body: `# Full index\n\nFULLMARKER ${MARK}\n` },
    '/sitemap.xml': {
      type: 'application/xml',
      body: '<?xml version="1.0"?><urlset><url><loc>http://x/a</loc></url><url><loc>http://x/b</loc></url></urlset>',
    },
    '/page': {
      type: 'text/html',
      body: '<!doctype html><title>doc</title><link rel="alternate" type="text/markdown" href="/page.md"><p>see alternate</p>',
    },
    // Served as text/plain so Chromium renders it in the detached view (text/* renders as text).
    '/page.md': { type: 'text/plain; charset=utf-8', body: `# Page MD\n\nMDMARKER ${MARK}\n` },
  });
  const plain = await startFixture({
    '/': { type: 'text/html', body: '<!doctype html><title>plain</title><p>no llm surface at all</p>' },
  });

  const friendlyPort = friendly.address().port;
  const plainPort = plain.address().port;
  const friendlyOrigin = `http://127.0.0.1:${friendlyPort}`;
  const plainOrigin = `http://127.0.0.1:${plainPort}`;

  let tabId = null;
  try {
    // --- Origin-level llms.txt / sitemap discovery ---------------------------------
    const surfaceA = await bridge('/llm/surface', 'POST', { url: friendlyOrigin });
    check(
      'llm_surface finds an llms.txt index',
      surfaceA.recommended === 'llms_txt' && surfaceA.llms_txt?.found === true,
      `recommended=${surfaceA.recommended}`
    );
    check(
      'llm_surface finds and counts the sitemap',
      surfaceA.sitemap?.found === true && surfaceA.sitemap.entries >= 1,
      `entries=${surfaceA.sitemap?.entries}`
    );

    // --- Gated fetch of the advertised index ---------------------------------------
    const fetched = await bridge('/llm/fetch', 'POST', { url: friendlyOrigin, as: 'llms_txt' });
    check(
      'llm_fetch returns the advertised llms.txt',
      typeof fetched.content === 'string' && fetched.content.includes('MARKER-LLMS') && fetched.via === 'net.fetch',
      `via=${fetched.via}, ${fetched.bytes}B`
    );

    const full = await bridge('/llm/fetch', 'POST', { url: friendlyOrigin, as: 'llms_full' });
    check(
      'llm_fetch can return llms-full.txt',
      typeof full.content === 'string' && full.content.includes('FULLMARKER'),
      `${full.bytes}B`
    );

    // --- The gate: no surface ⇒ rendered, and fetch refuses ------------------------
    const surfaceB = await bridge('/llm/surface', 'POST', { url: plainOrigin });
    check(
      'llm_surface reports "rendered" for a site with no LLM surface',
      surfaceB.recommended === 'rendered' && surfaceB.llms_txt?.found === false,
      `recommended=${surfaceB.recommended}`
    );

    const gated = await bridgeRaw('/llm/fetch', 'POST', { url: plainOrigin });
    check(
      'llm_fetch is gated (NO_LLM_SURFACE, HTTP 400) when nothing is advertised',
      gated.status === 400 && gated.json.code === 'NO_LLM_SURFACE',
      `${gated.status} ${gated.json.code || gated.json.error || ''}`
    );

    // --- Per-page alternate via a real document navigation (Tier B) ----------------
    const pageUrl = `${friendlyOrigin}/page`;
    const created = await bridge('/tabs/new', 'POST', { url: pageUrl });
    tabId = created?.tab?.id || null;

    let surfacePage = null;
    for (let i = 0; i < 12 && !surfacePage?.markdown_alternates?.length; i++) {
      await sleep(500);
      surfacePage = await bridge('/llm/surface', 'POST', { url: pageUrl });
    }
    check(
      'llm_surface detects a page-level <link rel="alternate"> from the live DOM',
      (surfacePage?.markdown_alternates || []).some((a) => a.href.includes('/page.md')),
      `alternates=${(surfacePage?.markdown_alternates || []).length}`
    );

    const md = await bridge('/llm/fetch', 'POST', { url: pageUrl, as: 'markdown' });
    check(
      'llm_fetch loads an advertised alternate via navigation (not a synthetic fetch)',
      md.via === 'navigation' && typeof md.content === 'string' && md.content.includes('MDMARKER'),
      `via=${md.via}, ${md.bytes}B`
    );
  } catch (err) {
    check('llm-surface run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    friendly.close();
    plain.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
