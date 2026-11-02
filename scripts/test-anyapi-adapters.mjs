import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { projectWrapMaps } from '../src/main/wrap/anyapi/maps.ts';
import { createSecretAdapter } from '../src/main/wrap/anyapi/secrets.ts';

test('the wrapper directory projects to runnable maps', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anyapi-maps-'));
  try {
    await writeFile(
      path.join(dir, 'sample.get.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample.get',
        name: 'Sample: get a thing',
        request: {
          method: 'GET',
          url: 'https://api.sample.test/things/1',
          headers: { Accept: 'application/json' },
          auth: 'sample_token',
        },
        response: { schemaVersion: 1, select: '$', mode: 'document', fields: { Name: 'name' } },
        mutating: false,
      }),
      'utf8',
    );

    const { maps, issues } = await projectWrapMaps(dir);
    assert.deepEqual(issues, []);
    assert.equal(maps.length, 1);

    const map = maps[0];
    assert.equal(map.id, 'sample.get');
    assert.equal(map.baseUrl, 'https://api.sample.test');
    assert.equal(map.operations.length, 1);

    const operation = map.operations[0];
    assert.equal(operation.id, 'sample.get');
    assert.equal(operation.request.method, 'GET');
    assert.equal(operation.request.path, '/things/1');
    assert.equal(operation.secret, 'sample_token');
    assert.equal(operation.mutating, false);
    assert.deepEqual(operation.view.fields, ['name']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a wrapper that is not a wrapper is reported, not thrown', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anyapi-maps-'));
  try {
    await writeFile(path.join(dir, 'broken.json'), JSON.stringify({ schemaVersion: 1, id: 'broken' }), 'utf8');
    const { maps, issues } = await projectWrapMaps(dir);
    assert.equal(maps.length, 0);
    assert.ok(issues.some((issue) => issue.severity === 'error'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function metadata(overrides = {}) {
  return {
    name: 'sample_token',
    allowedHosts: ['api.sample.test'],
    header: 'Authorization',
    prefix: 'Bearer ',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    kind: 'static',
    ...overrides,
  };
}

test('secrets become a binding table and a host-aware provider', async () => {
  const calls = [];
  const store = {
    list: () => [metadata()],
    resolve: async (name, host) => {
      calls.push([name, host]);
      return host === 'api.sample.test' ? { ok: true, value: 'Bearer value' } : { ok: false };
    },
  };

  const adapter = createSecretAdapter(store);

  assert.deepEqual(adapter.refused, []);
  assert.deepEqual(adapter.bindings['sample_token'], {
    host: 'api.sample.test',
    header: 'authorization',
    format: '{value}',
  });

  assert.equal(await adapter.provider.get('sample_token', 'api.sample.test'), 'Bearer value');
  assert.equal(await adapter.provider.get('sample_token', 'other.test'), undefined);
  assert.equal(await adapter.provider.get('sample_token'), undefined, 'the host is required');
  assert.deepEqual(calls, [['sample_token', 'api.sample.test']]);
});

test('wildcard hosts, multiple hosts and OAuth2 are refused with a reason', () => {
  const adapter = createSecretAdapter({
    list: () => [
      metadata({ name: 'wild', allowedHosts: ['*.sample.test'] }),
      metadata({ name: 'many', allowedHosts: ['a.sample.test', 'b.sample.test'] }),
      metadata({ name: 'oauth', kind: 'oauth2' }),
    ],
    resolve: async () => ({ ok: false }),
  });

  assert.deepEqual(Object.keys(adapter.bindings), []);
  assert.equal(adapter.refused.length, 3);

  const reason = Object.fromEntries(adapter.refused.map((entry) => [entry.name, entry.reason]));
  assert.match(reason.wild, /wildcard/);
  assert.match(reason.many, /exactly one host/);
  assert.match(reason.oauth, /OAuth2/);
});
