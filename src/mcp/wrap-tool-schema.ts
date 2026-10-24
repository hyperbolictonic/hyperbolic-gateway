/**
 * JSON Schema → Zod for generated wrap tools (S4).
 *
 * A wrapper's `inputSchema` is a small JSON-Schema subset (`WrapInputSchema`). The MCP
 * SDK's `registerTool` only accepts Zod (v3 or v4), so generated `wrap_<id>` tools need a
 * deterministic conversion. The executor still re-validates every call against the same
 * JSON Schema in main, so this schema is for the *client's* benefit: typed arguments and a
 * useful `tools/list` entry.
 *
 * Unknown constructs degrade to `z.unknown()` rather than throwing: a wrapper must remain
 * callable even if its schema uses something this converter does not model.
 */
import { z } from 'zod';
import type { WrapInputSchema } from '../main/wrap/types.js';

/** MCP tool names are `^[a-zA-Z0-9_-]{1,128}$`. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

/** Convert a wrapper input schema into a Zod raw shape (one entry per property). */
export function wrapInputToZodShape(schema: WrapInputSchema | undefined): Record<string, z.ZodTypeAny> {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(properties)) {
    let field = wrapPropertyToZod(property);
    if (!required.has(key)) field = field.optional();
    if (property.description) field = field.describe(property.description);
    shape[key] = field;
  }

  return shape;
}

function wrapPropertyToZod(property: WrapInputSchema): z.ZodTypeAny {
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    const literal = literalUnion(property.enum);
    if (literal) return maybeDefault(literal, property);
  }

  const types = property.type === undefined ? [] : Array.isArray(property.type) ? property.type : [property.type];
  const type = types.find((entry) => entry !== 'null') ?? 'string';

  let base: z.ZodTypeAny;
  switch (type) {
    case 'string':
      base = stringSchema(property);
      break;
    case 'number':
      base = numberSchema(property, false);
      break;
    case 'integer':
      base = numberSchema(property, true);
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'array':
      base = arraySchema(property);
      break;
    case 'object': {
      const nested = z.object(wrapInputToZodShape(property));
      base = property.additionalProperties === false ? nested.strict() : nested;
      break;
    }
    default:
      base = z.unknown();
  }

  if (types.includes('null')) base = base.nullable();
  return maybeDefault(base, property);
}

function stringSchema(property: WrapInputSchema): z.ZodTypeAny {
  let schema = z.string();
  if (typeof property.minLength === 'number') schema = schema.min(property.minLength);
  if (typeof property.maxLength === 'number') schema = schema.max(property.maxLength);
  if (typeof property.pattern === 'string' && property.pattern) {
    try {
      schema = schema.regex(new RegExp(property.pattern));
    } catch {
      /* an unparseable pattern is a wrapper bug; do not block the tool */
    }
  }
  return schema;
}

function numberSchema(property: WrapInputSchema, integer: boolean): z.ZodTypeAny {
  let schema = z.number();
  if (integer) schema = schema.int();
  if (typeof property.minimum === 'number') schema = schema.min(property.minimum);
  if (typeof property.maximum === 'number') schema = schema.max(property.maximum);
  return schema;
}

function arraySchema(property: WrapInputSchema): z.ZodTypeAny {
  const item = property.items ? wrapPropertyToZod(property.items) : z.unknown();
  let schema = z.array(item);
  if (typeof property.minItems === 'number') schema = schema.min(property.minItems);
  if (typeof property.maxItems === 'number') schema = schema.max(property.maxItems);
  return schema;
}

/** `z.literal` only supports primitives; anything else degrades to `z.unknown()`. */
function literalUnion(values: unknown[]): z.ZodTypeAny | null {
  const literals: z.ZodTypeAny[] = [];
  for (const value of values) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      literals.push(z.literal(value as never));
    } else {
      return null;
    }
  }
  if (literals.length === 1) return literals[0];
  return z.union(literals as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function maybeDefault(schema: z.ZodTypeAny, property: WrapInputSchema): z.ZodTypeAny {
  if (property.default === undefined) return schema;
  try {
    return schema.default(property.default as never);
  } catch {
    return schema;
  }
}

/**
 * Deterministic MCP-safe name for a wrapper: `wrap_` + id with every character outside
 * `[A-Za-z0-9_-]` replaced by `_`, truncated to 128. Collisions get `_2`, `_3`, … so two
 * ids that sanitise identically (`a.b` / `a-b`) still both work.
 */
export function generatedToolName(id: string, taken: ReadonlySet<string> = new Set()): string {
  const base = `wrap_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 128);
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}_${suffix}`.slice(0, 128);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique tool name for wrapper "${id}".`);
}

/** True when `name` is a legal MCP tool name (exported for tests). */
export function isToolName(name: string): boolean {
  return TOOL_NAME.test(name);
}
