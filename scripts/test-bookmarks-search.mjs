#!/usr/bin/env node
/**
 * list_bookmarks query-filter regression test (bridge-level).
 *
 * Guards the truthfulness of `list_bookmarks({ query, tag })`: `query` must
 * FILTER the library, not merely re-rank it. Previously the handler ran a pure
 * vector search with no threshold, so with fewer bookmarks than `limit` a query
 * returned *everything* — indistinguishable from no filter at all.
 *
 * Requires the Cyberdeck Electron app running (bridge on 127.0.0.1:4111). Prints
 * SKIP and exits 0 when the bridge is down.
 *
 * Usage: node scripts/test-bookmarks-search.mjs
 */

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

const searchable = (b) =>
  `${b.title || ''} ${b.notes || ''} ${b.url || ''} ${(b.tags || []).join(' ')}`.toLowerCase();

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  const nonce = `zqx${Date.now().toString(36)}`;
  const matchTok = `${nonce}match`;
  const controlTok = `${nonce}ctrl`;
  const tag = `${nonce}tag`;

  const created = [];
  try {
    // Bookmark A matches `matchTok` (via its title); B shares only the tag.
    const a = (await bridge('/bookmarks/add', 'POST', {
      url: `https://example.com/${nonce}/alpha`,
      title: `Report ${matchTok}`,
      notes: 'quarterly figures',
      tags: [tag],
    })).bookmark;
    const b = (await bridge('/bookmarks/add', 'POST', {
      url: `https://example.com/${nonce}/beta`,
      title: 'Generic reference page',
      notes: 'nothing relevant here',
      tags: [tag],
    })).bookmark;
    created.push(a.url, b.url);

    // 1. A query matching one bookmark returns exactly that one.
    const hit = await bridge(`/bookmarks?q=${encodeURIComponent(matchTok)}&limit=100`);
    check(
      'query returns only matching bookmarks (filters, not just ranks)',
      Array.isArray(hit.bookmarks) && hit.bookmarks.length === 1 && hit.bookmarks[0].url === a.url,
      `${hit.bookmarks?.length ?? 'n/a'} returned`
    );

    // 2. Every returned bookmark actually contains the query term.
    check(
      'every returned bookmark contains the query term',
      (hit.bookmarks || []).length > 0 && (hit.bookmarks || []).every((bm) => searchable(bm).includes(matchTok))
    );

    // 3. A query matching nothing returns an empty list — the core regression.
    const miss = await bridge(`/bookmarks?q=${encodeURIComponent(`zz${matchTok}qq`)}&limit=100`);
    check(
      'non-matching query returns [] (not the whole library)',
      Array.isArray(miss.bookmarks) && miss.bookmarks.length === 0,
      `${miss.bookmarks?.length ?? 'n/a'} returned`
    );

    // 4. Multi-term queries are AND-ed.
    const both = await bridge(`/bookmarks?q=${encodeURIComponent(`${matchTok} ${controlTok}`)}&limit=100`);
    check(
      'multi-term query requires every term (AND)',
      Array.isArray(both.bookmarks) && both.bookmarks.length === 0,
      `${both.bookmarks?.length ?? 'n/a'} returned`
    );

    // 5. Tag filtering still works.
    const byTag = await bridge(`/bookmarks?tag=${encodeURIComponent(tag)}&limit=100`);
    check(
      'tag filter still returns both tagged bookmarks',
      (byTag.bookmarks || []).some((bm) => bm.url === a.url) && (byTag.bookmarks || []).some((bm) => bm.url === b.url),
      `${byTag.bookmarks?.length ?? 'n/a'} returned`
    );

    // 6. Query + tag compose; the non-matching control never leaks in.
    const qTag = await bridge(`/bookmarks?q=${encodeURIComponent(matchTok)}&tag=${encodeURIComponent(tag)}&limit=100`);
    check(
      'query + tag compose (control excluded)',
      (qTag.bookmarks || []).length === 1 && qTag.bookmarks[0].url === a.url,
      `${qTag.bookmarks?.length ?? 'n/a'} returned`
    );

    // 7. The limit is applied after filtering, in newest-first order (B was added last).
    const newest = await bridge('/bookmarks?limit=1');
    check(
      'limit is applied, newest first',
      (newest.bookmarks || []).length === 1 && newest.bookmarks[0].url === b.url,
      newest.bookmarks?.[0]?.url || 'none'
    );
  } catch (err) {
    check('bookmark filter run', false, err.message);
  } finally {
    for (const url of created) {
      try { await bridge('/bookmarks/delete', 'POST', { urlOrId: url }); } catch {}
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
