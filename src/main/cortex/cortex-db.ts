/**
 * Kuang Grade Mark Eleven - Cortex LanceDB Memory Subsystem
 *
 * Implements persistent vector & full-text search across page visits,
 * extracted readability markdown, and research bookmarks.
 */

import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import {
  embedText,
  getEmbeddingProvider,
  listEmbeddingProviders,
  setEmbeddingProvider,
} from './embedder.js';
import { chunkMarkdown, extractDomain } from './chunker.js';
import { dataPath } from '../data-paths.js';

export interface PageHistoryRow {
  id: string;
  url: string;
  domain: string;
  title: string;
  chunk_index: number;
  content: string;
  visited_at: string;
  vector: number[];
  [key: string]: unknown;
}

export interface BookmarkRow {
  id: string;
  url: string;
  title: string;
  notes: string;
  tags: string[];
  created_at: string;
  vector: number[];
  [key: string]: unknown;
}

export interface RecallResult {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  chunkIndex: number;
  visitedAt: string;
  score?: number;
}

export interface HistoryItem {
  url: string;
  title: string;
  domain: string;
  visitedAt: string;
}

export interface UrlSuggestion {
  url: string;
  title: string;
  domain: string;
  visitedAt?: string;
  sources: Array<'history' | 'bookmark' | 'semantic'>;
  score: number;
  snippet?: string;
}

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  notes: string;
  tags: string[];
  createdAt: string;
}

export interface ScriptRow {
  id: string;
  name: string;
  description: string;
  code: string;
  domain?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  vector: number[];
  [key: string]: unknown;
}

export interface ScriptItem {
  id: string;
  name: string;
  description: string;
  code: string;
  domain?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  score?: number;
}

/** Split a search query into lowercase, punctuation-stripped terms. */
function tokenizeQuery(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * LanceDB returns list columns as Apache Arrow `Vector`s, not JS arrays, so
 * `Array.isArray` is false and using the value directly silently yields `[]`.
 * Coerce an array, an array-like/iterable (Arrow Vector), or a scalar to string[].
 */
function toStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(String);
  if (typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(value as Iterable<unknown>).map(String);
  }
  return [];
}

/** The text a bookmark query is matched against (title, notes, URL, tags). */
function bookmarkSearchText(row: any): string {
  const tags = toStringArray(row.tags).join(' ');
  return `${row.title || ''} ${row.notes || ''} ${row.url || ''} ${tags}`.toLowerCase();
}

/** Cosine similarity of two L2-normalized vectors (equal-length dot product). */
function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export class CortexDB {
  private db: lancedb.Connection | null = null;
  private historyTable: lancedb.Table | null = null;
  private bookmarksTable: lancedb.Table | null = null;
  private scriptsTable: lancedb.Table | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || dataPath('cortex');
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      this.db = await lancedb.connect(this.storageDir);
      this.selectEmbeddingProvider();
      const tables = await this.db.tableNames();

      // Initialize page_history table
      if (!tables.includes('page_history')) {
        const seedHistory: PageHistoryRow[] = [{
          id: 'seed_manual_0',
          url: 'mark-eleven://manual',
          domain: 'internal',
          title: 'Cyberdeck Manual',
          chunk_index: 0,
          content: 'Kuang Grade Mark Eleven Cyberdeck Manual - Chromium MCP Navigator with Bézier Kinematics and Multi-Tab support.',
          visited_at: new Date().toISOString(),
          vector: await embedText('Cyberdeck Manual Kuang Grade Mark Eleven Chromium MCP Navigator')
        }];
        this.historyTable = await this.db.createTable('page_history', seedHistory);
        try {
          await this.historyTable.createIndex('content', { config: lancedb.Index.fts() });
        } catch {
          // FTS indexing may fail on initial single-row table, will retry on updates
        }
      } else {
        this.historyTable = await this.db.openTable('page_history');
      }

      // Initialize bookmarks table
      if (!tables.includes('bookmarks')) {
        const seedBookmark: BookmarkRow[] = [{
          id: 'bkmk_manual',
          url: 'mark-eleven://manual',
          title: 'Cyberdeck Manual',
          notes: 'Built-in quickstart and system guide',
          tags: ['system', 'docs', 'manual'],
          created_at: new Date().toISOString(),
          vector: await embedText('Cyberdeck Manual Built-in quickstart and system guide system docs manual')
        }];
        this.bookmarksTable = await this.db.createTable('bookmarks', seedBookmark);
      } else {
        this.bookmarksTable = await this.db.openTable('bookmarks');
      }

      // Initialize scripts table
      if (!tables.includes('scripts')) {
        const seedScript: ScriptRow = {
          id: 'script_extract_links',
          name: 'extract_all_links',
          description: 'Extracts all anchor links, text, and href URLs currently present on the page into a clean array.',
          code: '(() => Array.from(document.querySelectorAll("a[href]")).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(l => l.text && l.href))()',
          domain: '*',
          tags: ['dom', 'links', 'extraction'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          vector: await embedText('extract_all_links Extracts all anchor links text and href URLs currently present on the page into a clean array dom links extraction'),
        };
        this.scriptsTable = await this.db.createTable('scripts', [seedScript]);
      } else {
        this.scriptsTable = await this.db.openTable('scripts');
      }

      this.assertEmbeddingProviderConsistency();
      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Honor KUANG_EMBEDDING_PROVIDER when it names a registered provider.
   * Unknown ids fall back to the default with a warning (never fatal).
   */
  private selectEmbeddingProvider(): void {
    const requested = process.env.KUANG_EMBEDDING_PROVIDER?.trim();
    if (!requested) return;
    try {
      setEmbeddingProvider(requested);
    } catch {
      console.warn(
        `[CortexDB] Unknown KUANG_EMBEDDING_PROVIDER "${requested}"; ` +
        `using "${getEmbeddingProvider().id}". Available: ${listEmbeddingProviders().join(', ')}`
      );
    }
  }

  /**
   * Record which embedding provider built the stored vectors, and warn when the
   * active provider differs — vectors from different models are not comparable,
   * so recall/ranking would be silently wrong until Cortex is re-embedded.
   */
  private assertEmbeddingProviderConsistency(): void {
    const active = getEmbeddingProvider();
    const metaPath = path.join(this.storageDir, 'embedding-provider.json');

    let stored: { id?: string; dim?: number } | null = null;
    try {
      if (fs.existsSync(metaPath)) {
        stored = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch {
      stored = null;
    }

    if (stored && (stored.id !== active.id || stored.dim !== active.dim)) {
      console.warn(
        `[CortexDB] Embedding provider changed: stored vectors were built with "${stored.id}" ` +
        `(dim ${stored.dim}), but the active provider is "${active.id}" (dim ${active.dim}). ` +
        `Existing Cortex vectors are not comparable until re-embedded.`
      );
    }

    try {
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ id: active.id, dim: active.dim, updatedAt: new Date().toISOString() }, null, 2)
      );
    } catch {
      // Non-fatal: the guard is best-effort bookkeeping.
    }
  }

  /**
   * Index a visited page's markdown content into LanceDB.
   */
  public async indexPage(url: string, title: string, markdown: string): Promise<number> {
    await this.initialize();
    if (!this.historyTable) return 0;
    if (!url || url === 'about:blank') return 0;

    const domain = extractDomain(url);
    const cleanTitle = title || domain || url;
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) return 0;

    const visitedAt = new Date().toISOString();
    const rows: PageHistoryRow[] = await Promise.all(chunks.map(async chunk => {
      const textToEmbed = `${cleanTitle} - ${chunk.content}`;
      return {
        id: `chunk_${Buffer.from(url).toString('base64').slice(0, 32)}_${chunk.chunkIndex}_${Date.now()}`,
        url,
        domain,
        title: cleanTitle,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        visited_at: visitedAt,
        vector: await embedText(textToEmbed)
      };
    }));

    await this.historyTable.add(rows);
    return rows.length;
  }

  /**
   * Perform hybrid/semantic recall across past page history.
   */
  public async recall(
    query: string,
    options: { limit?: number; domain?: string } = {}
  ): Promise<RecallResult[]> {
    await this.initialize();
    if (!this.historyTable || !query || query.trim().length === 0) return [];

    const limit = options.limit || 5;
    const queryVector = await embedText(query);
    const results: Map<string, RecallResult> = new Map();

    // 1. Vector Search
    try {
      let vectorQuery = this.historyTable.search(queryVector).limit(limit * 2);
      if (options.domain) {
        vectorQuery = vectorQuery.where(`domain = '${options.domain}'`);
      }
      const vecRows = await vectorQuery.toArray();
      for (const row of vecRows) {
        const key = `${row.url}#${row.chunk_index}`;
        results.set(key, {
          url: row.url,
          title: row.title,
          domain: row.domain,
          snippet: row.content,
          chunkIndex: row.chunk_index,
          visitedAt: row.visited_at,
          score: (row as any)._distance !== undefined ? 1 - (row as any)._distance : 0.8
        });
      }
    } catch (err) {
      console.warn('[CortexDB] Vector search warning:', err);
    }

    // 2. Full-Text Search (BM25)
    try {
      let ftsQuery = this.historyTable.search(query, 'fts').limit(limit * 2);
      if (options.domain) {
        ftsQuery = ftsQuery.where(`domain = '${options.domain}'`);
      }
      const ftsRows = await ftsQuery.toArray();
      for (const row of ftsRows) {
        const key = `${row.url}#${row.chunk_index}`;
        const existing = results.get(key);
        if (existing) {
          existing.score = (existing.score || 0.5) + 0.5; // Boost score for hybrid match
        } else {
          results.set(key, {
            url: row.url,
            title: row.title,
            domain: row.domain,
            snippet: row.content,
            chunkIndex: row.chunk_index,
            visitedAt: row.visited_at,
            score: 0.75
          });
        }
      }
    } catch {
      // FTS fallback or index not yet ready
    }

    // Sort by score descending and return top matches
    return Array.from(results.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
  }

  /**
   * Retrieve chronological browsing history.
   */
  public async getHistory(options: { limit?: number; domain?: string } = {}): Promise<HistoryItem[]> {
    await this.initialize();
    if (!this.historyTable) return [];

    const limit = options.limit || 20;
    let q = this.historyTable.query().where('chunk_index = 0');
    if (options.domain) {
      q = q.where(`domain = '${options.domain}'`);
    }
    const rows = await q.toArray();

    // Deduplicate by URL taking most recent visit
    const urlMap = new Map<string, HistoryItem>();
    for (const row of rows) {
      const existing = urlMap.get(row.url);
      if (!existing || new Date(row.visited_at) > new Date(existing.visitedAt)) {
        urlMap.set(row.url, {
          url: row.url,
          title: row.title,
          domain: row.domain,
          visitedAt: row.visited_at
        });
      }
    }

    return Array.from(urlMap.values())
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime())
      .slice(0, limit);
  }

  /**
   * URL-bar suggestions: lexical history/bookmarks plus optional semantic recall.
   *
   * The renderer asks for lexical results immediately and a semantic pass after a short debounce,
   * so typing does not pay the embedding cost on every keystroke.
   */
  public async suggestUrls(
    query: string,
    options: { limit?: number; semantic?: boolean } = {}
  ): Promise<UrlSuggestion[]> {
    await this.initialize();
    const limit = Math.max(1, Math.min(options.limit ?? 8, 12));
    const q = String(query || '').trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    const history = await this.getHistory({ limit: 500 }).catch(() => []);
    const bookmarks = await this.listBookmarks({ limit: 500 }).catch(() => []);
    const byUrl = new Map<string, UrlSuggestion>();

    const add = (
      item: { url: string; title?: string; domain?: string; visitedAt?: string },
      source: 'history' | 'bookmark' | 'semantic',
      score: number,
      snippet?: string
    ) => {
      if (!item.url) return;
      const existing = byUrl.get(item.url);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.score = Math.max(existing.score, score);
        if (!existing.snippet && snippet) existing.snippet = snippet;
        if (!existing.visitedAt && item.visitedAt) existing.visitedAt = item.visitedAt;
        return;
      }
      byUrl.set(item.url, {
        url: item.url,
        title: item.title || extractDomain(item.url) || item.url,
        domain: item.domain || extractDomain(item.url) || '',
        visitedAt: item.visitedAt,
        sources: [source],
        score,
        snippet,
      });
    };

    const recency = (value?: string) => {
      const t = value ? Date.parse(value) : 0;
      return Number.isFinite(t) ? t : 0;
    };

    const lexicalScore = (url: string, title: string, domain: string): number => {
      if (!q) return 0;
      const u = url.toLowerCase();
      const t = title.toLowerCase();
      const d = domain.toLowerCase();
      const hay = `${u} ${t} ${d}`;
      if (!hay.includes(q) && !tokens.every((token) => hay.includes(token))) return 0;
      let score = 10;
      if (u.startsWith(q)) score += 100;
      else if (u.includes(q)) score += 50;
      if (d.startsWith(q)) score += 60;
      if (t.startsWith(q)) score += 70;
      else if (t.includes(q)) score += 35;
      for (const token of tokens) if (hay.includes(token)) score += 8;
      return score;
    };

    for (const item of history) {
      const score = q ? lexicalScore(item.url, item.title, item.domain) : 10;
      if (score) add(item, 'history', score + Math.min(5, recency(item.visitedAt) / 1e15));
    }

    for (const item of bookmarks) {
      const domain = extractDomain(item.url) || '';
      const score = q ? lexicalScore(item.url, item.title, domain) : 20;
      if (score) {
        add({ url: item.url, title: item.title, domain, visitedAt: item.createdAt }, 'bookmark', score + 15);
      }
    }

    if (q && options.semantic === true) {
      const recalled = await this.recall(q, { limit: 8 }).catch(() => []);
      for (const item of recalled) {
        add(
          { url: item.url, title: item.title, domain: item.domain, visitedAt: item.visitedAt },
          'semantic',
          25 + Math.round((item.score || 0) * 20),
          item.snippet
        );
      }
    }

    return [...byUrl.values()]
      .sort((a, b) => b.score - a.score || recency(b.visitedAt) - recency(a.visitedAt))
      .slice(0, limit);
  }

  /**
   * Clear browsing history.
   */
  public async clearHistory(olderThan?: string): Promise<void> {
    await this.initialize();
    if (!this.historyTable || !this.db) return;

    if (!olderThan || olderThan === 'all') {
      await this.db.dropTable('page_history');
      const seedHistory: PageHistoryRow[] = [{
        id: 'seed_manual_0',
        url: 'mark-eleven://manual',
        domain: 'internal',
        title: 'Cyberdeck Manual',
        chunk_index: 0,
        content: 'Kuang Grade Mark Eleven Cyberdeck Manual',
        visited_at: new Date().toISOString(),
        vector: await embedText('Cyberdeck Manual')
      }];
      this.historyTable = await this.db.createTable('page_history', seedHistory);
    } else {
      await this.historyTable.delete(`visited_at < '${olderThan}'`);
    }
  }

  /**
   * Add or update a bookmark.
   */
  public async addBookmark(bookmark: {
    url: string;
    title?: string;
    notes?: string;
    tags?: string[];
  }): Promise<BookmarkItem> {
    await this.initialize();
    if (!this.bookmarksTable) throw new Error('Bookmarks table not initialized');

    const title = bookmark.title || extractDomain(bookmark.url) || bookmark.url;
    const notes = bookmark.notes || '';
    const tags = bookmark.tags || [];
    const createdAt = new Date().toISOString();
    const id = `bkmk_${Buffer.from(bookmark.url).toString('base64').replace(/=/g, '').slice(0, 24)}`;

    // Remove existing bookmark with same URL if present
    try {
      await this.bookmarksTable.delete(`url = '${bookmark.url.replace(/'/g, "''")}'`);
    } catch {
      // Ignore if not present
    }

    const textToEmbed = `${title} ${notes} ${tags.join(' ')}`;
    const row: BookmarkRow = {
      id,
      url: bookmark.url,
      title,
      notes,
      tags,
      created_at: createdAt,
      vector: await embedText(textToEmbed)
    };

    await this.bookmarksTable.add([row]);

    return {
      id,
      url: bookmark.url,
      title,
      notes,
      tags,
      createdAt
    };
  }

  /**
   * List or search bookmarks.
   *
   * `query` is a lexical filter, not just a ranking: a bookmark matches when
   * every whitespace-separated query term appears (case-insensitively, as a
   * substring) in its searchable text — title, notes, URL, and tags. Matches are
   * then ordered by embedding similarity (most relevant first). With no `query`,
   * returns the most recent bookmarks.
   */
  public async listBookmarks(options: {
    query?: string;
    tag?: string;
    limit?: number;
  } = {}): Promise<BookmarkItem[]> {
    await this.initialize();
    if (!this.bookmarksTable) return [];

    const limit = options.limit || 20;
    const tokens = tokenizeQuery(options.query);

    let rows: any[];
    if (tokens.length > 0) {
      const queryVector = await embedText(options.query!);
      const all = await this.bookmarksTable.query().toArray();
      const matches = all.filter((row: any) => {
        const text = bookmarkSearchText(row);
        return tokens.every(token => text.includes(token));
      });
      const scored = await Promise.all(
        matches.map(async (row: any) => ({
          row,
          score: cosineSimilarity(queryVector, await embedText(bookmarkSearchText(row))),
        }))
      );
      scored.sort((a, b) => b.score - a.score);
      rows = scored.map(entry => entry.row);
    } else if (options.tag) {
      // Filter by tag before applying the limit, so the slice can't hide matches.
      rows = await this.bookmarksTable.query().toArray();
    } else {
      // Newest first (LanceDB's default row order is insertion order).
      const all = await this.bookmarksTable.query().toArray();
      all.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      rows = all;
    }

    let items: BookmarkItem[] = rows.map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      notes: r.notes,
      tags: toStringArray(r.tags),
      createdAt: r.created_at
    }));

    if (options.tag) {
      const targetTag = options.tag.trim().toLowerCase();
      items = items.filter(b => b.tags.some(t => t.toLowerCase() === targetTag));
    }

    return items.slice(0, limit);
  }

  /**
   * Delete a bookmark by ID or URL.
   */
  public async deleteBookmark(urlOrId: string): Promise<boolean> {
    await this.initialize();
    if (!this.bookmarksTable) return false;

    try {
      const escaped = urlOrId.replace(/'/g, "''");
      await this.bookmarksTable.delete(`id = '${escaped}' OR url = '${escaped}'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a URL is currently bookmarked.
   */
  public async isBookmarked(url: string): Promise<boolean> {
    await this.initialize();
    if (!this.bookmarksTable || !url) return false;

    try {
      const escaped = url.replace(/'/g, "''");
      const res = await this.bookmarksTable.query().where(`url = '${escaped}'`).toArray();
      return res.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Saves or updates a script in LanceDB with vector embeddings.
   */
  public async saveScript(script: {
    name: string;
    code: string;
    description?: string;
    domain?: string;
    tags?: string[];
  }): Promise<ScriptItem> {
    await this.initialize();
    if (!this.scriptsTable) throw new Error('Scripts table uninitialized');

    const cleanName = script.name.trim();
    const description = script.description?.trim() || '';
    const domain = script.domain?.trim() || '*';
    const tags = script.tags || [];
    const now = new Date().toISOString();
    const id = `script_${cleanName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}`;

    // Remove existing script with same name if present
    try {
      await this.scriptsTable.delete(`name = '${cleanName.replace(/'/g, "''")}'`);
    } catch {}

    const textToEmbed = `${cleanName} ${description} ${domain} ${tags.join(' ')} ${script.code.slice(0, 300)}`;
    const row: ScriptRow = {
      id,
      name: cleanName,
      description,
      code: script.code,
      domain,
      tags,
      created_at: now,
      updated_at: now,
      vector: await embedText(textToEmbed),
    };

    await this.scriptsTable.add([row]);

    return {
      id,
      name: cleanName,
      description,
      code: script.code,
      domain,
      tags,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Semantically recalls or lists scripts from LanceDB.
   */
  public async recallScripts(
    query?: string,
    options: { domain?: string; tag?: string; limit?: number } = {}
  ): Promise<ScriptItem[]> {
    await this.initialize();
    if (!this.scriptsTable) return [];

    const limit = options.limit || 20;
    let rows: any[] = [];

    if (query && query.trim().length > 0) {
      const qVec = await embedText(query);
      rows = await this.scriptsTable.search(qVec).limit(limit).toArray();
    } else {
      rows = await this.scriptsTable.query().limit(limit).toArray();
    }

    let items: ScriptItem[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      code: r.code,
      domain: r.domain,
      tags: toStringArray(r.tags),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      score: r._distance !== undefined ? 1 - r._distance : undefined,
    }));

    if (options.domain && options.domain !== '*') {
      const targetDomain = options.domain.toLowerCase();
      items = items.filter(
        (s) => !s.domain || s.domain === '*' || s.domain.toLowerCase().includes(targetDomain) || targetDomain.includes(s.domain.toLowerCase())
      );
    }

    if (options.tag) {
      const targetTag = options.tag.toLowerCase();
      items = items.filter((s) => s.tags.some((t) => t.toLowerCase() === targetTag));
    }

    return items;
  }

  /**
   * Retrieves a script by name.
   */
  public async getScriptByName(name: string): Promise<ScriptItem | null> {
    await this.initialize();
    if (!this.scriptsTable) return null;

    try {
      const cleanName = name.replace(/'/g, "''");
      const rows = await this.scriptsTable.query().where(`name = '${cleanName}'`).limit(1).toArray();
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        code: r.code,
        domain: r.domain,
        tags: toStringArray(r.tags),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    } catch {
      return null;
    }
  }

  /**
   * Deletes a script by name or ID.
   */
  public async deleteScript(nameOrId: string): Promise<boolean> {
    await this.initialize();
    if (!this.scriptsTable) return false;

    try {
      const escaped = nameOrId.replace(/'/g, "''");
      await this.scriptsTable.delete(`id = '${escaped}' OR name = '${escaped}'`);
      return true;
    } catch {
      return false;
    }
  }
}

// Global singleton instance for the main chassis process
export const cortex = new CortexDB();
