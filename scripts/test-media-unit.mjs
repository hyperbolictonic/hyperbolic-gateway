import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  compareYtDlpVersions,
  mediaPlatformKey,
  parseChecksum,
  ytDlpFileName,
  ytDlpReleaseAsset,
  ytdlpRuntimeOptions,
} from '../src/main/media/platform.ts';
import { buildDownloadArgs, buildFormatSelector, parseProgressLine } from '../src/main/media/jobs.ts';
import { MediaUpdater, jitter } from '../src/main/media/updater.ts';

test('platform keys and file names match the build layout', () => {
  assert.equal(mediaPlatformKey('win32', 'x64'), 'win32-x64');
  assert.equal(mediaPlatformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(mediaPlatformKey('darwin', 'x64'), 'darwin-x64');
  assert.equal(mediaPlatformKey('linux', 'x64'), 'linux-x64');
  assert.equal(mediaPlatformKey('linux', 'arm64'), 'linux-arm64');

  assert.equal(ytDlpFileName('win32'), 'yt-dlp.exe');
  assert.equal(ytDlpFileName('linux'), 'yt-dlp');
  assert.equal(ytDlpFileName('darwin'), 'yt-dlp');
});

test('Electron is offered to yt-dlp as a Node runtime', () => {
  const runtime = ytdlpRuntimeOptions(
    '/app/Hypagon Gateway',
    { node: '24.21.0', electron: '44.7.2' },
    { PATH: '/usr/bin' },
  );

  assert.equal(runtime.kind, 'electron-node');
  assert.deepEqual(runtime.args, ['--js-runtimes', 'node:/app/Hypagon Gateway']);
  assert.equal(runtime.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(runtime.env.PATH, '/usr/bin', 'the parent environment is preserved');
});

test('an unusable runtime is omitted rather than guessed', () => {
  const plainNode = ytdlpRuntimeOptions('/usr/bin/node', { node: '24.0.0' }, {});
  assert.equal(plainNode.kind, 'none');
  assert.deepEqual(plainNode.args, []);
  assert.equal(plainNode.env.ELECTRON_RUN_AS_NODE, undefined);

  const oldElectron = ytdlpRuntimeOptions('/app/electron', { node: '18.0.0', electron: '28.0.0' }, {});
  assert.equal(oldElectron.kind, 'none', 'yt-dlp requires Node 22 or newer');
  assert.deepEqual(oldElectron.args, []);
});

test('version comparison orders yt-dlp release dates', () => {
  assert.ok(compareYtDlpVersions('2026.10.26', '2026.10.25') > 0);
  assert.ok(compareYtDlpVersions('2026.10.25', '2026.10.26') < 0);
  assert.equal(compareYtDlpVersions('2026.10.26', '2026.10.26'), 0);
  assert.equal(compareYtDlpVersions('v2026.10.26', '2026.10.26'), 0);
  assert.ok(compareYtDlpVersions('2026.11.01', '2026.10.26') > 0);
  assert.ok(compareYtDlpVersions('2027.01.01', '2026.12.31') > 0);
  assert.ok(compareYtDlpVersions('2026.10.26', null) > 0);
  assert.ok(compareYtDlpVersions(null, '2026.10.26') < 0);
  assert.equal(compareYtDlpVersions(null, null), 0);
});

test('the format selector asks for one file when ffmpeg is unavailable', () => {
  assert.equal(buildFormatSelector('audio', 'best', false), 'bestaudio[ext=m4a]/bestaudio');
  assert.equal(buildFormatSelector('audio', 'best', true), 'bestaudio');
  assert.equal(buildFormatSelector('video', 'best', false), 'best[ext=mp4]/best');
  assert.equal(buildFormatSelector('video', '720', false), 'best[height<=720][ext=mp4]/best[height<=720]');
  assert.equal(buildFormatSelector('video', 'worst', false), 'worst[ext=mp4]/worst');
  assert.equal(buildFormatSelector('video', '720', true), 'bestvideo[height<=720]+bestaudio/best[height<=720]');
});

test('download arguments are built here and never passed through', () => {
  const args = buildDownloadArgs({
    url: 'https://example.com/watch?v=abc',
    kind: 'video',
    quality: '720',
    home: '/tmp/home',
    temp: '/tmp/temp',
    ffmpeg: false,
  });

  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  assert.ok(args.includes('--newline'));
  assert.deepEqual(args.slice(args.indexOf('--paths'), args.indexOf('--paths') + 2), ['--paths', 'home:/tmp/home']);
  assert.ok(args.includes('--format'));
  assert.equal(args.at(-1), 'https://example.com/watch?v=abc');
  assert.ok(!args.includes('--exec'), 'no arbitrary execution hook');
  assert.ok(!args.includes('--config-locations'));
});

test('progress lines are parsed without a terminal', () => {
  const downloading = parseProgressLine('[download]  42.5% of  10.0MiB at  1.50MiB/s ETA 00:12');
  assert.equal(downloading?.stage, 'downloading');
  assert.equal(downloading?.percent, 42.5);
  assert.equal(downloading?.totalBytes, 10 * 1024 ** 2);
  assert.equal(downloading?.downloadedBytes, Math.round(10 * 1024 ** 2 * 0.425));
  assert.equal(downloading?.speedBytesPerSecond, Math.round(1.5 * 1024 ** 2));
  assert.equal(downloading?.etaSeconds, 12);

  assert.equal(parseProgressLine('[Merger] Merging formats into "a.mp4"')?.stage, 'merging');
  assert.equal(parseProgressLine('[ExtractAudio] Destination: a.m4a')?.stage, 'postprocessing');
  assert.equal(parseProgressLine('[download] Destination: a.mp4')?.stage, 'finalising');
  assert.equal(parseProgressLine('[youtube] Extracting URL'), null);
  assert.equal(parseProgressLine(''), null);

  assert.equal(parseProgressLine('[download]   5.0% of ~ 1.0GiB at 900.0KiB/s ETA 01:02:03')?.etaSeconds, 3723);
});

test('release assets and checksums use the target platform', () => {
  assert.equal(ytDlpReleaseAsset('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(ytDlpReleaseAsset('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(ytDlpReleaseAsset('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(ytDlpReleaseAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');

  const sums = [
    'a'.repeat(64) + '  yt-dlp.exe',
    'b'.repeat(64) + ' *yt-dlp_linux',
    'c'.repeat(64) + '  yt-dlp_macos',
  ].join('\n');
  assert.equal(parseChecksum(sums, 'yt-dlp.exe'), 'a'.repeat(64));
  assert.equal(parseChecksum(sums, 'yt-dlp_linux'), 'b'.repeat(64), 'a binary-mode marker is allowed');
  assert.equal(parseChecksum(sums, 'yt-dlp_macos'), 'c'.repeat(64));
  assert.equal(parseChecksum(sums, 'yt-dlp_linux_aarch64'), null);
});

test('the check interval jitters inside a ten percent band', () => {
  const hour = 60 * 60_000;
  assert.equal(jitter(hour, () => 0), Math.round(hour * 0.9));
  assert.equal(jitter(hour, () => 1), Math.round(hour * 1.1));
  assert.ok(jitter(10_000, () => 0) >= 60_000, 'never schedules more often than once a minute');
});

test('the updater verifies the checksum and installs a good binary', async () => {
  const { createHash } = await import('node:crypto');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-media-update-'));
  const target = path.join(dir, 'yt-dlp.exe');
  fs.writeFileSync(target, 'old-binary', 'utf8');

  const assetName = ytDlpReleaseAsset();
  const good = Buffer.from('new-binary');
  const sums = `${createHash('sha256').update(good).digest('hex')}  ${assetName}\n`;

  const updater = new MediaUpdater({
    binaryPath: () => target,
    readVersion: async (file) => (fs.readFileSync(file, 'utf8') === 'new-binary' ? '2026.10.27' : '2026.10.26'),
    settings: () => ({ autoUpdate: true, updateIntervalMinutes: 60 }),
    hasRunningJobs: () => false,
    onUpdated: () => {},
    fetchImpl: async (url) => {
      if (String(url).includes('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: '2026.10.27',
            assets: [
              { name: assetName, browser_download_url: 'https://example.test/asset' },
              { name: 'SHA2-256SUMS', browser_download_url: 'https://example.test/sums' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).endsWith('/sums')) return new Response(sums, { status: 200 });
      return new Response(good, { status: 200 });
    },
  });

  const state = await updater.check(true);
  assert.equal(state.lastError, null);
  assert.equal(state.installedVersion, '2026.10.27');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new-binary');
  assert.ok(state.lastUpdatedAt);
});

test('the updater refuses a bad checksum and leaves the current binary', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-media-update-bad-'));
  const target = path.join(dir, 'yt-dlp.exe');
  fs.writeFileSync(target, 'old-binary', 'utf8');

  const assetName = ytDlpReleaseAsset();
  const updater = new MediaUpdater({
    binaryPath: () => target,
    readVersion: async (file) => (fs.readFileSync(file, 'utf8') === 'old-binary' ? '2026.10.26' : null),
    settings: () => ({ autoUpdate: true, updateIntervalMinutes: 60 }),
    hasRunningJobs: () => false,
    onUpdated: () => {},
    fetchImpl: async (url) => {
      if (String(url).includes('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: '2026.10.27',
            assets: [
              { name: assetName, browser_download_url: 'https://example.test/asset' },
              { name: 'SHA2-256SUMS', browser_download_url: 'https://example.test/sums' },
            ],
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith('/sums')) return new Response(`${'d'.repeat(64)}  ${assetName}\n`, { status: 200 });
      return new Response('tampered', { status: 200 });
    },
  });

  const state = await updater.check(true);
  assert.match(state.lastError ?? '', /checksum mismatch/u);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old-binary');
  assert.equal(state.installedVersion, '2026.10.26');
});

test('the pinned manifest covers every supported target with a SHA-256', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'media-binaries.json'), 'utf8'));

  assert.match(manifest.version, /^\d{4}\.\d{2}\.\d{2}$/u);
  for (const key of ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
    assert.ok(manifest.assets[key], `missing asset entry for ${key}`);
  }
  for (const [key, entry] of Object.entries(manifest.assets)) {
    assert.match(entry.asset, /^yt-dlp/, `${key} asset name`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `${key} checksum`);
  }
});
