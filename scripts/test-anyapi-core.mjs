import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WrapStore } from '../src/main/wrap/store.ts';
import { WrapExecutor } from '../src/main/wrap/executor.ts';
import { SecretStore } from '../src/main/wrap/secrets.ts';
import { AnyApiWrapExecutor, coreGate } from '../src/main/wrap/anyapi/executor.ts';
import { createWrapExecutor, wrapCoreMode } from '../src/main/wrap/factory.ts';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-anyapi-core-'));
  return { store: new WrapStore(dir), dir };
}

function fakeCipher() {
  return {
    available: () => true,
    warning: '',
    encrypt: (value) => Buffer.from(`enc:${value}`).toString('base64'),
    decrypt: (payload) => Buffer.from(payload, 'base64').toString().replace(/^enc:/, ''),
  };
}

function getWrapper(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo.list',
    name: 'List items',
    description: 'Read a page of items',
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      query: { q: '{{city}}' },
      headers: { Accept: 'application/json' },
    },
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' }, limit: { type: 'integer' } },
      required: ['city'],
      additionalProperties: false,
    },
    response: {
      schemaVersion: 1,
      name: 'Items',
      select: '$.items[*]',
      fields: { ID: 'id', Name: 'name' },
    },
    ...overrides,
  };
}

function makeCore(store, options = {}) {
  const legacy = new WrapExecutor(store, { allowPrivateHosts: true, ...options });
  return new AnyApiWrapExecutor(store, { allowPrivateHosts: true, ...options, legacy });
}

test('the core gate rejects features the package cannot reproduce', () => {
  assert.deepEqual(coreGate(getWrapper()), { ok: true });

  assert.equal(coreGate(getWrapper({ request: { ...getWrapper().request, methods: ['GET', 'POST'] } })).ok, false);
  assert.equal(
    coreGate(getWrapper({ request: { ...getWrapper().request, method: 'POST', body: { a: '{{city}}' }, bodyFormat: 'form' } })).ok,
    false,
  );
  assert.equal(
    coreGate(
      getWrapper({
        response: { ...getWrapper().response, pagination: { type: 'offset', pageSize: 10, offsetParam: 'offset' } },
      }),
    ).ok,
    false,
  );
  assert.equal(coreGate(getWrapper({ response: { ...getWrapper().response, index: 'cortex' } })).ok, false);
  assert.equal(coreGate(getWrapper({ request: { ...getWrapper().request, url: 'https://api.example.com/v1/{{{city|raw}}}/items' } })).ok, false);
  assert.equal(
    coreGate(
      getWrapper({
        inputSchema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
      }),
    ).ok,
    false,
  );
  assert.equal(
    coreGate(getWrapper({ request: { ...getWrapper().request, headers: { 'X-Trace': '{{trace}}' } } })).ok,
    false,
    'an optional templated header would be sent literally',
  );
  assert.equal(
    coreGate(getWrapper({ request: { ...getWrapper().request, query: { ids: ['1', '2'] } } })).ok,
    false,
    'projection drops an array query value',
  );
});

test('a plain read runs through the core and keeps the wrapper surface', async () => {
  const { store } = tempStore();
  store.create(getWrapper());

  const calls = [];
  const audit = [];
  const core = makeCore(store, {
    audit: { append: (entry) => audit.push(entry) },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await core.run('demo.list', { city: 'New York' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.wrapper.id, 'demo.list');
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0], { ID: 1, Name: 'Alpha' });
  assert.match(result.markdown, /Alpha/);
  assert.equal(result.error, undefined);
  assert.equal(typeof result.durationMs, 'number');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/items\?q=New/);
  assert.equal(calls[0].init.headers.accept, 'application/json');

  assert.equal(audit.length, 1);
  assert.equal(audit[0].host, 'api.example.com');
  assert.equal(audit[0].status, 200);
  assert.equal(audit[0].ok, true);

  assert.ok(store.get('demo.list').lastVerified, 'a live success records lastVerified');
});

test('an optional argument is omitted, not sent empty', async () => {
  const { store } = tempStore();
  store.create(getWrapper());

  let seen = '';
  const core = makeCore(store, {
    fetchImpl: async (url) => {
      seen = url;
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await core.run('demo.list', { city: 'Paris' });
  assert.doesNotMatch(seen, /limit=/);
});

test('a dry run sends nothing and shows no header value', async () => {
  const { store } = tempStore();
  store.create(getWrapper());

  let called = false;
  const core = makeCore(store, {
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const plan = await core.test({ id: 'demo.list', args: { city: 'Paris' }, dryRun: true });

  assert.equal(plan.ok, true);
  assert.equal(plan.dryRun, true);
  assert.equal(called, false);
  assert.equal(plan.request.method, 'GET');
  assert.equal(plan.request.headers.accept, '<redacted>');
});

test('a secret is bound to its host and echoed values are redacted', async () => {
  const { store, dir } = tempStore();
  store.create(
    getWrapper({
      request: { ...getWrapper().request, auth: 'demo_token' },
    }),
  );

  const secrets = new SecretStore(dir, fakeCipher());
  assert.equal(secrets.set({ name: 'demo_token', value: 'top-secret', allowedHosts: 'api.example.com' }).ok, true);

  let seenAuthorization;
  const core = new AnyApiWrapExecutor(store, {
    allowPrivateHosts: true,
    legacy: new WrapExecutor(store, { allowPrivateHosts: true, secrets }),
    secrets,
    secretSource: secrets,
    fetchImpl: async (_url, init) => {
      seenAuthorization = init.headers.authorization;
      return new Response(JSON.stringify({ items: [{ id: 1, name: 'token top-secret' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await core.run('demo.list', { city: 'Paris' });

  assert.equal(result.ok, true);
  assert.equal(seenAuthorization, 'Bearer top-secret');
  assert.doesNotMatch(JSON.stringify(result), /top-secret/);
  assert.match(result.markdown, /<redacted>/);
});

test('a wrapper outside the gate is handed to the legacy executor', async () => {
  const { store } = tempStore();
  store.create(
    getWrapper({
      id: 'demo.form',
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/forms',
        body: { city: '{{city}}' },
        bodyFormat: 'form',
      },
    }),
  );

  let contentType = '';
  const core = makeCore(store, {
    fetchImpl: async (_url, init) => {
      contentType = init.headers['content-type'] ?? init.headers['Content-Type'];
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await core.run('demo.form', { city: 'Paris' });

  assert.equal(result.ok, true);
  assert.match(contentType, /x-www-form-urlencoded/);
});

test('the switch is per process and defaults to the legacy core', () => {
  const { store } = tempStore();
  const previous = process.env.HB_WRAP_CORE;
  try {
    delete process.env.HB_WRAP_CORE;
    assert.equal(wrapCoreMode(), 'legacy');
    assert.ok(createWrapExecutor(store, {}) instanceof WrapExecutor);

    process.env.HB_WRAP_CORE = 'anyapi';
    assert.equal(wrapCoreMode(), 'anyapi');
    assert.ok(createWrapExecutor(store, {}) instanceof AnyApiWrapExecutor);

    process.env.HB_WRAP_CORE = 'something-else';
    assert.equal(wrapCoreMode(), 'legacy');
  } finally {
    if (previous === undefined) delete process.env.HB_WRAP_CORE;
    else process.env.HB_WRAP_CORE = previous;
  }
});
