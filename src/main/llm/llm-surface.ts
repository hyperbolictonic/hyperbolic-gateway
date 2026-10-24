/**
 * LLM-Friendly Site Discovery (TODO_RESEARCH_CRAWL.md §5, Feature 6).
 *
 * Many sites publish an LLM-friendly representation of their content: an
 * `/llms.txt` (or `/llms-full.txt`) index, a `/sitemap.xml`, a page-level
 * `<link rel="alternate" type="text/markdown">`, or content-negotiated
 * `text/markdown`. Reading those is ~5–10x cheaper than rendering the page and
 * running a Set-of-Marks harvest.
 *
 * Safety posture (the whole point of the design):
 *  - `probe()` only ever requests **well-known, spec-defined paths** at the origin
 *    (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`) plus one `HEAD` for content
 *    negotiation. A per-page alternate is read from the **live DOM** (the active
 *    page only). Results are cached per origin so we never repeat-hit.
 *  - A page-level Markdown/Text alternate is discovered two ways, both of which
 *    read what the page actually offers rather than guessing a path: a declared
 *    `<link rel="alternate">` and a **real `<a href="….md">` anchor** on the page
 *    (e.g. a "View as Markdown" link, or the same URL with a `.md` suffix that a
 *    site links to itself). Cross-origin anchors are deprioritised.
 *  - `fetch()` is **gated**: it refuses with `NO_LLM_SURFACE` unless a probe
 *    confirmed an *advertised* surface. It never guesses paths and never fetches
 *    an arbitrary URL.
 *  - An advertised **per-page alternate** is loaded via a real document
 *    navigation (injected `navigateForText`), not a synthetic fetch, so the
 *    request carries Chromium's full header + renderer fingerprint.
 *  - A response that comes back `text/html` (or 4xx/5xx) is treated as "no
 *    surface" — never mislabelled as Markdown.
 *  - `readUrl()` is the composite: site-provided Markdown/Text when advertised,
 *    otherwise a **detached render** distilled to Markdown, so a caller never has
 *    to branch. A representation that does not exist is reported as
 *    `recommended: null` + `next` (a strategy), never as a fetchable kind.
 */
import { net, type Session, type WebContents } from 'electron';

/** A *fetchable* LLM-friendly representation. Deliberately excludes "rendered". */
export type LlmSurfaceKind = 'llms_txt' | 'llms_full' | 'markdown' | 'text';

/** Whether a representation covers the whole site (`origin`) or just the page (`page`). */
export type LlmSurfaceScope = 'origin' | 'page';

/**
 * The machine-readable next action. `recommended: null` means "there is no
 * fetchable representation" and `next` points at the render path — so a caller
 * that plans only from the report can never mistake a strategy for a
 * representation and then be rejected by `fetch()`.
 */
export type LlmSurfaceNext =
  | { tool: 'llm_fetch'; as: LlmSurfaceKind }
  | { tool: 'observe'; as: 'markdown' };

export interface LlmSurfaceEndpoint {
  found: boolean;
  url: string;
  status?: number;
  contentType?: string | null;
  bytes?: number;
  entries?: number;
}

export interface LlmSurfaceLink {
  href: string;
  type: string;
  rel: string;
  /** How the alternate was discovered: a declared `<link rel="alternate">`, or a real `<a href="…">`. */
  source: 'link' | 'anchor';
  /**
   * True when this alternate belongs to the requested page (a declared `<link>`, or a
   * same-origin `<a>` whose path is this page's path + `.md`/`.txt`). Only page-level
   * candidates are auto-recommended; other anchors are reported but not auto-chosen.
   */
  page_level: boolean;
}

export interface LlmSurfaceReport {
  url: string;
  origin: string;
  llms_txt: LlmSurfaceEndpoint;
  llms_full: LlmSurfaceEndpoint;
  sitemap: LlmSurfaceEndpoint;
  markdown_alternates: LlmSurfaceLink[];
  content_negotiation: { accepts_markdown: boolean; content_type: string | null };
  /** The fetchable representation, or `null` when the site advertises none (see `next`). */
  recommended: LlmSurfaceKind | null;
  /** Scope of `recommended` (`null` when `recommended` is `null`). */
  scope: LlmSurfaceScope | null;
  /** The unambiguous next step — always present, whatever `recommended` is. */
  next: LlmSurfaceNext;
  notes: string[];
}

export interface LlmFetchResult {
  as: LlmSurfaceKind;
  url: string;
  /** What the returned content actually covers. */
  scope: LlmSurfaceScope;
  /** True when a specific page was requested but only an origin-level index could be returned. */
  scope_mismatch: boolean;
  contentType: string | null;
  bytes: number;
  content: string;
  via: 'net.fetch' | 'navigation';
}

/** Result of the composite `read_url`: always Markdown text, paged for long documents. */
export interface ReadUrlResult {
  url: string;
  via: 'llm_fetch' | 'render';
  /** The representation kind when `via === 'llm_fetch'`, else null. */
  as: LlmSurfaceKind | null;
  scope: LlmSurfaceScope;
  scope_mismatch: boolean;
  contentType: string | null;
  title?: string;
  /** Total characters before `max_chars`/`cursor` paging. */
  total: number;
  offset: number;
  /** Offset to pass back as `cursor` for the next slice, or null when complete. */
  next_cursor: number | null;
  truncated: boolean;
  content: string;
  /** Why the cheap path was not used (present only when `via === 'render'`). */
  reason?: string;
}

export interface LlmSurfaceDeps {
  getSession: () => Session;
  getActiveWebContents?: () => WebContents | null;
  /** Loads a URL as a real document navigation and returns its text (Tier B). */
  navigateForText?: (url: string) => Promise<{ body: string | null; contentType: string | null; status: number }>;
  /** Renders a URL in a detached view and distils it to Markdown (composite `read_url` fallback). */
  renderPage?: (url: string) => Promise<{ markdown: string; title?: string; status: number; contentType?: string | null }>;
  userAgent?: string;
  log?: (level: 'info' | 'warn' | 'action', message: string) => void;
  ttlMs?: number;
}

interface OriginProbe {
  llms_txt: LlmSurfaceEndpoint;
  llms_full: LlmSurfaceEndpoint;
  sitemap: LlmSurfaceEndpoint;
  notes: string[];
}

interface PageProbe {
  markdown_alternates: LlmSurfaceLink[];
  content_negotiation: { accepts_markdown: boolean; content_type: string | null };
}

const TEXT_ACCEPT = 'text/plain, text/markdown, application/xml, text/xml, */*';
const NEGOTIATE_ACCEPT = 'text/markdown, text/plain, text/html;q=0.8, */*;q=0.5';

const MARKDOWN_LINK_RE = /markdown|\.md($|[?#])/i;
const TEXT_LINK_RE = /\.txt($|[?#])/i;
/** Default page budget for `read_url` (a long ToS page exceeds a single call). */
const DEFAULT_READ_CHARS = 20_000;
const MAX_READ_CHARS = 50_000;

function coded(code: string, message: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export class LlmSurface {
  private originCache = new Map<string, { at: number; data: OriginProbe }>();
  private pageCache = new Map<string, { at: number; data: PageProbe }>();
  private readonly ttlMs: number;

  constructor(private deps: LlmSurfaceDeps) {
    this.ttlMs = deps.ttlMs ?? 10 * 60 * 1000;
  }

  /** Reports what LLM-friendly surfaces a site/page offers. */
  public async probe(url?: string): Promise<LlmSurfaceReport> {
    const target = this.resolveUrl(url);
    const origin = new URL(target).origin;
    const isPage = this.isPageUrl(target);

    const originProbe = await this.probeOrigin(origin);
    const pageProbe = await this.probePage(target);
    const recommended = this.recommend(originProbe, pageProbe, isPage);
    const scope = recommended ? this.kindScope(recommended) : null;

    const notes = [...originProbe.notes];
    if (scope === 'origin' && isPage) {
      notes.push(
        `only an origin-level index is available for this page — ${origin} advertised no page-level representation`,
      );
    }
    const anchors = pageProbe.markdown_alternates.filter((a) => a.source === 'anchor').length;
    if (anchors > 0) notes.push(`discovered ${anchors} Markdown/Text alternate link(s) from page anchors`);

    this.deps.log?.('info', `llm_surface ${origin} → ${recommended ?? 'none (render)'}`);

    return {
      url: target,
      origin,
      llms_txt: originProbe.llms_txt,
      llms_full: originProbe.llms_full,
      sitemap: originProbe.sitemap,
      markdown_alternates: pageProbe.markdown_alternates,
      content_negotiation: pageProbe.content_negotiation,
      recommended,
      scope,
      next: recommended ? { tool: 'llm_fetch', as: recommended } : { tool: 'observe', as: 'markdown' },
      notes,
    };
  }

  /** Fetches an advertised LLM-friendly representation. Gated on a confirmed surface. */
  public async fetch(opts: { url?: string; as?: LlmSurfaceKind } = {}): Promise<LlmFetchResult> {
    const report = await this.probe(opts.url);
    const as = opts.as || report.recommended;

    if (!as) {
      throw coded(
        'NO_LLM_SURFACE',
        `${report.origin} advertises no LLM-friendly surface — read ${report.url} with observe(as:"markdown") or read_url.`,
      );
    }

    let target: string | undefined;
    let viaAlternate = false;

    if (as === 'llms_txt') {
      target = report.llms_txt.found ? report.llms_txt.url : undefined;
    } else if (as === 'llms_full') {
      target = report.llms_full.found ? report.llms_full.url : undefined;
    } else if (as === 'markdown' || as === 'text') {
      const wantMd = as === 'markdown';
      const matches = (a: LlmSurfaceLink) =>
        wantMd ? MARKDOWN_LINK_RE.test(a.type + ' ' + a.href) : a.type === 'text/plain' || TEXT_LINK_RE.test(a.href);
      // Prefer a page-level alternate (declared <link>, or this page's own ".md" sibling);
      // fall back to any advertised match so an explicit request still resolves.
      const alt = report.markdown_alternates.find((a) => a.page_level && matches(a)) || report.markdown_alternates.find(matches);
      if (alt) {
        target = alt.href;
        viaAlternate = true;
      } else if (report.content_negotiation.accepts_markdown) {
        target = report.url;
      }
    } else {
      throw coded('BAD_REQUEST', `Unknown "as" value "${as}" — expected llms_txt | llms_full | markdown | text.`);
    }

    if (!target) {
      throw coded('NO_LLM_SURFACE', `${report.url} has no advertised "${as}" representation.`);
    }

    const scope = this.kindScope(as);
    // The caller pointed at a page but the only representation is the site-wide index.
    const scope_mismatch = scope === 'origin' && this.isPageUrl(report.url);

    // Tier B — an advertised per-page alternate: real document navigation.
    if (viaAlternate && this.deps.navigateForText) {
      const r = await this.deps.navigateForText(target);
      const ct = (r.contentType || '').toLowerCase();
      if (r.status >= 400 || ct.includes('text/html') || !r.body) {
        throw coded('FETCH_BLOCKED', `Advertised alternate ${target} did not return Markdown/Text (status ${r.status}, type ${ct || 'unknown'}).`);
      }
      return { as, url: target, scope, scope_mismatch, contentType: ct || null, bytes: r.body.length, content: r.body, via: 'navigation' };
    }

    // Tier A — header-driven resource fetch (static well-known files, or a negotiated page).
    const r = await this.netGet(target, as === 'markdown' ? NEGOTIATE_ACCEPT : TEXT_ACCEPT, 'GET');
    if (r.status >= 400) throw coded('FETCH_BLOCKED', `${target} returned HTTP ${r.status}.`);
    if (this.isHtml(r.contentType)) throw coded('FETCH_BLOCKED', `${target} returned text/html, not Markdown/Text.`);
    return { as, url: target, scope, scope_mismatch, contentType: r.contentType, bytes: r.bytes, content: r.body, via: 'net.fetch' };
  }

  /**
   * The composite read (issue #1): probe → the site's own Markdown/Text when it
   * advertises one → otherwise a *detached* render distilled to Markdown. Always
   * returns text, so a caller never branches on `recommended`, and paged so a long
   * document is never silently truncated.
   */
  public async readUrl(
    opts: { url?: string; maxChars?: number; cursor?: number | string; as?: LlmSurfaceKind } = {},
  ): Promise<ReadUrlResult> {
    const report = await this.probe(opts.url);
    const url = report.url;
    const wantKind = opts.as || report.recommended;

    // An explicit `as` always wins. Otherwise, only take a *fetchable* representation when it
    // actually covers the thing the caller asked for: a page wants a `page`-scoped surface. If
    // the only thing on offer is a site-wide index (`origin`) for a page URL, render the page
    // instead — returning the site index would answer a different question.
    if (wantKind && (opts.as || report.scope === 'page' || !this.isPageUrl(url))) {
      try {
        const r = await this.fetch({ url, as: wantKind });
        return this.page({
          url: r.url,
          via: 'llm_fetch',
          as: r.as,
          scope: r.scope,
          scope_mismatch: r.scope_mismatch,
          contentType: r.contentType,
          full: r.content,
          opts,
        });
      } catch (err: any) {
        // Advertised but unfetchable → fall through to a render, reporting why.
        return await this.renderFallback(url, `advertised ${wantKind} fetch failed: ${err?.message || err}`, opts);
      }
    }

    if (wantKind) {
      // Only an origin-level index exists for this page (e.g. a site-wide /llms.txt).
      return await this.renderFallback(url, `only the site-wide ${wantKind} index is available for this page`, opts);
    }

    return await this.renderFallback(url, 'no advertised LLM surface (recommended: null)', opts);
  }

  public clearCache(): void {
    this.originCache.clear();
    this.pageCache.clear();
  }

  // ---- internals ----------------------------------------------------------

  /** Renders `url` in the shared detached view and distils it to Markdown (composite fallback). */
  private async renderFallback(
    url: string,
    reason: string,
    opts: { maxChars?: number; cursor?: number | string },
  ): Promise<ReadUrlResult> {
    if (!this.deps.renderPage) {
      throw coded('NOT_SUPPORTED', `No render fallback is wired for read_url (cannot render ${url}).`);
    }
    const r = await this.deps.renderPage(url);
    if (!r.markdown) {
      throw coded('FETCH_BLOCKED', `Rendering ${url} produced no text (status ${r.status}).`);
    }
    return this.page({
      url,
      via: 'render',
      as: null,
      scope: 'page',
      scope_mismatch: false,
      contentType: r.contentType ?? 'text/markdown',
      title: r.title,
      full: r.markdown,
      opts,
      reason,
    });
  }

  /** Applies `max_chars`/`cursor` paging to a full document and shapes the result. */
  private page(input: {
    url: string;
    via: 'llm_fetch' | 'render';
    as: LlmSurfaceKind | null;
    scope: LlmSurfaceScope;
    scope_mismatch: boolean;
    contentType: string | null;
    title?: string;
    full: string;
    opts: { maxChars?: number; cursor?: number | string };
    reason?: string;
  }): ReadUrlResult {
    const full = input.full || '';
    const max = Math.min(Math.max(Number(input.opts.maxChars) || DEFAULT_READ_CHARS, 500), MAX_READ_CHARS);
    const offset = Math.max(Math.floor(Number(input.opts.cursor)) || 0, 0);
    const content = full.slice(offset, offset + max);
    const end = offset + content.length;
    const truncated = end < full.length;
    return {
      url: input.url,
      via: input.via,
      as: input.as,
      scope: input.scope,
      scope_mismatch: input.scope_mismatch,
      contentType: input.contentType,
      title: input.title,
      total: full.length,
      offset,
      next_cursor: truncated ? end : null,
      truncated,
      content,
      reason: input.reason,
    };
  }

  /** A URL with a non-root path is "a page", which should prefer a page-level representation. */
  private isPageUrl(u: string): boolean {
    try {
      return new URL(u).pathname.replace(/\/+$/, '').length > 0;
    } catch {
      return false;
    }
  }

  private kindScope(kind: LlmSurfaceKind): LlmSurfaceScope {
    return kind === 'llms_txt' || kind === 'llms_full' ? 'origin' : 'page';
  }

  private resolveUrl(url?: string): string {
    const candidate = (url || '').trim();
    if (candidate) {
      if (!/^https?:\/\//i.test(candidate)) throw coded('BAD_REQUEST', `llm_surface needs an http(s) URL (got "${candidate}").`);
      return candidate;
    }
    const wc = this.deps.getActiveWebContents?.();
    const current = wc?.getURL?.() || '';
    if (!/^https?:\/\//i.test(current)) throw coded('BAD_REQUEST', 'No URL given and the active tab is not on an http(s) page.');
    return current;
  }

  private async probeOrigin(origin: string): Promise<OriginProbe> {
    const hit = this.originCache.get(origin);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data;

    const notes: string[] = [];
    const probe = async (path: string, kind: 'text' | 'xml'): Promise<LlmSurfaceEndpoint> => {
      const url = origin + path;
      try {
        const r = await this.netGet(url, TEXT_ACCEPT, 'GET');
        const okStatus = r.status >= 200 && r.status < 400;
        const found = okStatus && this.isTextual(r.contentType) && !this.isHtml(r.contentType) && r.bytes > 0;
        const ep: LlmSurfaceEndpoint = { found, url, status: r.status, contentType: r.contentType, bytes: r.bytes };
        if (kind === 'xml' && found) ep.entries = (r.body.match(/<loc[ >]/gi) || []).length;
        if (!found && okStatus && this.isHtml(r.contentType)) notes.push(`${path} served text/html (not an LLM surface)`);
        return ep;
      } catch (err: any) {
        notes.push(`${path}: ${err?.message || 'request failed'}`);
        return { found: false, url, status: 0, contentType: null, bytes: 0 };
      }
    };

    const llms_txt = await probe('/llms.txt', 'text');
    const llms_full = llms_txt.found
      ? await probe('/llms-full.txt', 'text')
      : ({ found: false, url: origin + '/llms-full.txt' } as LlmSurfaceEndpoint);
    const sitemap = await probe('/sitemap.xml', 'xml');

    const data: OriginProbe = { llms_txt, llms_full, sitemap, notes };
    this.originCache.set(origin, { at: Date.now(), data });
    return data;
  }

  private async probePage(url: string): Promise<PageProbe> {
    const key = this.normalize(url);
    const hit = this.pageCache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data;

    // 1. Per-page alternates — read from the live DOM, and only when this IS the
    //    active page (zero extra requests; never a speculative fetch of a URL).
    //    A page that is still parsing (or a tab still committing its navigation, which
    //    may not report the target URL yet) yields an *inconclusive* read: it is
    //    returned but NOT cached, so a half-loaded page cannot poison the probe for
    //    the whole TTL.
    let markdown_alternates: LlmSurfaceLink[] = [];
    let domConclusive = true;
    try {
      const wc = this.deps.getActiveWebContents?.();
      if (wc) {
        const wcUrl = wc.getURL?.() || '';
        if (this.normalize(wcUrl) === key) {
          const r = await this.readAlternates(wc);
          markdown_alternates = r.links;
          domConclusive = r.ready;
        } else if (!wcUrl || wcUrl === 'about:blank' || wc.isLoading?.()) {
          // The active tab is mid-navigation and may commit to `key` a moment from now.
          domConclusive = false;
        }
      }
    } catch {
      /* DOM probe is best-effort */
    }

    // 2. Content negotiation — a single HEAD. A Markdown-aware server answers text/markdown.
    let content_negotiation: PageProbe['content_negotiation'] = { accepts_markdown: false, content_type: null };
    try {
      const r = await this.netGet(url, NEGOTIATE_ACCEPT, 'HEAD');
      const ct = (r.contentType || '').split(';')[0].trim().toLowerCase();
      content_negotiation = {
        accepts_markdown: r.status < 400 && (ct === 'text/markdown' || ct === 'text/plain'),
        content_type: r.contentType || null,
      };
    } catch (err: any) {
      this.deps.log?.('info', `llm_surface negotiation HEAD failed for ${url}: ${err?.message || err}`);
    }

    const data: PageProbe = { markdown_alternates, content_negotiation };
    if (domConclusive) this.pageCache.set(key, { at: Date.now(), data });
    return data;
  }

  private async readAlternates(wc: WebContents): Promise<{ links: LlmSurfaceLink[]; ready: boolean }> {
    // Read what the live page *actually offers*: a declared <link rel="alternate">, and
    // real <a href="….md|.txt"> anchors (a self-link to the Markdown sibling, or a
    // "View as Markdown" link). We never construct or guess a path.
    // `ready` is false while the document is still parsing, so the caller can avoid
    // caching an empty result read from a half-loaded page.
    const script = `(() => {
      const out = [];
      const push = (href, type, rel, source) => { if (href) out.push({ href, type: (type || '').toLowerCase(), rel: (rel || '').toLowerCase(), source }); };
      for (const l of document.querySelectorAll('link[rel~="alternate"]')) {
        push(l.href, l.getAttribute('type'), l.getAttribute('rel'), 'link');
      }
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href || '';
        if (!/^https?:/i.test(href)) continue;
        if (!/\\.md($|[?#])/i.test(href) && !/\\.txt($|[?#])/i.test(href)) continue;
        push(href, '', a.getAttribute('rel'), 'anchor');
      }
      return { ready: document.readyState !== 'loading', links: out };
    })()`;
    const raw = await wc.executeJavaScript(script).catch(() => null);
    const rawLinks: any[] = Array.isArray((raw as any)?.links) ? (raw as any).links : [];
    const ready = (raw as any)?.ready !== false;

    let page: URL | null = null;
    try {
      page = new URL(wc.getURL?.() || '');
    } catch {
      page = null;
    }

    const isMd = (l: { type: string; href: string }) => MARKDOWN_LINK_RE.test(l.type + ' ' + l.href);
    const isTxt = (l: { type: string; href: string }) => l.type === 'text/plain' || TEXT_LINK_RE.test(l.href);

    interface Candidate {
      link: LlmSurfaceLink;
      rank: number;
    }
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    for (const l of rawLinks) {
      const href = String(l?.href || '');
      if (!href || seen.has(href)) continue;
      const source: 'link' | 'anchor' = l?.source === 'link' ? 'link' : 'anchor';
      const link: LlmSurfaceLink = {
        href,
        type: String(l?.type || ''),
        rel: String(l?.rel || 'alternate'),
        source,
        page_level: source === 'link',
      };
      if (!isMd(link) && !isTxt(link)) continue;

      // Rank so the most trustworthy candidate wins: a declared <link> first, then this
      // page's own ".md/.txt" sibling, then other same-origin anchors, then cross-origin.
      let rank = source === 'link' ? 0 : 100;
      if (source === 'anchor') {
        try {
          const h = new URL(href);
          if (!page || h.origin !== page.origin) {
            rank += 60;
          } else {
            const sibling = page.pathname.replace(/\/$/, '') + (isMd(link) ? '.md' : '.txt');
            if (h.pathname === sibling) {
              rank -= 50;
              link.page_level = true;
            } else {
              rank += 10;
            }
          }
        } catch {
          rank += 80;
        }
      }

      seen.add(href);
      candidates.push({ link, rank });
    }

    candidates.sort((a, b) => a.rank - b.rank);
    return { links: candidates.slice(0, 10).map((c) => c.link), ready };
  }

  private recommend(origin: OriginProbe, page: PageProbe, isPage: boolean): LlmSurfaceKind | null {
    const pageMd = page.markdown_alternates.find((a) => a.page_level && MARKDOWN_LINK_RE.test(a.type + ' ' + a.href));
    const pageAny = page.markdown_alternates.find((a) => a.page_level);

    // For a specific page, a page-level representation beats a site-wide index — the
    // caller asked for THIS page. An origin index is still offered when it is the only
    // option; `probe()` then flags the scope mismatch in `notes`/`scope_mismatch`.
    if (isPage) {
      if (pageMd) return 'markdown';
      if (page.content_negotiation.accepts_markdown) return 'markdown';
      if (pageAny) return 'text';
    }
    if (origin.llms_txt.found) return 'llms_txt';
    if (origin.llms_full.found) return 'llms_full';
    if (pageMd) return 'markdown';
    if (pageAny) return 'text';
    if (page.content_negotiation.accepts_markdown) return 'markdown';
    return null;
  }

  private async netGet(
    url: string,
    accept: string,
    method: 'GET' | 'HEAD',
  ): Promise<{ status: number; contentType: string | null; body: string; bytes: number }> {
    const session = this.deps.getSession();
    const headers: Record<string, string> = { Accept: accept };
    if (this.deps.userAgent) headers['User-Agent'] = this.deps.userAgent;
    const res = await net.fetch(url, { method, headers, session, redirect: 'follow' } as any);
    const contentType = res.headers.get('content-type');
    const body = method === 'HEAD' ? '' : await res.text();
    return { status: res.status, contentType, body, bytes: body.length };
  }

  private isTextual(ct: string | null): boolean {
    if (!ct) return false;
    const t = ct.split(';')[0].trim().toLowerCase();
    return t.startsWith('text/') || t === 'application/xml' || t === 'application/json';
  }

  private isHtml(ct: string | null): boolean {
    if (!ct) return false;
    return ct.split(';')[0].trim().toLowerCase() === 'text/html';
  }

  private normalize(u: string): string {
    try {
      const x = new URL(u);
      x.hash = '';
      return x.toString().replace(/\/$/, '');
    } catch {
      return (u || '').trim();
    }
  }
}
