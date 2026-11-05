import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  compareYtDlpVersions,
  mediaPlatformKey,
  ytDlpFileName,
  ytdlpRuntimeOptions,
} from '../src/main/media/platform.ts';
import { buildDownloadArgs, buildFormatSelector, parseProgressLine } from '../src/main/media/jobs.ts';

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
