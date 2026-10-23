import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecipe } from '../src/index.ts';
import type { Recipe } from '../src/index.ts';

test('renders a mapped table and escapes pipes', () => {
  const input = {
    results: [
      { name: 'A', score: 10, url: 'https://a.test' },
      { name: 'B|C', score: 2, url: 'https://b.test' },
    ],
  };

  const recipe: Recipe = {
    schemaVersion: 1,
    name: 'Scores',
    select: '$.results[*]',
    mode: 'table',
    fields: {
      Name: 'name',
      Score: { path: 'score', format: 'number' },
      Link: { path: 'url', format: 'url' },
    },
  };

  const result = renderRecipe(input, recipe);

  assert.equal(
    result.markdown,
    [
      '## Scores',
      '',
      '| Name | Score | Link |',
      '| --- | --- | --- |',
      '| A | 10 | <https://a.test> |',
      '| B\\|C | 2 | <https://b.test> |',
    ].join('\n'),
  );
  assert.equal(result.meta.selected, 2);
  assert.equal(result.meta.rendered, 2);
  assert.equal(result.meta.truncated, false);
  assert.deepEqual(result.records, [
    { Name: 'A', Score: 10, Link: 'https://a.test' },
    { Name: 'B|C', Score: 2, Link: 'https://b.test' },
  ]);
});

test('uses an explicit record projection with original types', () => {
  const result = renderRecipe(
    { results: [{ id: 1, name: 'A', price: { amount: 12, currency: 'GBP' } }] },
    {
      schemaVersion: 1,
      select: '$.results[*]',
      fields: { Name: 'name', Price: { path: 'price.amount', format: 'number' } },
      record: { id: 'id', name: 'name', amount: 'price.amount', currency: 'price.currency', missing: 'nope' },
    },
  );

  assert.deepEqual(result.records, [{ id: 1, name: 'A', amount: 12, currency: 'GBP' }]);
});

test('infers columns for an array of objects', () => {
  const result = renderRecipe(
    { items: [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }] },
    { schemaVersion: 1, select: '$.items[*]' },
  );

  assert.match(result.markdown, /\| Id \| Title \|/);
  assert.match(result.markdown, /\| 1 \| First \|/);
  assert.match(result.markdown, /\| 2 \| Second \|/);
});

test('renders a table of scalars', () => {
  const result = renderRecipe(['alpha', 'beta'], { schemaVersion: 1 });
  assert.equal(result.markdown, ['| Value |', '| --- |', '| alpha |', '| beta |'].join('\n'));
});

test('renders documents with title, if, and each', () => {
  const input = {
    items: [
      { name: 'Alpha', tags: ['a', 'b'], meta: { live: true }, body: 'first' },
      { name: 'Beta', tags: [], meta: { live: false }, body: 'second' },
    ],
  };

  const recipe: Recipe = {
    schemaVersion: 1,
    select: '$.items[*]',
    mode: 'documents',
    title: '{{name}}',
    template:
      '## {{name}}\n\n{{#if meta.live}}**Live**\n\n{{/if}}{{#each tags}}- {{.}}\n{{/each}}\n\n{{body}}\n\nItem {{@number}} of {{@count}}.',
  };

  const result = renderRecipe(input, recipe);

  assert.equal(result.documents.length, 2);
  assert.match(result.documents[0].markdown, /^## Alpha/);
  assert.match(result.documents[0].markdown, /\*\*Live\*\*/);
  assert.match(result.documents[0].markdown, /- a\n- b/);
  assert.match(result.documents[0].markdown, /Item 1 of 2/);
  assert.doesNotMatch(result.documents[1].markdown, /\*\*Live\*\*/);
  assert.match(result.documents[1].markdown, /Item 2 of 2/);
  assert.match(result.markdown, /\n\n---\n\n/);
  assert.equal(result.meta.mode, 'documents');
  assert.deepEqual(result.records[0], {
    name: 'Alpha',
    tags: ['a', 'b'],
    meta: { live: true },
    body: 'first',
  });
});

test('renders a single document with inferred fields', () => {
  const result = renderRecipe(
    { name: 'Widget', price: 12.5, available: true },
    { schemaVersion: 1, mode: 'document' },
  );

  assert.match(result.markdown, /^## Result/);
  assert.match(result.markdown, /- \*\*Name:\*\* Widget/);
  assert.match(result.markdown, /- \*\*Price:\*\* 12.5/);
  assert.match(result.markdown, /- \*\*Available:\*\* true/);
  assert.equal(result.documents.length, 1);
});

test('reports item truncation', () => {
  const input = Array.from({ length: 5 }, (_, index) => ({ n: index }));
  const result = renderRecipe(input, { schemaVersion: 1, limits: { maxItems: 2 } });

  assert.equal(result.meta.selected, 5);
  assert.equal(result.meta.rendered, 2);
  assert.equal(result.meta.truncated, true);
  assert.match(result.markdown, /_Showing 2 of 5 items\._/);
});

test('caps a collection of documents as a whole', () => {
  const input = Array.from({ length: 5 }, (_, index) => ({
    name: `Item ${index}`,
    body: 'x'.repeat(500),
  }));

  const result = renderRecipe(
    { items: input },
    {
      schemaVersion: 1,
      select: '$.items[*]',
      mode: 'documents',
      title: '{{name}}',
      template: '{{body}}',
      limits: { maxChars: 1200 },
    },
  );

  assert.equal(result.meta.truncated, true);
  assert.ok(result.markdown.length <= 1200);
  assert.ok(result.documents.length >= 1);
  assert.ok(result.documents.every((document) => document.markdown.length <= 1200));
});

test('caps total characters and says so', () => {
  const result = renderRecipe(
    { text: 'x'.repeat(2000) },
    { schemaVersion: 1, mode: 'document', limits: { maxChars: 600, maxFieldChars: 2000 } },
  );

  assert.equal(result.meta.truncated, true);
  assert.ok(result.markdown.length <= 600);
  assert.match(result.markdown, /truncated \d+ characters/);
});

test('applies fallback, prefix, suffix, and per-field cap', () => {
  const result = renderRecipe(
    { rows: [{ name: 'ABCDEF' }] },
    {
      schemaVersion: 1,
      select: '$.rows[*]',
      fields: {
        Name: 'name',
        Price: { path: 'price', format: 'number', fallback: 'n/a', prefix: '$', suffix: ' USD' },
        Long: { path: 'name', maxChars: 4 },
      },
    },
  );

  assert.match(result.markdown, /\| ABCDEF \| \$n\/a USD \| ABC… \|/);
});

test('filters an array with a path predicate', () => {
  const result = renderRecipe(
    { items: [{ score: 1 }, { score: 9 }, { score: 5 }] },
    { schemaVersion: 1, select: '$.items[?score>5]', fields: { Score: 'score' } },
  );

  assert.match(result.markdown, /\| 9 \|/);
  assert.doesNotMatch(result.markdown, /\| 5 \|/);
  assert.doesNotMatch(result.markdown, /\| 1 \|/);
});

test('renders an empty selection without throwing', () => {
  const result = renderRecipe({ items: [] }, { schemaVersion: 1, select: '$.items[*]' });
  assert.equal(result.markdown, '_No items matched._');
  assert.equal(result.meta.selected, 0);
});

test('renders an object as a key/value table when no fields are configured', () => {
  const result = renderRecipe(
    { status: 'ok', count: 3, nested: { a: 1 } },
    { schemaVersion: 1, mode: 'table' },
  );

  assert.match(result.markdown, /\| Field \| Value \|/);
  assert.match(result.markdown, /\| \*\*status\*\* \| ok \|/);
  assert.match(result.markdown, /\| \*\*nested\*\* \| `\{"a":1\}` \|/);
});
