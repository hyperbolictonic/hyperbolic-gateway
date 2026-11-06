import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampZoomFactor,
  DEFAULT_ZOOM_SETTINGS,
  nextZoomStep,
  normalizeZoomSettings,
} from '../src/shared/zoom.ts';

test('zoom settings default to display compensation', () => {
  assert.deepEqual(normalizeZoomSettings(null), DEFAULT_ZOOM_SETTINGS);
  assert.equal(normalizeZoomSettings({ mode: 'native' }).mode, 'native');
  assert.equal(normalizeZoomSettings({ mode: 'nonsense' }).mode, 'compensate');
});

test('zoom steps skip the fitted 0.667 -> 0.67 no-op', () => {
  assert.equal(nextZoomStep(2 / 3, 'in'), 0.75);
  assert.equal(nextZoomStep(2 / 3, 'out'), 0.5);
  assert.equal(nextZoomStep(1, 'in'), 1.1);
  assert.equal(nextZoomStep(1, 'out'), 0.9);
});

test('zoom factors are clamped to the supported range', () => {
  assert.equal(clampZoomFactor(0.01), 0.25);
  assert.equal(clampZoomFactor(99), 5);
  assert.equal(clampZoomFactor(1.25), 1.25);
});
