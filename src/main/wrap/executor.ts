/**
 * The REST executor.
 *
 * It validates the agent's arguments, builds the request deterministically,
 * applies the outbound policy, fetches, and renders the response through the
 * recipe. It never sees a secret in this slice; the secret store arrives in S2
 * and will keep values in the main process, not here.
 */

import { renderRecipe } from '../../../packages/recipe/src/index.ts';
import type { RenderMeta, RenderedDocument } from '../../../packages/recipe/src/index.ts';
import { validateArgs } from './input-schema.ts';
import { buildRequest, redactHeaders, BuildRequestError } from './interpolate.ts';
import { assertSafeUrl, WrapSecurityError } from './security.ts';
import { validateWrapper } from './validate-wrapper.ts';
import type { WrapFormat, WrapPreview, WrapRunResult, WrapWrapper } from './types.ts';
import type { WrapStore } from './store.ts';

export interface ExecutorOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  allowPrivateHosts?: boolean;
  allowHttp?: boolean;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxResultChars?: number;
  defaultTimeoutMs?: number;
}

interface ExecuteOptions {
  dryRun: boolean;
  includeRaw: boolean;
  format: WrapFormat;
}

interface FetchedResponse {
  response: Response;
  url: string;
  text: string;
  bytes: number;
  truncated: boolean;
  durationMs: number;
  contentType: string;
}

interface Rendered {
  markdown: string;
  records: Record<string, unknown>[];
  documents?: RenderedDocument[];
  meta?: RenderMeta;
}

export class WrapTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WrapTransportError';
    this.code = code;
  }
}

export class WrapExecutor {
  readonly store: WrapStore;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost?: (hostname: string) => Promise<string[]>;
  private readonly allowPrivateHosts: boolean;
  private readonly allowHttp: boolean;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly maxResultChars: number;
  private readonly defaultTimeoutMs: number;

  constructor(store: WrapStore, options: ExecutorOptions = {}) {
    this.store = store;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.resolveHost = options.resolveHost;
    this.allowPrivateHosts = options.allowPrivateHosts ?? process.env.KUANG_WRAP_ALLOW_PRIVATE === '1';
    this.allowHttp = options.allowHttp ?? process.env.KUANG_WRAP_ALLOW_HTTP === '1';
    this.maxRedirects = clampInt(options.maxRedirects ?? 5, 0, 10);
    this.maxResponseBytes = clampInt(options.maxResponseBytes ?? 5_000_000, 1_000, 10_000_000);
    this.maxResultChars = clampInt(options.maxResultChars ?? 50_000, 1_000, 200_000);
    this.defaultTimeoutMs = clampInt(options.defaultTimeoutMs ?? 15_000, 1_000, 60_000);
  }

  status(): { wrappers: number; allowPrivateHosts: boolean } {
    return { wrappers: this.store.count(), allowPrivateHosts: this.allowPrivateHosts };
  }

  async run(
    id: string,
    args: unknown,
    options: { format?: WrapFormat; includeRaw?: boolean } = {},
  ): Promise<WrapRunResult> {
    const wrapper = this.store.get(id);
    if (!wrapper) return failure({ id, name: id }, 'WRAPPER_NOT_FOUND', `No wrapper named "${id}".`);

    return this.execute(wrapper, args, {
      dryRun: false,
      includeRaw: Boolean(options.includeRaw),
      format: options.format || 'markdown',
    });
  }

  async preview(id: string, args: unknown): Promise<WrapRunResult> {
    const wrapper = this.store.get(id);
    if (!wrapper) return failure({ id, name: id }, 'WRAPPER_NOT_FOUND', `No wrapper named "${id}".`);
    return this.execute(wrapper, args, { dryRun: true, includeRaw: false, format: 'markdown' });
  }

  async test(input: {
    id?: string;
    wrapper?: unknown;
    args?: unknown;
    sample?: unknown;
    dryRun?: boolean;
    format?: WrapFormat;
  }): Promise<WrapRunResult> {
    const resolved = this.resolve(input.id, input.wrapper);
    if (!resolved.wrapper) return failure({ id: input.id || '(unsaved)', name: input.id || '(unsaved)' }, resolved.code, resolved.message);

    if (input.sample !== undefined) {
      return this.renderSample(resolved.wrapper, input.sample);
    }

    return this.execute(resolved.wrapper, input.args, {
      dryRun: input.dryRun !== false,
      includeRaw: false,
      format: input.format || 'markdown',
    });
  }

  private async execute(wrapper: WrapWrapper, argsInput: unknown, options: ExecuteOptions): Promise<WrapRunResult> {
    const validated = validateArgs(wrapper.inputSchema, argsInput);
    if (!validated.ok) {
      return failure(
        { id: wrapper.id, name: wrapper.name },
        'INVALID_ARGS',
        validated.errors.join('; '),
        undefined,
        validated.field,
      );
    }

    let built;
    try {
      built = buildRequest(wrapper, validated.value);
    } catch (err: any) {
      const code = err instanceof BuildRequestError ? err.code : 'INVALID_REQUEST';
      return failure({ id: wrapper.id, name: wrapper.name }, code, err?.message || String(err));
    }

    const request: WrapPreview = {
      method: built.method,
      url: built.url,
      headers: redactHeaders(built.headers),
      body: built.body,
    };

    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        wrapper: { id: wrapper.id, name: wrapper.name },
        request,
        markdown: '_Dry run — request not sent._',
        records: [],
      };
    }

    let fetched: FetchedResponse;
    try {
      fetched = await this.fetchWithPolicy(wrapper, built);
    } catch (err: any) {
      const code =
        err instanceof WrapSecurityError || err instanceof WrapTransportError ? err.code : 'NETWORK_ERROR';
      const retryable = code === 'TIMEOUT' || code === 'NETWORK_ERROR';
      return failure({ id: wrapper.id, name: wrapper.name }, code, err?.message || String(err), request, undefined, retryable);
    }

    const json = parseJson(fetched.text, fetched.contentType);
    const rendered = this.render(wrapper, json, fetched.text, fetched.contentType);
    const ok = fetched.response.ok;

    const result: WrapRunResult = {
      ok,
      status: fetched.response.status,
      durationMs: fetched.durationMs,
      wrapper: { id: wrapper.id, name: wrapper.name },
      request,
      response: {
        contentType: fetched.contentType || undefined,
        bytes: fetched.bytes,
        truncated: fetched.truncated || undefined,
        text: ok && json !== undefined ? undefined : clip(fetched.text, 1_000),
        json: options.includeRaw ? json : undefined,
      },
      markdown: rendered.markdown,
      records: rendered.records,
      documents: rendered.documents,
      meta: rendered.meta,
    };

    if (!ok) {
      const status = fetched.response.status;
      const message = `HTTP ${status}${fetched.response.statusText ? ` ${fetched.response.statusText}` : ''}`;
      const excerpt = clip(fetched.text, 600);
      result.markdown = excerpt
        ? `**${message}**\n\n\`\`\`\n${excerpt}\n\`\`\``
        : `**${message}**`;
      result.records = [];
      result.error = {
        code: 'HTTP_ERROR',
        message: excerpt ? `${message}: ${excerpt}` : message,
        status,
        retryable: status === 429 || status >= 500,
      };
    }

    return result;
  }

  private async renderSample(wrapper: WrapWrapper, sample: unknown): Promise<WrapRunResult> {
    const rendered = this.render(wrapper, sample, typeof sample === 'string' ? sample : '', 'application/json');
    return {
      ok: true,
      wrapper: { id: wrapper.id, name: wrapper.name },
      markdown: rendered.markdown,
      records: rendered.records,
      documents: rendered.documents,
      meta: rendered.meta,
    };
  }

  private render(wrapper: WrapWrapper, json: unknown, text: string, contentType: string): Rendered {
    if (json !== undefined && wrapper.response) {
      try {
        const rendered = renderRecipe(json, wrapper.response, { maxChars: this.maxResultChars });
        return {
          markdown: rendered.markdown,
          records: rendered.records,
          documents: rendered.documents,
          meta: rendered.meta,
        };
      } catch (err: any) {
        return {
          markdown: `_Recipe failed: ${err?.message || err}_\n\n${fence(text, 'text', this.maxResultChars)}`,
          records: [],
        };
      }
    }

    if (json !== undefined) {
      const pretty = JSON.stringify(json, null, 2);
      return {
        markdown: fence(pretty, 'json', this.maxResultChars),
        records: toRecords(json),
      };
    }

    if (!text) return { markdown: '_Empty response._', records: [] };

    const label = contentType.includes('html') ? 'html' : 'text';
    return {
      markdown: fence(text, label, this.maxResultChars),
      records: [],
    };
  }

  private async fetchWithPolicy(wrapper: WrapWrapper, built: ReturnType<typeof buildRequest>): Promise<FetchedResponse> {
    const timeoutMs = clampInt(wrapper.request.timeoutMs ?? this.defaultTimeoutMs, 1_000, 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let url = built.url;
    let method = built.method;
    let body = built.body;
    const headers = { ...built.headers };
    const started = Date.now();

    try {
      for (let redirects = 0; ; redirects++) {
        const safe = await assertSafeUrl(url, {
          allowPrivateHosts: this.allowPrivateHosts,
          allowHttp: this.allowHttp,
          resolveHost: this.resolveHost,
        });

        const init: RequestInit = {
          method,
          headers,
          redirect: 'manual',
          signal: controller.signal,
        };
        if (body !== undefined) init.body = body;

        const response = await this.fetchImpl(safe.toString(), init);
        const location = response.headers.get('location');

        if (isRedirect(response.status) && location) {
          if (redirects >= this.maxRedirects) {
            await response.body?.cancel();
            throw new WrapTransportError('TOO_MANY_REDIRECTS', `Exceeded ${this.maxRedirects} redirects.`);
          }

          const next = new URL(location, safe).toString();
          await response.body?.cancel();

          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')) {
            method = 'GET';
            body = undefined;
            delete headers['content-type'];
            delete headers['Content-Type'];
            delete headers['content-length'];
            delete headers['Content-Length'];
          }

          url = next;
          continue;
        }

        return await this.readResponse(response, safe.toString(), started);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new WrapTransportError('TIMEOUT', `Request timed out after ${timeoutMs} ms.`);
      }
      if (err instanceof WrapSecurityError || err instanceof WrapTransportError) throw err;
      throw new WrapTransportError('NETWORK_ERROR', err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  private async readResponse(response: Response, url: string, started: number): Promise<FetchedResponse> {
    const contentType = response.headers.get('content-type') || '';
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const next = bytes + value.byteLength;
        if (next > this.maxResponseBytes) {
          const remaining = this.maxResponseBytes - bytes;
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining));
            bytes += remaining;
          }
          truncated = true;
          await reader.cancel();
          break;
        }

        chunks.push(value);
        bytes = next;
      }
    }

    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return {
      response,
      url,
      text,
      bytes,
      truncated,
      durationMs: Date.now() - started,
      contentType,
    };
  }

  private resolve(
    id: string | undefined,
    wrapper: unknown,
  ): { wrapper?: WrapWrapper; code: string; message: string } {
    if (wrapper !== undefined) {
      const validation = validateWrapper(wrapper);
      if (!validation.ok || !validation.wrapper) {
        return { code: 'INVALID_WRAPPER', message: validation.errors.join('; ') };
      }
      return { wrapper: validation.wrapper, code: '', message: '' };
    }

    if (!id) return { code: 'WRAPPER_REQUIRED', message: 'Provide either id or wrapper.' };
    const stored = this.store.get(id);
    if (!stored) return { code: 'WRAPPER_NOT_FOUND', message: `No wrapper named "${id}".` };
    return { wrapper: stored, code: '', message: '' };
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseJson(text: string, contentType: string): unknown {
  if (!text) return undefined;
  const looksJson = contentType.includes('json') || /^\s*[\[{]/.test(text);
  if (!looksJson) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toRecords(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.map((item) => (isPlainObject(item) ? item : { value: item }));
  }
  if (isPlainObject(json)) return [json];
  return [];
}

function fence(text: string, language: string, maxChars: number): string {
  const clipped = clip(text.trim(), maxChars);
  return clipped ? `\`\`\`${language}\n${clipped}\n\`\`\`` : '_Empty response._';
}

function clip(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function failure(
  wrapper: { id: string; name: string },
  code: string,
  message: string,
  request?: WrapPreview,
  field?: string,
  retryable?: boolean,
): WrapRunResult {
  return {
    ok: false,
    wrapper,
    request,
    markdown: `**${code}:** ${message}`,
    records: [],
    error: { code, message, field, retryable },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
