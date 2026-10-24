#!/usr/bin/env node
/**
 * LLM-friendly site discovery regression test (TODO_RESEARCH_CRAWL.md §5, Feature 6).
 *
 * Guards the contracts that make this feature safe to expose:
 *   1. `llm_surface` discovers /llms.txt, /llms-full.txt, /sitemap.xml and page-level
 *      Markdown/Text alternates — a declared `<link rel="alternate">` AND a real
 *      `<a href="….md">` page link — and reports `recommended` (`null` when there is
 *      none), `scope` (origin|page) and a machine-readable `next`.
 *   2. `llm_fetch` is GATED — it refuses (NO_LLM_SURFACE) when nothing is advertised, only
 *      ever fetches an advertised URL, and reports `scope`/`scope_mismatch` so a page
 *      request answered with a site-wide index is never mistaken for the page.
 *   3. `read_url` is the composite: site-provided Markdown/Text when advertised, else a
 *      detached render — always Markdown text, paged via max_chars/next_cursor.
 *
 * Runs against local fixture origins, so it needs no external network — but it does need
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

/** Polls llm_surface until the live-DOM alternates settle. */
async function probeUntil(url, predicate, tries = 12) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await bridge('/llm/surface', 'POST', { url });
    if (predicate(last)) return last;
    await sleep(500);
  }
  return last;
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const longPlain = 'no llm surface at all. '.repeat(70); // ~1.7 kB, forces paging when max_chars is small
  const friendly = await startFixture({
    '/': { type: 'text/html', body: '<!doctype html><title>plain</title><p>no llm surface here</p>' },
    '/llms.txt': { type: 'text/plain; charset=utf-8', body: `# llms.txt\n\n- [Docs](/docs)\n\nMARKER-LLMS ${MARK}\n` },
    '/llms-full.txt': { type: 'text/plain; charset=utf-8', body: `# Full index\n\nFULLMARKER ${MARK}\n` },
    '/sitemap.xml': {
      type: 'application/xml',
      body: '<?xml version="1.0"?><urlset><url><loc>http://x/a</loc></url><url><loc>http://x/b</loc></url></urlset>',
    },
    // Declared <link rel="alternate">.
    '/page': {
      type: 'text/html',
      body: '<!doctype html><title>doc</title><link rel="alternate" type="text/markdown" href="/page.md"><p>see alternate</p>',
    },
    // Anchor-only alternate: no <link rel>, just a real <a> to the .md sibling.
    '/page2': {
      type: 'text/html',
      body: '<!doctype html><title>doc2</title><p>anchor alternate</p><a href="/page2.md">View as Markdown</a>',
    },
    // A page on an origin that has llms.txt but no page-level representation.
    '/page3': { type: 'text/html', body: '<!doctype html><title>doc3</title><p>plain page with no alternate</p>' },
    // Served as text/plain so Chromium renders it in the detached view (text/* renders as text).
    '/page.md': { type: 'text/plain; charset=utf-8', body: `# Page MD\n\nMDMARKER ${MARK}\n` },
    '/page2.md': { type: 'text/plain; charset=utf-8', body: `# Page2 MD\n\nP2MARKER ${MARK}\n` },
  });
  const plain = await startFixture({
    '/': { type: 'text/html', body: `<!doctype html><title>plain</title><p>${longPlain}</p>` },
  });

  const friendlyPort = friendly.address().port;
  const plainPort = plain.address().port;
  const friendlyOrigin = `http://127.0.0.1:${friendlyPort}`;
  const plainOrigin = `http://127.0.0.1:${plainPort}`;

  const tabIds = [];
  try {
    // --- Origin-level llms.txt / sitemap discovery ---------------------------------
    const surfaceA = await bridge('/llm/surface', 'POST', { url: friendlyOrigin });
    check(
      'llm_surface finds an llms.txt index',
      surfaceA.recommended === 'llms_txt' && surfaceA.llms_txt?.found === true,
      `recommended=${surfaceA.recommended}`
    );
    check(
      'llm_surface reports origin scope + a machine-readable next',
      surfaceA.scope === 'origin' && surfaceA.next?.tool === 'llm_fetch' && surfaceA.next?.as === 'llms_txt',
      `scope=${surfaceA.scope} next=${JSON.stringify(surfaceA.next)}`
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
    check(
      'llm_fetch reports origin scope without a mismatch for an origin URL',
      fetched.scope === 'origin' && fetched.scope_mismatch === false,
      `scope=${fetched.scope} mismatch=${fetched.scope_mismatch}`
    );

    const full = await bridge('/llm/fetch', 'POST', { url: friendlyOrigin, as: 'llms_full' });
    check(
      'llm_fetch can return llms-full.txt',
      typeof full.content === 'string' && full.content.includes('FULLMARKER'),
      `${full.bytes}B`
    );

    // --- The gate: no surface ⇒ recommended null, and fetch refuses ----------------
    const surfaceB = await bridge('/llm/surface', 'POST', { url: plainOrigin });
    check(
      'llm_surface reports recommended=null (not "rendered") for a site with no LLM surface',
      surfaceB.recommended === null && surfaceB.scope === null && surfaceB.llms_txt?.found === false,
      `recommended=${JSON.stringify(surfaceB.recommended)} scope=${JSON.stringify(surfaceB.scope)}`
    );
    check(
      'null recommended carries an observe next step',
      surfaceB.next?.tool === 'observe' && surfaceB.next?.as === 'markdown',
      `next=${JSON.stringify(surfaceB.next)}`
    );

    const gated = await bridgeRaw('/llm/fetch', 'POST', { url: plainOrigin });
    check(
      'llm_fetch is gated (NO_LLM_SURFACE, HTTP 400) when nothing is advertised',
      gated.status === 400 && gated.json.code === 'NO_LLM_SURFACE',
      `${gated.status} ${gated.json.code || gated.json.error || ''}`
    );

    // --- Page-level alternate via a real document navigation (Tier B) --------------
    const pageUrl = `${friendlyOrigin}/page`;
    const created = await bridge('/tabs/new', 'POST', { url: pageUrl });
    if (created?.tab?.id) tabIds.push(created.tab.id);

    const surfacePage = await probeUntil(pageUrl, (s) => (s?.markdown_alternates || []).length > 0);
    check(
      'llm_surface detects a page-level <link rel="alternate"> from the live DOM',
      (surfacePage?.markdown_alternates || []).some((a) => a.href.includes('/page.md')),
      `alternates=${(surfacePage?.markdown_alternates || []).length}`
    );
    check(
      'a page with its own Markdown alternate outranks the origin llms.txt index',
      surfacePage?.recommended === 'markdown' && surfacePage?.scope === 'page',
      `recommended=${surfacePage?.recommended} scope=${surfacePage?.scope}`
    );

    const md = await bridge('/llm/fetch', 'POST', { url: pageUrl, as: 'markdown' });
    check(
      'llm_fetch loads an advertised alternate via navigation (not a synthetic fetch)',
      md.via === 'navigation' && md.scope === 'page' && typeof md.content === 'string' && md.content.includes('MDMARKER'),
      `via=${md.via}, scope=${md.scope}, ${md.bytes}B`
    );

    // --- Anchor-discovered alternate (no <link rel="alternate">) -------------------
    const page2Url = `${friendlyOrigin}/page2`;
    const created2 = await bridge('/tabs/new', 'POST', { url: page2Url });
    if (created2?.tab?.id) tabIds.push(created2.tab.id);
    const surface2 = await probeUntil(page2Url, (s) => (s?.markdown_alternates || []).length > 0);
    const anchorAlt = (surface2?.markdown_alternates || []).find((a) => a.href.includes('/page2.md'));
    check(
      'llm_surface discovers a Markdown alternate from a real <a href> (not just <link>)',
      !!anchorAlt && anchorAlt.source === 'anchor' && anchorAlt.page_level === true,
      `alt=${JSON.stringify(anchorAlt || null)}`
    );

    const md2 = await bridge('/llm/fetch', 'POST', { url: page2Url, as: 'markdown' });
    check(
      'llm_fetch reads the anchor-discovered alternate',
      md2.via === 'navigation' && typeof md2.content === 'string' && md2.content.includes('P2MARKER'),
      `via=${md2.via}, ${md2.bytes}B`
    );

    // --- Scope mismatch: a page answered with the site-wide index -------------------
    const page3Url = `${friendlyOrigin}/page3`;
    const surface3 = await bridge('/llm/surface', 'POST', { url: page3Url });
    check(
      'a page with no page-level surface falls back to the origin index (flagged)',
      surface3.recommended === 'llms_txt' && surface3.scope === 'origin',
      `recommended=${surface3.recommended} scope=${surface3.scope}`
    );
    const fetched3 = await bridge('/llm/fetch', 'POST', { url: page3Url });
    check(
      'llm_fetch flags scope_mismatch when a page yields only the site-wide index',
      fetched3.scope_mismatch === true && fetched3.scope === 'origin',
      `scope=${fetched3.scope} mismatch=${fetched3.scope_mismatch}`
    );

    // --- read_url: the composite -----------------------------------------------------
    const read = await bridge('/read/url', 'POST', { url: pageUrl });
    check(
      'read_url returns the site-provided page Markdown (not the origin index)',
      read.via === 'llm_fetch' && read.as === 'markdown' && read.scope === 'page' &&
        read.scope_mismatch === false && read.content.includes('MDMARKER') && !read.content.includes('MARKER-LLMS'),
      `via=${read.via} scope=${read.scope} ${read.total} chars`
    );

    const readAnchor = await bridge('/read/url', 'POST', { url: page2Url });
    check(
      'read_url reads an anchor-discovered alternate',
      readAnchor.via === 'llm_fetch' && readAnchor.content.includes('P2MARKER'),
      `via=${readAnchor.via} ${readAnchor.total} chars`
    );

    const readRendered = await bridge('/read/url', 'POST', { url: plainOrigin });
    check(
      'read_url falls back to a detached render and reports why',
      readRendered.via === 'render' && readRendered.scope === 'page' && readRendered.total > 0 &&
        /no advertised LLM surface/.test(readRendered.reason || '') && readRendered.content.includes('no llm surface at all'),
      `via=${readRendered.via} reason="${readRendered.reason}" ${readRendered.total} chars`
    );

    // The issue's Telegram case: a page on an origin with only a site-wide /llms.txt must be
    // rendered, not answered with the index.
    const readOriginOnly = await bridge('/read/url', 'POST', { url: page3Url });
    check(
      'read_url renders a page whose only surface is the site-wide index (not the index)',
      readOriginOnly.via === 'render' && /site-wide llms_txt index/.test(readOriginOnly.reason || ''),
      `via=${readOriginOnly.via} reason="${readOriginOnly.reason}"`
    );

    // --- read_url paging -------------------------------------------------------------
    const firstPageOf = await bridge('/read/url', 'POST', { url: plainOrigin, max_chars: 500 });
    check(
      'read_url pages a long document (truncated + next_cursor)',
      firstPageOf.truncated === true && firstPageOf.next_cursor === 500 && firstPageOf.content.length === 500 &&
        firstPageOf.total > 500,
      `total=${firstPageOf.total} next=${firstPageOf.next_cursor}`
    );
    const rest = await bridge('/read/url', 'POST', { url: plainOrigin, cursor: firstPageOf.next_cursor, max_chars: 50000 });
    check(
      'read_url continues from next_cursor to completion',
      rest.truncated === false && rest.offset === 500 && rest.content.length === firstPageOf.total - 500,
      `offset=${rest.offset} len=${rest.content.length} truncated=${rest.truncated}`
    );
  } catch (err) {
    check('llm-surface run', false, err.message);
  } finally {
    for (const id of tabIds) {
      try { await bridge('/tabs/close', 'POST', { tabId: id }); } catch {}
    }
    friendly.close();
    plain.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
