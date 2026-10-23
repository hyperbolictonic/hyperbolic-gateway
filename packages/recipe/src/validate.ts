/**
 * Recipe validation and normalisation.
 *
 * Validation is intentionally forgiving about unknown properties (so a newer
 * producer can add fields) but strict about the shape the renderer relies on.
 * Every error names the path that is wrong.
 */

import type { FieldFormat, FieldSpec, PaginationSpec, Recipe, RecipeLimits } from './types.ts';

const MODES = new Set(['table', 'document', 'documents']);
const FORMATS = new Set(['text', 'number', 'integer', 'boolean', 'date', 'url', 'image', 'json', 'code']);
const PAGINATION_TYPES = new Set(['none', 'cursor', 'offset', 'link']);

export class RecipeError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid recipe: ${errors.join('; ')}`);
    this.name = 'RecipeError';
    this.errors = errors;
  }
}

export function validateRecipe(
  input: unknown,
): { ok: true; recipe: Recipe; errors: [] } | { ok: false; recipe: Recipe; errors: string[] } {
  const { recipe, errors } = normalizeRecipe(input);
  return errors.length === 0 ? { ok: true, recipe, errors: [] } : { ok: false, recipe, errors };
}

export function normalizeRecipe(input: unknown): { recipe: Recipe; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { recipe: { schemaVersion: 1 }, errors: ['recipe must be an object'] };
  }

  const source = input as Record<string, unknown>;
  const recipe: Recipe = { schemaVersion: 1 };

  if (source.schemaVersion !== undefined && source.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  for (const key of ['id', 'name', 'description', 'select', 'template', 'title', 'notes'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      errors.push(`${key} must be a string`);
      continue;
    }
    if (value.length > 0) recipe[key] = value;
  }

  if (source.mode !== undefined) {
    if (typeof source.mode !== 'string' || !MODES.has(source.mode)) {
      errors.push('mode must be one of table, document, documents');
    } else {
      recipe.mode = source.mode as Recipe['mode'];
    }
  }

  const fields = normalizeFields(source.fields, errors);
  if (fields) recipe.fields = fields;

  const record = normalizeRecord(source.record, errors);
  if (record) recipe.record = record;

  const limits = normalizeLimits(source.limits, errors);
  if (limits) recipe.limits = limits;

  const pagination = normalizePagination(source.pagination, errors);
  if (pagination) recipe.pagination = pagination;

  return { recipe, errors };
}

function normalizeFields(input: unknown, errors: string[]): Recipe['fields'] | undefined {
  if (input === undefined) return undefined;

  if (Array.isArray(input)) {
    const out: FieldSpec[] = [];
    input.forEach((entry, index) => {
      if (typeof entry === 'string') {
        out.push({ path: entry });
        return;
      }
      const spec = normalizeField(entry, `fields[${index}]`, errors);
      if (spec) out.push(spec);
    });
    return out;
  }

  if (isPlainObject(input)) {
    const out: Record<string, string | FieldSpec> = {};
    for (const [label, entry] of Object.entries(input)) {
      if (typeof entry === 'string') {
        out[label] = entry;
        continue;
      }
      const spec = normalizeField(entry, `fields.${label}`, errors);
      if (spec) out[label] = spec;
    }
    return out;
  }

  errors.push('fields must be an object or an array');
  return undefined;
}

function normalizeRecord(input: unknown, errors: string[]): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    errors.push('record must be an object');
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`record.${key} must be a non-empty path string`);
      continue;
    }
    out[key] = value;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeField(input: unknown, where: string, errors: string[]): FieldSpec | undefined {
  if (!isPlainObject(input)) {
    errors.push(`${where} must be an object`);
    return undefined;
  }

  const source = input as Record<string, unknown>;
  if (typeof source.path !== 'string' || source.path.length === 0) {
    errors.push(`${where}.path must be a non-empty string`);
    return undefined;
  }

  const spec: FieldSpec = { path: source.path };

  if (source.label !== undefined) {
    if (typeof source.label !== 'string') errors.push(`${where}.label must be a string`);
    else spec.label = source.label;
  }

  if (source.format !== undefined) {
    if (typeof source.format !== 'string' || !FORMATS.has(source.format)) {
      errors.push(`${where}.format is not recognised`);
    } else {
      spec.format = source.format as FieldFormat;
    }
  }

  for (const key of ['fallback', 'prefix', 'suffix'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') errors.push(`${where}.${key} must be a string`);
    else spec[key] = value;
  }

  if (source.maxChars !== undefined) {
    if (typeof source.maxChars !== 'number' || !Number.isFinite(source.maxChars) || source.maxChars <= 0) {
      errors.push(`${where}.maxChars must be a positive number`);
    } else {
      spec.maxChars = Math.floor(source.maxChars);
    }
  }

  return spec;
}

function normalizeLimits(input: unknown, errors: string[]): RecipeLimits | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    errors.push('limits must be an object');
    return undefined;
  }

  const source = input as Record<string, unknown>;
  const limits: RecipeLimits = {};

  for (const key of ['maxItems', 'maxChars', 'maxFieldChars'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`limits.${key} must be a positive number`);
    } else {
      limits[key] = Math.floor(value);
    }
  }

  return Object.keys(limits).length > 0 ? limits : undefined;
}

function normalizePagination(input: unknown, errors: string[]): PaginationSpec | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    errors.push('pagination must be an object');
    return undefined;
  }

  const source = input as Record<string, unknown>;
  const pagination: PaginationSpec = { type: 'none' };

  if (source.type !== undefined) {
    if (typeof source.type !== 'string' || !PAGINATION_TYPES.has(source.type)) {
      errors.push('pagination.type must be none, cursor, offset, or link');
    } else {
      pagination.type = source.type as PaginationSpec['type'];
    }
  }

  for (const key of ['next', 'hasMore', 'cursorParam', 'offsetParam', 'limitParam', 'nextUrl'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') errors.push(`pagination.${key} must be a string`);
    else pagination[key] = value;
  }

  if (source.pageSize !== undefined) {
    if (typeof source.pageSize !== 'number' || !Number.isFinite(source.pageSize) || source.pageSize <= 0) {
      errors.push('pagination.pageSize must be a positive number');
    } else {
      pagination.pageSize = Math.floor(source.pageSize);
    }
  }

  return pagination;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
