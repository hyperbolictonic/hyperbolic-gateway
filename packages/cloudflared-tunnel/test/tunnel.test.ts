import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { CloudflaredTunnel } from '../src/index.ts';

const fixture = (name: string) => path.join(process.cwd(), 'packages', 'cloudflared-tunnel', 'test', name);

test('starts a named tunnel after registration and stops cleanly', async () => {
  const states: string[] = [];
  const tunnel = new CloudflaredTunnel({
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-tunnel.mjs')],
    startupTimeoutMs: 2000,
    onStatus: (status) => states.push(status.state),
  });

  try {
    const started = await tunnel.start('test-token');
    assert.equal(started.running, true);
    assert.equal(started.state, 'running');
    assert.ok(states.includes('starting'));
    assert.ok(states.includes('running'));
  } finally {
    await tunnel.stop();
  }

  const stopped = tunnel.status();
  assert.equal(stopped.running, false);
  assert.equal(stopped.state, 'stopped');
});

test('rejects when cloudflared exits before registration', async () => {
  const tunnel = new CloudflaredTunnel({
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-fail.mjs')],
    startupTimeoutMs: 2000,
  });

  await assert.rejects(() => tunnel.start('test-token'), /exited before registering/i);
  assert.equal(tunnel.status().running, false);
  assert.equal(tunnel.status().state, 'error');
});

test('bounds startup when registration never arrives', async () => {
  const tunnel = new CloudflaredTunnel({
    binaryPath: process.execPath,
    argsPrefix: [fixture('fake-silent.mjs')],
    startupTimeoutMs: 250,
  });

  await assert.rejects(() => tunnel.start('test-token'), /Timed out waiting/i);
  assert.equal(tunnel.status().running, false);
});
