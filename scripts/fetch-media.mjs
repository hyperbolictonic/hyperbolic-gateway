#!/usr/bin/env node
/**
 * Fetch the pinned yt-dlp binary for the build target.
 *
 * The release asset is downloaded from GitHub, checked against the SHA-256 in
 * `scripts/media-binaries.json`, made executable, and then executed once to prove
 * it runs. A failed download fails the build: shipping a missing or placeholder
 * binary would only surface as a broken download at runtime.
 *
 * Usage:
 *   node scripts/fetch-media.mjs
 *   node scripts/fetch-media.mjs --force
 *   TARGET_PLATFORM=linux TARGET_ARCH=arm64 node scripts/fetch-media.mjs
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const manifestPath = path.join(root, 'scripts', 'media-binaries.json');
const outRoot = path.join(root, 'bin', 'media');

function targetKey() {
  const platform = (process.env.TARGET_PLATFORM || process.platform).trim();
  const arch = (process.env.TARGET_ARCH || process.arch).trim();
  return `${platform}-${arch}`;
}

function binaryName(key) {
  return key.startsWith('win32-') ? 'yt-dlp.exe' : 'yt-dlp';
}

function readManifest() {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof raw.version !== 'string' || raw.version === '') {
    throw new Error('media-binaries.json has no version');
  }
  return raw;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function existingIsGood(target, expectedHash) {
  try {
    const stat = await fs.stat(target);
    if (stat.size === 0) return false;
    return (await sha256(target)) === expectedHash;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  const handle = await fs.open(destination, 'w');
  try {
    for await (const chunk of response.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

async function fetchOne(key, entry, force) {
  const dir = path.join(outRoot, key);
  const target = path.join(dir, binaryName(key));

  await fs.mkdir(dir, { recursive: true });

  if (!force && (await existingIsGood(target, entry.sha256))) {
    console.log(`[fetch-media] ${key} yt-dlp ${manifestVersion()} already present`);
  } else {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${manifestVersion()}/${entry.asset}`;
    const temp = `${target}.download`;
    console.log(`[fetch-media] downloading ${url}`);
    await fs.rm(temp, { force: true });
    try {
      await download(url, temp);
      const actual = await sha256(temp);
      if (actual !== entry.sha256) {
        throw new Error(`checksum mismatch for ${entry.asset}: expected ${entry.sha256}, got ${actual}`);
      }
      await fs.rm(target, { force: true });
      await fs.rename(temp, target);
      if (process.platform !== 'win32') await fs.chmod(target, 0o755);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  const { stdout } = await execFileAsync(target, ['--version'], { timeout: 30_000 });
  const version = stdout.trim();
  if (version === '') throw new Error(`the fetched yt-dlp for ${key} did not report a version`);
  console.log(`[fetch-media] ready: ${key} yt-dlp ${version} at ${path.relative(root, target)}`);
}

let cachedManifest = null;
function manifestVersion() {
  cachedManifest ??= readManifest();
  return cachedManifest.version;
}

async function main() {
  const manifest = readManifest();
  cachedManifest = manifest;
  const force = process.argv.includes('--force');

  if (process.argv.includes('--all')) {
    for (const [key, entry] of Object.entries(manifest.assets)) {
      await fetchOne(key, entry, force);
    }
    return;
  }

  const key = targetKey();
  const entry = manifest.assets[key];
  if (!entry) {
    throw new Error(
      `no yt-dlp asset for ${key}. Known targets: ${Object.keys(manifest.assets).join(', ')}`,
    );
  }
  await fetchOne(key, entry, force);
}

main().catch((error) => {
  console.error(`[fetch-media] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
