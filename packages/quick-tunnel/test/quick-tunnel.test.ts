import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { QuickTunnel } from '../src/index.ts';

const fixture = (name: string) => path.join(process.cwd(), 'packages', 'quick-tunnel', 'test', name);

test('starts a tunnel, publishes its URL, and stops cleanly', async () => {
  const states: string[] = [];
  const tunnel = new QuickTunnel({
    localUrl: 'http://127.0.0.1:4112',
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-cloudflared.mjs')],
    startupTimeoutMs: 2000,
    onStatus: (status) => states.push(status.state),
  });

  try {
    const started = await tunnel.start();
    assert.equal(started.running, true);
    assert.equal(started.state, 'running');
    assert.equal(started.url, 'https://fake-quick-tunnel.trycloudflare.com');
    assert.ok(states.includes('starting'));
    assert.ok(states.includes('running'));
  } finally {
    await tunnel.stop();
  }

  const stopped = tunnel.status();
  assert.equal(stopped.running, false);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.url, undefined);
});

test('rejects when cloudflared exits before publishing a URL', async () => {
  const tunnel = new QuickTunnel({
    localUrl: 'http://127.0.0.1:4112',
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-fail.mjs')],
    startupTimeoutMs: 2000,
  });

  await assert.rejects(() => tunnel.start(), /exited before publishing|cloudflared/i);
  assert.equal(tunnel.status().running, false);
  assert.equal(tunnel.status().state, 'error');
});

test('bounds startup when cloudflared never publishes a URL', async () => {
  const tunnel = new QuickTunnel({
    localUrl: 'http://127.0.0.1:4112',
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-silent.mjs')],
    startupTimeoutMs: 250,
  });

  await assert.rejects(() => tunnel.start(), /Timed out waiting/i);
  assert.equal(tunnel.status().running, false);
});
