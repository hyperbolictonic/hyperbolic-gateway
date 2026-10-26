/**
 * Deterministic request construction.
 *
 * The wrapper author writes the shape once:
 *
 *   "body": { "customer": "{{customer_id}}", "line_items": "{{items}}" }
 *
 * The agent supplies `customer_id` and `items`. A placeholder that occupies a
 * whole string keeps the argument's JSON type (an array stays an array); an
 * embedded placeholder is string interpolation. Missing optional values are
 * omitted, never sent as the string "undefined".
 */

import { resolvePath } from '../../../packages/recipe/src/index.ts';
import type { WrapMethod, WrapRequest, WrapWrapper } from './types.ts';

export class BuildRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BuildRequestError';
    this.code = code;
  }
}

export interface BuiltRequest {
  method: WrapMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyFormat?: 'json' | 'form' | 'text';
}

const WHOLE_PLACEHOLDER = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const RAW_PATH_SUFFIX = /^(.*?)\s*\|\s*raw$/i;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

interface Placeholder {
  name: string;
  rawPath: boolean;
}

function parsePlaceholder(expression: string): Placeholder {
  const trimmed = expression.trim();
  const raw = trimmed.match(RAW_PATH_SUFFIX);
  if (raw && raw[1].trim()) return { name: raw[1].trim(), rawPath: true };
  return { name: trimmed, rawPath: false };
}

const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
]);

export function buildRequest(wrapper: WrapWrapper, args: Record<string, unknown>): BuiltRequest {
  const request = wrapper.request;
  const allowedMethods = request.methods?.length ? request.methods : [request.method];
  const requested =
    request.methods && request.methods.length > 1 && args.method !== undefined
      ? String(args.method).toUpperCase()
      : request.method;
  const method = requested as WrapMethod;

  if (!METHODS.has(method) || !allowedMethods.includes(method)) {
    throw new BuildRequestError(
      'METHOD_NOT_ALLOWED',
      `Method "${requested}" is not allowed; use one of ${allowedMethods.join(', ')}.`,
    );
  }

  const rawUrl = interpolateText(request.url, args, true, true);
  if (!rawUrl || rawUrl.includes('{{')) {
    throw new BuildRequestError('UNRESOLVED_TEMPLATE', `The URL still contains a placeholder: "${rawUrl}".`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BuildRequestError('INVALID_URL', `"${rawUrl}" is not a valid URL after interpolation.`);
  }

  for (const [key, template] of Object.entries(request.query || {})) {
    const value = interpolateValue(template, args);
    if (value === undefined || value === null) continue;
    appendQuery(url, key, value);
  }

  const headers = buildHeaders(request, args, method);
  const body = buildBody(request, args, method);

  if (body !== undefined && !hasHeader(headers, 'content-type')) {
    const format = bodyFormatOf(request);
    headers['Content-Type'] =
      format === 'json' ? 'application/json' : format === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8';
  }

  return {
    method,
    url: url.toString(),
    headers,
    body,
    bodyFormat: body === undefined ? undefined : bodyFormatOf(request),
  };
}

export function redactHeaders(headers: Record<string, string>, extraSensitive: string[] = []): Record<string, string> {
  const sensitive = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'apikey',
    'x-auth-token',
    'x-access-token',
    ...extraSensitive.map((name) => name.toLowerCase()),
  ]);
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = sensitive.has(key.toLowerCase()) ? '<redacted>' : value;
  }
  return redacted;
}

function buildHeaders(request: WrapRequest, args: Record<string, unknown>, method: WrapMethod): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, template] of Object.entries(request.headers || {})) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower)) {
      throw new BuildRequestError('FORBIDDEN_HEADER', `Header "${name}" cannot be set by a wrapper.`);
    }
    const value = interpolateText(template, args, false);
    if (value === '') continue;
    headers[name] = value;
  }

  if (method === 'GET' || method === 'HEAD') {
    // A body on these is almost always a mistake; fail loudly rather than let
    // fetch silently ignore it.
    if (request.body !== undefined) throw new BuildRequestError('BODY_NOT_ALLOWED', `${method} requests cannot have a body.`);
  }

  return headers;
}

function buildBody(request: WrapRequest, args: Record<string, unknown>, method: WrapMethod): string | undefined {
  if (method === 'GET' || method === 'HEAD' || request.body === undefined) return undefined;

  const value = interpolateValue(request.body, args);
  if (value === undefined) return undefined;

  const format = bodyFormatOf(request);

  if (format === 'json') {
    try {
      return JSON.stringify(value);
    } catch {
      throw new BuildRequestError('INVALID_BODY', 'The request body could not be serialised as JSON.');
    }
  }

  if (format === 'form') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const params = new URLSearchParams();
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        appendForm(params, key, entry);
      }
      return params.toString();
    }
    return stringifyForTemplate(value);
  }

  return stringifyForTemplate(value);
}

function bodyFormatOf(request: WrapRequest): 'json' | 'form' | 'text' {
  if (request.bodyFormat) return request.bodyFormat;
  return typeof request.body === 'string' ? 'text' : 'json';
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function appendQuery(url: URL, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    url.searchParams.delete(key);
    for (const item of value) {
      if (item === undefined || item === null) continue;
      url.searchParams.append(key, stringifyForTemplate(item));
    }
    return;
  }
  url.searchParams.set(key, stringifyForTemplate(value));
}

function appendForm(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendForm(params, key, item);
    return;
  }
  params.append(key, stringifyForTemplate(value));
}

function interpolateText(
  template: string,
  args: Record<string, unknown>,
  encode: boolean,
  allowRawPath = false,
): string {
  if (typeof template !== 'string') return '';

  const whole = template.match(WHOLE_PLACEHOLDER);
  if (whole) {
    const placeholder = parsePlaceholder(whole[1]);
    if (placeholder.rawPath && !allowRawPath) {
      throw new BuildRequestError(
        'INVALID_TEMPLATE',
        'The "|raw" path modifier is only allowed in request.url.',
      );
    }
    const value = getArg(args, placeholder.name);
    if (value === undefined || value === null) return '';
    return placeholder.rawPath
      ? encodeRawPath(value)
      : encode
        ? encodeURIComponent(stringifyForTemplate(value))
        : stringifyForTemplate(value);
  }

  return template.replace(PLACEHOLDER, (_match, expression: string) => {
    const placeholder = parsePlaceholder(expression);
    if (placeholder.rawPath && !allowRawPath) {
      throw new BuildRequestError(
        'INVALID_TEMPLATE',
        'The "|raw" path modifier is only allowed in request.url.',
      );
    }
    const value = getArg(args, placeholder.name);
    if (value === undefined || value === null) return '';
    return placeholder.rawPath
      ? encodeRawPath(value)
      : encode
        ? encodeURIComponent(stringifyForTemplate(value))
        : stringifyForTemplate(value);
  });
}

/**
 * Preserve slash-separated path segments while encoding each segment. Raw paths are relative:
 * leading/trailing slashes are ignored, `.`/`..` segments are rejected, and backslashes/control
 * characters are refused before URL construction.
 */
function encodeRawPath(value: unknown): string {
  const raw = stringifyForTemplate(value);
  if (!raw) throw new BuildRequestError('INVALID_PATH', 'The raw path is empty.');
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new BuildRequestError('INVALID_PATH', 'The raw path contains a forbidden character.');
  }

  const normalized = raw.replace(/^\/+|\/+$/g, '');
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new BuildRequestError(
      'INVALID_PATH',
      'The raw path must not contain empty, "." or ".." segments.',
    );
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

export function interpolateValue(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_PLACEHOLDER);
    if (whole) {
      const placeholder = parsePlaceholder(whole[1]);
      if (placeholder.rawPath) {
        throw new BuildRequestError(
          'INVALID_TEMPLATE',
          'The "|raw" path modifier is only allowed in request.url.',
        );
      }
      return getArg(args, placeholder.name);
    }
    return value.replace(PLACEHOLDER, (_match, expression: string) => {
      const placeholder = parsePlaceholder(expression);
      if (placeholder.rawPath) {
        throw new BuildRequestError(
          'INVALID_TEMPLATE',
          'The "|raw" path modifier is only allowed in request.url.',
        );
      }
      const resolved = getArg(args, placeholder.name);
      return resolved === undefined || resolved === null ? '' : stringifyForTemplate(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => interpolateValue(item, args))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const resolved = interpolateValue(entry, args);
      if (resolved !== undefined) out[key] = resolved;
    }
    return out;
  }

  return value;
}

function getArg(args: Record<string, unknown>, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '.' || trimmed === '$') return args;
  return resolvePath(args, trimmed);
}

function stringifyForTemplate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
