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
import { toNetscape } from '../src/main/media/cookie-format.ts';
import { needsLogin } from '../src/main/media/auth.ts';
import { normalizeMediaSettings } from '../src/main/media/settings.ts';
import { detectFfmpeg, parseFfmpegVersion } from '../src/main/media/ffmpeg.ts';
import { parseVtt, transcriptDocument } from '../src/main/media/transcript.ts';

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

test('cookies are written in the Netscape format yt-dlp reads', () => {
  const text = toNetscape([
    {
      domain: '.youtube.com',
      hostOnly: false,
      path: '/',
      secure: true,
      expirationDate: 1893456000.9,
      name: 'SID',
      value: 'abc',
    },
    { domain: 'www.youtube.com', hostOnly: true, path: '/', secure: true, name: 'PREF', value: 'x' },
    { domain: '.example.com', hostOnly: false, path: '/', secure: false, name: 'bad\tname', value: 'v\nw' },
  ]);

  assert.match(text, /^# Netscape HTTP Cookie File/u);
  assert.match(text, /\.youtube\.com\tTRUE\t\/\tTRUE\t1893456000\tSID\tabc/u);
  assert.match(text, /www\.youtube\.com\tFALSE\t\/\tTRUE\t0\tPREF\tx/u);
  assert.ok(!text.includes('bad\tname'), 'tabs are stripped from fields');
  assert.ok(!text.includes('v\nw'), 'newlines are stripped from values');
});

test('auth failures are recognised without treating every 403 as a login', () => {
  assert.equal(needsLogin('[youtube] x: Sign in to confirm you\u2019re not a bot'), true);
  assert.equal(needsLogin('ERROR: This video is private'), true);
  assert.equal(needsLogin('ERROR: HTTP Error 401: Unauthorized'), true);
  assert.equal(needsLogin('ERROR: This content requires authentication'), true);
  assert.equal(needsLogin('ERROR: This video is age-restricted'), true);

  assert.equal(needsLogin('ERROR: HTTP Error 404: Not Found'), false);
  assert.equal(needsLogin('WARNING: ffmpeg not found'), false);
  assert.equal(needsLogin('Unable to download webpage: HTTP Error 403: Forbidden'), false);
  assert.equal(needsLogin(''), false);
});

test('media settings default to no session cookies', () => {
  const defaults = normalizeMediaSettings({});
  assert.equal(defaults.useSessionCookies, false);
  assert.equal(defaults.autoUpdate, true);
  assert.equal(defaults.updateIntervalMinutes, 60);
  assert.equal(defaults.outputDir, '');
  assert.equal(defaults.ffmpegMode, 'auto');
  assert.equal(defaults.ffmpegPath, '');

  assert.equal(normalizeMediaSettings({ useSessionCookies: true }).useSessionCookies, true);
  assert.equal(normalizeMediaSettings({ updateIntervalMinutes: 1 }).updateIntervalMinutes, 15);
  assert.equal(normalizeMediaSettings({ updateIntervalMinutes: 99999 }).updateIntervalMinutes, 1440);
});

test('a save folder must be absolute to be kept', () => {
  const absolute = path.resolve('media-test-output');
  assert.equal(normalizeMediaSettings({ outputDir: absolute }).outputDir, absolute);
  assert.equal(normalizeMediaSettings({ outputDir: 'relative/folder' }).outputDir, '');
  assert.equal(normalizeMediaSettings({ outputDir: '   ' }).outputDir, '');
  assert.equal(normalizeMediaSettings({ ffmpegMode: 'managed' }).ffmpegMode, 'managed');
  assert.equal(normalizeMediaSettings({ ffmpegMode: 'nonsense' }).ffmpegMode, 'auto');
});

test('a cookie file is passed to yt-dlp only when one was written', () => {
  const base = {
    url: 'https://example.com/watch?v=abc',
    kind: 'video',
    quality: 'best',
    home: '/tmp/home',
    temp: '/tmp/temp',
    ffmpeg: false,
  };
  const without = buildDownloadArgs(base);
  assert.ok(!without.includes('--cookies'));
  assert.ok(!without.includes('--ffmpeg-location'));
  assert.ok(without.includes('best[ext=mp4]/best'), 'single-file selector without ffmpeg');

  const withCookies = buildDownloadArgs({ ...base, cookies: '/tmp/cookies.txt' });
  assert.deepEqual(
    withCookies.slice(withCookies.indexOf('--cookies'), withCookies.indexOf('--cookies') + 2),
    ['--cookies', '/tmp/cookies.txt'],
  );
  assert.equal(withCookies.at(-1), base.url);

  const withFfmpeg = buildDownloadArgs({ ...base, ffmpeg: true, ffmpegDir: '/tmp/ffmpeg' });
  assert.deepEqual(
    withFfmpeg.slice(withFfmpeg.indexOf('--ffmpeg-location'), withFfmpeg.indexOf('--ffmpeg-location') + 2),
    ['--ffmpeg-location', '/tmp/ffmpeg'],
  );
  assert.ok(withFfmpeg.includes('bestvideo+bestaudio/best'), 'merge selector with ffmpeg');
});

test('ffmpeg versions are parsed from -version output', () => {
  assert.equal(parseFfmpegVersion('ffmpeg version 6.1.1-full_build-www.gyan.dev Copyright (c) 2000-2023'), '6.1.1-full_build-www.gyan.dev');
  assert.equal(parseFfmpegVersion('ffmpeg version 7.0.2 Copyright (c) 2000-2024 the FFmpeg developers'), '7.0.2');
  assert.equal(parseFfmpegVersion('not ffmpeg'), null);
});

test('managed ffmpeg mode reports a missing install instead of guessing', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-ffmpeg-managed-'));
  const info = await detectFfmpeg(
    { autoUpdate: true, updateIntervalMinutes: 60, useSessionCookies: false, outputDir: '', ffmpegMode: 'managed', ffmpegPath: '' },
    dir,
  );
  assert.equal(info.available, false);
  assert.equal(info.mode, 'managed');
  assert.match(info.error ?? '', /Install ffmpeg/u);
});

test('path mode does not silently fall back to PATH', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-ffmpeg-path-'));
  const info = await detectFfmpeg(
    { autoUpdate: true, updateIntervalMinutes: 60, useSessionCookies: false, outputDir: '', ffmpegMode: 'path', ffmpegPath: '' },
    dir,
  );
  assert.equal(info.available, false);
  assert.match(info.error ?? '', /ffmpegPath/u);
});

test('VTT is reduced to plain text without duplicate scrolling lines', () => {
  const vtt = [
    'WEBVTT',
    'Kind: captions',
    'Language: en',
    '',
    'NOTE this is a note',
    '',
    '00:00:00.000 --> 00:00:02.000 align:start position:0%',
    'Hello <c.colorE5E5E5>world</c>',
    '',
    '00:00:02.000 --> 00:00:04.000',
    'Hello world',
    '',
    '00:00:04.000 --> 00:00:06.000',
    'Next line &amp; more',
    '',
    '1',
    '00:00:06.000 --> 00:00:08.000',
    'Third &lt;cue&gt;',
  ].join('\n');

  assert.equal(parseVtt(vtt), 'Hello world\nNext line & more\nThird <cue>');
  assert.equal(parseVtt('WEBVTT\n\n'), '');
});

test('the transcript document carries source and caption metadata', () => {
  const document = transcriptDocument({
    title: 'Me at the zoo',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    language: 'en',
    automatic: true,
    text: 'The cool thing about these guys...',
  });

  assert.match(document, /^# Me at the zoo/u);
  assert.match(document, /Source: https:\/\/www\.youtube\.com\/watch\?v=jNQXAC9IVRw/u);
  assert.match(document, /Captions: en \(automatic\)/u);
  assert.ok(document.endsWith('The cool thing about these guys...'));

  const manual = transcriptDocument({
    title: 'T',
    url: 'https://example.com/v',
    language: 'de',
    automatic: false,
    text: 'x',
  });
  assert.match(manual, /Captions: de$/mu);
});

test('the pinned manifest covers every supported target with a SHA-256', () => {  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'media-binaries.json'), 'utf8'));

  assert.match(manifest.version, /^\d{4}\.\d{2}\.\d{2}$/u);
  for (const key of ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
    assert.ok(manifest.assets[key], `missing asset entry for ${key}`);
  }
  for (const [key, entry] of Object.entries(manifest.assets)) {
    assert.match(entry.asset, /^yt-dlp/, `${key} asset name`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `${key} checksum`);
  }
});
