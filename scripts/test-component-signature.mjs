import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSurface, componentSignatureOf } from '../src/main/shadow-walk/component-signature.ts';

test('signature is stable regardless of attribute order', () => {
  const a = normalizeSurface({ tag: 'PAY-WIDGET', defined: true, part: ['card', 'shadow'], exportparts: ['button:pay', 'label:tag'], cssVars: ['--brand', '--radius'] });
  const b = normalizeSurface({ tag: 'pay-widget', defined: true, part: ['shadow', 'card'], exportparts: ['label:tag', 'button:pay'], cssVars: ['--radius', '--brand'] });
  assert.equal(a.signature, b.signature);
  assert.deepEqual(a.part, ['card', 'shadow']);
  assert.match(a.signature, /^pay-widget:[0-9a-f]{8}$/);
});

test('structural changes change the signature', () => {
  const base = normalizeSurface({ tag: 'pay-widget', defined: true, part: ['card'], exportparts: [], cssVars: ['--brand'] });
  const part = normalizeSurface({ tag: 'pay-widget', defined: true, part: ['card-alt'], exportparts: [], cssVars: ['--brand'] });
  const exported = normalizeSurface({ tag: 'pay-widget', defined: true, part: ['card'], exportparts: ['button:pay'], cssVars: ['--brand'] });
  const variable = normalizeSurface({ tag: 'pay-widget', defined: true, part: ['card'], exportparts: [], cssVars: ['--brand', '--radius'] });
  assert.notEqual(base.signature, part.signature);
  assert.notEqual(base.signature, exported.signature);
  assert.notEqual(base.signature, variable.signature);
});

test('the pure hash matches a known surface', () => {
  const surface = normalizeSurface({ tag: 'x-card', defined: true, part: [], exportparts: [], cssVars: [] });
  assert.equal(surface.signature, componentSignatureOf({ tag: 'x-card', defined: true, part: [], exportparts: [], cssVars: [] }));
});
