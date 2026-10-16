/**
 * Kuang Grade Mark Eleven - Cortex LanceDB Memory Subsystem
 *
 * Implements persistent vector & full-text search across page visits,
 * extracted readability markdown, and research bookmarks.
 */

import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import { generateEmbedding, EMBEDDING_DIM } from './embedder.js';
import { chunkMarkdown, extractDomain } from './chunker.js';

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

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  notes: string;
  tags: string[];
  createdAt: string;
}

export class CortexDB {
  private db: lancedb.Connection | null = null;
  private historyTable: lancedb.Table | null = null;
  private bookmarksTable: lancedb.Table | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || path.join(process.cwd(), 'data', 'cortex');
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      this.db = await lancedb.connect(this.storageDir);
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
          vector: generateEmbedding('Cyberdeck Manual Kuang Grade Mark Eleven Chromium MCP Navigator')
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
          vector: generateEmbedding('Cyberdeck Manual Built-in quickstart and system guide system docs manual')
        }];
        this.bookmarksTable = await this.db.createTable('bookmarks', seedBookmark);
      } else {
        this.bookmarksTable = await this.db.openTable('bookmarks');
      }

      this.isInitialized = true;
    })();

    return this.initPromise;
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
    const rows: PageHistoryRow[] = chunks.map(chunk => {
      const textToEmbed = `${cleanTitle} - ${chunk.content}`;
      return {
        id: `chunk_${Buffer.from(url).toString('base64').slice(0, 32)}_${chunk.chunkIndex}_${Date.now()}`,
        url,
        domain,
        title: cleanTitle,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        visited_at: visitedAt,
        vector: generateEmbedding(textToEmbed)
      };
    });

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
    const queryVector = generateEmbedding(query);
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
        vector: generateEmbedding('Cyberdeck Manual')
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
      vector: generateEmbedding(textToEmbed)
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
   */
  public async listBookmarks(options: {
    query?: string;
    tag?: string;
    limit?: number;
  } = {}): Promise<BookmarkItem[]> {
    await this.initialize();
    if (!this.bookmarksTable) return [];

    const limit = options.limit || 20;

    let rows: any[] = [];
    if (options.query && options.query.trim().length > 0) {
      const qVec = generateEmbedding(options.query);
      rows = await this.bookmarksTable.search(qVec).limit(limit).toArray();
    } else {
      rows = await this.bookmarksTable.query().limit(limit).toArray();
    }

    let items: BookmarkItem[] = rows.map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      notes: r.notes,
      tags: Array.isArray(r.tags) ? r.tags : [],
      createdAt: r.created_at
    }));

    if (options.tag) {
      const targetTag = options.tag.toLowerCase();
      items = items.filter(b => b.tags.some(t => t.toLowerCase() === targetTag));
    }

    return items;
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
}

// Global singleton instance for the main chassis process
export const cortex = new CortexDB();
