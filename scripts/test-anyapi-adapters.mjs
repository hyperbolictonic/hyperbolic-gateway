import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { projectWrapMaps } from '../src/main/wrap/anyapi/maps.ts';
import { createSecretAdapter } from '../src/main/wrap/anyapi/secrets.ts';
import { wrapDryRun, wrapErrorCode, wrapFailure, wrapSuccess } from '../src/main/wrap/anyapi/result.ts';

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

test('core error codes map onto published wrapper codes', () => {
  assert.equal(wrapErrorCode({ code: 'missing_argument' }), 'INVALID_ARGS');
  assert.equal(wrapErrorCode({ code: 'unknown_argument' }), 'INVALID_ARGS');
  assert.equal(wrapErrorCode({ code: 'unknown_operation' }), 'WRAPPER_NOT_FOUND');
  assert.equal(wrapErrorCode({ code: 'secret_unbound' }), 'AUTH_REQUIRED');
  assert.equal(wrapErrorCode({ code: 'timeout' }), 'TIMEOUT');
  assert.equal(wrapErrorCode({ code: 'network' }), 'NETWORK_ERROR');
  assert.equal(wrapErrorCode({ code: 'http_error', status: 401 }), 'AUTH_REQUIRED');
  assert.equal(wrapErrorCode({ code: 'http_error', status: 403 }), 'AUTH_REQUIRED');
  assert.equal(wrapErrorCode({ code: 'http_error', status: 500 }), 'HTTP_ERROR');
  assert.equal(wrapErrorCode({ code: 'outcome_unknown', status: 503 }), 'OUTCOME_UNKNOWN');
  assert.equal(wrapErrorCode({ code: 'blocked_scheme' }), 'BLOCKED_PROTOCOL');
  assert.equal(wrapErrorCode({ code: 'url_has_credentials' }), 'BLOCKED_URL_CREDENTIALS');
  assert.equal(wrapErrorCode({ code: 'something_new' }), 'INVALID_REQUEST', 'an unknown code is not leaked');
});

test('a failure keeps the wrapper surface shape', () => {
  const result = wrapFailure(
    { id: 'sample.get', name: 'Sample' },
    { code: 'http_error', message: 'sample.get returned 500', hint: 'boom', status: 500 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.wrapper.id, 'sample.get');
  assert.deepEqual(result.records, []);
  assert.equal(result.error.code, 'HTTP_ERROR');
  assert.equal(result.error.status, 500);
  assert.equal(result.error.retryable, undefined);
  assert.equal(result.markdown, '**HTTP_ERROR:** sample.get returned 500 (boom)');
});

test('a timeout is retryable; a rejected credential is not', () => {
  assert.equal(wrapFailure({ id: 'a', name: 'A' }, { code: 'timeout', message: 'took too long' }).error.retryable, true);
  assert.equal(
    wrapFailure({ id: 'a', name: 'A' }, { code: 'http_error', message: 'nope', status: 401 }).error.retryable,
    undefined,
  );
});

test('a dry run never shows a header value', () => {
  const plan = {
    dryRun: true,
    operation: 'sample.get',
    method: 'POST',
    host: 'api.sample.test',
    url: 'https://api.sample.test/things',
    query: { q: '1' },
    headers: ['accept', 'authorization'],
    body: '{"name":"x"}',
    secret: { name: 'sample_token', host: 'api.sample.test', header: 'authorization' },
    mutating: true,
  };

  const result = wrapDryRun({ id: 'sample.get', name: 'Sample' }, plan);

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.request.method, 'POST');
  // The plan separates the query; the preview shows it, encoded.
  assert.equal(result.request.url, 'https://api.sample.test/things?q=1');
  assert.deepEqual(result.request.headers, { accept: '<redacted>', authorization: '<redacted>' });
  assert.equal(result.request.body, '{"name":"x"}');
  assert.equal(JSON.stringify(result).includes('Bearer'), false);
});

test('a success keeps status, bytes, rendering and paging', () => {
  const result = wrapSuccess({
    wrapper: { id: 'sample.get', name: 'Sample' },
    result: {
      dryRun: false,
      handle: 'h_1',
      envelope: { summary: '', mode: 'rows', total: 2, returned: 2, truncated: false, bytes: 10 },
      network: true,
      status: 200,
      url: 'https://api.sample.test/things',
      method: 'GET',
      mutating: false,
    },
    request: { method: 'GET', url: 'https://api.sample.test/things', headers: { accept: 'application/json' } },
    rendered: { markdown: '| a |', records: [{ a: 1 }] },
    durationMs: 12,
    bytes: 34,
    contentType: 'application/json',
    paging: { pages: 1, cap: 10, more: false },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.durationMs, 12);
  assert.equal(result.response.bytes, 34);
  assert.equal(result.response.contentType, 'application/json');
  assert.equal(result.response.truncated, undefined);
  assert.equal(result.markdown, '| a |');
  assert.deepEqual(result.records, [{ a: 1 }]);
  assert.deepEqual(result.paging, { pages: 1, cap: 10, more: false });
  assert.equal(result.error, undefined);
});
