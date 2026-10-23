/**
 * A small JSON Schema validator for wrapper inputs.
 *
 * This is intentionally a subset: objects, arrays, strings, numbers, booleans,
 * null, enums, ranges, lengths, and patterns. It is enough for an MCP input
 * schema and it rejects stringified numbers, which keeps request bodies
 * deterministic. No coercion happens here.
 */

import type { WrapInputSchema } from './types.ts';

export interface ArgsValidation {
  ok: boolean;
  value: Record<string, unknown>;
  errors: string[];
  field?: string;
}

export function validateArgs(schema: WrapInputSchema | undefined, input: unknown): ArgsValidation {
  const errors: string[] = [];

  if (input === undefined || input === null) input = {};
  if (!isPlainObject(input)) {
    return { ok: false, value: {}, errors: ['args must be an object'], field: 'args' };
  }

  const value: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const effective = schema && Object.keys(schema).length > 0 ? schema : { type: 'object', additionalProperties: true };

  applyDefaults(value, effective);
  validateValue(value, effective, 'args', errors);

  return {
    ok: errors.length === 0,
    value,
    errors,
    field: errors.length > 0 ? firstField(errors[0]) : undefined,
  };
}

function applyDefaults(value: Record<string, unknown>, schema: WrapInputSchema): void {
  if (!schema.properties) return;
  for (const [key, property] of Object.entries(schema.properties)) {
    if (value[key] === undefined && property.default !== undefined) {
      value[key] = clone(property.default);
    }
  }
}

function validateValue(value: unknown, schema: WrapInputSchema, path: string, errors: string[]): void {
  if (value === undefined) return;

  if (schema.enum && !schema.enum.some((candidate) => sameValue(candidate, value))) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }

  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path} must be ${types.join(' or ')}`);
    return;
  }

  if (value === null) return;

  if (typeof value === 'object' && !Array.isArray(value)) {
    validateObject(value as Record<string, unknown>, schema, path, errors);
    return;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items as WrapInputSchema, `${path}[${index}]`, errors));
    }
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
      } catch {
        // A malformed pattern is a wrapper bug; don't reject the caller for it.
      }
    }
    return;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: WrapInputSchema,
  path: string,
  errors: string[],
): void {
  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const key of required) {
    if (value[key] === undefined) errors.push(`${path}.${key} is required`);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) errors.push(`${path}.${key} is not a recognised argument`);
    }
  }

  for (const [key, child] of Object.entries(properties)) {
    if (value[key] === undefined) continue;
    validateValue(value[key], child, `${path}.${key}`, errors);
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function firstField(error: string): string | undefined {
  const match = error.match(/^args(?:\.([A-Za-z0-9_]+))?/);
  return match ? match[1] : undefined;
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
