import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
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

function releasePayload(digest: string, assetName = ASSET, version = VERSION) {
  return {
    tag_name: version,
    assets: [
      {
        name: assetName,
        browser_download_url: `https://github.com/cloudflare/cloudflared/releases/download/${version}/${assetName}`,
        digest: `sha256:${digest}`,
      },
    ],
  };
}

function fakeFetch(digest: string, binary = BINARY, assetName = ASSET, version = VERSION): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/releases/latest')) return response(releasePayload(digest, assetName, version));
    if (url.startsWith('https://github.com/cloudflare/cloudflared/releases/download/')) {
      return new Response(binary, { status: 200, headers: { 'Content-Length': String(binary.length) } });
    }
    return response({ error: 'not found' }, 404);
  }) as typeof fetch;
}

function tarFixture(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000755\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding, Buffer.alloc(1024, 0)]);
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

test('extracts the macOS tar archive in pure Node', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-tar-'));
  const tar = zlib.gzipSync(tarFixture('package/cloudflared', BINARY));
  const digest = crypto.createHash('sha256').update(tar).digest('hex');
  const manager = new CloudflaredManager({
    dataDir,
    platform: 'darwin',
    arch: 'arm64',
    releaseApiUrl: 'https://api.test/cloudflared/releases/latest',
    fetchImpl: fakeFetch(digest, tar, 'cloudflared-darwin-arm64.tgz'),
  });

  try {
    const record = await manager.installLatest();
    assert.equal(record.version, VERSION);
    assert.deepEqual(fs.readFileSync(manager.managedPath()), BINARY);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
