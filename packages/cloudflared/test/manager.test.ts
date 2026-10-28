import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CloudflaredManager } from '../src/index.ts';

const VERSION = '2026.10.5';
const ASSET = 'cloudflared-windows-amd64.exe';
const BINARY = Buffer.from('fake cloudflared binary');

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function releasePayload(digest: string) {
  return {
    tag_name: VERSION,
    assets: [
      {
        name: ASSET,
        browser_download_url: `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${ASSET}`,
        digest: `sha256:${digest}`,
      },
    ],
  };
}

function fakeFetch(digest: string, binary = BINARY): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/releases/latest')) return response(releasePayload(digest));
    if (url.startsWith('https://github.com/cloudflare/cloudflared/releases/download/')) {
      return new Response(binary, { status: 200, headers: { 'Content-Length': String(binary.length) } });
    }
    return response({ error: 'not found' }, 404);
  }) as typeof fetch;
}

test('checks, verifies, and installs a managed cloudflared binary', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-manager-'));
  const digest = crypto.createHash('sha256').update(BINARY).digest('hex');
  const manager = new CloudflaredManager({
    dataDir,
    platform: 'win32',
    arch: 'x64',
    releaseApiUrl: 'https://api.test/cloudflared/releases/latest',
    fetchImpl: fakeFetch(digest),
  });

  try {
    const check = await manager.checkForUpdate();
    assert.equal(check.updateAvailable, true);
    assert.equal(check.latest.version, VERSION);

    const record = await manager.installLatest();
    assert.equal(record.version, VERSION);
    assert.equal(record.sha256, digest);
    assert.equal(manager.installed()?.version, VERSION);
    assert.ok(fs.existsSync(manager.managedPath()));

    const secondCheck = await manager.checkForUpdate();
    assert.equal(secondCheck.updateAvailable, false);
    assert.equal(secondCheck.installed?.version, VERSION);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects a checksum mismatch without installing', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-mismatch-'));
  const manager = new CloudflaredManager({
    dataDir,
    platform: 'win32',
    arch: 'x64',
    releaseApiUrl: 'https://api.test/cloudflared/releases/latest',
    fetchImpl: fakeFetch('0'.repeat(64)),
  });

  try {
    await assert.rejects(() => manager.installLatest(), /checksum/i);
    assert.equal(manager.installed(), undefined);
    assert.equal(fs.existsSync(manager.managedPath()), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects unsupported platforms explicitly', async () => {
  const manager = new CloudflaredManager({
    dataDir: path.join(os.tmpdir(), 'unused-cloudflared'),
    platform: 'win32',
    arch: 'arm64',
    fetchImpl: fakeFetch('0'.repeat(64)),
  });
  await assert.rejects(() => manager.checkForUpdate(), /Unsupported cloudflared platform/i);
});
