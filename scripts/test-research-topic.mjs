#!/usr/bin/env node
/**
 * `research_topic` regression test (TODO_RESEARCH_CRAWL.md §5, Feature 3) — bridge-level.
 *
 * Drives the whole pipeline against local fixtures (a fake SERP + article pages), so no external
 * network is touched. Asserts:
 *   1. search → gather: the top sources are fetched and cited.
 *   2. Highlights are EXTRACTIVE (real paragraphs containing the query terms), not prose.
 *   3. The content-negotiated Markdown fast path is used where advertised (`via: "llm"`).
 *   4. max_sources caps the source count.
 *   5. harvest_to_cortex indexes sources.
 *   6. An empty query is a clean client error.
 *
 * Requires the Cyberdeck app running (bridge on 127.0.0.1:4111). Prints SKIP and exits 0 when down.
 *
 * Usage: node scripts/test-research-topic.mjs
 */
import http from 'node:http';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const TERM = `krmk${Date.now().toString(36)}`;
const QUERY = `${TERM} findings`;

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

const LONG = `This article is about the ${TERM} discovery engine and how it finds findings across the open web. `.repeat(2);
const FILLER = `Unrelated filler paragraph about logistics, scheduling and office furniture. `.repeat(2);

function article(title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${LONG}</p><p>${FILLER}</p></body></html>`;
}

function startFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const accept = (req.headers['accept'] || '').toLowerCase();
      const wantsMd = accept.includes('text/markdown');

      if (path === '/search') {
        const serp = `<!doctype html><html><body>
<div class="result"><a class="result__a" href="/doc1">Document One about ${TERM}</a><div class="result__snippet">Snippet one.</div></div>
<div class="result"><a class="result__a" href="/doc2">Document Two about ${TERM}</a><div class="result__snippet">Snippet two.</div></div>
<div class="result"><a class="result__a" href="/doc3">Document Three about ${TERM}</a><div class="result__snippet">Snippet three.</div></div>
</body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(serp);
        return;
      }
      if (path === '/doc1' || path === '/doc2') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : article(path === '/doc1' ? 'Doc One' : 'Doc Two'));
        return;
      }
      if (path === '/doc3') {
        if (wantsMd) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
          res.end(req.method === 'HEAD' ? undefined : `# Doc Three\n\n${LONG}\n\n${FILLER}\n`);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(req.method === 'HEAD' ? undefined : article('Doc Three'));
        }
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
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const base = {
    query: QUERY,
    engine: 'custom',
    url_template: `${origin}/search?q={query}`,
    harvest_to_cortex: false,
  };

  try {
    // 1-3. Full pipeline.
    const run = await bridge('/research/topic', 'POST', base);
    check(
      'research_topic gathers and cites the top sources',
      run.sourceCount === 3 && (run.sources || []).every((s) => s.url && s.title),
      `${run.sourceCount} sources via ${run.engine}`
    );
    check(
      'highlights are extractive (real paragraphs containing the query term)',
      (run.sources || []).some((s) => (s.highlights || []).length > 0 && s.highlights.every((h) => h.includes(TERM))),
      `highlights=${(run.sources || []).reduce((n, s) => n + s.highlights.length, 0)}`
    );
    check(
      'the content-negotiated Markdown fast path is used where advertised',
      (run.sources || []).some((s) => /\/doc3$/.test(s.url) && s.via === 'llm'),
      (run.sources || []).map((s) => `${s.url.replace(origin, '')}:${s.via}`).join(' ')
    );
    check(
      'output declares it is extractive only (no prose synthesis)',
      (run.notes || []).some((n) => /extractive only/i.test(n)),
      `${(run.notes || []).length} note(s)`
    );

    // 4. max_sources caps the gather.
    const capped = await bridge('/research/topic', 'POST', { ...base, max_sources: 2 });
    check('max_sources caps the source count', capped.sourceCount === 2, `${capped.sourceCount} sources`);

    // 5. harvest_to_cortex indexes sources.
    const indexed = await bridge('/research/topic', 'POST', { ...base, max_sources: 1, harvest_to_cortex: true });
    check('harvest_to_cortex indexes gathered sources into Cortex', indexed.cortexIndexed >= 1, `indexed=${indexed.cortexIndexed}`);

    // 6. Invalid input is a clean client error.
    const bad = await bridgeRaw('/research/topic', 'POST', { query: '  ' });
    check('empty query returns BAD_REQUEST (HTTP 400)', bad.status === 400 && bad.json.code === 'BAD_REQUEST', `${bad.status} ${bad.json.code || ''}`);
  } catch (err) {
    check('research_topic run', false, err.message);
  } finally {
    fixture.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
