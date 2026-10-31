import assert from 'node:assert/strict';
import { JevEngine } from '../src/main/jev/engine.ts';

const markdown = [
  'Intro paragraph before any heading. It is declarative.',
  '',
  '## Overview & Base URLs',
  'The API lives at api.example.com over TLS. Use HTTPS only.',
  '',
  '### Generating API Keys',
  'Keys are created in the dashboard and scoped per project.',
  '',
  '### Token Rotation',
  'Rotate bearer tokens every ninety days.',
  '',
  '## Rate Limits',
  'HTTP 429 responses include a Retry-After header.',
  '',
  '### Backoff',
  'Use exponential backoff starting at one second.',
].join('\n');

const engine = new JevEngine();
const session = engine.build(markdown, 'https://api.example.com/docs', 'API Guide');
assert.equal(session.url, 'https://api.example.com/docs');
assert.ok(session.order.length >= 5, `expected several sections, got ${session.order.join(',')}`);

// Nested numbering: a subsection of the second top-level heading.
const nested = session.order.find((id) => id.startsWith('sec_') && id.includes('.'));
assert.ok(nested, 'expected at least one nested section id');

const index = engine.renderIndex();
assert.match(index, /JEV_SURFACE_INDEX/);
assert.match(index, /\[sec_0\]/);
assert.match(index, /Tokens:/);
assert.match(index, /Summary:/);
assert.match(index, /read_section/);

const section = engine.readSection('sec_0');
assert.equal(section.ok, true);
assert.match(section.content, /Intro paragraph/);

const missing = engine.readSection('sec_99');
assert.equal(missing.ok, false);
assert.match(missing.error, /Unknown section_id/);

const found = engine.search('Retry-After');
assert.equal(found.ok, true);
assert.ok(found.hits.some((hit) => hit.snippet.includes('Retry-After')), 'search should return a snippet');

const none = engine.search('zzz-not-present-zzz');
assert.equal(none.ok, true);
assert.deepEqual(none.hits, []);

// Expansion accounting: a very large section crosses the fold ceiling.
const big = engine.build(
  ['## Huge Section', 'x'.repeat(26_000)].join('\n'),
  'https://example.com/big',
  'Big',
);
assert.equal(big.order.length, 1);
const readBig = engine.readSection('sec_0');
assert.equal(readBig.ok, true);
assert.ok(Array.isArray(readBig.folded) && readBig.folded.length > 0, 'expected auto-fold hints past the ceiling');

// Purge drops the depth store.
engine.purge();
assert.equal(engine.current, null);
assert.equal(engine.readSection('sec_0').ok, false);

console.log('jev engine passed');
