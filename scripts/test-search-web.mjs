#!/usr/bin/env node
/**
 * `search_web` regression test (TODO_RESEARCH_CRAWL.md §5, Feature 5) — bridge-level.
 *
 * Uses the `custom` engine (a URL template) pointed at a local fixture SERP, so it needs no
 * external network and never touches a real search provider. Asserts:
 *   1. Results are parsed into {rank, title, url, snippet}.
 *   2. An explicit engine chain falls back across engines.
 *   3. `max_results` is honoured.
 *   4. A bot-check/consent wall is reported (`blocked`) rather than silently returning nothing.
 *
 * Requires the Cyberdeck app running (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when down.
 *
 * Usage: node scripts/test-search-web.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

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

const SERP = `<!doctype html><html><head><meta charset="utf-8"><title>results</title></head><body>
<div class="result"><a class="result__a" href="https://example.com/one">Example One — a sufficiently long title</a><div class="result__snippet">Snippet one body text here.</div></div>
<div class="result"><a class="result__a" href="https://example.com/two">Example Two — another long enough title</a><div class="result__snippet">Snippet two body text here.</div></div>
</body></html>`;

const BLOCKED = `<!doctype html><html><head><meta charset="utf-8"><title>blocked</title></head><body><h1>Before you continue</h1><p>We detected unusual traffic from your network.</p></body></html>`;

function startFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      if (path === '/search') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(SERP);
        return;
      }
      if (path === '/blocked') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(BLOCKED);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const fixture = await startFixture();
  const port = fixture.address().port;
  const template = `http://127.0.0.1:${port}/search?q={query}`;

  try {
    // 1. Custom engine parses a SERP into structured results.
    const hit = await bridge('/search/web', 'POST', { query: 'test query', engine: 'custom', url_template: template });
    check(
      'search_web parses ranked results from a SERP',
      Array.isArray(hit.results) && hit.results.length === 2 && hit.results[0].rank === 1,
      `${hit.results?.length ?? 'n/a'} results via ${hit.engine}`
    );
    check(
      'results carry title, url and snippet',
      hit.results?.[0]?.title?.includes('Example One') &&
        hit.results?.[0]?.url === 'https://example.com/one' &&
        (hit.results?.[0]?.snippet || '').includes('Snippet one'),
      `${hit.results?.[0]?.url || 'none'}`
    );

    // 2. max_results is honoured.
    const capped = await bridge('/search/web', 'POST', { query: 'test query', engine: 'custom', url_template: template, max_results: 1 });
    check('max_results caps the list', (capped.results || []).length === 1, `${capped.results?.length ?? 'n/a'} results`);

    // 3. Engine fallback chain: an unknown engine first, then the working custom one.
    const chain = await bridge('/search/web', 'POST', {
      query: 'test query',
      engines: ['bogus', 'custom'],
      url_template: template,
    });
    check(
      'search_web falls back across an explicit engine chain',
      (chain.results || []).length === 2 && chain.engine === 'custom' && chain.attempts?.[0]?.engine === 'bogus',
      `attempts=${(chain.attempts || []).map((a) => a.engine).join('>')}`
    );

    // 4. A bot-check/consent wall is reported, not silently swallowed.
    const blocked = await bridge('/search/web', 'POST', {
      query: 'test query',
      engine: 'custom',
      url_template: `http://127.0.0.1:${port}/blocked?q={query}`,
    });
    check(
      'a bot-check/consent wall is reported as blocked with 0 results',
      (blocked.results || []).length === 0 && blocked.blocked === true,
      `blocked=${blocked.blocked}`
    );

    // 5. Invalid input is a clean client error.
    const bad = await bridgeRaw('/search/web', 'POST', { query: '   ' });
    check('empty query returns BAD_REQUEST (HTTP 400)', bad.status === 400 && bad.json.code === 'BAD_REQUEST', `${bad.status} ${bad.json.code || ''}`);
  } catch (err) {
    check('search_web run', false, err.message);
  } finally {
    fixture.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
