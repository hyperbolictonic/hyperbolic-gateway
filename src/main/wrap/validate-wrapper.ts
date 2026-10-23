/**
 * Wrapper validation and normalisation.
 *
 * The store and the bridge both call this. Invalid wrappers never reach disk,
 * and errors name the exact field so an agent can correct its own proposal.
 */

import { normalizeRecipe } from '../../../packages/recipe/src/index.ts';
import type { Recipe } from '../../../packages/recipe/src/index.ts';
import type { WrapInputSchema, WrapMethod, WrapRequest, WrapWrapper } from './types.ts';

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SECRET_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const BODY_FORMATS = new Set(['json', 'form', 'text']);
const CREDENTIAL_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'auth',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'password',
]);
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

export interface WrapperValidation {
  ok: boolean;
  wrapper?: WrapWrapper;
  errors: string[];
}

export function validateWrapper(input: unknown): WrapperValidation {
  const errors: string[] = [];

  if (!isPlainObject(input)) return { ok: false, errors: ['wrapper must be an object'] };

  const source = input as Record<string, unknown>;
  if (source.schemaVersion !== undefined && source.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) errors.push('id is required');
  else if (id.length > 80) errors.push('id must be 80 characters or fewer');
  else if (!ID_PATTERN.test(id)) {
    errors.push('id must start with a lowercase letter and use only lowercase letters, numbers, dot, dash, or underscore');
  }

  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > 120) errors.push('name must be 120 characters or fewer');

  const description = source.description;
  if (description !== undefined && typeof description !== 'string') errors.push('description must be a string');
  else if (typeof description === 'string' && description.length > 1000) errors.push('description must be 1000 characters or fewer');

  const request = normalizeRequest(source.request, errors);
  const inputSchema = normalizeInputSchema(source.inputSchema, errors);

  let response: Recipe | undefined;
  if (source.response !== undefined) {
    const result = normalizeRecipe(source.response);
    if (result.errors.length > 0) {
      for (const error of result.errors) errors.push(`response.${error}`);
    } else {
      response = result.recipe;
    }
  }

  if (source.lastVerified !== undefined && typeof source.lastVerified !== 'string') {
    errors.push('lastVerified must be a string');
  }
  if (source.notes !== undefined && typeof source.notes !== 'string') errors.push('notes must be a string');

  const mutating = typeof source.mutating === 'boolean' ? source.mutating : undefined;
  const exposeAsTool = typeof source.exposeAsTool === 'boolean' ? source.exposeAsTool : false;

  if (errors.length > 0 || !request) {
    return { ok: false, errors };
  }

  const wrapper: WrapWrapper = {
    schemaVersion: 1,
    id,
    name,
    request,
    inputSchema,
    exposeAsTool,
  };

  if (typeof description === 'string' && description.trim()) wrapper.description = description.trim();
  if (response) wrapper.response = response;
  if (mutating !== undefined) wrapper.mutating = mutating;
  else wrapper.mutating = !['GET', 'HEAD'].includes(request.method);
  if (typeof source.lastVerified === 'string') wrapper.lastVerified = source.lastVerified;
  if (typeof source.notes === 'string') wrapper.notes = source.notes;

  return { ok: true, wrapper, errors: [] };
}

function normalizeRequest(input: unknown, errors: string[]): WrapRequest | undefined {
  if (!isPlainObject(input)) {
    errors.push('request is required and must be an object');
    return undefined;
  }

  const source = input as Record<string, unknown>;

  let auth: string | undefined;
  if (source.auth !== undefined && source.auth !== null && source.auth !== '') {
    if (typeof source.auth !== 'string' || !SECRET_NAME_PATTERN.test(source.auth) || source.auth.length > 64) {
      errors.push('request.auth must be a secret name (lowercase letters, numbers, dot, dash, or underscore)');
    } else {
      auth = source.auth;
    }
  }

  const method = String(source.method || 'GET').toUpperCase() as WrapMethod;
  if (!METHODS.has(method)) {
    errors.push('request.method must be GET, POST, PUT, PATCH, DELETE, or HEAD');
  }

  const url = typeof source.url === 'string' ? source.url.trim() : '';
  if (!url) {
    errors.push('request.url is required');
  } else {
    validateUrlShape(url, errors);
  }

  let query: Record<string, unknown> | undefined;
  if (source.query !== undefined) {
    if (!isPlainObject(source.query)) {
      errors.push('request.query must be an object');
    } else {
      query = source.query;
      for (const key of Object.keys(query)) {
        if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) {
          errors.push(`request.query.${key} looks like a credential; secrets are not enabled in this build`);
        }
      }
    }
  }

  let headers: Record<string, string> | undefined;
  if (source.headers !== undefined) {
    if (!isPlainObject(source.headers)) {
      errors.push('request.headers must be an object');
    } else {
      headers = {};
      for (const [key, value] of Object.entries(source.headers)) {
        if (typeof value !== 'string') {
          errors.push(`request.headers.${key} must be a string template`);
          continue;
        }
        if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
          errors.push(`request.headers.${key} cannot be set by a wrapper`);
          continue;
        }
        headers[key] = value;
      }
    }
  }

  let body: unknown;
  if (source.body !== undefined) {
    body = source.body;
    if (method === 'GET' || method === 'HEAD') errors.push(`request.body is not allowed on ${method}`);
    try {
      JSON.stringify(body);
    } catch {
      errors.push('request.body must be JSON-serialisable');
    }
  }

  let bodyFormat: WrapRequest['bodyFormat'];
  if (source.bodyFormat !== undefined) {
    if (typeof source.bodyFormat !== 'string' || !BODY_FORMATS.has(source.bodyFormat)) {
      errors.push('request.bodyFormat must be json, form, or text');
    } else {
      bodyFormat = source.bodyFormat as WrapRequest['bodyFormat'];
    }
  }

  let timeoutMs: number | undefined;
  if (source.timeoutMs !== undefined) {
    if (typeof source.timeoutMs !== 'number' || !Number.isFinite(source.timeoutMs) || source.timeoutMs < 1000) {
      errors.push('request.timeoutMs must be a number of at least 1000');
    } else if (source.timeoutMs > 60_000) {
      errors.push('request.timeoutMs must be at most 60000');
    } else {
      timeoutMs = Math.floor(source.timeoutMs);
    }
  }

  if (!METHODS.has(method) || !url) return undefined;

  const request: WrapRequest = { method, url };
  if (query) request.query = query;
  if (headers) request.headers = headers;
  if (source.body !== undefined) request.body = body;
  if (bodyFormat) request.bodyFormat = bodyFormat;
  if (auth) request.auth = auth;
  if (timeoutMs) request.timeoutMs = timeoutMs;
  return request;
}

function normalizeInputSchema(input: unknown, errors: string[]): WrapInputSchema {
  if (input === undefined) return { type: 'object', additionalProperties: true };
  if (!isPlainObject(input)) {
    errors.push('inputSchema must be an object');
    return { type: 'object', additionalProperties: true };
  }

  const source = input as WrapInputSchema;
  if (source.type !== undefined) {
    const types = Array.isArray(source.type) ? source.type : [source.type];
    if (!types.includes('object')) errors.push('inputSchema.type must include "object"');
  }

  if (source.properties !== undefined) {
    if (!isPlainObject(source.properties)) {
      errors.push('inputSchema.properties must be an object');
    } else {
      for (const [key, property] of Object.entries(source.properties)) {
        if (!isPlainObject(property)) errors.push(`inputSchema.properties.${key} must be an object`);
      }
    }
  }

  if (source.items !== undefined && !isPlainObject(source.items)) {
    errors.push('inputSchema.items must be an object');
  }

  if (source.required !== undefined) {
    if (!Array.isArray(source.required) || source.required.some((key) => typeof key !== 'string')) {
      errors.push('inputSchema.required must be an array of strings');
    }
  }

  // When a wrapper declares properties, reject typos by default. A schema-less
  // wrapper stays permissive so a quick GET can still accept arguments.
  const additionalProperties = source.additionalProperties ?? (source.properties ? false : true);
  return { ...source, type: source.type || 'object', additionalProperties };
}

function validateUrlShape(url: string, errors: string[]): void {
  const match = url.match(/^(https?):\/\//i);
  if (!match) {
    errors.push('request.url must start with http:// or https://');
    return;
  }

  const rest = url.slice(match[0].length);
  const hostEnd = rest.search(/[/?#]/);
  const host = hostEnd === -1 ? rest : rest.slice(0, hostEnd);

  if (!host) {
    errors.push('request.url must include a host');
    return;
  }
  if (host.includes('{{')) {
    errors.push('request.url may template the path or query, but not the host');
  }
  if (host.includes('@')) {
    errors.push('request.url must not contain credentials');
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
