import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideFunnel, FunnelBreaker } from '../src/main/jev/policy.ts';
import { JevSettingsStore } from '../src/main/settings/jev.ts';

const base = { enforce: true, as: 'markdown', pageTokens: 14_823 };

assert.deepEqual(decideFunnel({ ...base, enforce: false }), { allowed: true, reason: 'not-enforced' });
assert.deepEqual(decideFunnel({ ...base, as: 'som' }), { allowed: true, reason: 'not-content' });
assert.deepEqual(decideFunnel({ ...base, full: true }), { allowed: true, reason: 'override' });
assert.deepEqual(decideFunnel({ ...base, region: '#main' }), { allowed: true, reason: 'region' });
assert.deepEqual(decideFunnel({ ...base, cursor: '25000' }), { allowed: true, reason: 'cursor' });
assert.deepEqual(decideFunnel({ ...base, budget: 4000 }), { allowed: true, reason: 'budget' });

// budget: 0 means the whole construct, so it is unscoped.
assert.deepEqual(decideFunnel({ ...base, budget: 0 }), { allowed: false, reason: 'unscoped' });
// Small pages are exempt.
assert.deepEqual(decideFunnel({ ...base, pageTokens: 900 }), { allowed: true, reason: 'small-page' });
// Default threshold boundary: exactly 1500 is exempt, 1501 is not.
assert.equal(decideFunnel({ ...base, pageTokens: 1500 }).allowed, true);
assert.equal(decideFunnel({ ...base, pageTokens: 1501 }).allowed, false);
// Unknown page size (0) is not treated as small.
assert.equal(decideFunnel({ ...base, pageTokens: 0 }).allowed, false);

// Loop breaker: two refusals in the window release the third read.
const breaker = new FunnelBreaker(60_000, 2);
const now = 1_000_000;
assert.equal(breaker.shouldRelease('https://example.com/a', now), false);
breaker.recordRefusal('https://example.com/a', now);
assert.equal(breaker.shouldRelease('https://example.com/a', now), false);
breaker.recordRefusal('https://example.com/a', now + 1000);
assert.equal(breaker.shouldRelease('https://example.com/a', now + 2000), true);
breaker.reset('https://example.com/a');
assert.equal(breaker.shouldRelease('https://example.com/a', now + 3000), false);
// A stale window is forgotten.
breaker.recordRefusal('https://example.com/b', now);
breaker.recordRefusal('https://example.com/b', now + 1000);
assert.equal(breaker.shouldRelease('https://example.com/b', now + 61_500), false);

// Settings: legacy { enabled } migrates to prefer, never silently to enforce.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-settings-'));
try {
  const file = path.join(dir, 'jev.json');
  fs.writeFileSync(file, JSON.stringify({ enabled: true }), 'utf8');
  const store = new JevSettingsStore(file);
  assert.deepEqual(store.get(), { power: true, mode: 'prefer' });

  store.savePatch({ mode: 'enforce' });
  assert.deepEqual(store.get(), { power: true, mode: 'enforce' });

  store.savePatch({ power: false });
  assert.deepEqual(store.get(), { power: false, mode: 'enforce' });

  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(persisted, { power: false, mode: 'enforce' });

  // Unknown modes fall back to the current mode, never crash.
  store.savePatch({ power: true, mode: 'bogus' });
  assert.deepEqual(store.get(), { power: true, mode: 'enforce' });

  // A UTF-8 BOM (common from Windows editors) must not reset the settings.
  fs.writeFileSync(file, '\uFEFF{"power":true,"mode":"enforce"}', 'utf8');
  assert.deepEqual(new JevSettingsStore(file).get(), { power: true, mode: 'enforce' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('jev funnel passed');
