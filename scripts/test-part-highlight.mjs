import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartHighlightCss } from '../src/main/shadow-walk/part-highlight-css.ts';

test('builds one ::part rule per host/part, deduplicated', () => {
  const css = buildPartHighlightCss([
    { tag: 'X-Card', parts: ['button', 'button', 'label'] },
    { tag: 'x-card', parts: ['button'] },
    { tag: '', parts: ['ignored'] },
  ]);
  assert.match(css, /x-card::part\(button\)/);
  assert.match(css, /x-card::part\(label\)/);
  assert.equal((css.match(/x-card::part\(button\)/g) || []).length, 1);
  assert.doesNotMatch(css, /ignored/);
});

test('an empty host list produces no style text', () => {
  assert.equal(buildPartHighlightCss([]), '');
  assert.equal(buildPartHighlightCss([{ tag: 'x-card', parts: [] }]), '');
});
