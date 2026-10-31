/**
 * Just-Enough-View (JEV) page compaction.
 *
 * Tier 1 is a small surface index (headings, token weights, one-line digests)
 * that replaces a full page dump in the agent's context. Tier 2 is the in-memory
 * depth store: sanitized markdown chunks keyed by deterministic IDs, fetched on
 * demand via read_section/search_page. The store is scoped to the page URL and
 * discarded when the page changes.
 */

export interface JevSection {
  id: string;
  level: number;
  heading: string;
  tokens: number;
  digest: string;
  text: string;
  parent?: string;
  children: string[];
}

export interface JevSession {
  url: string;
  title: string;
  builtAt: number;
  sections: Map<string, JevSection>;
  order: string[];
  totalTokens: number;
}

export interface JevStatus {
  enabled: boolean;
  ready: boolean;
  url?: string;
  title?: string;
  sections?: number;
  totalTokens?: number;
  indexTokens?: number;
  expandedTokens?: number;
}

export interface JevSearchHit {
  section_id: string;
  heading: string;
  matches: number;
  snippet: string;
}

const TOKEN_RATIO = 4;
const FOLD_THRESHOLD = 6000;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

const estimateTokens = (text: string): number => Math.ceil(String(text || '').length / TOKEN_RATIO);

/** First declarative sentence from the first paragraph-like lines. */
function digestFor(lines: string[]): string {
  const paragraph: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (paragraph.length) break;
      continue;
    }
    if (/^(```|>|\||[-*]\s|\d+\.\s|<)/.test(line)) continue;
    paragraph.push(line);
    if (paragraph.length >= 2) break;
  }
  const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(/^(.{20,160}?[.!?])(\s|$)/);
  const sentence = (match ? match[1] : text).trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

export class JevEngine {
  private session: JevSession | null = null;
  private expanded = new Map<string, number>();

  /** Build (or rebuild) the depth store from clean markdown. */
  build(markdown: string, url: string, title: string): JevSession {
    const lines = String(markdown || '').split('\n');
    const headings: Array<{ line: number; level: number; text: string }> = [];
    lines.forEach((raw, index) => {
      const match = raw.match(HEADING_RE);
      if (match) headings.push({ line: index, level: match[1].length, text: match[2].replace(/#+\s*$/, '').trim() });
    });

    const sections = new Map<string, JevSection>();
    const order: string[] = [];
    const minLevel = headings.length ? Math.min(...headings.map((heading) => heading.level)) : 0;

    const addSection = (id: string, level: number, heading: string, body: string, parent?: string): void => {
      const text = `${'#'.repeat(Math.max(1, level))} ${heading}\n${body}`.trim();
      const section: JevSection = {
        id,
        level,
        heading: heading || 'Page',
        tokens: estimateTokens(text),
        digest: digestFor(body.split('\n')),
        text,
        parent,
        children: [],
      };
      sections.set(id, section);
      order.push(id);
      if (parent) sections.get(parent)?.children.push(id);
    };

    if (!headings.length) {
      addSection('sec_0', 1, title || 'Page', lines.join('\n'));
    } else {
      const preamble = lines.slice(0, headings[0].line).join('\n').trim();
      if (preamble) addSection('sec_0', 1, title || 'Overview', preamble);
      const path: number[] = [];
      const stack: string[] = [];
      let topIndex = preamble ? 1 : 0;
      headings.forEach((heading, index) => {
        const depth = Math.max(0, heading.level - minLevel);
        while (path.length <= depth) path.push(0);
        path.length = depth + 1;
        if (depth === 0) path[0] = topIndex++;
        else path[depth] += 1;
        const id = `sec_${path.join('.')}`;
        const bodyStart = heading.line + 1;
        const bodyEnd = index + 1 < headings.length ? headings[index + 1].line : lines.length;
        addSection(id, heading.level, heading.text, lines.slice(bodyStart, bodyEnd).join('\n'), depth > 0 ? stack[depth - 1] : undefined);
        stack.length = depth + 1;
        stack[depth] = id;
      });
    }

    this.session = {
      url,
      title,
      builtAt: Date.now(),
      sections,
      order,
      totalTokens: estimateTokens(markdown),
    };
    this.expanded.clear();
    return this.session;
  }

  /** Drop the depth store (navigation/tab change). */
  purge(): void {
    this.session = null;
    this.expanded.clear();
  }

  get current(): JevSession | null {
    return this.session;
  }

  status(enabled: boolean): JevStatus {
    const session = this.session;
    const index = session ? this.renderIndex(session) : '';
    return {
      enabled,
      ready: Boolean(session),
      url: session?.url,
      title: session?.title,
      sections: session?.order.length,
      totalTokens: session?.totalTokens,
      indexTokens: index ? estimateTokens(index) : undefined,
      expandedTokens: this.expandedTotal(),
    };
  }

  /** Surface-index wire format (Tier 1). */
  renderIndex(session: JevSession = this.session as JevSession): string {
    if (!session) return '';
    const fmt = (value: number): string => value.toLocaleString('en-US');
    const lines: string[] = [];
    lines.push('<!-- JEV_SURFACE_INDEX -->');
    lines.push(`# Page: ${session.title || 'Untitled'} (${session.url})`);
    lines.push(`Total Content: ~${fmt(session.totalTokens)} tokens | Index: ~__INDEX_TOKENS__ tokens`);
    lines.push('');
    lines.push('## Page Sections');
    const render = (id: string, indent: string): void => {
      const section = session.sections.get(id);
      if (!section) return;
      lines.push(`${indent}- [${section.id}] ${section.heading} (Tokens: ${fmt(section.tokens)})`);
      if (section.digest) lines.push(`${indent}  > Summary: ${section.digest}`);
      for (const child of section.children) render(child, `${indent}  `);
    };
    for (const id of session.order) {
      const section = session.sections.get(id);
      if (section && !section.parent) render(id, '');
    }
    lines.push('<!-- END_INDEX -->');
    lines.push('');
    lines.push('Fetch a section body with read_section(section_id), or query the whole page with search_page(query).');
    const body = lines.join('\n');
    const indexTokens = estimateTokens(body.replace('__INDEX_TOKENS__', ''));
    return body.replace('__INDEX_TOKENS__', fmt(indexTokens));
  }

  readSection(sectionId: string, includeChildren = false): {
    ok: boolean;
    section_id?: string;
    tokens?: number;
    content?: string;
    folded?: string[];
    error?: string;
  } {
    const session = this.session;
    if (!session) return { ok: false, error: 'No JEV index for this page yet. Call jev_index first.' };
    const id = String(sectionId || '').trim();
    const section = session.sections.get(id);
    if (!section) {
      return {
        ok: false,
        error: `Unknown section_id "${id}". Available: ${session.order.slice(0, 8).join(', ')}${session.order.length > 8 ? '…' : ''}`,
      };
    }
    const collect = (target: JevSection): string => {
      const parts = [target.text];
      if (includeChildren) for (const child of target.children) {
        const childSection = session.sections.get(child);
        if (childSection) parts.push(collect(childSection));
      }
      return parts.join('\n\n');
    };
    const content = collect(section);
    this.expanded.set(id, estimateTokens(content));
    return {
      ok: true,
      section_id: id,
      tokens: estimateTokens(content),
      content,
      folded: this.foldSuggestions(),
    };
  }

  /** Keyword search across the folded depth store without expanding it. */
  search(query: string, limit = 8): { ok: boolean; hits?: JevSearchHit[]; error?: string } {
    const session = this.session;
    if (!session) return { ok: false, error: 'No JEV index for this page yet. Call jev_index first.' };
    const needle = String(query || '').trim();
    if (!needle) return { ok: false, error: 'search_page requires a non-empty query.' };
    let pattern: RegExp;
    try {
      pattern = new RegExp(needle, 'gi');
    } catch {
      pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }
    const hits: JevSearchHit[] = [];
    for (const id of session.order) {
      const section = session.sections.get(id);
      if (!section) continue;
      const matches = section.text.match(pattern);
      if (!matches?.length) continue;
      const at = section.text.search(pattern);
      const start = Math.max(0, at - 60);
      const snippet = section.text.slice(start, Math.min(section.text.length, at + 120)).replace(/\s+/g, ' ').trim();
      hits.push({ section_id: id, heading: section.heading, matches: matches.length, snippet });
      if (hits.length >= limit) break;
    }
    return { ok: true, hits };
  }

  private expandedTotal(): number {
    let total = 0;
    for (const tokens of this.expanded.values()) total += tokens;
    return total;
  }

  /** When expanded sections exceed the ceiling, suggest folding the oldest. */
  private foldSuggestions(): string[] | undefined {
    if (this.expandedTotal() <= FOLD_THRESHOLD) return undefined;
    const suggestions: string[] = [];
    const entries = [...this.expanded.entries()];
    for (const [id, tokens] of entries) {
      suggestions.push(`[Section ${id} folded (${tokens} tokens). Call read_section(section_id="${id}") to restore.]`);
    }
    return suggestions.slice(0, 4);
  }
}
