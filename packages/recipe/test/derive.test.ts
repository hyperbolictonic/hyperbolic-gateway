import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecipe } from '../src/index.ts';
import type { JsonSchema } from '../src/index.ts';

test('derives a table from a schema array under results', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', title: 'ID' },
            name: { type: 'string' },
            score: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      total: { type: 'integer' },
    },
  };

  const input = { results: [{ id: '1', name: 'A', score: 1, tags: ['x'] }], total: 1 };
  const recipe = deriveRecipe(input, schema, { name: 'Search' });

  assert.equal(recipe.select, '$.results');
  assert.equal(recipe.mode, 'table');
  assert.equal(recipe.name, 'Search');
  assert.deepEqual(
    (recipe.fields as { path: string }[]).map((field) => field.path),
    ['id', 'name', 'score'],
  );
  assert.equal((recipe.fields as { label: string }[])[0].label, 'ID');
});

test('derives a document from an object sample without a schema', () => {
  const recipe = deriveRecipe({ status: 'ok', count: 3, nested: { a: 1 } });

  assert.equal(recipe.select, '$');
  assert.equal(recipe.mode, 'document');
  assert.deepEqual(
    (recipe.fields as { path: string }[]).map((field) => field.path),
    ['status', 'count'],
  );
});

test('uses the first array-valued property as the selection', () => {
  const recipe = deriveRecipe({ total: 2, items: [{ title: 'x' }] });
  assert.equal(recipe.select, '$.items');
  assert.equal(recipe.mode, 'table');
});

test('handles a scalar response', () => {
  const recipe = deriveRecipe('hello');
  assert.equal(recipe.mode, 'table');
  assert.deepEqual(recipe.fields, [{ path: '.', label: 'Value', format: 'text' }]);
});

test('resolves a local $ref in the item schema', () => {
  const schema: JsonSchema = {
    type: 'array',
    $defs: {
      Item: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    items: { $ref: '#/$defs/Item' },
  };

  const recipe = deriveRecipe([{ name: 'x', createdAt: '2026-01-02T03:04:05Z' }], schema);
  const fields = recipe.fields as { path: string; format?: string }[];

  assert.deepEqual(fields.map((field) => field.path), ['name', 'createdAt']);
  assert.equal(fields[1].format, 'date');
});

test('merges allOf properties', () => {
  const schema: JsonSchema = {
    type: 'object',
    allOf: [
      { properties: { a: { type: 'string' } } },
      { properties: { b: { type: 'integer' } } },
    ],
  };

  const recipe = deriveRecipe({ a: 'x', b: 1 }, schema);
  assert.deepEqual(
    (recipe.fields as { path: string }[]).map((field) => field.path),
    ['a', 'b'],
  );
});
