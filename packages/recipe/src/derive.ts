/**
 * Derive a first draft recipe from a response sample and (optionally) its
 * JSON Schema.
 *
 * The result is intentionally conservative: primitive top-level fields, a
 * table for arrays, a document for objects, and a small item cap. A human or
 * an agent can then edit the recipe instead of starting from a blank page.
 */

import type { DeriveOptions, FieldSpec, JsonSchema, Recipe } from './types.ts';
import { humanizeKey } from './path.ts';
import { isPlainObject } from './validate.ts';

const PREFERRED_ARRAY_KEYS = [
  'items',
  'results',
  'data',
  'records',
  'entries',
  'rows',
  'value',
  'values',
  'list',
  'nodes',
  'edges',
];

export function deriveRecipe(input: unknown, schema?: JsonSchema, options: DeriveOptions = {}): Recipe {
  const maxFields = clampInt(options.maxFields ?? 12, 1, 60);
  const rootSchema = schema;

  let select = '$';
  let itemSchema: JsonSchema | undefined;
  let sample: unknown;
  let arraySelected = false;

  if (Array.isArray(input)) {
    arraySelected = true;
    itemSchema = deref(firstItem(schema?.items), rootSchema);
    sample = input[0];
  } else if (isPlainObject(input)) {
    const key = findArrayKey(input, rootSchema);
    if (key) {
      arraySelected = true;
      select = `$.${key}`;
      itemSchema = deref(firstItem(rootSchema?.properties?.[key]?.items), rootSchema);
      sample = (input as Record<string, unknown>)[key];
      if (Array.isArray(sample)) sample = sample[0];
    } else {
      itemSchema = deref(rootSchema, rootSchema);
      sample = input;
    }
  } else {
    itemSchema = deref(rootSchema, rootSchema);
    sample = input;
  }

  const fields = buildFields(itemSchema, sample, maxFields);
  const mode: Recipe['mode'] = arraySelected ? 'table' : isPlainObject(sample) ? 'document' : 'table';

  const recipe: Recipe = {
    schemaVersion: 1,
    select,
    mode,
    fields,
    limits: { maxItems: 50 },
  };

  if (options.id) recipe.id = options.id;
  if (options.name) recipe.name = options.name;
  if (options.description) recipe.description = options.description;

  return recipe;
}

function findArrayKey(input: Record<string, unknown>, schema?: JsonSchema): string | undefined {
  const keys = orderedKeys(input, schema);
  for (const key of keys) {
    const schemaType = typeOf(schema?.properties?.[key]);
    const sample = input[key];
    if (schemaType === 'array' || Array.isArray(sample)) return key;
  }
  return undefined;
}

function orderedKeys(input: Record<string, unknown>, schema?: JsonSchema): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  for (const key of PREFERRED_ARRAY_KEYS) {
    if (key in input || schema?.properties?.[key]) push(key);
  }
  for (const key of Object.keys(schema?.properties || {})) push(key);
  for (const key of Object.keys(input)) push(key);
  return keys;
}

function buildFields(itemSchema: JsonSchema | undefined, sample: unknown, maxFields: number): FieldSpec[] {
  const fields: FieldSpec[] = [];

  if (itemSchema?.properties) {
    const entries = Object.entries(itemSchema.properties);
    if (entries.length > 0) {
      const primitives = entries.filter(([, value]) => isPrimitive(value));
      const chosen = (primitives.length > 0 ? primitives : entries).slice(0, maxFields);
      for (const [key, value] of chosen) {
        const resolved = deref(value, itemSchema);
        fields.push({
          path: key,
          label: resolved?.title || value.title || humanizeKey(key),
          format: formatForSchema(resolved || value),
        });
      }
    }
  } else if (isPlainObject(sample)) {
    const keys = Object.keys(sample);
    const primitives = keys.filter((key) => {
      const value = sample[key];
      return value === null || typeof value !== 'object';
    });
    const chosen = (primitives.length > 0 ? primitives : keys).slice(0, maxFields);
    for (const key of chosen) {
      fields.push({
        path: key,
        label: humanizeKey(key),
        format: formatForSample(sample[key]),
      });
    }
  }

  if (fields.length === 0) {
    fields.push({ path: '.', label: 'Value', format: formatForSample(sample) });
  }

  return fields;
}

function firstItem(items: JsonSchema | JsonSchema[] | undefined): JsonSchema | undefined {
  return Array.isArray(items) ? items[0] : items;
}

function isPrimitive(schema: JsonSchema): boolean {
  const type = typeOf(schema);
  if (type) return type !== 'object' && type !== 'array';
  return !schema.properties && !schema.items && !schema.$ref;
}

function formatForSchema(schema: JsonSchema): FieldSpec['format'] {
  if (schema.format === 'date' || schema.format === 'date-time') return 'date';
  if (schema.format === 'uri' || schema.format === 'url') return 'url';

  switch (typeOf(schema)) {
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'object':
    case 'array':
      return 'json';
    default:
      return 'text';
  }
}

function formatForSample(value: unknown): FieldSpec['format'] {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) return 'json';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'date';
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return 'url';
  return 'text';
}

function typeOf(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null');
  return schema.type;
}

function deref(schema: JsonSchema | undefined, root: JsonSchema | undefined, depth = 0): JsonSchema | undefined {
  if (!schema || depth > 8) return schema;

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (target) return deref(target, root, depth + 1);
  }

  if (schema.allOf && schema.allOf.length > 0) {
    const merged: JsonSchema = { ...schema };
    const properties: Record<string, JsonSchema> = { ...(schema.properties || {}) };
    for (const part of schema.allOf) {
      const resolved = deref(part, root, depth + 1);
      if (resolved?.properties) Object.assign(properties, resolved.properties);
      if (resolved?.type && merged.type === undefined) merged.type = resolved.type;
      if (resolved?.items && merged.items === undefined) merged.items = resolved.items;
    }
    delete merged.allOf;
    if (Object.keys(properties).length > 0) merged.properties = properties;
    return merged;
  }

  if (schema.oneOf?.length) return deref(schema.oneOf[0], root, depth + 1);
  if (schema.anyOf?.length) return deref(schema.anyOf[0], root, depth + 1);

  return schema;
}

function resolveRef(ref: string, root: JsonSchema | undefined): JsonSchema | undefined {
  if (!root || !ref.startsWith('#/')) return undefined;

  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current && typeof current === 'object' ? (current as JsonSchema) : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
