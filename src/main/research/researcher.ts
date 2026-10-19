/**
 * `research_topic` — autonomous research mode (TODO_RESEARCH_CRAWL.md §5, Feature 3).
 *
 * search → fetch the top sources (cheap `llm` path first) → distill to Markdown → index into
 * LanceDB Cortex → return **extractive**, cited evidence.
 *
 * It is deliberately **not** a summarizer: Kuang has no LLM, so the tool gathers and ranks cited
 * evidence (per-source highlights are paragraphs from the sources that mention the query terms)
 * and leaves the prose synthesis to the calling agent. Sources are indexed into Cortex so the
 * agent can follow up with `recall_memory`.
 */
import type { SearchOutcome, SearchAttempt } from '../search/search-engine.js';
import type { CrawlOptions, CrawlOutcome } from '../crawl/crawler.js';

export interface ResearchOptions {
  query: string;
  /** Distinct sources to gather (default 5, max 8). */
  maxSources?: number;
  engine?: string;
  engines?: string[];
  urlTemplate?: string;
  /** Chars of each source kept for highlighting (default 1200, max 4000). */
  excerptChars?: number;
  /** Index each source into LanceDB Cortex (default true). */
  harvestToCortex?: boolean;
  /** Try content-negotiated Markdown/Text before rendering (default true). */
  preferLlm?: boolean;
}

export interface ResearchSource {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  via: 'llm' | 'render';
  bytes: number;
  indexed: boolean;
  highlights: string[];
  error?: string;
}

export interface ResearchOutcome {
  query: string;
  engine: string | null;
  sources: ResearchSource[];
  sourceCount: number;
  cortexIndexed: number;
  searchAttempts: SearchAttempt[];
  notes: string[];
}

export interface ResearcherDeps {
  search: (
    query: string,
    opts: { engine?: string; engines?: string[]; urlTemplate?: string; max?: number },
  ) => Promise<SearchOutcome>;
  crawl: (opts: CrawlOptions) => Promise<CrawlOutcome>;
  log?: (level: 'info' | 'warn' | 'action', message: string) => void;
}

function coded(code: string, message: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Extractive highlights: paragraphs of the source that mention the most query terms, best first.
 * (Not a summary — it is a citation aid so the caller can quote real evidence.)
 */
export function extractHighlights(markdown: string, query: string, max = 3): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const paragraphs = (markdown || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/[#*>`_\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 60);
  if (!paragraphs.length) return [];

  const scored = paragraphs.map((p) => {
    const low = p.toLowerCase();
    let score = 0;
    for (const t of terms) if (low.includes(t)) score += 1;
    return { p, score };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const pool = hits.length ? hits : scored;
  return pool.slice(0, max).map((s) => s.p.slice(0, 320));
}

export class Researcher {
  constructor(private deps: ResearcherDeps) {}

  public async research(opts: ResearchOptions): Promise<ResearchOutcome> {
    const query = (opts.query || '').trim();
    if (!query) throw coded('BAD_REQUEST', 'research_topic needs a non-empty query.');

    const maxSources = clamp(opts.maxSources ?? 5, 1, 8);
    const excerptChars = clamp(opts.excerptChars ?? 1200, 200, 4000);
    const notes: string[] = [];

    const search = await this.deps.search(query, {
      engine: opts.engine,
      engines: opts.engines,
      urlTemplate: opts.urlTemplate,
      max: Math.min(maxSources * 3, 25),
    });
    const results = search.results || [];
    if (search.blocked) notes.push('A search provider returned a bot-check/consent page.');
    if (!results.length) notes.push('Search returned no results.');

    // Distinct URLs, in rank order.
    const seen = new Set<string>();
    const picked: typeof results = [];
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      picked.push(r);
      if (picked.length >= maxSources) break;
    }

    const sources: ResearchSource[] = [];
    let cortexIndexed = 0;

    for (const r of picked) {
      try {
        const crawled = await this.deps.crawl({
          startUrl: r.url,
          maxDepth: 0,
          maxPages: 1,
          delayMs: 0,
          preferLlm: opts.preferLlm !== false,
          harvestToCortex: opts.harvestToCortex !== false,
          includeContent: excerptChars,
        });
        const page = crawled.pages[0];
        cortexIndexed += crawled.cortexIndexed;
        const excerpt = page?.excerpt || '';
        sources.push({
          rank: r.rank,
          title: page?.title || r.title,
          url: r.url,
          snippet: r.snippet,
          via: page?.via || 'render',
          bytes: page?.bytes || 0,
          indexed: !!page?.indexed,
          highlights: extractHighlights(excerpt, query, 3),
          error: page?.error,
        });
      } catch (err: any) {
        sources.push({
          rank: r.rank,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          via: 'render',
          bytes: 0,
          indexed: false,
          highlights: [],
          error: err?.message || String(err),
        });
      }
    }

    if (sources.length && !sources.some((s) => s.highlights.length)) {
      notes.push('No query-term highlights found in the gathered sources — try broader terms or more sources.');
    }
    notes.push('Extractive only: sources are distilled and cited, but no prose is synthesized — the caller writes the answer.');

    const outcome: ResearchOutcome = {
      query,
      engine: search.engine,
      sources,
      sourceCount: sources.length,
      cortexIndexed,
      searchAttempts: search.attempts || [],
      notes,
    };
    this.deps.log?.('action', `research_topic "${query}" → ${sources.length} source(s), ${cortexIndexed} indexed`);
    return outcome;
  }
}
