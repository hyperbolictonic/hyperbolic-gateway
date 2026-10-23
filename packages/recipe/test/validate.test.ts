import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecipe, validateRecipe, RecipeError } from '../src/index.ts';

test('accepts a valid recipe', () => {
  const result = validateRecipe({
    schemaVersion: 1,
    select: '$.items[*]',
    mode: 'table',
    fields: { Name: 'name', Score: { path: 'score', format: 'number' } },
    limits: { maxItems: 10 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.recipe.select, '$.items[*]');
  assert.equal(result.errors.length, 0);
});

test('rejects an unknown schema version and mode', () => {
  const result = validateRecipe({ schemaVersion: 2, mode: 'cards' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('schemaVersion')));
  assert.ok(result.errors.some((error) => error.includes('mode')));
});

test('rejects fields without a path', () => {
  const result = validateRecipe({ schemaVersion: 1, fields: [{ label: 'Name' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('fields[0].path')));
});

test('rejects non-positive limits and unknown formats', () => {
  const result = validateRecipe({
    schemaVersion: 1,
    fields: { Name: { path: 'name', format: 'sparkles' } },
    limits: { maxItems: 0 },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('limits.maxItems')));
  assert.ok(result.errors.some((error) => error.includes('format')));
});

test('render throws a RecipeError for an invalid recipe', () => {
  assert.throws(
    () => renderRecipe({}, { schemaVersion: 1, mode: 'nope' as never }),
    (error: unknown) => error instanceof RecipeError && error.errors.length > 0,
  );
});

test('treats an empty select as the whole response but keeps a default', () => {
  const result = validateRecipe({ schemaVersion: 1, select: '' });
  assert.equal(result.ok, true);
  assert.equal(result.recipe.select, undefined);
});
