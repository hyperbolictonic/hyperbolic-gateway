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
