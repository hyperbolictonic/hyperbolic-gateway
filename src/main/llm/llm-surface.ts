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
 *    negotiation. Results are cached per origin so we never repeat-hit.
 *  - `fetch()` is **gated**: it refuses with `NO_LLM_SURFACE` unless a probe
 *    confirmed an *advertised* surface. It never guesses paths and never fetches
 *    an arbitrary URL.
 *  - An advertised **per-page alternate** is loaded via a real document
 *    navigation (injected `navigateForText`), not a synthetic fetch, so the
 *    request carries Chromium's full header + renderer fingerprint.
 *  - A response that comes back `text/html` (or 4xx/5xx) is treated as "no
 *    surface" — never mislabelled as Markdown.
 */
import { net, type Session, type WebContents } from 'electron';

export type LlmSurfaceKind = 'llms_txt' | 'llms_full' | 'markdown' | 'text' | 'rendered';

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
}

export interface LlmSurfaceReport {
  url: string;
  origin: string;
  llms_txt: LlmSurfaceEndpoint;
  llms_full: LlmSurfaceEndpoint;
  sitemap: LlmSurfaceEndpoint;
  markdown_alternates: LlmSurfaceLink[];
  content_negotiation: { accepts_markdown: boolean; content_type: string | null };
  recommended: LlmSurfaceKind;
  notes: string[];
}

export interface LlmFetchResult {
  as: string;
  url: string;
  contentType: string | null;
  bytes: number;
  content: string;
  via: 'net.fetch' | 'navigation';
}

export interface LlmSurfaceDeps {
  getSession: () => Session;
  getActiveWebContents?: () => WebContents | null;
  /** Loads a URL as a real document navigation and returns its text (Tier B). */
  navigateForText?: (url: string) => Promise<{ body: string | null; contentType: string | null; status: number }>;
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

    const originProbe = await this.probeOrigin(origin);
    const pageProbe = await this.probePage(target);
    const recommended = this.recommend(originProbe, pageProbe);

    this.deps.log?.('info', `llm_surface ${origin} → ${recommended}`);

    return {
      url: target,
      origin,
      llms_txt: originProbe.llms_txt,
      llms_full: originProbe.llms_full,
      sitemap: originProbe.sitemap,
      markdown_alternates: pageProbe.markdown_alternates,
      content_negotiation: pageProbe.content_negotiation,
      recommended,
      notes: originProbe.notes,
    };
  }

  /** Fetches an advertised LLM-friendly representation. Gated on a confirmed surface. */
  public async fetch(opts: { url?: string; as?: LlmSurfaceKind } = {}): Promise<LlmFetchResult> {
    const report = await this.probe(opts.url);
    const as = opts.as || report.recommended;

    if (as === 'rendered' || report.recommended === 'rendered') {
      throw coded(
        'NO_LLM_SURFACE',
        `${report.origin} advertises no LLM-friendly surface — read it with observe(as:"markdown").`,
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
      const alt = report.markdown_alternates.find((a) =>
        wantMd ? /markdown|\.md($|[?#])/i.test(a.type + ' ' + a.href) : a.type === 'text/plain' || /\.txt($|[?#])/i.test(a.href),
      );
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

    // Tier B — an advertised per-page alternate: real document navigation.
    if (viaAlternate && this.deps.navigateForText) {
      const r = await this.deps.navigateForText(target);
      const ct = (r.contentType || '').toLowerCase();
      if (r.status >= 400 || ct.includes('text/html') || !r.body) {
        throw coded('FETCH_BLOCKED', `Advertised alternate ${target} did not return Markdown/Text (status ${r.status}, type ${ct || 'unknown'}).`);
      }
      return { as, url: target, contentType: ct || null, bytes: r.body.length, content: r.body, via: 'navigation' };
    }

    // Tier A — header-driven resource fetch (static well-known files, or a negotiated page).
    const r = await this.netGet(target, as === 'markdown' ? NEGOTIATE_ACCEPT : TEXT_ACCEPT, 'GET');
    if (r.status >= 400) throw coded('FETCH_BLOCKED', `${target} returned HTTP ${r.status}.`);
    if (this.isHtml(r.contentType)) throw coded('FETCH_BLOCKED', `${target} returned text/html, not Markdown/Text.`);
    return { as, url: target, contentType: r.contentType, bytes: r.bytes, content: r.body, via: 'net.fetch' };
  }

  public clearCache(): void {
    this.originCache.clear();
    this.pageCache.clear();
  }

  // ---- internals ----------------------------------------------------------

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
    let markdown_alternates: LlmSurfaceLink[] = [];
    try {
      const wc = this.deps.getActiveWebContents?.();
      if (wc && this.normalize(wc.getURL()) === key) {
        markdown_alternates = await this.readAlternates(wc);
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
    this.pageCache.set(key, { at: Date.now(), data });
    return data;
  }

  private async readAlternates(wc: WebContents): Promise<LlmSurfaceLink[]> {
    const script = `(() => Array.from(document.querySelectorAll('link[rel~="alternate"]')).map((l) => ({
      href: l.href || '',
      type: (l.getAttribute('type') || '').toLowerCase(),
      rel: (l.getAttribute('rel') || '').toLowerCase(),
    })).filter((l) => l.href && (l.type.includes('markdown') || l.type === 'text/plain' || /\\.md($|[?#])/i.test(l.href) || /\\.txt($|[?#])/i.test(l.href))))()`;
    const raw = await wc.executeJavaScript(script).catch(() => []);
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 10).map((l: any) => ({
      href: String(l.href),
      type: String(l.type || ''),
      rel: String(l.rel || 'alternate'),
    }));
  }

  private recommend(origin: OriginProbe, page: PageProbe): LlmSurfaceKind {
    if (origin.llms_txt.found) return 'llms_txt';
    if (origin.llms_full.found) return 'llms_full';
    if (page.markdown_alternates.some((a) => /markdown|\.md($|[?#])/i.test(a.type + ' ' + a.href))) return 'markdown';
    if (page.markdown_alternates.length > 0) return 'text';
    if (page.content_negotiation.accepts_markdown) return 'markdown';
    return 'rendered';
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
