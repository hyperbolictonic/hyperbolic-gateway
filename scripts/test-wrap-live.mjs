#!/usr/bin/env node
/**
 * Kuang Wrap — live integration suite against DummyJSON.
 *
 * The offline suite (`npm run test:wrap`) covers the store, policy and renderer with a
 * stubbed fetch. This one drives the *real* bridge and the real network, so it exercises
 * the whole path: argument validation → request build → outbound policy → fetch → recipe
 * → records, plus pagination, secrets and audit redaction.
 *
 * Everything runs through `POST /wrap/test` with an **inline** wrapper, so nothing is
 * saved. The few cases that need a credential (DummyJSON /auth/me) use an existing
 * secret bound to `dummyjson.com` if one exists and SKIP otherwise — secrets are
 * human-only by design, so this suite can never create one.
 *
 * Needs the Cyberdeck app running. Prints SKIP and exits 0 when the bridge is down.
 *
 * Usage: node scripts/test-wrap-live.mjs
 *        KUANG_WRAP_TOKEN_FILE=/path/to/token node scripts/test-wrap-live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const API = 'https://dummyjson.com';

function tokenFile() {
  if (process.env.KUANG_WRAP_TOKEN_FILE) return process.env.KUANG_WRAP_TOKEN_FILE;
  const app = 'kuang-grade-mark-eleven';
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, app, 'wrap', 'token');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', app, 'wrap', 'token');
  }
  return path.join(os.homedir(), '.config', app, 'wrap', 'token');
}

let H = {};
try {
  const token = fs.readFileSync(tokenFile(), 'utf8').trim();
  H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
} catch (err) {
  console.log(`SKIP: could not read the wrap bridge token (${err.message}).`);
  console.log('      Set KUANG_WRAP_TOKEN_FILE, or start the Cyberdeck app once to create it.');
  process.exit(0);
}

const post = async (p, body) => {
  const res = await fetch(BRIDGE + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return res.json().catch(() => ({}));
};
const get = async (p) => {
  const res = await fetch(BRIDGE + p, { headers: H });
  return res.json().catch(() => ({}));
};
/** Inline wrapper test. dryRun defaults true; pass live:true to actually send. */
const wt = (wrapper, args = {}, opts = {}) =>
  post('/wrap/test', { wrapper, args, dryRun: !opts.live, format: opts.format, maxPages: opts.maxPages });

const results = [];
function record(name, status, detail) {
  results.push({ name, status });
  const label = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`  ${label}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function test(name, fn) {
  try {
    const r = await fn();
    if (r?.skip) return record(name, 'skip', r.detail);
    record(name, r?.ok ? 'pass' : 'fail', r?.detail);
  } catch (err) {
    record(name, 'fail', 'threw: ' + err.message);
  }
}
const group = (t) => console.log(`\n── ${t} ──`);

const w = (over = {}) => ({ schemaVersion: 1, id: 'live.case', name: 'live case', ...over });

// Preflight: the bridge must be up, and we need to know whether a usable secret exists.
try {
  const health = await fetch(`${BRIDGE}/health`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch (err) {
  console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
  process.exit(0);
}

const secretList = await get('/wrap/secrets').catch(() => ({}));
const authSecret = (secretList.secrets || []).find((s) => (s.allowedHosts || []).includes('dummyjson.com'))?.name;
const authSkip = authSecret ? null : { skip: true, detail: 'no credential bound to dummyjson.com (add one in Settings → Wrappers)' };

// ── request building (dry run, no network) ───────────────────────────────────
group('Request building (dry run, no network)');

await test('query interpolation + URL encoding', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products/search`, query: { q: '{{q}}', limit: '{{limit}}' } },
      inputSchema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer', default: 3 } } },
    }),
    { q: 'iphone 9' },
  );
  const url = r.request?.url || '';
  return { ok: r.ok === true && /q=iphone(\+|%20)9/.test(url) && url.includes('limit=3'), detail: url };
});

await test('array in query → repeated params', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products`, query: { tag: '{{tags}}' } },
      inputSchema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
    }),
    { tags: ['alpha', 'beta'] },
  );
  const url = r.request?.url || '';
  return { ok: /tag=alpha&tag=beta/.test(url), detail: url };
});

await test('number stays a number in the body', async () => {
  const r = await wt(
    w({
      request: { method: 'POST', url: `${API}/products/add`, body: { title: '{{title}}', price: '{{price}}' } },
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' } } },
    }),
    { title: 'T', price: 99.5 },
  );
  return { ok: r.request?.body === '{"title":"T","price":99.5}', detail: r.request?.body };
});

await test('embedded string interpolation', async () => {
  const r = await wt(
    w({
      request: { method: 'POST', url: `${API}/products/add`, body: { title: '{{name}} (dummy)', price: 1 } },
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    }),
    { name: 'Widget' },
  );
  return { ok: /"title":"Widget \(dummy\)"/.test(r.request?.body || ''), detail: r.request?.body };
});

await test('omitted optional key is omitted from the body', async () => {
  const r = await wt(
    w({
      request: { method: 'POST', url: `${API}/products/add`, body: { title: '{{title}}', description: '{{note}}' } },
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, note: { type: 'string' } } },
    }),
    { title: 'X' },
  );
  return { ok: r.request?.body === '{"title":"X"}', detail: r.request?.body };
});

await test('explicit null is preserved', async () => {
  const r = await wt(
    w({
      request: { method: 'POST', url: `${API}/products/add`, body: { title: '{{title}}', description: '{{note}}' } },
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, note: { type: ['string', 'null'] } } },
    }),
    { title: 'X', note: null },
  );
  return { ok: /"description":null/.test(r.request?.body || ''), detail: r.request?.body };
});

await test('path interpolation', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/users/{{id}}` },
      inputSchema: { type: 'object', properties: { id: { type: 'integer' } } },
    }),
    { id: 5 },
  );
  return { ok: (r.request?.url || '').endsWith('/users/5'), detail: r.request?.url };
});

await test('header interpolation (value only)', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products/1`, headers: { Accept: 'application/json', 'X-Trace': '{{trace}}' } },
      inputSchema: { type: 'object', properties: { trace: { type: 'string' } } },
    }),
    { trace: 'abc123' },
  );
  return { ok: r.request?.headers?.['X-Trace'] === 'abc123', detail: JSON.stringify(r.request?.headers) };
});

await test('input defaults are applied', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products`, query: { limit: '{{limit}}' } },
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 7 } } },
    }),
    {},
  );
  return { ok: (r.request?.url || '').includes('limit=7'), detail: r.request?.url };
});

// ── guardrails ───────────────────────────────────────────────────────────────
group('Guardrails (validator + outbound policy)');

await test('wrapper cannot set an Authorization header', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/products/1`, headers: { Authorization: 'Bearer x' } } }));
  return { ok: r.error?.code === 'INVALID_WRAPPER' && /cannot be set/.test(r.error?.message || ''), detail: r.error?.message };
});

await test('credential-shaped query key is rejected', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/products`, query: { api_key: '{{k}}' } } }));
  return { ok: r.error?.code === 'INVALID_WRAPPER' && /credential/.test(r.error?.message || ''), detail: r.error?.message };
});

await test('plain http is blocked', async () => {
  const r = await wt(w({ request: { method: 'GET', url: 'http://dummyjson.com/products/1' } }), {}, { live: true });
  return { ok: r.error?.code === 'BLOCKED_PROTOCOL', detail: `${r.error?.code}: ${r.error?.message}` };
});

await test('credentials in the URL are blocked', async () => {
  const r = await wt(w({ request: { method: 'GET', url: 'https://user:pass@dummyjson.com/products/1' } }), {}, { live: true });
  return { ok: ['INVALID_WRAPPER', 'BLOCKED_URL_CREDENTIALS'].includes(r.error?.code), detail: `${r.error?.code}: ${r.error?.message}` };
});

await test('loopback address is blocked (SSRF)', async () => {
  const r = await wt(w({ request: { method: 'GET', url: 'https://127.0.0.1/products/1' } }), {}, { live: true });
  return { ok: r.error?.code === 'BLOCKED_ADDRESS', detail: `${r.error?.code}: ${r.error?.message}` };
});

await test('localhost hostname is blocked', async () => {
  const r = await wt(w({ request: { method: 'GET', url: 'https://localhost/products/1' } }), {}, { live: true });
  return { ok: r.error?.code === 'BLOCKED_HOST', detail: `${r.error?.code}: ${r.error?.message}` };
});

await test('file: scheme is blocked', async () => {
  const r = await wt(w({ request: { method: 'GET', url: 'file:///etc/hosts' } }), {}, { live: true });
  return { ok: ['BLOCKED_PROTOCOL', 'INVALID_WRAPPER'].includes(r.error?.code), detail: `${r.error?.code}: ${r.error?.message}` };
});

await test('unknown secret name', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/auth/me`, auth: 'nope_not_here' } }), {}, { live: true });
  return { ok: r.error?.code === 'SECRET_NOT_FOUND', detail: r.error?.message };
});

await test('secret is refused on a foreign host', async () => {
  if (!authSecret) return authSkip;
  const r = await wt(w({ request: { method: 'GET', url: 'https://example.com/', auth: authSecret } }), {}, { live: true });
  return { ok: r.error?.code === 'SECRET_HOST_MISMATCH', detail: r.error?.message };
});

await test('injected credential header is redacted in the preview', async () => {
  if (!authSecret) return authSkip;
  const r = await wt(w({ request: { method: 'GET', url: `${API}/auth/me`, auth: authSecret } }), {}, {});
  return { ok: r.request?.headers?.Authorization === '<redacted>', detail: JSON.stringify(r.request?.headers) };
});

// ── argument validation ──────────────────────────────────────────────────────
group('Argument validation (offline)');

const strict = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 }, kind: { type: 'string', enum: ['a', 'b'] } },
  required: ['id'],
  additionalProperties: false,
};

await test('missing required argument', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/users/{{id}}` }, inputSchema: strict }), { kind: 'a' });
  return { ok: r.error?.code === 'INVALID_ARGS' && /required/.test(r.error?.message || ''), detail: `${r.error?.field}: ${r.error?.message}` };
});

await test('string where integer expected (no coercion)', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/users/{{id}}` }, inputSchema: strict }), { id: '5' });
  return { ok: r.error?.code === 'INVALID_ARGS' && /integer/.test(r.error?.message || ''), detail: r.error?.message };
});

await test('unknown argument (additionalProperties: false)', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/users/{{id}}` }, inputSchema: strict }), { id: 1, bogus: true });
  return { ok: r.error?.code === 'INVALID_ARGS' && /not a recognised/.test(r.error?.message || ''), detail: r.error?.message };
});

await test('enum violation', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/users/{{id}}`, query: { k: '{{kind}}' } }, inputSchema: strict }), { id: 1, kind: 'z' });
  return { ok: r.error?.code === 'INVALID_ARGS' && /must be one of/.test(r.error?.message || ''), detail: r.error?.message };
});

await test('minimum violation', async () => {
  const r = await wt(w({ request: { method: 'GET', url: `${API}/users/{{id}}` }, inputSchema: strict }), { id: 0 });
  return { ok: r.error?.code === 'INVALID_ARGS' && /at least 1/.test(r.error?.message || ''), detail: r.error?.message };
});

// ── live reads ───────────────────────────────────────────────────────────────
group('Live reads');

await test('list + select + table recipe + record projection', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/users`, query: { limit: '{{limit}}', select: 'id,firstName,email' } },
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 3 } } },
      response: {
        schemaVersion: 1, select: '$.users', mode: 'table',
        fields: { id: 'id', name: 'firstName', email: 'email' },
        record: { id: 'id', name: 'firstName', email: 'email' },
      },
    }),
    { limit: 3 },
    { live: true },
  );
  return {
    ok: r.ok === true && r.status === 200 && r.records?.length === 3 && r.meta?.mode === 'table' && /^\|/m.test(r.markdown || ''),
    detail: `status=${r.status} records=${r.records?.length} mode=${r.meta?.mode}`,
  };
});

await test('single item by path (document mode)', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/users/{{id}}` },
      inputSchema: { type: 'object', properties: { id: { type: 'integer', default: 1 } } },
      response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Name: 'firstName', Email: 'email' }, record: { id: 'id' } },
    }),
    { id: 1 },
    { live: true },
  );
  return { ok: r.ok === true && /Emily/.test(r.markdown || '') && r.records?.[0]?.id === 1, detail: `status=${r.status}` };
});

await test('search + sort + limit', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products/search`, query: { q: '{{q}}', sortBy: 'price', order: 'asc', limit: '{{limit}}' } },
      inputSchema: { type: 'object', properties: { q: { type: 'string', default: 'phone' }, limit: { type: 'integer', default: 3 } } },
      response: { schemaVersion: 1, select: '$.products', mode: 'table', fields: { Title: 'title', Price: { path: 'price', format: 'number' } }, record: { id: 'id', price: 'price' } },
    }),
    { q: 'phone', limit: 3 },
    { live: true },
  );
  const prices = (r.records || []).map((x) => x.price);
  const sorted = prices.every((p, i) => i === 0 || prices[i - 1] <= p);
  return { ok: r.ok === true && prices.length === 3 && sorted, detail: `prices=${prices.join(', ')}` };
});

await test('nested resource path', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/posts/{{postId}}/comments` },
      inputSchema: { type: 'object', properties: { postId: { type: 'integer', default: 1 } } },
      response: { schemaVersion: 1, select: '$.comments', mode: 'table', fields: { User: 'user.username', Body: 'body' }, record: { id: 'id', user: 'user.username' } },
    }),
    { postId: 1 },
    { live: true },
  );
  return { ok: r.ok === true && r.records?.length > 0 && r.records[0].user !== undefined, detail: `records=${r.records?.length}` };
});

await test('no-argument endpoint (/todos/random)', async () => {
  const r = await wt(
    w({ request: { method: 'GET', url: `${API}/todos/random` }, response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Todo: 'todo', Done: { path: 'completed', format: 'boolean' } } } }),
    {},
    { live: true },
  );
  return { ok: r.ok === true && /yes|no|true|false/i.test(r.markdown || ''), detail: `status=${r.status}` };
});

await test('documents mode + per-item title/template', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products`, query: { limit: '3' } },
      response: { schemaVersion: 1, select: '$.products', mode: 'documents', title: '{{title}}', template: 'Price: **${{price}}** · rating {{rating}}' },
    }),
    {},
    { live: true },
  );
  return { ok: r.ok === true && r.documents?.length === 3 && /Price:/.test(r.markdown || ''), detail: `documents=${r.documents?.length}` };
});

await test('template {{#each}} over an array field', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/posts/1` },
      response: { schemaVersion: 1, select: '$', mode: 'document', template: 'Tags:{{#each tags}} {{.}}{{/each}}' },
    }),
    {},
    { live: true },
  );
  return { ok: r.ok === true && /Tags:\s+\S+/.test(r.markdown || ''), detail: (r.markdown || '').match(/Tags:[^\n]*/)?.[0] };
});

await test('large result is capped and flagged (meta.truncated)', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products`, query: { limit: '0' } },
      response: { schemaVersion: 1, select: '$.products', mode: 'table', fields: { Title: 'title', Price: 'price' } },
    }),
    {},
    { live: true },
  );
  return {
    ok: r.ok === true && r.meta?.selected > 50 && r.meta?.rendered === 50 && r.meta?.truncated === true,
    detail: `selected=${r.meta?.selected} rendered=${r.meta?.rendered} truncated=${r.meta?.truncated}`,
  };
});

await test('includeRaw returns the parsed JSON (saved wrapper)', async () => {
  const temp = w({ id: 'tmp.live.includeraw', request: { method: 'GET', url: `${API}/users/1` }, response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Name: 'firstName' } } });
  const created = await post('/wrap/wrappers', { action: 'create', wrapper: temp });
  try {
    const res = await post('/wrap/run', { id: 'tmp.live.includeraw', args: {}, includeRaw: true });
    return { ok: res.ok === true && res.response?.json?.username === 'emilys', detail: `json.username=${res.response?.json?.username}` };
  } finally {
    await post('/wrap/wrappers', { action: 'delete', id: 'tmp.live.includeraw' });
    void created;
  }
});

// ── pagination (S3) ──────────────────────────────────────────────────────────
group('Pagination');

const pagedWrapper = {
  schemaVersion: 1,
  id: 'live.paged',
  name: 'paged products',
  request: { method: 'GET', url: `${API}/products`, query: { limit: '{{limit}}', skip: '{{skip}}' } },
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', default: 10 }, skip: { type: 'integer', default: 0 } },
  },
  response: {
    schemaVersion: 1,
    select: '$.products',
    mode: 'table',
    fields: { Title: 'title', Price: { path: 'price', format: 'number' } },
    record: { id: 'id', title: 'title', price: 'price' },
    limits: { maxItems: 25 },
    pagination: { type: 'offset', limitParam: 'limit', offsetParam: 'skip', pageSize: 10 },
  },
};

await test('offset paging follows pages and merges them into one table', async () => {
  const r = await wt(pagedWrapper, { limit: 10, skip: 0 }, { live: true });
  return {
    ok: r.ok === true && r.paging?.pages === 3 && r.records?.length === 25 && r.paging?.more === true && (r.markdown.match(/^\|/gm) || []).length > 0,
    detail: `pages=${r.paging?.pages}/${r.paging?.cap} records=${r.records?.length} more=${r.paging?.more}`,
  };
});

await test('maxPages caps the run and reports more remaining', async () => {
  const r = await wt(pagedWrapper, { limit: 10, skip: 0 }, { live: true, maxPages: 2 });
  return {
    ok: r.ok === true && r.paging?.pages === 2 && r.records?.length === 20 && r.paging?.more === true,
    detail: `pages=${r.paging?.pages}/${r.paging?.cap} records=${r.records?.length} more=${r.paging?.more}`,
  };
});

// ── upstream errors ──────────────────────────────────────────────────────────
group('Upstream errors');

await test('404 surfaces as HTTP_ERROR with status 404', async () => {
  const r = await wt(
    w({ request: { method: 'GET', url: `${API}/products/999999` }, response: { schemaVersion: 1, select: '$', mode: 'document' } }),
    {},
    { live: true },
  );
  return { ok: r.ok === false && r.error?.code === 'HTTP_ERROR' && r.error?.status === 404 && r.records.length === 0, detail: `${r.error?.code} ${r.error?.status}` };
});

await test('400 from bad credentials carries the body excerpt', async () => {
  const r = await wt(
    w({
      request: { method: 'POST', url: `${API}/auth/login`, body: { username: '{{u}}', password: '{{p}}' } },
      inputSchema: { type: 'object', properties: { u: { type: 'string' }, p: { type: 'string' } } },
    }),
    { u: 'emilys', p: 'definitely-wrong' },
    { live: true },
  );
  return { ok: r.ok === false && r.status === 400 && /Invalid|credentials/i.test(r.error?.message || ''), detail: r.error?.message };
});

// ── transport ────────────────────────────────────────────────────────────────
group('Transport');

await test('timeout is reported (TIMEOUT, retryable)', async () => {
  const r = await wt(
    w({
      request: { method: 'GET', url: `${API}/products/1`, query: { delay: '{{delay}}' }, timeoutMs: 1000 },
      inputSchema: { type: 'object', properties: { delay: { type: 'integer', default: 5000 } } },
    }),
    { delay: 5000 },
    { live: true },
  );
  return { ok: r.ok === false && r.error?.code === 'TIMEOUT' && r.error?.retryable === true, detail: `${r.error?.code}: ${r.error?.message}` };
});

// ── live writes ──────────────────────────────────────────────────────────────
group('Live writes');

await test('POST create — dry run first, then live, types preserved', async () => {
  const wrapper = w({
    id: 'live.products.add',
    request: { method: 'POST', url: `${API}/products/add`, body: { title: '{{title}}', price: '{{price}}', stock: '{{stock}}' } },
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' }, stock: { type: 'integer' } } },
    response: {
      schemaVersion: 1, select: '$', mode: 'document',
      fields: { Id: 'id', Title: 'title', Price: { path: 'price', format: 'number' } },
      record: { id: 'id', title: 'title', price: 'price' },
    },
  });
  const args = { title: 'Kuang Wrap demo', price: 42.5, stock: 7 };
  const dry = await wt(wrapper, args, {});
  if (dry.ok !== true || dry.dryRun !== true) return { ok: false, detail: 'dry run did not preview' };
  const live = await wt(wrapper, args, { live: true });
  return {
    ok: live.ok === true && live.status === 201 && live.records?.[0]?.price === 42.5 && typeof live.records?.[0]?.price === 'number',
    detail: `status=${live.status} price=${JSON.stringify(live.records?.[0]?.price)}`,
  };
});

await test('PUT update', async () => {
  const r = await wt(
    w({ request: { method: 'PUT', url: `${API}/products/1`, body: { title: '{{title}}' } }, inputSchema: { type: 'object', properties: { title: { type: 'string', default: 'Updated by wrap' } } }, response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Title: 'title' } } }),
    { title: 'Updated by wrap' },
    { live: true },
  );
  return { ok: r.ok === true && r.status === 200 && /Updated by wrap/.test(r.markdown || ''), detail: `status=${r.status}` };
});

await test('PATCH partial update', async () => {
  const r = await wt(
    w({ request: { method: 'PATCH', url: `${API}/products/1`, body: { stock: '{{stock}}' } }, inputSchema: { type: 'object', properties: { stock: { type: 'integer', default: 3 } } }, response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Stock: { path: 'stock', format: 'integer' } } } }),
    { stock: 3 },
    { live: true },
  );
  return { ok: r.ok === true && r.status === 200 && /3/.test(r.markdown || ''), detail: `status=${r.status}` };
});

await test('DELETE', async () => {
  const r = await wt(
    w({ request: { method: 'DELETE', url: `${API}/products/1` }, response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Deleted: { path: 'isDeleted', format: 'boolean' } } } }),
    {},
    { live: true },
  );
  return { ok: r.ok === true && r.status === 200 && /yes|true/i.test(r.markdown || ''), detail: `status=${r.status}` };
});

await test('mutating flag defaults true for POST, false for GET', async () => {
  const created = await post('/wrap/wrappers', { action: 'create', wrapper: w({ id: 'tmp.live.mutpost', name: 'p', request: { method: 'POST', url: `${API}/products/add`, body: {} } }) });
  const getw = await post('/wrap/wrappers', { action: 'create', wrapper: w({ id: 'tmp.live.mutget', name: 'g', request: { method: 'GET', url: `${API}/products/1` } }) });
  await post('/wrap/wrappers', { action: 'delete', id: 'tmp.live.mutpost' });
  await post('/wrap/wrappers', { action: 'delete', id: 'tmp.live.mutget' });
  const man = await get('/wrap/manifest');
  const left = (man.wrappers || []).map((x) => x.id).filter((i) => i.startsWith('tmp.'));
  return {
    ok: created.wrapper?.mutating === true && getw.wrapper?.mutating === false && left.length === 0,
    detail: `POST=${created.wrapper?.mutating} GET=${getw.wrapper?.mutating} leftovers=${left.length}`,
  };
});

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
const passed = results.filter((r) => r.status === 'pass');
const verdict = failed.length === 0 ? 'ALL PASSED' : failed.length + ' FAILED';
console.log(
  `\n${verdict} — ${passed.length} passed, ${skipped.length} skipped, ${results.length} total`,
);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail || ''}`);
}
process.exit(failed.length === 0 ? 0 : 1);
