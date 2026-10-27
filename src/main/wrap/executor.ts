/**
 * The REST executor.
 *
 * It validates the agent's arguments, builds the request deterministically,
 * applies the outbound policy, fetches, and renders the response through the
 * recipe. It never sees a secret in this slice; the secret store arrives in S2
 * and will keep values in the main process, not here.
 */

import { renderRecipe, resolvePath } from '../../../packages/recipe/src/index.ts';
import type { Recipe, RenderMeta, RenderedDocument } from '../../../packages/recipe/src/index.ts';
import { validateArgs } from './input-schema.ts';
import { buildRequest, redactHeaders, BuildRequestError } from './interpolate.ts';
import { assertSafeUrl, WrapSecurityError } from './security.ts';
import { validateWrapper } from './validate-wrapper.ts';
import type { WrapFormat, WrapPreview, WrapRunResult, WrapWrapper } from './types.ts';
import type { WrapStore } from './store.ts';
import type { SecretStore } from './secrets.ts';
import type { WrapAuditLog } from './audit.ts';

/** One rendered document handed to an opt-in indexer (Cortex). */
export interface WrapIndexDocument {
  title: string;
  markdown: string;
}

export interface WrapIndexContext {
  wrapperId: string;
  wrapperName: string;
  /** The URL the content came from (the first page of a paginated run). */
  url: string;
}

export interface ExecutorOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  allowPrivateHosts?: boolean;
  allowHttp?: boolean;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxResultChars?: number;
  defaultTimeoutMs?: number;
  /** Maximum pages followed when a recipe declares pagination. Default 10, capped at 25. */
  maxPages?: number;
  /** Overall item cap for a paginated run when the recipe has no `limits.maxItems`. Default 50. */
  maxItems?: number;
  /**
   * Opt-in sink for recipes with `response.index: "cortex"`. Best-effort: a throw is
   * reported in `result.indexed.error` and never fails the call.
   */
  indexDocuments?: (documents: WrapIndexDocument[], context: WrapIndexContext) => Promise<number>;
  secrets?: Pick<SecretStore, 'resolve'>;
  audit?: Pick<WrapAuditLog, 'append'>;
}

interface ExecuteOptions {
  dryRun: boolean;
  includeRaw: boolean;
  format: WrapFormat;
  /** Per-call override of the executor's page cap. */
  maxPages?: number;
}

/** Overall item cap when a recipe does not declare `limits.maxItems` (mirrors the renderer). */
const DEFAULT_MAX_ITEMS = 50;
/** Page size when a paginated recipe does not declare `pagination.pageSize`. */
const DEFAULT_PAGE_SIZE = 50;
/** Safety cap on how many rendered documents one run may index. */
const MAX_INDEX_DOCUMENTS = 50;

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

/** The paging contract derived from `recipe.pagination` for one run. */
interface PagePlan {
  active: boolean;
  type: 'none' | 'cursor' | 'offset' | 'link';
  pageSize: number;
  limitParam?: string;
  offsetParam?: string;
  cursorParam?: string;
  nextPath?: string;
  hasMorePath?: string;
  nextUrlPath?: string;
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
  private readonly maxPages: number;
  private readonly defaultMaxItems: number;
  private readonly indexDocuments?: (documents: WrapIndexDocument[], context: WrapIndexContext) => Promise<number>;
  private readonly secrets?: Pick<SecretStore, 'resolve'>;
  private readonly audit?: Pick<WrapAuditLog, 'append'>;

  constructor(store: WrapStore, options: ExecutorOptions = {}) {
    this.store = store;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.resolveHost = options.resolveHost;
    this.allowPrivateHosts = options.allowPrivateHosts ?? (process.env.HB_WRAP_ALLOW_PRIVATE ?? process.env.KUANG_WRAP_ALLOW_PRIVATE) === '1';
    this.allowHttp = options.allowHttp ?? (process.env.HB_WRAP_ALLOW_HTTP ?? process.env.KUANG_WRAP_ALLOW_HTTP) === '1';
    this.maxRedirects = clampInt(options.maxRedirects ?? 5, 0, 10);
    this.maxResponseBytes = clampInt(options.maxResponseBytes ?? 5_000_000, 1_000, 10_000_000);
    this.maxResultChars = clampInt(options.maxResultChars ?? 50_000, 1_000, 200_000);
    this.defaultTimeoutMs = clampInt(options.defaultTimeoutMs ?? 15_000, 1_000, 60_000);
    this.maxPages = clampInt(options.maxPages ?? 10, 1, 25);
    this.defaultMaxItems = clampInt(options.maxItems ?? DEFAULT_MAX_ITEMS, 1, 5_000);
    this.indexDocuments = options.indexDocuments;
    this.secrets = options.secrets;
    this.audit = options.audit;
  }

  status(): { wrappers: number; allowPrivateHosts: boolean } {
    return { wrappers: this.store.count(), allowPrivateHosts: this.allowPrivateHosts };
  }

  async run(
    id: string,
    args: unknown,
    options: { format?: WrapFormat; includeRaw?: boolean; maxPages?: number } = {},
  ): Promise<WrapRunResult> {
    const wrapper = this.store.get(id);
    if (!wrapper) return failure({ id, name: id }, 'WRAPPER_NOT_FOUND', `No wrapper named "${id}".`);

    return this.execute(wrapper, args, {
      dryRun: false,
      includeRaw: Boolean(options.includeRaw),
      format: options.format || 'markdown',
      maxPages: options.maxPages,
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
    maxPages?: number;
    includeRaw?: boolean;
  }): Promise<WrapRunResult> {
    const resolved = this.resolve(input.id, input.wrapper);
    if (!resolved.wrapper) return failure({ id: input.id || '(unsaved)', name: input.id || '(unsaved)' }, resolved.code, resolved.message);

    if (input.sample !== undefined) {
      return this.renderSample(resolved.wrapper, input.sample);
    }

    return this.execute(resolved.wrapper, input.args, {
      dryRun: input.dryRun !== false,
      includeRaw: Boolean(input.includeRaw),
      format: input.format || 'markdown',
      maxPages: input.maxPages,
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

    let secretHeader: string | undefined;
    let secretValues: string[] = [];
    let secretRefreshable = false;
    if (wrapper.request.auth) {
      if (!this.secrets) {
        return failure(
          { id: wrapper.id, name: wrapper.name },
          'SECRETS_UNAVAILABLE',
          'This build has no secret store; remove request.auth or use a credential-free endpoint.',
        );
      }

      const host = new URL(built.url).hostname;
      const resolved = await this.secrets.resolve(wrapper.request.auth, host);
      if (!resolved.ok || !resolved.header || resolved.value === undefined) {
        return failure(
          { id: wrapper.id, name: wrapper.name },
          resolved.code || 'SECRET_ERROR',
          resolved.message || `Could not resolve secret "${wrapper.request.auth}".`,
        );
      }

      built.headers[resolved.header] = resolved.value;
      secretHeader = resolved.header;
      secretValues = secretVariants(resolved.value);
      secretRefreshable = Boolean(resolved.refreshable);
    }

    const plan = this.pagePlan(wrapper, built);
    const maxPages = plan.active ? clampInt(options.maxPages ?? this.maxPages, 1, this.maxPages) : 1;
    const itemCap = wrapper.response?.limits?.maxItems ?? this.defaultMaxItems;

    let url = built.url;
    let offset = 0;
    if (plan.active && plan.type === 'offset') {
      const firstUrl = new URL(url);
      if (plan.limitParam) firstUrl.searchParams.set(plan.limitParam, String(plan.pageSize));
      firstUrl.searchParams.set(plan.offsetParam ?? 'offset', '0');
      url = firstUrl.toString();
    }

    const request: WrapPreview = {
      method: built.method,
      url,
      headers: redactHeaders(built.headers, secretHeader ? [secretHeader] : []),
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

    const pages: FetchedResponse[] = [];
    const rawPages: unknown[] = [];
    let accumulated = 0;
    let more = false;
    let failed: FetchedResponse | undefined;
    let authRetried = false;

    try {
      for (let index = 0; index < maxPages; index++) {
        const fetched = await this.fetchWithPolicy(wrapper, { ...built, url }, secretHeader);
        const pageOk = fetched.response.ok;

        this.audit?.append({
          wrapper: wrapper.id,
          host: safeHost(fetched.url),
          method: built.method,
          status: fetched.response.status,
          ok: pageOk,
          bytes: fetched.bytes,
          durationMs: fetched.durationMs,
          code: pageOk ? undefined : 'HTTP_ERROR',
        });

        if (!pageOk) {
          // One re-mint for an OAuth2 credential the API rejected, then give up with AUTH_REQUIRED.
          const rejected = fetched.response.status === 401 || fetched.response.status === 403;
          if (rejected && secretRefreshable && !authRetried && wrapper.request.auth && this.secrets) {
            authRetried = true;
            const refreshed = await this.secrets.resolve(wrapper.request.auth, safeHost(url), { forceRefresh: true });
            if (refreshed.ok && refreshed.header && refreshed.value !== undefined) {
              built.headers[refreshed.header] = refreshed.value;
              secretHeader = refreshed.header;
              secretValues = secretVariants(refreshed.value);
              index -= 1; // retry this page once
              continue;
            }
          }
          pages.push(fetched);
          failed = fetched;
          break;
        }

        pages.push(fetched);

        const json = parseJson(fetched.text, fetched.contentType);
        const safeJson = json === undefined ? undefined : redactDeep(json, secretValues);
        rawPages.push(safeJson);

        if (!plan.active) break;

        // Auto-paging only makes sense for a list selection.
        const items = this.itemsOf(wrapper.response, safeJson);
        if (!items || items.length === 0) {
          more = false;
          break;
        }
        accumulated += items.length;

        const next = this.nextPageToken(plan, safeJson, items.length);
        if (next === null) {
          more = false;
          break;
        }
        if (accumulated >= itemCap || index + 1 >= maxPages) {
          more = true;
          break;
        }

        if (plan.type === 'link') {
          const candidate = String(next);
          // A page link must stay on the origin the wrapper was written for.
          if (!sameOrigin(candidate, built.url)) {
            more = true;
            break;
          }
          url = candidate;
        } else {
          const pageUrl = new URL(url);
          if (plan.type === 'offset') {
            offset += plan.pageSize;
            pageUrl.searchParams.set(plan.offsetParam ?? 'offset', String(offset));
            if (plan.limitParam) pageUrl.searchParams.set(plan.limitParam, String(plan.pageSize));
          } else if (plan.type === 'cursor') {
            pageUrl.searchParams.set(plan.cursorParam ?? 'cursor', String(next));
          }
          url = pageUrl.toString();
        }
        more = true;
      }
    } catch (err: any) {
      const code =
        err instanceof WrapSecurityError || err instanceof WrapTransportError ? err.code : 'NETWORK_ERROR';
      const retryable = code === 'TIMEOUT' || code === 'NETWORK_ERROR';
      this.audit?.append({
        wrapper: wrapper.id,
        host: safeHost(url),
        method: built.method,
        ok: false,
        code,
      });
      return failure({ id: wrapper.id, name: wrapper.name }, code, err?.message || String(err), request, undefined, retryable);
    }

    const first = pages[0];
    const failedPage = failed ?? first;
    const safeFirstText = redactText(first.text, secretValues);
    const firstJson = rawPages[0];
    const rendered =
      rawPages.length > 1
        ? this.mergePages(wrapper, rawPages, itemCap)
        : this.render(wrapper, firstJson, safeFirstText, first.contentType);

    const ok = !failed && pages.every((page) => page.response.ok);

    // Opt-in Cortex indexing (`recipe.index === "cortex"`). Best-effort: a Cortex failure
    // never turns a successful upstream call into a failure.
    let indexed: WrapRunResult['indexed'];
    if (ok && wrapper.response?.index === 'cortex' && this.indexDocuments) {
      const documents = this.documentsToIndex(wrapper, rendered);
      if (documents.length > 0) {
        try {
          const chunks = await this.indexDocuments(documents, {
            wrapperId: wrapper.id,
            wrapperName: wrapper.name,
            url: first.url,
          });
          indexed = { documents: documents.length, chunks };
        } catch (err: any) {
          indexed = { documents: documents.length, chunks: 0, error: err?.message || String(err) };
        }
      }
    }

    const result: WrapRunResult = {
      ok,
      status: failedPage.response.status,
      durationMs: pages.reduce((total, page) => total + page.durationMs, 0),
      wrapper: { id: wrapper.id, name: wrapper.name },
      request,
      response: {
        contentType: first.contentType || undefined,
        bytes: pages.reduce((total, page) => total + page.bytes, 0),
        truncated: pages.some((page) => page.truncated) || undefined,
        text: ok && firstJson !== undefined ? undefined : clip(safeFirstText, 1_000),
        json: options.includeRaw ? firstJson : undefined,
      },
      markdown: rendered.markdown,
      records: rendered.records,
      documents: rendered.documents,
      meta: rendered.meta,
      paging: plan.active ? { pages: pages.length, cap: maxPages, more } : undefined,
      indexed,
    };

    if (!ok) {
      const status = failedPage.response.status;
      const message = `HTTP ${status}${failedPage.response.statusText ? ` ${failedPage.response.statusText}` : ''}`;
      const excerpt = clip(redactText(failedPage.text, secretValues), 600);
      const authRejected = status === 401 || status === 403;
      const credential = wrapper.request.auth ? ` "${wrapper.request.auth}"` : '';

      if (authRejected) {
        const hint = `Credential${credential} was rejected (HTTP ${status}). Refresh it in Settings → Wrappers, or raise request_human_intervention.`;
        result.markdown = `**AUTH_REQUIRED** — ${hint}${excerpt ? `\n\n\`\`\`\n${excerpt}\n\`\`\`` : ''}`;
      } else {
        result.markdown = excerpt
          ? `**${message}**\n\n\`\`\`\n${excerpt}\n\`\`\``
          : `**${message}**`;
      }

      result.records = [];
      result.error = {
        code: authRejected ? 'AUTH_REQUIRED' : 'HTTP_ERROR',
        message: authRejected
          ? `Credential${credential} was rejected with HTTP ${status}. Refresh it in Settings → Wrappers, or raise request_human_intervention.`
          : excerpt
            ? `${message}: ${excerpt}`
            : message,
        status,
        retryable: !authRejected && (status === 429 || status >= 500),
      };
    } else {
      // A live success is the verification signal surfaced as `lastVerified`.
      try {
        this.store.touchVerified(wrapper.id);
      } catch {
        /* verification metadata is best-effort */
      }
    }

    return result;
  }

  /** The paging contract derived from the recipe, or `active: false` for a single request. */
  private pagePlan(wrapper: WrapWrapper, built: ReturnType<typeof buildRequest>): PagePlan {
    const spec = wrapper.response?.pagination;
    const type = (spec?.type ?? 'none') as PagePlan['type'];
    const active = type !== 'none' && !!wrapper.response;

    let pageSize = spec?.pageSize ?? 0;
    if (active && spec?.limitParam && !pageSize) {
      try {
        const current = Number(new URL(built.url).searchParams.get(spec.limitParam));
        if (Number.isFinite(current) && current > 0) pageSize = Math.floor(current);
      } catch {
        /* keep the default */
      }
    }

    return {
      active,
      type,
      pageSize: pageSize || DEFAULT_PAGE_SIZE,
      limitParam: spec?.limitParam,
      offsetParam: spec?.offsetParam,
      cursorParam: spec?.cursorParam,
      nextPath: spec?.next,
      hasMorePath: spec?.hasMore,
      nextUrlPath: spec?.nextUrl,
    };
  }

  /** The list a recipe selects from one page, or null when the selection is not a list. */
  private itemsOf(recipe: Recipe | undefined, page: unknown): unknown[] | null {
    if (!recipe?.select) return null;
    const value = resolvePath(page, recipe.select);
    return Array.isArray(value) ? value : null;
  }

  /**
   * Whether another page exists, and what to send next.
   * `true` for offset paging, the cursor/next-URL string for cursor/link paging.
   */
  private nextPageToken(plan: PagePlan, page: unknown, pageCount: number): string | true | null {
    if (plan.type === 'offset') {
      if (plan.hasMorePath) {
        const more = resolvePath(page, plan.hasMorePath);
        if (more === undefined || more === null || more === false || more === 0) return null;
      }
      return pageCount >= plan.pageSize ? true : null;
    }
    if (plan.type === 'cursor') {
      const next = plan.nextPath ? resolvePath(page, plan.nextPath) : undefined;
      return next === undefined || next === null || next === '' ? null : String(next);
    }
    if (plan.type === 'link') {
      const next = plan.nextUrlPath ? resolvePath(page, plan.nextUrlPath) : undefined;
      return next === undefined || next === null || next === '' ? null : String(next);
    }
    return null;
  }

  /**
   * Merge several pages into one render. The common case (a `select` that resolves to a
   * list) concatenates the lists and renders once, so the agent gets one table rather
   * than N tables with repeated headings.
   */
  private mergePages(wrapper: WrapWrapper, rawPages: unknown[], itemCap: number): Rendered {
    const recipe = wrapper.response;
    const merged = this.mergeSelection(recipe, rawPages);

    if (merged && merged.length > 0) {
      try {
        const result = renderRecipe(
          { __kuang_pages: merged },
          { ...(recipe as Recipe), select: '$.__kuang_pages' },
          { maxChars: this.maxResultChars, maxItems: itemCap },
        );
        return {
          markdown: result.markdown,
          records: result.records,
          documents: result.documents,
          meta: result.meta,
        };
      } catch {
        /* fall through to the per-page join */
      }
    }

    const parts = rawPages.map((page) => this.render(wrapper, page, '', '', itemCap));
    const markdown = parts.map((part) => part.markdown).filter(Boolean).join('\n\n---\n\n');
    const records = parts.flatMap((part) => part.records).slice(0, itemCap);
    const documents = parts.flatMap((part) => part.documents ?? []);
    const selected = parts.reduce((total, part) => total + (part.meta?.selected ?? 0), 0);
    return {
      markdown,
      records,
      documents,
      meta: {
        mode: parts[0]?.meta?.mode ?? 'table',
        select: parts[0]?.meta?.select ?? '$',
        selected,
        rendered: records.length,
        truncated: selected > records.length,
        chars: markdown.length,
      },
    };
  }

  private mergeSelection(recipe: Recipe | undefined, rawPages: unknown[]): unknown[] | null {
    if (!recipe?.select) return null;
    const out: unknown[] = [];
    for (const page of rawPages) {
      const value = resolvePath(page, recipe.select);
      if (!Array.isArray(value)) return null;
      out.push(...value);
    }
    return out;
  }

  /**
   * What an opt-in indexer receives: one entry per rendered document when the recipe used
   * documents mode, otherwise one entry for the whole rendered result. Capped so a large
   * table cannot turn into hundreds of embeddings.
   */
  private documentsToIndex(wrapper: WrapWrapper, rendered: Rendered): WrapIndexDocument[] {
    const documents = (rendered.documents ?? [])
      .filter((document) => document.markdown && document.markdown.trim())
      .map((document) => ({ title: document.title || wrapper.name, markdown: document.markdown }));

    if (documents.length > 0) return documents.slice(0, MAX_INDEX_DOCUMENTS);

    const markdown = rendered.markdown?.trim();
    if (!markdown) return [];
    return [{ title: wrapper.response?.name || wrapper.name, markdown }].slice(0, MAX_INDEX_DOCUMENTS);
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

  private render(
    wrapper: WrapWrapper,
    json: unknown,
    text: string,
    contentType: string,
    maxItems?: number,
  ): Rendered {
    if (json !== undefined && wrapper.response) {
      try {
        const rendered = renderRecipe(json, wrapper.response, { maxChars: this.maxResultChars, maxItems });
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

  private async fetchWithPolicy(
    wrapper: WrapWrapper,
    built: ReturnType<typeof buildRequest>,
    secretHeader?: string,
  ): Promise<FetchedResponse> {
    const timeoutMs = clampInt(wrapper.request.timeoutMs ?? this.defaultTimeoutMs, 1_000, 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let url = built.url;
    let method = built.method;
    let body = built.body;
    let authHeader = secretHeader;
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

          // Never carry an injected credential across an origin boundary.
          if (authHeader && new URL(next).origin !== safe.origin) {
            deleteHeader(headers, authHeader);
            authHeader = undefined;
          }

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

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function secretVariants(value: string): string[] {
  const variants = new Set<string>();
  if (value) variants.add(value);
  const withoutScheme = value.replace(/^[A-Za-z]+\s+/, '');
  if (withoutScheme && withoutScheme !== value) variants.add(withoutScheme);
  return [...variants];
}

function redactText(text: string, values: string[]): string {
  if (!text || values.length === 0) return text;
  let out = text;
  for (const value of values) {
    if (value) out = out.split(value).join('<redacted>');
  }
  return out;
}

function redactDeep(value: unknown, values: string[], depth = 0): unknown {
  if (values.length === 0) return value;
  if (depth > 100) return '<redacted-deep>';
  if (typeof value === 'string') return redactText(value, values);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, values, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[redactText(key, values)] = redactDeep(entry, values, depth + 1);
    }
    return out;
  }
  return value;
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
