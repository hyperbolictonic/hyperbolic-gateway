import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WrapStore } from '../src/main/wrap/store.ts';
import { WrapExecutor } from '../src/main/wrap/executor.ts';
import { validateWrapper } from '../src/main/wrap/validate-wrapper.ts';
import { buildRequest } from '../src/main/wrap/interpolate.ts';
import { validateArgs } from '../src/main/wrap/input-schema.ts';
import { assertSafeUrl, isPrivateAddress } from '../src/main/wrap/security.ts';
import { createWrapToken, readWrapToken } from '../src/main/wrap/token.ts';
import { isWrapAuthorized, tokenFromHeaders } from '../src/main/wrap/auth.ts';
import { SecretStore } from '../src/main/wrap/secrets.ts';
import { WrapAuditLog } from '../src/main/wrap/audit.ts';
import { generatedToolName, isToolName, wrapInputToZodShape } from '../src/mcp/wrap-tool-schema.ts';
import { z } from 'zod';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuang-wrap-test-'));
  return { store: new WrapStore(dir), dir };
}

function listWrapper(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo.list',
    name: 'List items',
    description: 'Read a page of items',
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      query: { q: '{{city}}', tags: '{{tags}}' },
      headers: { 'X-Trace': '{{trace}}' },
    },
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        trace: { type: 'string' },
      },
      required: ['city'],
      additionalProperties: false,
    },
    response: {
      schemaVersion: 1,
      name: 'Items',
      select: '$.items[*]',
      fields: { ID: 'id', Name: 'name' },
      record: { id: 'id', name: 'name' },
    },
    ...overrides,
  };
}

function postWrapper() {
  return {
    schemaVersion: 1,
    id: 'demo.order',
    name: 'Create order',
    request: {
      method: 'POST',
      url: 'https://api.example.com/v1/customers/{{customer_id}}/orders',
      headers: { 'X-Request': '{{request_id}}' },
      body: {
        customer: '{{customer_id}}',
        line_items: '{{items}}',
        coupon: '{{coupon}}',
        note: '{{note}}',
        meta: { source: 'kuang', request: '{{request_id}}' },
      },
    },
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        coupon: { type: 'string' },
        note: { type: 'string' },
        request_id: { type: 'string' },
      },
      required: ['customer_id', 'items'],
      additionalProperties: false,
    },
  };
}

test('rotates and reads the local wrap bridge token', () => {
  const { dir } = tempStore();
  const first = createWrapToken(dir);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(readWrapToken(dir), first);
  assert.equal(isWrapAuthorized(first, first), true);
  assert.equal(isWrapAuthorized('wrong', first), false);
  assert.equal(isWrapAuthorized('', first), false);

  const second = createWrapToken(dir);
  assert.notEqual(second, first);
  assert.equal(readWrapToken(dir), second);
  assert.equal(isWrapAuthorized(first, second), false);
});

test('reads bearer and alternate token headers', () => {
  assert.equal(tokenFromHeaders({ authorization: 'Bearer abc123' }), 'abc123');
  assert.equal(tokenFromHeaders({ authorization: 'bearer abc123' }), 'abc123');
  assert.equal(tokenFromHeaders({ 'x-kuang-wrap-token': 'def456' }), 'def456');
  assert.equal(tokenFromHeaders({ authorization: 'Basic abc123' }), '');
  assert.equal(tokenFromHeaders({}), '');
});

function fakeCipher(available = true) {
  return {
    available: () => available,
    warning: available ? '' : 'encryption unavailable in this test',
    encrypt: (value) => Buffer.from(`enc:${value}`).toString('base64'),
    decrypt: (payload) => Buffer.from(payload, 'base64').toString().replace(/^enc:/, ''),
  };
}

test('stores encrypted, host-bound secrets and never lists values', async () => {
  const { dir } = tempStore();
  const store = new SecretStore(dir, fakeCipher());

  assert.equal(store.set({ name: 'weather-key', value: 'top-secret', allowedHosts: 'api.example.com, *.example.org' }).ok, true);
  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'weather-key');
  assert.deepEqual(listed[0].allowedHosts, ['api.example.com', '*.example.org']);
  assert.doesNotMatch(JSON.stringify(listed), /top-secret/);

  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.doesNotMatch(raw, /top-secret/);
  assert.match(raw, /ciphertext/);

  const exact = await store.resolve('weather-key', 'api.example.com');
  assert.equal(exact.ok, true);
  assert.equal(exact.header, 'Authorization');
  assert.equal(exact.value, 'Bearer top-secret');

  const wildcard = await store.resolve('weather-key', 'v1.example.org');
  assert.equal(wildcard.ok, true);

  const foreign = await store.resolve('weather-key', 'evil.example.com');
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'SECRET_HOST_MISMATCH');

  const reloaded = new SecretStore(dir, fakeCipher());
  assert.equal((await reloaded.resolve('weather-key', 'api.example.com')).ok, true);
  assert.equal(reloaded.set({ name: 'weather-key', value: 'rotated', allowedHosts: 'api.example.com' }).ok, true);
  assert.equal((await reloaded.resolve('weather-key', 'api.example.com')).value, 'Bearer rotated');
  assert.equal(reloaded.set({ name: 'weather-key', value: '', allowedHosts: 'api.example.com, new.example.com' }).ok, true);
  assert.equal((await reloaded.resolve('weather-key', 'new.example.com')).value, 'Bearer rotated');
  assert.equal(reloaded.delete('weather-key'), true);
  assert.equal((await reloaded.resolve('weather-key', 'api.example.com')).code, 'SECRET_NOT_FOUND');
});

test('refuses secrets when OS encryption is unavailable', () => {
  const { dir } = tempStore();
  const store = new SecretStore(dir, fakeCipher(false));
  const result = store.set({ name: 'key', value: 'value', allowedHosts: 'api.example.com' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /encryption unavailable/);
});

test('validates and persists wrappers in a temp store', () => {
  const { store } = tempStore();
  const input = listWrapper();

  const validation = validateWrapper(input);
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.equal(validation.wrapper.id, 'demo.list');

  const created = store.create(input);
  assert.equal(created.ok, true, created.errors.join('; '));
  assert.deepEqual(store.get('demo.list'), validation.wrapper);

  const manifest = store.manifest();
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].host, 'api.example.com');
  assert.deepEqual(manifest[0].required, ['city']);

  assert.equal(store.create(input).ok, false);

  const updated = store.update({ ...input, name: 'List everything' });
  assert.equal(updated.ok, true, updated.errors.join('; '));
  assert.equal(store.get('demo.list').name, 'List everything');

  assert.equal(store.delete('demo.list'), true);
  assert.equal(store.get('demo.list'), undefined);
});

test('rejects invalid wrappers before they reach disk', () => {
  const { store } = tempStore();
  const validation = validateWrapper({
    ...listWrapper(),
    id: 'Bad ID',
    request: { method: 'TRACE', url: 'ftp://example.com', body: {} },
    inputSchema: { type: 'string' },
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length >= 4);
  assert.equal(store.create({ id: 'Bad ID' }).ok, false);
  assert.equal(store.count(), 0);

  const credential = validateWrapper({
    ...listWrapper(),
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      headers: { 'X-Api-Key': 'literal-secret' },
    },
  });
  assert.equal(credential.ok, false);
  assert.match(credential.errors.join(' '), /cannot be set by a wrapper/);

  const queryCredential = validateWrapper({
    ...listWrapper(),
    request: { method: 'GET', url: 'https://api.example.com/v1/items', query: { api_key: 'literal' } },
  });
  assert.equal(queryCredential.ok, false);
  assert.match(queryCredential.errors.join(' '), /looks like a credential/);
});

test('maps flat arguments to a deterministic POST body', () => {
  const validation = validateWrapper(postWrapper());
  assert.equal(validation.ok, true, validation.errors.join('; '));

  const built = buildRequest(validation.wrapper, {
    customer_id: 'cus_123',
    items: [
      { sku: 'a', qty: 2 },
      { sku: 'b', qty: 1 },
    ],
    coupon: 'SAVE10',
    request_id: 'req_1',
  });

  assert.equal(built.method, 'POST');
  assert.equal(built.url, 'https://api.example.com/v1/customers/cus_123/orders');
  assert.equal(built.headers['X-Request'], 'req_1');
  assert.equal(built.headers['Content-Type'], 'application/json');

  assert.deepEqual(JSON.parse(built.body), {
    customer: 'cus_123',
    line_items: [
      { sku: 'a', qty: 2 },
      { sku: 'b', qty: 1 },
    ],
    coupon: 'SAVE10',
    meta: { source: 'kuang', request: 'req_1' },
  });
});

test('raw path preserves slash-separated segments and encodes each segment', () => {
  const wrapper = {
    schemaVersion: 1,
    id: 'proxy.get',
    name: 'Proxy GET',
    request: { method: 'GET', url: 'https://api.example.com/api/proxy/{{path|raw}}' },
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  };
  const built = buildRequest(wrapper, { path: '/my path/v1.2/ü' });
  assert.equal(
    built.url,
    'https://api.example.com/api/proxy/my%20path/v1.2/%C3%BC',
  );
});

test('raw path rejects traversal, empty segments, and backslashes', () => {
  const wrapper = {
    schemaVersion: 1,
    id: 'proxy.get',
    name: 'Proxy GET',
    request: { method: 'GET', url: 'https://api.example.com/api/proxy/{{path|raw}}' },
  };
  assert.throws(() => buildRequest(wrapper, { path: 'a/../b' }), /raw path/i);
  assert.throws(() => buildRequest(wrapper, { path: 'a//b' }), /raw path/i);
  assert.throws(() => buildRequest(wrapper, { path: 'a\\\\b' }), /raw path/i);
});

test('raw path is URL-only, not headers or query/body templates', () => {
  const wrapper = {
    schemaVersion: 1,
    id: 'proxy.get',
    name: 'Proxy GET',
    request: {
      method: 'GET',
      url: 'https://api.example.com/api/proxy',
      headers: { 'X-Path': '{{path|raw}}' },
    },
  };
  assert.throws(() => buildRequest(wrapper, { path: 'a/b' }), /only allowed in request\.url/i);
});

test('omits missing optional values and repeats query arrays', () => {
  const validation = validateWrapper(listWrapper());
  const built = buildRequest(validation.wrapper, { city: 'New York', tags: ['a', 'b'] });

  const url = new URL(built.url);
  assert.equal(url.searchParams.get('q'), 'New York');
  assert.deepEqual(url.searchParams.getAll('tags'), ['a', 'b']);
  assert.equal(built.headers['X-Trace'], undefined);
});

test('validates required, unknown, default, and typed arguments', () => {
  const schema = {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
      label: { type: 'string', minLength: 2, pattern: '^[a-z]+$' },
      flag: { type: 'boolean' },
    },
    required: ['label'],
    additionalProperties: false,
  };

  assert.equal(validateArgs(schema, {}).ok, false);
  assert.equal(validateArgs(schema, { label: 'ok', extra: true }).ok, false);
  assert.equal(validateArgs(schema, { label: 'ok', count: '3' }).ok, false);
  assert.equal(validateArgs(schema, { label: 'ok', count: 11 }).ok, false);
  assert.equal(validateArgs(schema, { label: 'A' }).ok, false);

  const valid = validateArgs(schema, { label: 'ok', flag: true });
  assert.equal(valid.ok, true, valid.errors.join('; '));
  assert.equal(valid.value.count, 3);
  assert.equal(valid.value.flag, true);
});

test('runs a GET wrapper and renders records through the recipe', async () => {
  const { store } = tempStore();
  store.create(listWrapper());

  const calls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          items: [
            { id: 1, name: 'Alpha', hidden: true },
            { id: 2, name: 'Beta', hidden: false },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const result = await executor.run('demo.list', { city: 'New York' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /q=New\+York/);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0], { id: 1, name: 'Alpha' });
  assert.match(result.markdown, /## Items/);
  assert.match(result.markdown, /\| 1 \| Alpha \|/);
});

test('injects a bound secret without exposing it in previews or audits', async () => {
  const { store } = tempStore();
  const wrapper = listWrapper({ request: { ...listWrapper().request, auth: 'demo-key' } });
  const validation = validateWrapper(wrapper);
  assert.equal(validation.ok, true, validation.errors.join('; '));
  store.create(wrapper);

  const audit = [];
  let seenAuthorization = '';
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: {
      resolve: (name, host) => {
        assert.equal(name, 'demo-key');
        assert.equal(host, 'api.example.com');
        return { ok: true, header: 'Authorization', value: 'Bearer super-secret' };
      },
    },
    audit: { append: (entry) => audit.push(entry) },
    fetchImpl: async (_url, init) => {
      seenAuthorization = init.headers.Authorization;
      return new Response(JSON.stringify({ items: [{ id: 1, name: 'A' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const preview = await executor.test({ id: 'demo.list', args: { city: 'Paris' } });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.request.headers.Authorization, '<redacted>');
  assert.doesNotMatch(JSON.stringify(preview), /super-secret/);

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  assert.equal(seenAuthorization, 'Bearer super-secret');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].host, 'api.example.com');
  assert.doesNotMatch(JSON.stringify(audit), /super-secret/);
});

test('redacts a secret echoed by the upstream API', async () => {
  const { store } = tempStore();
  store.create(
    listWrapper({
      response: undefined,
      request: { ...listWrapper().request, auth: 'demo-key' },
    }),
  );

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: { resolve: () => ({ ok: true, header: 'Authorization', value: 'Bearer super-secret' }) },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ echo: 'Bearer super-secret', nested: { token: 'super-secret' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  const result = await executor.run('demo.list', { city: 'Paris' }, { includeRaw: true });
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /super-secret/);
  assert.match(result.markdown, /<redacted>/);
});

test('refuses a secret that is not bound to the request host', async () => {
  const { store } = tempStore();
  store.create(listWrapper({ request: { ...listWrapper().request, auth: 'demo-key' } }));

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: {
      resolve: () => ({
        ok: false,
        code: 'SECRET_HOST_MISMATCH',
        message: 'Secret "demo-key" is not bound to this host.',
      }),
    },
    fetchImpl: async () => {
      throw new Error('must not connect');
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SECRET_HOST_MISMATCH');
});

test('drops an injected secret on a cross-origin redirect', async () => {
  const { store } = tempStore();
  store.create(listWrapper({ request: { ...listWrapper().request, auth: 'demo-key' } }));

  const calls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: { resolve: () => ({ ok: true, header: 'Authorization', value: 'Bearer super-secret' }) },
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://other.example.com/v2/items' } });
      }
      return new Response(JSON.stringify({ items: [{ id: 1, name: 'Moved' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, 'Bearer super-secret');
  assert.equal(calls[1].authorization, undefined);
});

test('writes redacted audit rows', () => {
  const { dir } = tempStore();
  const audit = new WrapAuditLog(path.join(dir, 'audit.jsonl'));
  audit.append({ wrapper: 'demo.list', host: 'api.example.com', method: 'GET', status: 200, ok: true, bytes: 12 });
  const rows = audit.list(10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wrapper, 'demo.list');
  assert.doesNotMatch(JSON.stringify(rows), /authorization|body|token/i);
});

test('does not fetch during a dry run', async () => {
  const { store } = tempStore();
  store.create(postWrapper());

  let called = false;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });

  const result = await executor.test({
    id: 'demo.order',
    args: {
      customer_id: 'cus_123',
      items: [{ sku: 'a', qty: 1 }],
      request_id: 'req_1',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(called, false);
  assert.equal(result.request.method, 'POST');
  assert.deepEqual(JSON.parse(result.request.body), {
    customer: 'cus_123',
    line_items: [{ sku: 'a', qty: 1 }],
    meta: { source: 'kuang', request: 'req_1' },
  });
});

test('blocks private destinations and URL credentials', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fc00::1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:7f00:1'), true);
  assert.equal(isPrivateAddress('192.0.2.10'), true);
  assert.equal(isPrivateAddress('93.184.216.34'), false);

  await assert.rejects(() => assertSafeUrl('https://localhost/'), /private host/i);
  await assert.rejects(() => assertSafeUrl('http://api.example.com'), /plain http/i);
  await assert.rejects(
    () => assertSafeUrl('https://api.example.com', { resolveHost: async () => ['10.0.0.1'] }),
    /private address/i,
  );
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com'), /credentials/i);
  await assert.doesNotReject(() =>
    assertSafeUrl('https://api.example.com', { resolveHost: async () => ['93.184.216.34'] }),
  );

  const { store } = tempStore();
  store.create(listWrapper({ request: { method: 'GET', url: 'https://127.0.0.1/secret' } }));
  const executor = new WrapExecutor(store, {
    fetchImpl: async () => {
      throw new Error('must not connect');
    },
  });

  const result = await executor.run('demo.list', { city: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BLOCKED_ADDRESS');
});

test('surfaces HTTP errors and retryability', async () => {
  const { store } = tempStore();
  store.create(listWrapper());

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async () =>
      new Response('rate limited', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'content-type': 'text/plain' },
      }),
  });

  const result = await executor.run('demo.list', { city: 'London' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.error.code, 'HTTP_ERROR');
  assert.equal(result.error.retryable, true);
  assert.match(result.markdown, /Too Many Requests/);
});

test('follows a redirect and re-checks the destination', async () => {
  const { store } = tempStore();
  store.create(listWrapper());

  const calls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://api.example.com/v2/items' } });
      }
      return new Response(JSON.stringify({ items: [{ id: 1, name: 'Moved' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/v2\/items/);
  assert.equal(result.records[0].name, 'Moved');
});

test('renders a sample without a network call', async () => {
  const validation = validateWrapper(listWrapper());
  assert.equal(validation.ok, true, validation.errors.join('; '));

  const executor = new WrapExecutor(tempStore().store, {
    fetchImpl: async () => {
      throw new Error('must not connect');
    },
  });

  const result = await executor.test({
    wrapper: validation.wrapper,
    sample: { items: [{ id: 7, name: 'Sample' }] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.records[0].name, 'Sample');
  assert.match(result.markdown, /Sample/);
});

test('reports wrapper-not-found and invalid arguments without throwing', async () => {
  const { store } = tempStore();
  const executor = new WrapExecutor(store);

  const missing = await executor.run('nope', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'WRAPPER_NOT_FOUND');

  store.create(listWrapper());
  const invalid = await executor.run('demo.list', {});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_ARGS');
  assert.match(invalid.error.message, /city is required/);
});

// ── pagination (S3) ───────────────────────────────────────────────────────────

function pagedWrapper(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo.paged',
    name: 'Paged list',
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      query: { limit: '{{limit}}', skip: '{{skip}}' },
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 10 },
        skip: { type: 'integer', default: 0 },
      },
    },
    response: {
      schemaVersion: 1,
      select: '$.items',
      fields: { ID: 'id', Name: 'name' },
      record: { id: 'id', name: 'name' },
      limits: { maxItems: 50 },
      pagination: { type: 'offset', limitParam: 'limit', offsetParam: 'skip', pageSize: 10 },
    },
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeItems(from, count) {
  return Array.from({ length: count }, (_, i) => ({ id: from + i, name: `Item ${from + i}` }));
}

test('offset paging follows every page and merges them into one render', async () => {
  const { store } = tempStore();
  store.create(pagedWrapper());

  const skips = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      const u = new URL(url);
      const skip = Number(u.searchParams.get('skip'));
      const limit = Number(u.searchParams.get('limit'));
      skips.push({ skip, limit });
      // 25 items total, so the third page is short and paging stops naturally.
      const count = Math.max(0, Math.min(limit, 25 - skip));
      return jsonResponse({ items: makeItems(skip + 1, count), total: 25 });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, true);
  assert.deepEqual(skips, [
    { skip: 0, limit: 10 },
    { skip: 10, limit: 10 },
    { skip: 20, limit: 10 },
  ]);
  assert.equal(result.records.length, 25);
  assert.deepEqual(result.paging, { pages: 3, cap: 10, more: false });
  assert.equal(result.meta.selected, 25);
  // One merged table, not three: every row appears exactly once, with no page separators.
  assert.equal((result.markdown.match(/\| \d+ \| Item \d+ \|/g) || []).length, 25);
  assert.doesNotMatch(result.markdown, /^---$/m);
});

test('offset paging stops at the item cap and reports that more remains', async () => {
  const { store } = tempStore();
  store.create(pagedWrapper({ response: { ...pagedWrapper().response, limits: { maxItems: 25 } } }));

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      const u = new URL(url);
      const skip = Number(u.searchParams.get('skip'));
      return jsonResponse({ items: makeItems(skip + 1, 10), total: 1000 });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 25);
  assert.equal(result.paging.pages, 3);
  assert.equal(result.paging.more, true);
  assert.equal(result.meta.truncated, true);
});

test('cursor paging follows the next token and stops at null', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      request: { method: 'GET', url: 'https://api.example.com/v1/items', query: { cursor: '{{cursor}}' } },
      inputSchema: { type: 'object', properties: { cursor: { type: 'string', default: '' } } },
      response: {
        schemaVersion: 1,
        select: '$.items',
        record: { id: 'id' },
        pagination: { type: 'cursor', next: 'next', cursorParam: 'cursor', pageSize: 2 },
      },
    }),
  );

  const cursors = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      const cursor = new URL(url).searchParams.get('cursor') || '';
      cursors.push(cursor);
      const page = cursor === '' ? 1 : cursor === 'c2' ? 2 : 3;
      return jsonResponse({ items: makeItems(page * 10 + 1, 2), next: page < 3 ? `c${page + 1}` : null });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, true);
  assert.deepEqual(cursors, ['', 'c2', 'c3']);
  assert.equal(result.records.length, 6);
  assert.deepEqual(result.paging, { pages: 3, cap: 10, more: false });
});

test('link paging follows a same-origin next URL', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      request: { method: 'GET', url: 'https://api.example.com/v1/items' },
      inputSchema: { type: 'object', properties: {} },
      response: {
        schemaVersion: 1,
        select: '$.items',
        record: { id: 'id' },
        pagination: { type: 'link', nextUrl: 'links.next' },
      },
    }),
  );

  const urls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      urls.push(url);
      const page = urls.length;
      return jsonResponse({
        items: makeItems(page * 10 + 1, 1),
        links: page === 1 ? { next: 'https://api.example.com/v1/items?page=2' } : {},
      });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, true);
  assert.deepEqual(urls, [
    'https://api.example.com/v1/items',
    'https://api.example.com/v1/items?page=2',
  ]);
  assert.equal(result.records.length, 2);
  assert.equal(result.paging.more, false);
});

test('a cross-origin page link is not followed', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      request: { method: 'GET', url: 'https://api.example.com/v1/items' },
      inputSchema: { type: 'object', properties: {} },
      response: {
        schemaVersion: 1,
        select: '$.items',
        record: { id: 'id' },
        pagination: { type: 'link', nextUrl: 'links.next' },
      },
    }),
  );

  const urls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      urls.push(url);
      return jsonResponse({
        items: makeItems(1, 1),
        links: { next: 'https://evil.example.com/v1/items?page=2' },
      });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, true);
  assert.equal(urls.length, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.paging.more, true);
});

test('hasMore=false stops offset paging after one page', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      response: {
        ...pagedWrapper().response,
        pagination: { type: 'offset', limitParam: 'limit', offsetParam: 'skip', pageSize: 10, hasMore: 'hasMore' },
      },
    }),
  );

  let calls = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ items: makeItems(1, 10), hasMore: false });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(calls, 1);
  assert.equal(result.paging.more, false);
  assert.equal(result.records.length, 10);
});

test('a non-list selection is not paged', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      response: {
        schemaVersion: 1,
        select: '$',
        fields: { Total: 'total' },
        pagination: { type: 'offset', limitParam: 'limit', offsetParam: 'skip', pageSize: 10 },
      },
    }),
  );

  let calls = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ items: makeItems(1, 10), total: 10 });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test('a failing second page surfaces HTTP_ERROR and keeps the page count', async () => {
  const { store } = tempStore();
  store.create(pagedWrapper());

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async (url) => {
      const skip = Number(new URL(url).searchParams.get('skip'));
      if (skip >= 10) return jsonResponse({ message: 'boom' }, 500);
      return jsonResponse({ items: makeItems(skip + 1, 10), total: 100 });
    },
  });

  const result = await executor.run('demo.paged', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HTTP_ERROR');
  assert.equal(result.error.status, 500);
  assert.equal(result.paging.pages, 2);
  assert.equal(result.records.length, 0);
});

// ── cortex indexing (S3) ─────────────────────────────────────────────────────

function indexedDocsWrapper(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo.docs',
    name: 'Docs',
    request: { method: 'GET', url: 'https://api.example.com/v1/docs' },
    inputSchema: { type: 'object', properties: {} },
    response: {
      schemaVersion: 1,
      select: '$.items',
      mode: 'documents',
      title: '{{title}}',
      template: '{{body}}',
      index: 'cortex',
    },
    ...overrides,
  };
}

test('indexes each rendered document when the recipe opts in', async () => {
  const { store } = tempStore();
  store.create(indexedDocsWrapper());

  const calls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async (documents, context) => {
      calls.push({ documents, context });
      return documents.length * 2;
    },
    fetchImpl: async () =>
      jsonResponse({
        items: [
          { title: 'One', body: 'First body' },
          { title: 'Two', body: 'Second body' },
        ],
      }),
  });

  const result = await executor.run('demo.docs', {});
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].documents.length, 2);
  assert.equal(calls[0].documents[0].title, 'One');
  assert.match(calls[0].documents[0].markdown, /First body/);
  assert.equal(calls[0].context.wrapperId, 'demo.docs');
  assert.equal(calls[0].context.url, 'https://api.example.com/v1/docs');
  assert.deepEqual(result.indexed, { documents: 2, chunks: 4 });
});

test('indexes the whole render once for a table recipe', async () => {
  const { store } = tempStore();
  store.create(
    pagedWrapper({
      id: 'demo.table',
      response: { ...indexedDocsWrapper().response, select: '$.items', mode: 'table', title: undefined, template: undefined, index: 'cortex' },
    }),
  );

  const calls = [];
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async (documents) => {
      calls.push(documents);
      return 1;
    },
    fetchImpl: async () => jsonResponse({ items: makeItems(1, 3) }),
  });

  const result = await executor.run('demo.table', {});
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.match(calls[0][0].markdown, /Item 1/);
  assert.deepEqual(result.indexed, { documents: 1, chunks: 1 });
});

test('does not index when the recipe has not opted in', async () => {
  const { store } = tempStore();
  store.create(listWrapper());

  let called = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async () => {
      called++;
      return 1;
    },
    fetchImpl: async () => jsonResponse({ items: [{ id: 1, name: 'A' }] }),
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  assert.equal(called, 0);
  assert.equal(result.indexed, undefined);
});

test('does not index on a dry run or a failed upstream call', async () => {
  const { store } = tempStore();
  store.create(indexedDocsWrapper());

  let called = 0;
  const okExecutor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async () => {
      called++;
      return 1;
    },
    fetchImpl: async () => jsonResponse({ items: [{ title: 'One', body: 'Body' }] }),
  });

  const preview = await okExecutor.test({ id: 'demo.docs', args: {} });
  assert.equal(preview.dryRun, true);
  assert.equal(called, 0);

  const failing = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async () => {
      called++;
      return 1;
    },
    fetchImpl: async () => jsonResponse({ message: 'nope' }, 500),
  });
  const result = await failing.run('demo.docs', {});
  assert.equal(result.ok, false);
  assert.equal(called, 0);
  assert.equal(result.indexed, undefined);
});

test('an indexer failure never fails a successful call', async () => {
  const { store } = tempStore();
  store.create(indexedDocsWrapper());

  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    indexDocuments: async () => {
      throw new Error('cortex offline');
    },
    fetchImpl: async () => jsonResponse({ items: [{ title: 'One', body: 'Body' }] }),
  });

  const result = await executor.run('demo.docs', {});
  assert.equal(result.ok, true);
  assert.equal(result.indexed.documents, 1);
  assert.equal(result.indexed.chunks, 0);
  assert.match(result.indexed.error, /cortex offline/);
});

// ── generated tool schema (S4) ───────────────────────────────────────────────

const parseWith = (schema, value) => z.object(wrapInputToZodShape(schema)).safeParse(value);

test('maps required/optional inputs into a Zod shape', () => {
  const schema = {
    type: 'object',
    properties: { city: { type: 'string' }, note: { type: 'string' } },
    required: ['city'],
  };

  assert.equal(parseWith(schema, {}).success, false);
  assert.equal(parseWith(schema, { city: 'Paris' }).success, true);
  assert.equal(parseWith(schema, { city: 'Paris', note: 'hi' }).success, true);
});

test('maps numeric bounds, integer-ness and enums', () => {
  const schema = {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 5 },
      kind: { type: 'string', enum: ['a', 'b'] },
    },
  };

  assert.equal(parseWith(schema, { count: 0 }).success, false);
  assert.equal(parseWith(schema, { count: 6 }).success, false);
  assert.equal(parseWith(schema, { count: 2.5 }).success, false);
  assert.equal(parseWith(schema, { count: 5 }).success, true);
  assert.equal(parseWith(schema, { count: 3, kind: 'c' }).success, false);
  assert.equal(parseWith(schema, { count: 3, kind: 'b' }).success, true);
});

test('maps arrays, item types, minItems and string patterns', () => {
  const schema = {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
      code: { type: 'string', pattern: '^[A-Z]{3}$' },
    },
  };

  assert.equal(parseWith(schema, { tags: [] }).success, false);
  assert.equal(parseWith(schema, { tags: [1] }).success, false);
  assert.equal(parseWith(schema, { tags: ['x'] }).success, true);
  assert.equal(parseWith(schema, { code: 'abc' }).success, false);
  assert.equal(parseWith(schema, { code: 'ABC' }).success, true);
});

test('maps nested objects and strict additionalProperties', () => {
  const schema = {
    type: 'object',
    properties: {
      meta: {
        type: 'object',
        properties: { source: { type: 'string' } },
        additionalProperties: false,
      },
    },
  };

  assert.equal(parseWith(schema, { meta: { source: 'web' } }).success, true);
  assert.equal(parseWith(schema, { meta: { source: 'web', extra: 1 } }).success, false);
});

test('applies defaults and nullable types', () => {
  const schema = {
    type: 'object',
    properties: {
      limit: { type: 'integer', default: 10 },
      note: { type: ['string', 'null'] },
    },
  };

  const parsed = parseWith(schema, {});
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.limit, 10);
  assert.equal(parseWith(schema, { note: null }).success, true);
});

test('degrades an empty/unknown schema instead of throwing', () => {
  assert.deepEqual(wrapInputToZodShape(undefined), {});
  assert.deepEqual(wrapInputToZodShape({ type: 'object' }), {});
  // An unrecognised type is accepted rather than rejecting every call.
  assert.equal(parseWith({ type: 'object', properties: { odd: { type: 'quantum' } } }, { odd: 1 }).success, true);
});

test('derives MCP-safe, collision-free tool names', () => {
  assert.equal(generatedToolName('dummyjson.auth.me'), 'wrap_dummyjson_auth_me');
  // Dash is legal in an MCP tool name, so it is preserved.
  assert.equal(generatedToolName('a-b'), 'wrap_a-b');
  assert.equal(isToolName(generatedToolName('dummyjson.auth.me')), true);

  // `a.b` and `a_b` sanitise identically, so the second gets a stable suffix.
  const taken = new Set(['wrap_a_b']);
  assert.equal(generatedToolName('a.b', taken), 'wrap_a_b_2');

  // The 128-char MCP limit holds.
  const long = generatedToolName('x'.repeat(400));
  assert.equal(long.length, 128);
  assert.equal(isToolName(long), true);
});

// ── oauth2 client credentials (S5) ───────────────────────────────────────────

function oauthSecret(overrides = {}) {
  return {
    name: 'oauth-key',
    value: 'client-secret',
    allowedHosts: 'api.example.com',
    kind: 'oauth2',
    tokenUrl: 'https://auth.example.com/oauth/token',
    clientId: 'client-id',
    scope: 'read:things',
    ...overrides,
  };
}

test('mints and caches an OAuth2 client-credentials token', async () => {
  const { dir } = tempStore();
  const calls = [];
  const now = 1_000_000;
  const store = new SecretStore(dir, fakeCipher(), {
    now: () => now,
    mintToken: async (input) => {
      calls.push(input);
      return { accessToken: `tok-${calls.length}`, expiresIn: 3600 };
    },
  });

  assert.equal(store.set(oauthSecret()).ok, true);

  const first = await store.resolve('oauth-key', 'api.example.com');
  assert.equal(first.ok, true);
  assert.equal(first.value, 'Bearer tok-1');
  assert.equal(first.refreshable, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientSecret, 'client-secret');
  assert.equal(calls[0].clientId, 'client-id');
  assert.equal(calls[0].scope, 'read:things');

  // Neither metadata nor disk ever contains the token.
  assert.doesNotMatch(JSON.stringify(store.list()), /tok-1/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'), /tok-1/);

  // A second resolve reuses the cache.
  assert.equal((await store.resolve('oauth-key', 'api.example.com')).value, 'Bearer tok-1');
  assert.equal(calls.length, 1);

  // forceRefresh mints again (used after a 401).
  assert.equal((await store.resolve('oauth-key', 'api.example.com', { forceRefresh: true })).value, 'Bearer tok-2');
  assert.equal(calls.length, 2);
});

test('re-mints an OAuth2 token inside the expiry window', async () => {
  const { dir } = tempStore();
  let calls = 0;
  let now = 1_000_000;
  const store = new SecretStore(dir, fakeCipher(), {
    now: () => now,
    mintToken: async () => {
      calls++;
      return { accessToken: `tok-${calls}`, expiresIn: 100 };
    },
  });

  store.set(oauthSecret());
  assert.equal((await store.resolve('oauth-key', 'api.example.com')).value, 'Bearer tok-1');

  now += 50_000; // inside the 60-second early-refresh window
  assert.equal((await store.resolve('oauth-key', 'api.example.com')).value, 'Bearer tok-2');
  assert.equal(calls, 2);
});

test('persists the OAuth2 token cache across store instances', async () => {
  const { dir } = tempStore();
  let calls = 0;
  const options = {
    now: () => 1_000_000,
    mintToken: async () => {
      calls++;
      return { accessToken: 'tok-persist', expiresIn: 3600 };
    },
  };

  const first = new SecretStore(dir, fakeCipher(), options);
  first.set(oauthSecret());
  await first.resolve('oauth-key', 'api.example.com');

  const second = new SecretStore(dir, fakeCipher(), options);
  assert.equal((await second.resolve('oauth-key', 'api.example.com')).value, 'Bearer tok-persist');
  assert.equal(calls, 1);
});

test('reports a failed OAuth2 token request', async () => {
  const { dir } = tempStore();
  const store = new SecretStore(dir, fakeCipher(), {
    mintToken: async () => {
      throw new Error('invalid_client');
    },
  });

  store.set(oauthSecret());
  const result = await store.resolve('oauth-key', 'api.example.com');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOKEN_REQUEST_FAILED');
  assert.equal(result.refreshable, true);
  assert.match(result.message, /invalid_client/);
});

test('validates OAuth2 credential input', () => {
  const { dir } = tempStore();
  const store = new SecretStore(dir, fakeCipher(), { mintToken: async () => ({ accessToken: 't', expiresIn: 60 }) });

  assert.equal(store.set(oauthSecret({ tokenUrl: 'http://auth.example.com/token' })).ok, false);
  assert.equal(store.set(oauthSecret({ tokenUrl: '' })).ok, false);
  assert.equal(store.set(oauthSecret({ clientId: '' })).ok, false);
  assert.equal(store.set(oauthSecret()).ok, true);
  assert.equal(store.list()[0].kind, 'oauth2');
  assert.equal(store.list()[0].oauth2?.tokenUrl, 'https://auth.example.com/oauth/token');
  assert.doesNotMatch(JSON.stringify(store.list()), /client-secret/);

  // A static credential is still the default.
  assert.equal(store.set({ name: 'plain', value: 'x', allowedHosts: 'api.example.com' }).ok, true);
  assert.equal(store.list().find((secret) => secret.name === 'plain')?.kind, 'static');
});

test('refreshes an OAuth2 credential once on 401 and retries', async () => {
  const { store } = tempStore();
  const base = listWrapper();
  store.create({ ...base, request: { ...base.request, auth: 'oauth' } });

  const resolves = [];
  let attempts = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: {
      resolve: async (_name, _host, options = {}) => {
        resolves.push(options.forceRefresh === true);
        return {
          ok: true,
          header: 'Authorization',
          value: options.forceRefresh ? 'Bearer fresh' : 'Bearer stale',
          refreshable: true,
        };
      },
    },
    fetchImpl: async (_url, init) => {
      attempts++;
      if (init.headers.Authorization === 'Bearer stale') return new Response('unauthorized', { status: 401 });
      return jsonResponse({ items: [{ id: 1, name: 'A' }] });
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(resolves, [false, true]);
  assert.equal(result.records.length, 1);
});

test('reports AUTH_REQUIRED when the refreshed credential is still rejected', async () => {
  const { store } = tempStore();
  const base = listWrapper();
  store.create({ ...base, request: { ...base.request, auth: 'oauth' } });

  let attempts = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: {
      resolve: async () => ({ ok: true, header: 'Authorization', value: 'Bearer nope', refreshable: true }),
    },
    fetchImpl: async () => {
      attempts++;
      return new Response('unauthorized', { status: 401 });
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, false);
  assert.equal(attempts, 2); // initial + one retry
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  assert.equal(result.error.retryable, false);
  assert.match(result.error.message, /Settings/);
  assert.match(result.markdown, /AUTH_REQUIRED/);
  assert.equal(store.get('demo.list').lastVerified, undefined);
});

test('a static credential rejected with 401 is not retried', async () => {
  const { store } = tempStore();
  const base = listWrapper();
  store.create({ ...base, request: { ...base.request, auth: 'static-key' } });

  const resolves = [];
  let attempts = 0;
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    secrets: {
      resolve: async () => {
        resolves.push(true);
        return { ok: true, header: 'Authorization', value: 'Bearer static', refreshable: false };
      },
    },
    fetchImpl: async () => {
      attempts++;
      return new Response('unauthorized', { status: 401 });
    },
  });

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(attempts, 1);
  assert.equal(resolves.length, 1);
  assert.equal(result.error.code, 'AUTH_REQUIRED');
});

test('records lastVerified on a successful live run only', async () => {
  const { store } = tempStore();
  store.create(listWrapper());
  const executor = new WrapExecutor(store, {
    allowPrivateHosts: true,
    fetchImpl: async () => jsonResponse({ items: [{ id: 1, name: 'A' }] }),
  });

  const preview = await executor.test({ id: 'demo.list', args: { city: 'Paris' } });
  assert.equal(preview.dryRun, true);
  assert.equal(store.get('demo.list').lastVerified, undefined);

  const result = await executor.run('demo.list', { city: 'Paris' });
  assert.equal(result.ok, true);
  const verified = store.get('demo.list').lastVerified;
  assert.match(String(verified), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.manifest().find((entry) => entry.id === 'demo.list')?.lastVerified, verified);
});




