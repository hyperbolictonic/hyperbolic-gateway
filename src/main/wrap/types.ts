/**
 * Kuang Wrap — the saved REST wrapper format.
 *
 * A wrapper is the deterministic half of an API call: a fixed endpoint, a
 * typed input schema, and a request template. The agent supplies only the
 * semantic arguments; this module never lets it assemble a URL, headers, or a
 * body envelope.
 */

import type { Recipe, RenderedDocument, RenderMeta } from '../../../packages/recipe/src/index.ts';

export type WrapMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type WrapFormat = 'markdown' | 'json' | 'both';

/** The subset of JSON Schema used by wrapper inputs. */
export interface WrapInputSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  properties?: Record<string, WrapInputSchema>;
  required?: string[];
  items?: WrapInputSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  additionalProperties?: boolean;
  default?: unknown;
}

export interface WrapRequest {
  /** Primary/default method. */
  method: WrapMethod;
  /** Allowed methods when the wrapper accepts more than one; `method` is the default. */
  methods?: WrapMethod[];
  /** Absolute URL; path/query placeholders use `{{name}}`. In the URL only, `{{name|raw}}` preserves slash-separated path segments. */
  url: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** JSON-shaped template tree, or a string for `bodyFormat: "text"`. */
  body?: unknown;
  bodyFormat?: 'json' | 'form' | 'text';
  /** Secret name; the value is resolved in main and bound to allowed hosts. */
  auth?: string;
  /** Per-request timeout. Default 15000 ms, capped at 60000. */
  timeoutMs?: number;
}

export interface WrapWrapper {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  request: WrapRequest;
  inputSchema?: WrapInputSchema;
  response?: Recipe;
  /** Opt-in generated MCP tool. Dynamic tools arrive in a later slice. */
  exposeAsTool?: boolean;
  /** Defaults to true for POST/PUT/PATCH/DELETE, false for GET/HEAD. */
  mutating?: boolean;
  lastVerified?: string;
  notes?: string;
}

export interface WrapManifestEntry {
  id: string;
  name: string;
  description?: string;
  method: WrapMethod;
  methods?: WrapMethod[];
  host: string;
  mutating: boolean;
  required: string[];
  exposeAsTool: boolean;
  /** Secret name, never its value. */
  secret?: string;
  /** ISO timestamp of the last successful live run, if any. */
  lastVerified?: string;
}

export interface WrapPreview {
  method: WrapMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface WrapErrorInfo {
  code: string;
  message: string;
  status?: number;
  field?: string;
  retryable?: boolean;
}

export interface WrapResponseInfo {
  contentType?: string;
  bytes: number;
  /** Present only when `includeRaw` is requested. */
  json?: unknown;
  /** Short text excerpt for errors and non-JSON responses. */
  text?: string;
  truncated?: boolean;
}

export interface WrapIndexed {
  /** How many rendered documents were handed to Cortex. */
  documents: number;
  /** Chunks actually written (0 when skipped or failed). */
  chunks: number;
  /** Present when indexing was attempted but failed; the call itself still succeeds. */
  error?: string;
}

export interface WrapRunResult {
  ok: boolean;
  dryRun?: boolean;
  status?: number;
  durationMs?: number;
  wrapper: { id: string; name: string };
  request?: WrapPreview;
  response?: WrapResponseInfo;
  markdown: string;
  records: Record<string, unknown>[];
  documents?: RenderedDocument[];
  meta?: RenderMeta;
  /** Present only when the recipe declares pagination (or a call overrides the page cap). */
  paging?: { pages: number; cap: number; more: boolean };
  /** Present when the recipe opted into Cortex indexing (`response.index: "cortex"`). */
  indexed?: WrapIndexed;
  error?: WrapErrorInfo;
}
