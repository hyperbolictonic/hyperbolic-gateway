#!/usr/bin/env node
/**
 * `deep_crawl` regression test (TODO_RESEARCH_CRAWL.md §5, Feature 1) — bridge-level.
 *
 * Crawls a local fixture link graph, so no external network and no real site is touched. Asserts:
 *   1. BFS respects max_depth (depth 1 vs depth 2 reach different pages).
 *   2. max_pages is a hard budget (and reports `truncated`).
 *   3. match_patterns scopes the queue.
 *   4. Cross-origin links are not followed (same_origin default).
 *   5. The cheap path is used when a page content-negotiates Markdown (`via: "llm"`).
 *   6. harvest_to_cortex indexes pages (cortexIndexed).
 *
 * Requires the Cyberdeck app running (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when down.
 *
 * Usage: node scripts/test-deep-crawl.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const MARK = `dc${Date.now().toString(36)}`;

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

const filler = 'This page has enough distilled markdown content to clear the Cortex indexing threshold. '.repeat(2);

function page(title, links = []) {
  const anchors = links.map((h) => `<a href="${h}">${h}</a>`).join(' ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${filler}</p><nav>${anchors}</nav></body></html>`;
}

function startFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const accept = (req.headers['accept'] || '').toLowerCase();
      const wantsMd = accept.includes('text/markdown');

      const html = (body) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      const md = (body) => {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : body);
      };

      switch (path) {
        case '/':
          return html(page('Home', ['/a', '/b', '/mdpage']));
        case '/a':
          return html(page('A', ['/a1', '/a2']));
        case '/a1':
          return html(page('A1'));
        case '/a2':
          return html(page('A2'));
        case '/b':
          return html(page('B', ['https://external.example/off']));
        case '/mdpage':
          return wantsMd ? md(`# Markdown Page\n\nMDCONTENT ${MARK}\n\n[next](/a1)\n`) : html(page('MDPage', ['/a1']));
        default:
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const urls = (o) => (o.pages || []).map((p) => p.url);

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const fixture = await startFixture();
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const base = { url: `${origin}/`, max_pages: 10, delay_ms: 0, harvest_to_cortex: false };

  try {
    // 1. Depth 1 reaches the seed + its direct children only.
    const d1 = await bridge('/crawl/deep', 'POST', { ...base, max_depth: 1 });
    check(
      'max_depth=1 crawls the seed + direct children only',
      d1.pageCount === 4 && !urls(d1).some((u) => /\/(a1|a2)$/.test(u)),
      `${d1.pageCount} pages: ${urls(d1).map((u) => u.replace(origin, '')).join(' ')}`
    );

    // 2. Depth 2 reaches grandchildren.
    const d2 = await bridge('/crawl/deep', 'POST', { ...base, max_depth: 2 });
    check(
      'max_depth=2 reaches grandchildren (/a1, /a2)',
      d2.pageCount === 6 && urls(d2).some((u) => /\/a1$/.test(u)) && urls(d2).some((u) => /\/a2$/.test(u)),
      `${d2.pageCount} pages`
    );

    // 3. max_pages is a hard budget.
    const capped = await bridge('/crawl/deep', 'POST', { ...base, max_depth: 3, max_pages: 2 });
    check('max_pages is a hard budget (truncated)', capped.pageCount === 2 && capped.truncated === true, `${capped.pageCount} pages, truncated=${capped.truncated}`);

    // 4. match_patterns scopes the queue (everything except /b and /mdpage).
    const scoped = await bridge('/crawl/deep', 'POST', { ...base, max_depth: 2, match_patterns: ['/a*'] });
    check(
      'match_patterns scopes the crawl to /a*',
      urls(scoped).every((u) => u === `${origin}/` || /\/a[0-9]?$/.test(u)) && urls(scoped).length === 4,
      `${urls(scoped).map((u) => u.replace(origin, '')).join(' ')}`
    );

    // 5. Cross-origin links are not followed.
    const sameOrigin = await bridge('/crawl/deep', 'POST', { ...base, max_depth: 2 });
    check('cross-origin links are not followed', !urls(sameOrigin).some((u) => u.includes('external.example')), 'external.example absent');

    // 6. The cheap path is used when a page content-negotiates Markdown.
    check(
      'a content-negotiated page is read as Markdown (via "llm"), not rendered',
      (d2.pages || []).some((p) => /\/mdpage$/.test(p.url) && p.via === 'llm'),
      (d2.pages || []).map((p) => `${p.url.replace(origin, '') || '/'}:${p.via}`).join(' ')
    );

    // 7. harvest_to_cortex indexes pages.
    const indexed = await bridge('/crawl/deep', 'POST', { url: `${origin}/`, max_depth: 0, max_pages: 1, delay_ms: 0, harvest_to_cortex: true });
    check('harvest_to_cortex indexes pages into Cortex', indexed.cortexIndexed >= 1, `indexed=${indexed.cortexIndexed}`);
  } catch (err) {
    check('deep_crawl run', false, err.message);
  } finally {
    fixture.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
