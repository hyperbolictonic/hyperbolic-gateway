import { WebContentsView, WebContents } from 'electron';
import { type HostBrowserProfile } from '../telemetry/host-fingerprint.js';
import { RenderedSnapshotEngine } from '../snapshots/rendered-snapshot.js';
import { CortexDB } from '../cortex/cortex-db.js';

export interface PrerenderItem {
  url: string;
  view: WebContentsView;
  createdAt: number;
  ready: boolean;
  title: string;
  harvested: boolean;
}

export interface PrerenderOptions {
  urls?: string[];
  selector?: string;
  maxPages?: number;
  harvestToCortex?: boolean;
  waitUntilIdleMs?: number;
}

export class PrerenderEngine {
  private pool: Map<string, PrerenderItem> = new Map();
  private maxPoolSize = 3;
  private ttlMs = 3 * 60 * 1000; // 3 minutes expiration

  constructor(
    private hostProfile: HostBrowserProfile,
    private cortex: CortexDB,
    private onLog?: (level: 'info' | 'warn' | 'action', message: string) => void
  ) {
    // Periodic sweep for expired prerendered views
    setInterval(() => this.sweepExpired(), 30000);
  }

  /**
   * Pre-renders candidate URLs in the background with full hydration and stealth headers.
   */
  public async prerender(
    activeWc: WebContents,
    options: PrerenderOptions = {}
  ): Promise<{ prerendered: string[]; count: number }> {
    const maxPages = Math.min(Math.max(1, options.maxPages || 3), this.maxPoolSize);
    const harvestToCortex = options.harvestToCortex !== false;

    // 1. Resolve URLs to prerender
    let candidateUrls: string[] = [];
    if (Array.isArray(options.urls) && options.urls.length > 0) {
      candidateUrls = options.urls;
    } else {
      candidateUrls = await this.extractCandidateLinks(activeWc, options.selector, maxPages);
    }

    // Clean & normalize URLs
    candidateUrls = Array.from(new Set(candidateUrls))
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, maxPages);

    if (candidateUrls.length === 0) {
      return { prerendered: [], count: 0 };
    }

    const completed: string[] = [];

    for (const targetUrl of candidateUrls) {
      // Skip if already warm in pool
      if (this.pool.has(targetUrl)) {
        completed.push(targetUrl);
        continue;
      }

      // Evict oldest if pool is full
      if (this.pool.size >= this.maxPoolSize) {
        this.evictOldest();
      }

      try {
        const item = await this.spawnPrerenderView(targetUrl, options.waitUntilIdleMs || 600);
        this.pool.set(targetUrl, item);
        completed.push(targetUrl);

        // Pre-harvest to LanceDB Cortex in background
        if (harvestToCortex && !item.harvested) {
          this.harvestToCortex(item).catch(() => {});
        }
      } catch (err: any) {
        this.onLog?.('warn', `Failed to prerender link "${targetUrl}": ${err.message}`);
      }
    }

    this.onLog?.(
      'action',
      `Prerendered ${completed.length} candidate URLs into background pool: ${completed.map((u) => u.slice(0, 50)).join(', ')}`
    );

    return {
      prerendered: completed,
      count: completed.length,
    };
  }

  /**
   * Checks if an exact or normalized URL has an active pre-rendered view.
   */
  public has(url: string): boolean {
    const normalized = this.normalizeUrl(url);
    return Array.from(this.pool.keys()).some((k) => this.normalizeUrl(k) === normalized);
  }

  /**
   * Consumes and returns a pre-rendered view for instant (0ms) tab elevation.
   */
  public consume(url: string): WebContentsView | undefined {
    const normalized = this.normalizeUrl(url);
    for (const [k, item] of this.pool.entries()) {
      if (this.normalizeUrl(k) === normalized) {
        this.pool.delete(k);
        this.onLog?.('info', `Instant 0ms swap: Elevated prerendered view for "${url}"`);
        return item.view;
      }
    }
    return undefined;
  }

  /**
   * Spawns a background WebContentsView, navigates to target, applies stealth, and awaits hydration.
   */
  private async spawnPrerenderView(targetUrl: string, waitIdleMs: number): Promise<PrerenderItem> {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: true,
      },
    });

    const wc = view.webContents;
    wc.setUserAgent(this.hostProfile.userAgent);

    // Apply stealth request headers
    wc.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = this.hostProfile.userAgent;
      details.requestHeaders['sec-ch-ua'] = this.hostProfile.secChUa;
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = this.hostProfile.secChUaPlatform;
      callback({ requestHeaders: details.requestHeaders });
    });

    // Suppress popups from prerendered views
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));

    const item: PrerenderItem = {
      url: targetUrl,
      view,
      createdAt: Date.now(),
      ready: false,
      title: 'Prerendering...',
      harvested: false,
    };

    return new Promise((resolve) => {
      const finish = async () => {
        item.title = wc.getTitle() || targetUrl;
        item.ready = true;
        if (waitIdleMs > 0) {
          await new Promise((r) => setTimeout(r, waitIdleMs));
        }
        resolve(item);
      };

      const timer = setTimeout(finish, 8000); // 8s safety timeout

      wc.once('did-finish-load', () => {
        clearTimeout(timer);
        finish();
      });

      wc.once('did-fail-load', () => {
        clearTimeout(timer);
        resolve(item);
      });

      wc.loadURL(targetUrl).catch(() => {
        clearTimeout(timer);
        resolve(item);
      });
    });
  }

  /**
   * Extracts top outgoing links from the active page using semantic link heuristics.
   */
  private async extractCandidateLinks(
    wc: WebContents,
    selector?: string,
    limit: number = 3
  ): Promise<string[]> {
    const script = `
      (() => {
        const sel = ${selector ? JSON.stringify(selector) : 'null'};
        let elements = [];
        if (sel) {
          elements = Array.from(document.querySelectorAll(sel));
        } else {
          // Heuristic: search result links, navigation anchors, main content links
          const candidates = document.querySelectorAll('main a[href], article a[href], .search a[href], [role="main"] a[href], a[href]');
          elements = Array.from(candidates);
        }

        const currentOrigin = window.location.origin;
        const seen = new Set();
        const urls = [];

        for (const el of elements) {
          const href = el.href;
          if (!href || href.startsWith('javascript:') || href.includes('#')) continue;
          if (!/^https?:\\/\\//i.test(href)) continue;
          if (href === window.location.href) continue;

          if (!seen.has(href)) {
            seen.add(href);
            urls.push(href);
            if (urls.length >= ${limit}) break;
          }
        }
        return urls;
      })()
    `;
    try {
      const res = await wc.executeJavaScript(script);
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  }

  /**
   * Distills rendered markdown and indexes into LanceDB Cortex.
   */
  private async harvestToCortex(item: PrerenderItem): Promise<void> {
    try {
      const snapshot = await RenderedSnapshotEngine.capture(item.view.webContents, {
        format: 'markdown',
        waitUntilIdleMs: 100,
      });
      if (snapshot.content && snapshot.content.length > 50) {
        await this.cortex.indexPage(
          item.url,
          item.title || snapshot.title,
          snapshot.content
        );
        item.harvested = true;
        this.onLog?.('info', `Pre-harvested "${item.title || item.url}" directly into LanceDB Cortex memory`);
      }
    } catch {
      // Non-critical background task
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [k, item] of this.pool.entries()) {
      if (item.createdAt < oldestTime) {
        oldestTime = item.createdAt;
        oldestKey = k;
      }
    }

    if (oldestKey) {
      const item = this.pool.get(oldestKey);
      if (item) {
        try {
          (item.view.webContents as any).destroy?.();
        } catch {}
      }
      this.pool.delete(oldestKey);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [k, item] of this.pool.entries()) {
      if (now - item.createdAt > this.ttlMs) {
        try {
          (item.view.webContents as any).destroy?.();
        } catch {}
        this.pool.delete(k);
      }
    }
  }

  public normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Canonicalize query parameters so search order doesn't cause cache misses,
      // while preserving distinct filter/query states so filtered pages never collide with base pages.
      const params = new URLSearchParams(u.search);
      params.sort();
      const queryString = params.toString();
      const basePath = `${u.origin}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
      return queryString ? `${basePath}?${queryString}` : basePath;
    } catch {
      return url.trim().toLowerCase();
    }
  }

  public destroy(): void {
    for (const item of this.pool.values()) {
      try {
        (item.view.webContents as any).destroy?.();
      } catch {}
    }
    this.pool.clear();
  }
}
