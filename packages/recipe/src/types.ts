/**
 * The recipe format.
 *
 * A recipe is deliberately data, not code. It names a place in the response
 * (`select`), the fields to show, and (optionally) a Markdown template. It is
 * safe to store, diff, send over MCP, and reuse across wrappers.
 *
 * The format is versioned with `schemaVersion`. Version 1 is the only version
 * this package understands; unknown properties are preserved by callers but
 * ignored by the renderer so that newer recipes do not break older readers.
 */

export type RecipeMode = 'table' | 'document' | 'documents';

export type FieldFormat =
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'url'
  | 'image'
  | 'json'
  | 'code';

export interface FieldSpec {
  /** JSON path relative to the selected item. Use `.` for the item itself. */
  path: string;
  /** Column heading or document label. Defaults to a humanised path. */
  label?: string;
  format?: FieldFormat;
  /** Literal text used when the path is missing or empty. */
  fallback?: string;
  prefix?: string;
  suffix?: string;
  /** Per-field character cap. Defaults to `limits.maxFieldChars`. */
  maxChars?: number;
}

export interface RecipeLimits {
  /** Maximum items rendered from the selection. Default 50. */
  maxItems?: number;
  /** Maximum characters in the whole Markdown result. Default 100000. */
  maxChars?: number;
  /** Maximum characters in one table cell or field. Default 500. */
  maxFieldChars?: number;
}

export interface PaginationSpec {
  type: 'none' | 'cursor' | 'offset' | 'link';
  /** Path to the next cursor/token in the response. */
  next?: string;
  /** Path to a boolean or array length that says another page exists. */
  hasMore?: string;
  /** Query parameter that carries the cursor. */
  cursorParam?: string;
  /** Query parameter that carries the offset. */
  offsetParam?: string;
  /** Query parameter that carries the page size. */
  limitParam?: string;
  /** Path to the next page URL (for `type: "link"`). */
  nextUrl?: string;
  /** Default page size, if the API supports one. */
  pageSize?: number;
}

/**
 * A response recipe. The wrapper adds the request, auth reference, and input
 * schema around it; this object only describes how to turn JSON into Markdown.
 */
export interface Recipe {
  schemaVersion: 1;
  id?: string;
  name?: string;
  description?: string;
  /** Path to the array or object to render. Default `$` (the whole response). */
  select?: string;
  /** Defaults to `table` for arrays and `document` for objects. */
  mode?: RecipeMode;
  /**
   * Ordered fields. An object keeps insertion order and uses its keys as
   * labels; an array allows explicit labels and per-field formats.
   */
  fields?: Record<string, string | FieldSpec> | FieldSpec[];
  /**
   * The structured projection returned alongside the Markdown. Keys are stable
   * record names; values are paths. Use this for querying, storing, or
   * returning `format: "json"` without parsing the rendered text.
   *
   * When omitted, the record keys follow `fields` (labels), or are inferred
   * from the selected item.
   */
  record?: Record<string, string>;
  /**
   * Markdown template for `document` and `documents` modes.
   *
   * Supports `{{path}}`, `{{#if path}}...{{else}}...{{/if}}`,
   * `{{#unless path}}...{{/unless}}`, `{{#each path}}...{{/each}}`,
   * `{{.}}`, `{{@index}}`, `{{@number}}`, `{{@count}}`, and `{{@key}}`.
   * There is no expression language and no code execution.
   */
  template?: string;
  /** Per-item heading template for `documents` mode. */
  title?: string;
  limits?: RecipeLimits;
  pagination?: PaginationSpec;
  /**
   * Opt-in post-render indexing. `'cortex'` asks the executor to store the rendered
   * document(s) in the local Cortex so `recall_memory` can find them later. The pure
   * renderer ignores this field; only the wrapper executor acts on it.
   */
  index?: 'none' | 'cortex';
  /** Human/agent notes. Never rendered. */
  notes?: string;
}

export interface RenderOptions {
  /** Hard ceiling for this render, regardless of the recipe. */
  maxItems?: number;
  maxChars?: number;
  /** Set false when the caller supplies its own heading. Default true. */
  includeTitle?: boolean;
}

export interface RenderMeta {
  mode: RecipeMode;
  select: string;
  /** Number of items the selection produced. */
  selected: number;
  /** Number of items actually rendered. */
  rendered: number;
  /** True when items or characters were dropped. */
  truncated: boolean;
  chars: number;
}

export interface RenderedDocument {
  /** Heading used for this document, if any. */
  title: string;
  /** The rendered Markdown for this document. */
  markdown: string;
  /** The structured record behind this document, when it has one. */
  record?: Record<string, unknown>;
}

export interface RenderResult {
  /** The complete Markdown output, documents joined by horizontal rules. */
  markdown: string;
  /** One entry per document. A table render produces a single entry. */
  documents: RenderedDocument[];
  /** One structured record per rendered item, with original JSON types. */
  records: Record<string, unknown>[];
  meta: RenderMeta;
}

/** A minimal JSON Schema shape, enough to derive a first recipe. */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
}

export interface DeriveOptions {
  id?: string;
  name?: string;
  description?: string;
  /** Maximum inferred columns. Default 12. */
  maxFields?: number;
}
