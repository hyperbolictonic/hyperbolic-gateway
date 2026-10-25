import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SHADOW_WALK_SETTINGS,
  ShadowWalkSettingsStore,
  normalizeShadowWalkSettings,
  shadowWalkRefusal,
} from '../src/main/shadow-walk/settings.ts';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuang-shadow-'));
  return { dir, store: new ShadowWalkSettingsStore(path.join(dir, 'shadow-walk.json')) };
}

test('defaults round-trip through the store', () => {
  const { store } = tempStore();
  const saved = store.save(DEFAULT_SHADOW_WALK_SETTINGS);
  assert.equal(saved.ok, true);
  const loaded = store.load();
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.shadow.axSealed, true);
  assert.equal(loaded.frames.maxFrames, 6);
  assert.equal(loaded.shadow.forceOpen, false);
});

test('numbers are clamped and unknown fields keep defaults', () => {
  const { store } = tempStore();
  const saved = store.save({ shadow: { tabWalkMaxSteps: 99 }, frames: { maxFrames: 0, screenshotMaxSide: 99999 } });
  assert.equal(saved.ok, true);
  const loaded = store.load();
  assert.equal(loaded.shadow.tabWalkMaxSteps, 12);
  assert.equal(loaded.frames.maxFrames, 1);
  assert.equal(loaded.frames.screenshotMaxSide, 4096);
  assert.equal(loaded.shadow.axSealed, DEFAULT_SHADOW_WALK_SETTINGS.shadow.axSealed);
});

test('a corrupt file falls back to defaults', () => {
  const { dir } = tempStore();
  const file = path.join(dir, 'shadow-walk.json');
  fs.writeFileSync(file, '{not json', 'utf8');
  const loaded = new ShadowWalkSettingsStore(file).load();
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.shadow.axSealed, true);
});

test('invalid input is rejected', () => {
  const bad = normalizeShadowWalkSettings(null);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /object/);
});

test('the master switch wins over every surface', () => {
  const settings = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  settings.enabled = false;
  for (const surface of ['sealed', 'tabWalk', 'frames', 'deepOpenRoots']) {
    assert.equal(shadowWalkRefusal(surface, settings)?.code, 'SHADOW_WALK_DISABLED');
  }
});

test('per-surface refusals are specific', () => {
  const sealed = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  sealed.shadow.axSealed = false;
  assert.equal(shadowWalkRefusal('sealed', sealed)?.code, 'SEALED_DISABLED');
  assert.equal(shadowWalkRefusal('tabWalk', sealed), null);

  const tab = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  tab.shadow.tabWalk = false;
  assert.equal(shadowWalkRefusal('tabWalk', tab)?.code, 'TAB_WALK_DISABLED');

  const frames = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  frames.frames.geometry = false;
  assert.equal(shadowWalkRefusal('frames', frames)?.code, 'FRAMES_DISABLED');

  const deep = structuredClone(DEFAULT_SHADOW_WALK_SETTINGS);
  deep.shadow.deepOpenRoots = false;
  assert.equal(shadowWalkRefusal('deepOpenRoots', deep)?.code, 'DEEP_OPEN_ROOTS_DISABLED');
});

test('KUANG_SHADOW_WALK=off is an environment kill switch', () => {
  const { store } = tempStore();
  store.save(DEFAULT_SHADOW_WALK_SETTINGS);
  const previous = process.env.KUANG_SHADOW_WALK;
  process.env.KUANG_SHADOW_WALK = 'off';
  try {
    assert.equal(store.load().enabled, false);
  } finally {
    if (previous === undefined) delete process.env.KUANG_SHADOW_WALK;
    else process.env.KUANG_SHADOW_WALK = previous;
  }
});
