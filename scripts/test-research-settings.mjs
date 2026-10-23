import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_RESEARCH_SETTINGS,
  ResearchSettingsStore,
  looksLikeChallenge,
  normalizeResearchSettings,
} from '../src/main/research/settings.ts';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuang-research-test-'));
  return { dir, store: new ResearchSettingsStore(path.join(dir, 'research-settings.json')) };
}

test('loads defaults when no settings file exists', () => {
  const { store } = tempStore();
  const settings = store.load();
  assert.equal(settings.enabled, false);
  assert.deepEqual(settings.engineChain, DEFAULT_RESEARCH_SETTINGS.engineChain);
  assert.equal(settings.domainCooldownSec, 300);
});

test('saves and reloads stealth settings', () => {
  const { store } = tempStore();
  const result = store.save({
    enabled: true,
    engineChain: 'duckduckgo > brave > google',
    urlTemplate: 'https://searx.example/search?q={query}',
    proxyUrl: 'socks5://proxy.example:1080',
    domainCooldownSec: 600,
    delayMs: 1500,
    activateView: true,
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.settings.engineChain, ['duckduckgo', 'brave', 'google']);

  const loaded = store.load();
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.proxyUrl, 'socks5://proxy.example:1080');
  assert.equal(loaded.domainCooldownSec, 600);
  assert.equal(loaded.delayMs, 1500);
});

test('rejects invalid research settings', () => {
  const unknownEngine = normalizeResearchSettings({ engineChain: ['google', 'nope'] });
  assert.equal(unknownEngine.ok, false);

  const badTemplate = normalizeResearchSettings({ urlTemplate: 'https://searx.example/search' });
  assert.equal(badTemplate.ok, false);

  const customWithoutTemplate = normalizeResearchSettings({ engineChain: ['custom'] });
  assert.equal(customWithoutTemplate.ok, false);

  const badCooldown = normalizeResearchSettings({ domainCooldownSec: 5 });
  assert.equal(badCooldown.ok, false);

  const badDelay = normalizeResearchSettings({ delayMs: -1 });
  assert.equal(badDelay.ok, false);

  const badProxy = normalizeResearchSettings({ proxyUrl: 'proxy without a scheme' });
  assert.equal(badProxy.ok, false);
});

test('detects WAF and challenge pages', () => {
  assert.equal(looksLikeChallenge(200, 'Please verify you are human'), true);
  assert.equal(looksLikeChallenge(200, 'AWS WAF challenge'), true);
  assert.equal(looksLikeChallenge(200, 'Cloudflare checking your browser'), true);
  assert.equal(looksLikeChallenge(429, ''), true);
  assert.equal(looksLikeChallenge(403, ''), true);
  assert.equal(looksLikeChallenge(200, 'A normal documentation page about requests'), false);
});
