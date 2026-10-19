import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, nativeImage, ipcMain, WebContentsView, type WebContents } from 'electron';
import type { AgentStatus, ChassisState, HarvestedConstruct, TelemetryEvent, TabSummary } from '../shared/types.js';
import { HumanizedInputSimulator } from './telemetry/input-simulator.js';
import { ConstructHarvester } from './harvester/markdown.js';
import { detectHostBrowserProfile, type HostBrowserProfile } from './telemetry/host-fingerprint.js';
import { TabManager, type TabInstance } from './tabs/tab-manager.js';
import { cortex, CortexDB } from './cortex/cortex-db.js';
import { ShieldBreaker, type ShieldDismissResult } from './shield/shield-breaker.js';
import { DownloadManager, type DownloadRecord } from './downloads/download-manager.js';
import { SessionVault, type SessionSnapshot } from './session/session-vault.js';
import {
  NetworkInterceptor,
  type CapturedNetworkRequest,
  type NetworkFilter,
  type RealtimeStream,
  type StreamMessage,
} from './network/network-interceptor.js';
import { MarksOverlay, type MarkItem } from './marks/marks-overlay.js';
import { Primitives } from './primitives/primitives.js';
import { ScriptVault } from './scripts/script-vault.js';
import type { ScriptItem } from './cortex/cortex-db.js';
import { TrayManager } from './tray/tray-manager.js';
import { HilManager, type HilRequest, type HilResolution, type NotificationOptions } from './hil/hil-manager.js';
import {
  generateChaosTrajectory,
  type ChaosKinematicsOptions,
  type PathStep,
} from './telemetry/chaos-kinematics.js';
import { JsonNavigator, type JsonQueryOptions, type JsonQueryResult } from './utils/json-navigator.js';
import { RenderedSnapshotEngine, type RenderedSnapshotOptions, type RenderedSnapshotResult } from './snapshots/rendered-snapshot.js';
import { PrerenderEngine, type PrerenderOptions } from './prerender/prerender-engine.js';
import { LlmSurface, type LlmSurfaceReport, type LlmSurfaceKind, type LlmFetchResult } from './llm/llm-surface.js';
import { SearchHub, type SearchOutcome } from './search/search-engine.js';
import { Crawler, type CrawlOptions, type CrawlOutcome } from './crawl/crawler.js';
import { Researcher, type ResearchOptions, type ResearchOutcome } from './research/researcher.js';

export class BrowserChassis {
  private mainWindow: BrowserWindow | null = null;
  private tabManager: TabManager | null = null;
  private simulator: HumanizedInputSimulator;
  private harvester: ConstructHarvester;
  private shieldBreaker: ShieldBreaker;
  private downloadManager: DownloadManager;
  private sessionVault: SessionVault;
  private networkInterceptor: NetworkInterceptor;
  private marksOverlay: MarksOverlay;
  private scriptVault: ScriptVault;
  private trayManager: TrayManager | null = null;
  private hilManager: HilManager;
  private prerenderEngine: PrerenderEngine;
  private hostProfile: HostBrowserProfile = detectHostBrowserProfile();
  private primitives: Primitives;
  private llmSurface: LlmSurface;
  private searchHub: SearchHub;
  private crawler: Crawler;
  private researcher: Researcher;
  /** Reused off-screen view for detached reads (SERPs, Markdown alternates, crawls). */
  private utilView: WebContentsView | null = null;
  private utilQueue: Promise<void> = Promise.resolve();
  /** Monotonic page revision: bumped on navigation and every mutating action. */
  private revision = 0;

  private state: ChassisState = {
    currentUrl: 'about:blank',
    pageTitle: 'Mark Eleven Chassis Offline',
    isLoading: false,
    agentStatus: 'IDLE',
    activeAction: 'Standby - Awaiting MCP Uplink',
    cursor: { x: 100, y: 100 },
    tabs: [],
    stats: {
      totalInteractions: 0,
      tokensHarvested: 0,
      avgLatencyMs: 42,
      uptimeSeconds: 0,
    },
  };

  private latestConstruct: HarvestedConstruct | null = null;
  private logs: Array<{ id: string; time: string; level: 'info' | 'warn' | 'action'; message: string }> = [];
  private targetConsoleLogs: Array<{ level: string; message: string; line: number; sourceId: string; timestamp: number }> = [];

  constructor() {
    this.harvester = new ConstructHarvester();
    this.simulator = new HumanizedInputSimulator({
      onMouseMove: (point, velocity) => {
        this.state.cursor = point;
        this.emitTelemetry({
          type: 'mouse_move',
          x: point.x,
          y: point.y,
          timestamp: Date.now(),
          details: `Velocity: ${velocity.toFixed(2)} px/ms`,
        });
      },
      onClick: (point) => {
        this.state.stats.totalInteractions++;
        this.emitTelemetry({
          type: 'click',
          x: point.x,
          y: point.y,
          timestamp: Date.now(),
          details: 'Physical mouse switch actuated',
        });
      },
      onKey: (char, delay) => {
        this.state.stats.totalInteractions++;
        this.emitTelemetry({
          type: 'keystroke',
          key: char === ' ' ? 'SPACE' : char,
          durationMs: delay,
          timestamp: Date.now(),
          details: `Cadence variance: ${delay}ms`,
        });
      },
      onScroll: (deltaY) => {
        this.emitTelemetry({
          type: 'scroll',
          timestamp: Date.now(),
          details: `Mousewheel impulse: ${deltaY}px`,
        });
      },
    });

    this.shieldBreaker = new ShieldBreaker(this.simulator);
    this.downloadManager = new DownloadManager();
    this.sessionVault = new SessionVault();
    this.networkInterceptor = new NetworkInterceptor();
    this.marksOverlay = new MarksOverlay();
    this.scriptVault = new ScriptVault();

    this.prerenderEngine = new PrerenderEngine(
      this.hostProfile,
      cortex,
      (level, msg) => this.addLog(level, msg)
    );

    this.hilManager = new HilManager({
      getActiveWebContents: () => {
        try {
          return this.getActiveWebContents();
        } catch {
          return null;
        }
      },
      onHilStateChanged: (pending, req) => {
        this.trayManager?.updateStatus(this.state.agentStatus, this.state.tabs?.length || 0, pending);
        if (pending && req) {
          this.state.agentStatus = 'AWAITING_INPUT';
          this.state.activeAction = `⚠️ HUMAN ACTION REQUIRED: ${req.reason}`;
        } else {
          this.state.agentStatus = 'IDLE';
          this.state.activeAction = 'Standby - Awaiting MCP Uplink';
        }
        this.broadcastState();
      },
    });

    // Orthogonal primitives layer (observe / act / wait / extract / collect / find).
    // It borrows the chassis' real input + marks plumbing so it stays on the humanlike path.
    this.primitives = new Primitives({
      webContents: () => this.getActiveWebContents(),
      log: (level, msg) => this.addLog(level, msg),
      evaluate: (script) => this.evaluateQuiet(script),
      harvest: (opts) => this.harvestMarkdown(opts),
      injectMarks: (opts) => this.marksOverlay.injectMarks(this.getActiveWebContents(), opts || {}),
      removeMarks: () => this.marksOverlay.removeMarks(this.getActiveWebContents()),
      getMarks: () => this.getActiveMarks(),
      getMarkTarget: (id) => this.marksOverlay.getMarkTarget(this.getActiveWebContents(), id),
      clickMark: (id) => this.clickMark(id),
      typeMark: (id, text, opts) => this.typeMark(id, text, opts),
      clickElement: (selector, coords) => this.clickElement(selector, coords),
      typeText: (text, selector) => this.typeText(text, selector),
      moveMouseTo: (target) => this.moveMouse(target),
      pressKey: (key) => this.pressKey(key),
      snapshotRenderedPage: (opts) => this.snapshotRenderedPage(opts),
      getNetworkTraffic: (filter) => this.getNetworkTraffic(filter),
      getPageInfo: () => this.getPageInfo(),
      revision: () => this.revision,
      windowFocused: () => this.isWindowFocused(),
    });

    // LLM-friendly site discovery (TODO_RESEARCH_CRAWL.md §5, Feature 6).
    // `net.fetch` runs on Chromium's network stack (session cookies/UA/TLS); per-page
    // alternates go through a real document navigation instead of a synthetic fetch.
    this.llmSurface = new LlmSurface({
      getSession: () => this.getActiveWebContents().session,
      getActiveWebContents: () => {
        try {
          return this.getActiveWebContents();
        } catch {
          return null;
        }
      },
      navigateForText: (url) => this.navigateForText(url),
      userAgent: this.hostProfile.userAgent,
      log: (level, msg) => this.addLog(level, msg),
    });

    // Multi-engine web search (TODO_RESEARCH_CRAWL.md §5, Feature 5).
    this.searchHub = new SearchHub({
      load: (url, script, opts) => this.loadDetached(url, script, opts),
      log: (level, msg) => this.addLog(level, msg),
    });

    // Autonomous multi-page crawl (TODO_RESEARCH_CRAWL.md §5, Feature 1).
    // Cheap path first: content-negotiated Markdown/Text, else a detached render.
    this.crawler = new Crawler({
      tryLlm: async (url) => {
        const report = await this.llmSurface.probe(url);
        if (!report.content_negotiation?.accepts_markdown) return null;
        const r = await this.llmSurface.fetch({ url, as: 'markdown' });
        return { content: r.content, via: r.via };
      },
      renderPage: (url, pageOpts) => this.crawlRenderPage(url, pageOpts),
      indexPage: async (url, title, content) => {
        await cortex.indexPage(url, title, content);
      },
      log: (level, msg) => this.addLog(level, msg),
    });

    // Autonomous research mode (TODO_RESEARCH_CRAWL.md §5, Feature 3).
    this.researcher = new Researcher({
      search: (q, o) => this.searchHub.search(q, o),
      crawl: (o) => this.crawler.crawl(o),
      log: (level, msg) => this.addLog(level, msg),
    });

    setInterval(() => {
      this.state.stats.uptimeSeconds++;
      this.broadcastState();
    }, 1000);
  }

  public setWindow(win: BrowserWindow) {
    this.mainWindow = win;
    this.hilManager.setWindow(win);
    this.trayManager = new TrayManager({
      mainWindow: win,
      closeToTrayDefault: false,
    });
    this.downloadManager.attachToSession(win.webContents.session);
    this.downloadManager.onDownloadComplete((record) => {
      this.addLog('info', `Download Complete: "${record.filename}" (${record.totalBytes} bytes) saved to data/downloads/`);
      this.emitTelemetry({
        type: 'harvest',
        timestamp: Date.now(),
        details: `File Download Complete: ${record.filename}`,
      });
    });
    this.setupTabManager();
    this.registerIpcHandlers();
  }

  private setupTabManager() {
    if (!this.mainWindow) return;

    this.tabManager = new TabManager({
      mainWindow: this.mainWindow,
      hostProfile: this.hostProfile,
      getViewportBounds: () => this.getViewportBounds(),
      onTabUpdated: (tab: TabInstance) => {
        if (tab.id === this.tabManager?.getActiveTabId()) {
          this.state.currentUrl = tab.url;
          this.state.pageTitle = tab.title;
          this.state.isLoading = tab.isLoading;
          this.state.activeTabId = tab.id;
          this.broadcastState();

          if (!tab.isLoading) this.bumpRevision();

          if (!tab.isLoading && tab.url && !tab.url.startsWith('mark-eleven:') && tab.url !== 'about:blank') {
            this.indexTabQuietly(tab);
          }
        }
      },
      onTabsChanged: (tabs: TabSummary[]) => {
        this.state.tabs = tabs;
        this.broadcastState();
        this.trayManager?.updateStatus(this.state.agentStatus, tabs.length, !!this.hilManager.getActiveRequest());
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('chassis:tabs-updated', tabs);
        }
      },
      onTabCreated: (tab: TabInstance) => {
        this.networkInterceptor.attach(tab.view.webContents);
      },
      onLog: (level, msg) => this.addLog(level, msg),
      onConsoleLog: (log) => {
        this.targetConsoleLogs.push(log);
        if (this.targetConsoleLogs.length > 200) this.targetConsoleLogs.shift();
      },
    });

    this.addLog('info', `Stealth Profile Active: Spoofing host ${this.hostProfile.name} v${this.hostProfile.version}`);

    // Create initial default tab
    this.tabManager.createTab('about:blank');

    this.mainWindow.on('resize', () => {
      this.tabManager?.updateActiveTabBounds();
    });
  }

  public getViewportBounds(): { x: number; y: number; width: number; height: number } {
    if (!this.mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    const [winWidth, winHeight] = this.mainWindow.getSize();
    const rightPanelWidth = 420;
    // With tab bar, top bar height is 100px (64px navbar + 36px tab bar)
    const topBarHeight = 100;

    const viewportWidth = Math.max(400, winWidth - rightPanelWidth);
    const viewportHeight = Math.max(300, winHeight - topBarHeight);

    return {
      x: 0,
      y: topBarHeight,
      width: viewportWidth,
      height: viewportHeight,
    };
  }

  public getActiveWebContents(): Electron.WebContents {
    if (!this.tabManager) throw new Error('Browser Chassis uninitialized');
    const wc = this.tabManager.getActiveTab().view.webContents;
    this.networkInterceptor.attach(wc);
    return wc;
  }

  // Tab Operations
  public createTab(url?: string): TabSummary {
    if (!this.tabManager) throw new Error('Browser Chassis uninitialized');
    this.addLog('action', `MCP Directive: new_tab(${url || 'about:blank'})`);
    const tab = this.tabManager.createTab(url);
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      isLoading: tab.isLoading,
      isActive: true,
    };
  }

  public switchTab(tabId: string): void {
    if (!this.tabManager) throw new Error('Browser Chassis uninitialized');
    this.addLog('action', `MCP Directive: switch_tab(${tabId})`);
    this.tabManager.switchTab(tabId);
  }

  public closeTab(tabId?: string): void {
    if (!this.tabManager) throw new Error('Browser Chassis uninitialized');
    this.addLog('action', `MCP Directive: close_tab(${tabId || 'active'})`);
    this.tabManager.closeTab(tabId);
  }

  public getTabsSummary(): TabSummary[] {
    if (!this.tabManager) return [];
    return this.tabManager.getTabsSummary();
  }

  private registerIpcHandlers() {
    ipcMain.handle('chassis:get-state', () => this.state);
    ipcMain.handle('chassis:get-latest-construct', () => this.latestConstruct);
    ipcMain.handle('chassis:get-logs', () => this.logs);

    ipcMain.handle('chassis:navigate', async (_, url: string) => {
      await this.navigateTo(url);
      return { success: true };
    });

    ipcMain.handle('chassis:harvest', async () => {
      return await this.harvestMarkdown();
    });

    // Tab IPC Handlers
    ipcMain.handle('chassis:get-tabs', () => this.getTabsSummary());
    ipcMain.handle('chassis:create-tab', (_, url?: string) => this.createTab(url));
    ipcMain.handle('chassis:switch-tab', (_, tabId: string) => this.switchTab(tabId));
    ipcMain.handle('chassis:close-tab', (_, tabId?: string) => this.closeTab(tabId));

    const setVisibility = (_: any, visible: boolean) => {
      this.tabManager?.setViewportVisibility(visible);
    };

    ipcMain.handle('chassis:set-viewport-visibility', setVisibility);
    ipcMain.on('chassis:set-viewport-visibility', setVisibility);

    // Cortex & Bookmarks IPC Handlers
    ipcMain.handle('cortex:recall', async (_, query: string, options?: any) => {
      return await cortex.recall(query, options);
    });
    ipcMain.handle('cortex:get-history', async (_, options?: any) => {
      return await cortex.getHistory(options);
    });
    ipcMain.handle('cortex:clear-history', async (_, olderThan?: string) => {
      await cortex.clearHistory(olderThan);
      return { success: true };
    });
    ipcMain.handle('cortex:add-bookmark', async (_, bookmark: any) => {
      return await cortex.addBookmark(bookmark);
    });
    ipcMain.handle('cortex:list-bookmarks', async (_, options?: any) => {
      return await cortex.listBookmarks(options);
    });
    ipcMain.handle('cortex:delete-bookmark', async (_, urlOrId: string) => {
      return await cortex.deleteBookmark(urlOrId);
    });
    ipcMain.handle('cortex:is-bookmarked', async (_, url: string) => {
      return await cortex.isBookmarked(url);
    });
  }

  public getCortex(): CortexDB {
    return cortex;
  }

  private async indexTabQuietly(tab: TabInstance) {
    try {
      const url = tab.url;
      const title = tab.title;
      if (!url || url === 'about:blank' || url.startsWith('mark-eleven:') || url.startsWith('file:')) return;
      
      const wc = tab.view.webContents;
      const rawHtml = await wc.executeJavaScript('document.documentElement.outerHTML');
      const construct = this.harvester.harvest(rawHtml, url, title);
      const indexedCount = await cortex.indexPage(url, construct.title, construct.content);
      if (indexedCount > 0) {
        this.addLog('info', `Cortex indexed: ${construct.title} (${indexedCount} semantic chunks)`);
      }
    } catch {
      // Background indexing failure is non-fatal
    }
  }

  private broadcastState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('chassis:state-updated', this.state);
    }
  }

  private emitTelemetry(event: TelemetryEvent) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('chassis:telemetry', event);
    }
  }

  public addLog(level: 'info' | 'warn' | 'action', message: string) {
    const entry = {
      id: Math.random().toString(36).substring(2, 9),
      time: new Date().toLocaleTimeString(),
      level,
      message,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.pop();

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('chassis:log', entry);
    }
  }

  // MCP Operations on Active Tab
  public async navigateTo(url: string, autoDismissConsent: boolean = true): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'TRAVERSING';
    this.broadcastState();

    if (url === 'about:blank' || url === 'mark-eleven://manual' || url === 'mark-eleven://welcome') {
      const manualPath = this.tabManager?.getWelcomePagePath();
      if (manualPath) {
        this.addLog('action', 'MCP Directive: navigate_to(mark-eleven://manual)');
        await wc.loadFile(manualPath);
        return 'Loaded Kuang Grade Mark Eleven Manual';
      }
    }

    const formattedUrl = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `https://${url}`;

    // 0ms Navigation: Check if target URL is already warm in speculative prerender pool.
    // Guard: Do not elevate if current active tab is already on this page/domain or active form state is present.
    const currentUrl = wc.getURL();
    const isSamePage = currentUrl
      ? this.prerenderEngine.normalizeUrl(currentUrl) === this.prerenderEngine.normalizeUrl(formattedUrl)
      : false;

    if (!isSamePage && this.prerenderEngine.has(formattedUrl)) {
      const warmView = this.prerenderEngine.consume(formattedUrl);
      if (warmView && this.tabManager) {
        this.addLog('action', `0ms Speculative Elevation: Elevated prerendered view for ${formattedUrl}`);
        this.tabManager.createTab(formattedUrl, warmView);
        return `Navigated to ${formattedUrl} (0ms Speculative Instant Elevation)`;
      }
    }

    this.addLog('action', `MCP Directive: navigate_to(${formattedUrl})`);
    const navPromise = wc.loadURL(formattedUrl);

    if (autoDismissConsent) {
      setTimeout(() => {
        this.dismissConsent().catch(() => {});
      }, 1800);
    }

    await navPromise;
    this.bumpRevision();
    return `Navigated to ${formattedUrl}`;
  }

  public async dismissConsent(): Promise<ShieldDismissResult> {
    const wc = this.getActiveWebContents();
    this.addLog('action', 'Shield Directive: dismiss_consent()');
    const result = await this.shieldBreaker.dismissConsent(wc);
    if (result.dismissed) {
      this.addLog('info', `Shield Breaker: ${result.message}`);
      this.emitTelemetry({
        type: 'click',
        x: result.coordinates?.x,
        y: result.coordinates?.y,
        timestamp: Date.now(),
        details: `Shield Breaker: Dismissed ${result.framework} consent banner`,
      });
    }
    return result;
  }

  public async clickElement(selector?: string, coordinates?: { x: number; y: number }): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';

    let targetX = coordinates?.x;
    let targetY = coordinates?.y;

    if (selector) {
      this.addLog('action', `MCP Directive: click_element(selector="${selector}")`);
      const box = await wc.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()
      `);

      if (!box) {
        this.state.agentStatus = 'ERROR';
        this.broadcastState();
        throw new Error(`Target element not found: ${selector}`);
      }

      targetX = box.x;
      targetY = box.y;
    } else if (targetX !== undefined && targetY !== undefined) {
      this.addLog('action', `MCP Directive: click_element(x=${targetX}, y=${targetY})`);
    } else {
      throw new Error('Must provide either selector or coordinates');
    }

    await this.simulator.clickAt(wc, { x: targetX!, y: targetY! });

    // NOTE: no synthetic `el.click()` here. The trusted CDP click above already
    // actuates the element; firing a second JS click double-submitted forms and
    // double-opened links. We only give text controls a focus nudge.
    if (selector) {
      await wc.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el && typeof el.focus === 'function' && !el.matches('a[href], button, [role="button"]')) {
            el.focus();
          }
        })()
      `).catch(() => {});
    }

    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();
    return `Clicked element at (${targetX}, ${targetY})`;
  }

  public async typeText(text: string, selector?: string): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';
    this.addLog('action', `MCP Directive: type_text("${text.substring(0, 15)}..."${selector ? ` on ${selector}` : ''})`);

    if (selector) {
      await this.clickElement(selector);
    }

    await this.simulator.typeText(wc, text);
    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();
    return `Typed text (${text.length} chars) with variable human cadence`;
  }

  public async fillForm(
    fields: Record<string, string | boolean | number>,
    submitSelector?: string
  ): Promise<{ success: boolean; fieldsFilled: number; submitted: boolean; details: string[] }> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';
    this.addLog('action', `MCP Directive: fill_form(${Object.keys(fields).length} fields${submitSelector ? `, submit="${submitSelector}"` : ''})`);

    const details: string[] = [];
    let fieldsFilled = 0;

    for (const [selector, value] of Object.entries(fields)) {
      try {
        const info = await wc.executeJavaScript(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            const rect = el.getBoundingClientRect();
            return {
              tagName: el.tagName.toUpperCase(),
              type: (el.getAttribute('type') || '').toLowerCase(),
              currentVal: (el as any).value,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            };
          })()
        `);

        if (!info) {
          details.push(`Field skipped (not found): ${selector}`);
          continue;
        }

        await this.simulator.clickAt(wc, { x: info.x, y: info.y });

        if (info.type === 'checkbox' || info.type === 'radio') {
          await wc.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (el && typeof (el as any).checked === 'boolean') {
                const target = ${JSON.stringify(Boolean(value))};
                if ((el as any).checked !== target) {
                  (el as any).click();
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
            })()
          `);
          details.push(`Toggled ${info.type} [${selector}] -> ${value}`);
        } else if (info.tagName === 'SELECT') {
          await wc.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (el) {
                (el as any).value = ${JSON.stringify(String(value))};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            })()
          `);
          details.push(`Selected option [${selector}] -> "${value}"`);
        } else {
          await wc.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (el) {
                if (typeof (el as any).focus === 'function') (el as any).focus();
                (el as any).value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            })()
          `);
          await this.simulator.typeText(wc, String(value));
          details.push(`Typed [${selector}] -> "${String(value)}"`);
        }

        fieldsFilled++;
        await new Promise((r) => setTimeout(r, 120 + Math.random() * 120));
      } catch (err: any) {
        details.push(`Error filling [${selector}]: ${err.message}`);
      }
    }

    let submitted = false;
    if (submitSelector) {
      try {
        await this.clickElement(submitSelector);
        submitted = true;
        details.push(`Clicked submit button [${submitSelector}]`);
      } catch (err: any) {
        details.push(`Failed to click submit button [${submitSelector}]: ${err.message}`);
      }
    }

    this.state.agentStatus = 'IDLE';
    this.broadcastState();

    this.bumpRevision();
    return {
      success: fieldsFilled > 0,
      fieldsFilled,
      submitted,
      details,
    };
  }

  public async scrollPage(direction: 'up' | 'down', amount: number = 400): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';
    this.addLog('action', `MCP Directive: scroll_page(${direction}, ${amount}px)`);

    const deltaY = direction === 'down' ? amount : -amount;
    await this.simulator.scrollPage(wc, deltaY);

    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();
    return `Scrolled ${direction} by ${amount}px`;
  }

  public getScreenshotsDir(): string {
    const dir = path.resolve(process.cwd(), 'data', 'screenshots');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public cleanupScreenshots(maxFiles: number = 50, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): { prunedCount: number; remainingCount: number } {
    try {
      const dir = this.getScreenshotsDir();
      const files = fs.readdirSync(dir);
      const now = Date.now();
      const screenshotFiles: { file: string; fullPath: string; mtimeMs: number; size: number }[] = [];

      for (const file of files) {
        if (!file.toLowerCase().endsWith('.png')) continue;
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          screenshotFiles.push({ file, fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // ignore stat errors
        }
      }

      // Sort oldest first
      screenshotFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);

      let prunedCount = 0;
      const keepFiles: typeof screenshotFiles = [];

      for (const item of screenshotFiles) {
        const isExpired = now - item.mtimeMs > maxAgeMs;
        const wouldExceedLimit = (screenshotFiles.length - prunedCount) > maxFiles;

        if (isExpired || wouldExceedLimit) {
          try {
            fs.unlinkSync(item.fullPath);
            prunedCount++;
          } catch (err: any) {
            console.error(`[BrowserChassis] Failed to prune screenshot ${item.file}:`, err);
            keepFiles.push(item);
          }
        } else {
          keepFiles.push(item);
        }
      }

      if (prunedCount > 0) {
        this.addLog('info', `Disk Maintenance: Pruned ${prunedCount} old screenshots from data/screenshots/ (kept ${keepFiles.length})`);
      }

      return { prunedCount, remainingCount: keepFiles.length };
    } catch (err: any) {
      console.error('[BrowserChassis] Error in cleanupScreenshots:', err);
      return { prunedCount: 0, remainingCount: 0 };
    }
  }

  private async capturePageWithRetry(
    wc: Electron.WebContents,
    bounds: { x: number; y: number; width: number; height: number },
    maxRetries: number = 3
  ): Promise<Electron.NativeImage> {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await wc.capturePage({
          x: 0,
          y: 0,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        });
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        if (attempt < maxRetries - 1 && (msg.includes('Viz') || msg.includes('compositor') || msg.includes('Gpu') || msg.includes('GPU'))) {
          this.addLog('warn', `Transient capturePage hitch (${msg}). Retrying in 120ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  public async takeScreenshot(opts: {
    maxWidth?: number;
    format?: 'jpeg' | 'png';
    quality?: number;
  } = {}): Promise<{ base64Image: string; filePath: string; width: number; height: number; mimeType: string }> {
    const wc = this.getActiveWebContents();
    this.addLog('action', 'MCP Directive: take_screenshot()');

    const bounds = this.getViewportBounds();
    const rawImage = await this.capturePageWithRetry(wc, bounds);

    const maxWidth = opts.maxWidth !== undefined ? opts.maxWidth : 768;
    const format = opts.format || 'jpeg';
    const quality = opts.quality !== undefined ? opts.quality : 70;

    let outImage = rawImage;
    if (maxWidth > 0 && rawImage.getSize().width > maxWidth) {
      outImage = rawImage.resize({ width: maxWidth, quality: 'good' });
    }

    const size = outImage.getSize();
    const isJpeg = format === 'jpeg';
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const buffer = isJpeg ? outImage.toJPEG(quality) : outImage.toPNG();
    const base64Image = `data:${mimeType};base64,${buffer.toString('base64')}`;

    // Save image to disk & run retention cleanup
    const screenshotsDir = this.getScreenshotsDir();
    const filename = `screenshot_${Date.now()}.${isJpeg ? 'jpg' : 'png'}`;
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, buffer);
    this.cleanupScreenshots(50);

    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Captured live viewport screenshot: ${size.width}x${size.height}px (${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB), saved to ${filePath}`,
    });

    return {
      base64Image,
      filePath,
      width: size.width,
      height: size.height,
      mimeType,
    };
  }

  public async harvestMarkdown(opts: { includeMarks?: boolean; includeOffscreen?: boolean } = {}): Promise<HarvestedConstruct> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'HARVESTING';
    this.broadcastState();
    this.addLog('action', `MCP Directive: get_page_markdown(include_marks=${opts.includeMarks ?? true}${opts.includeOffscreen ? ', include_offscreen' : ''})`);

    // Ensure interactive elements have data-mark-id stamps for grounded markdown
    if (opts.includeMarks !== false) {
      await this.marksOverlay.injectMarks(wc, { includeOffscreen: Boolean(opts.includeOffscreen) });
      await this.marksOverlay.removeMarks(wc); // Strips visual badges, keeps data-mark-id
    }

    const rawHtml = await wc.executeJavaScript('document.documentElement.outerHTML');
    const url = wc.getURL();
    const title = wc.getTitle();

    const construct = this.harvester.harvest(rawHtml, url, title);
    this.latestConstruct = construct;

    this.state.stats.tokensHarvested += construct.estimatedTokens;
    this.state.agentStatus = 'IDLE';
    this.broadcastState();

    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Construct extracted: ${construct.estimatedTokens} tokens (${construct.markdownLength} bytes)`,
    });

    this.addLog('info', `Construct harvested: ${construct.title} (~${construct.estimatedTokens} tokens)`);
    cortex.indexPage(url, construct.title, construct.content).catch(() => {});
    return construct;
  }

  public async pressKey(key: string): Promise<string> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: press_key("${key}")`);
    await this.simulator.pressKey(wc, key);
    this.bumpRevision();
    return `Pressed key: ${key}`;
  }

  public async evaluateJavaScript(script: string): Promise<any> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: evaluate_javascript("${script.substring(0, 30)}...")`);
    const result = await wc.executeJavaScript(script);
    return result;
  }

  public async goBack(): Promise<string> {
    const wc = this.getActiveWebContents();
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
      this.bumpRevision();
      return 'Navigated back in history';
    }
    return 'Cannot navigate back; at start of history';
  }

  public async goForward(): Promise<string> {
    const wc = this.getActiveWebContents();
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
      this.bumpRevision();
      return 'Navigated forward in history';
    }
    return 'Cannot navigate forward; at end of history';
  }

  public async reload(): Promise<string> {
    const wc = this.getActiveWebContents();
    wc.reload();
    this.bumpRevision();
    return 'Reloaded active web page';
  }

  public getPageInfo(): { url: string; title: string; isLoading: boolean; activeTabId?: string } {
    return {
      url: this.state.currentUrl,
      title: this.state.pageTitle,
      isLoading: this.state.isLoading,
      activeTabId: this.state.activeTabId,
    };
  }

  public getTargetConsoleLogs(limit: number = 50) {
    return this.targetConsoleLogs.slice(-limit);
  }

  public getFingerprintProfile(): HostBrowserProfile {
    return this.hostProfile;
  }

  public getDownloads(): DownloadRecord[] {
    return this.downloadManager.getDownloads();
  }

  public async readDownloadedDocument(filenameOrId: string) {
    this.addLog('action', `MCP Directive: read_download("${filenameOrId}")`);
    return await this.downloadManager.readDocumentContent(filenameOrId);
  }

  public async saveSession(name?: string) {
    this.addLog('action', `MCP Directive: save_session("${name || 'auto'}")`);
    const wc = this.getActiveWebContents();
    const result = await this.sessionVault.saveSession(wc.session, wc, name);
    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Saved session "${result.name}" with ${result.cookiesCount} cookies`,
    });
    return result;
  }

  public async restoreSession(name: string) {
    this.addLog('action', `MCP Directive: restore_session("${name}")`);
    const wc = this.getActiveWebContents();
    const result = await this.sessionVault.restoreSession(wc.session, wc, name);
    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Restored session "${result.name}" (${result.cookiesRestored} cookies)`,
    });
    return result;
  }

  public listSessions() {
    return this.sessionVault.listSessions();
  }

  public deleteSession(name: string) {
    this.addLog('action', `MCP Directive: delete_session("${name}")`);
    return this.sessionVault.deleteSession(name);
  }

  public getNetworkTraffic(filter?: NetworkFilter): CapturedNetworkRequest[] {
    return this.networkInterceptor.getTraffic(filter);
  }

  public getApiPayload(requestId: string) {
    this.addLog('action', `MCP Directive: get_api_payload("${requestId}")`);
    return this.networkInterceptor.getPayload(requestId);
  }

  public clearNetworkTraffic(): void {
    this.addLog('action', 'MCP Directive: clear_network_traffic()');
    this.networkInterceptor.clear();
  }

  public getRealtimeStreams(options?: { type?: 'websocket' | 'sse'; activeOnly?: boolean }): RealtimeStream[] {
    return this.networkInterceptor.getStreams(options);
  }

  public getStreamMessages(options?: {
    streamId?: string;
    type?: 'websocket' | 'sse';
    direction?: 'sent' | 'received';
    limit?: number;
  }): StreamMessage[] {
    this.addLog('action', `MCP Directive: get_stream_messages(${options?.type || 'all'})`);
    return this.networkInterceptor.getStreamMessages(options);
  }

  public clearStreamMessages(streamId?: string): void {
    this.addLog('action', 'MCP Directive: clear_stream_messages()');
    this.networkInterceptor.clearStreamMessages(streamId);
  }

  public queryJsonData(params: {
    source: 'network_payload' | 'stream_messages' | 'download_file' | 'inline_json';
    sourceId?: string;
    jsonString?: string;
    path?: string;
    view?: 'value' | 'schema' | 'keys' | 'summary';
    limit?: number;
    maxStringLength?: number;
    filterPredicate?: string;
  }): JsonQueryResult {
    this.addLog('action', `MCP Directive: query_json_data(${params.source}${params.sourceId ? `:${params.sourceId}` : ''}, view=${params.view || 'value'})`);

    let targetData: any = null;

    switch (params.source) {
      case 'network_payload': {
        if (!params.sourceId) throw new Error('Missing "sourceId" (requestId) for source "network_payload"');
        const payload = this.networkInterceptor.getPayload(params.sourceId);
        targetData = payload.data;
        break;
      }

      case 'stream_messages': {
        const messages = this.networkInterceptor.getStreamMessages({
          streamId: params.sourceId,
          limit: params.limit || 50,
        });
        targetData = messages.map(m => m.jsonData !== undefined ? m.jsonData : m.data);
        break;
      }

      case 'download_file': {
        if (!params.sourceId) throw new Error('Missing "sourceId" (filename) for source "download_file"');
        const downloadsDir = path.join(process.cwd(), 'data', 'downloads');
        const filePath = path.join(downloadsDir, path.basename(params.sourceId));
        if (!fs.existsSync(filePath)) {
          throw new Error(`Downloaded file not found: ${params.sourceId}`);
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        try {
          targetData = JSON.parse(raw);
        } catch {
          targetData = raw;
        }
        break;
      }

      case 'inline_json': {
        const raw = params.jsonString || params.sourceId;
        if (!raw) throw new Error('Missing "jsonString" or raw json in "sourceId" for source "inline_json"');
        try {
          targetData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e: any) {
          throw new Error(`Invalid inline JSON provided: ${e.message}`);
        }
        break;
      }

      default:
        throw new Error(`Unsupported source: ${params.source}`);
    }

    return JsonNavigator.query(targetData, {
      path: params.path,
      view: params.view,
      limit: params.limit,
      maxStringLength: params.maxStringLength,
      filterPredicate: params.filterPredicate,
    });
  }

  public async snapshotRenderedPage(options: RenderedSnapshotOptions = {}): Promise<RenderedSnapshotResult> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: snapshot_rendered_page(format=${options.format || 'ax_tree'})`);
    return await RenderedSnapshotEngine.capture(wc, options);
  }

  public async prerenderLinks(options: PrerenderOptions = {}): Promise<{ prerendered: string[]; count: number }> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: prerender_links(maxPages=${options.maxPages || 3})`);
    return await this.prerenderEngine.prerender(wc, options);
  }

  // ---- LLM-friendly site discovery (TODO_RESEARCH_CRAWL.md §5, Feature 6) ----

  public async probeLlmSurface(url?: string): Promise<LlmSurfaceReport> {
    this.addLog('action', `MCP Directive: llm_surface(${url || 'active tab'})`);
    return await this.llmSurface.probe(url);
  }

  public async fetchLlmSurface(opts: { url?: string; as?: LlmSurfaceKind } = {}): Promise<LlmFetchResult> {
    this.addLog('action', `MCP Directive: llm_fetch(${opts.url || 'active tab'}, as=${opts.as || 'auto'})`);
    return await this.llmSurface.fetch(opts);
  }

  /**
   * Loads a URL in a *detached* WebContentsView (real Chromium, host fingerprint) and returns the
   * result of `script`. Used for reading advertised Markdown/Text alternates and for `search_web`
   * SERPs — without hijacking the active tab. Optionally waits for `readyScript` to become truthy.
   */
  private async loadDetached<T = any>(
    url: string,
    script: string,
    opts: { timeoutMs?: number; settleMs?: number; readyScript?: string; readyMs?: number; after?: (wc: WebContents) => Promise<any> } = {},
  ): Promise<{ result: T | null; after: any; status: number; contentType: string | null }> {
    // Serialize every detached operation through ONE reusable, off-screen view. Creating and
    // destroying a WebContentsView per call churns renderer processes (Electron 44 has no reliable
    // public destroy), which made repeated crawls/searches flaky.
    const run = (): Promise<{ result: T | null; after: any; status: number; contentType: string | null }> =>
      new Promise((resolve) => {
        const wc = this.getUtilView().webContents;
        let settled = false;
        let status = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = async () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          let result: T | null = null;
          let after: any = null;
          let contentType: string | null = null;
          try {
            contentType = await wc.executeJavaScript('document.contentType || ""').catch(() => '');
            result = (await wc.executeJavaScript(script).catch(() => null)) as T | null;
            if (opts.after) after = await opts.after(wc).catch(() => null);
          } catch {
            /* navigation may have replaced the frame */
          }
          resolve({ result, after, status, contentType: contentType || null });
        };

        const deadlineMs = opts.timeoutMs ?? 12000;
        timer = setTimeout(() => void finish(), deadlineMs);

        const onNav = (_e: unknown, _u: string, code?: number) => {
          status = code || status;
        };
        wc.on('did-navigate', onNav as any);

        void (async () => {
          // `loadURL` resolves when the navigation *it* started finishes — unlike a bare
          // `did-finish-load` listener, which the initial about:blank document also triggers.
          try {
            await wc.loadURL(url);
          } catch {
            /* load error: read whatever committed */
          }
          wc.removeListener('did-navigate', onNav as any);

          // Bounded readiness poll: the committed document must be complete and non-empty, and
          // `readyScript` (if any) must be truthy.
          const deadline = Date.now() + Math.min(opts.readyMs ?? 4000, deadlineMs);
          while (!settled && Date.now() < deadline) {
            const st = await wc
              .executeJavaScript('(() => ({ href: location.href, ready: document.readyState, len: document.body ? document.body.innerHTML.length : 0 }))()')
              .catch(() => null);
            if (st && /^https?:/i.test(st.href) && st.ready === 'complete' && st.len > 0) {
              if (!opts.readyScript) break;
              const extra = await wc.executeJavaScript(opts.readyScript).catch(() => false);
              if (extra) break;
            }
            await new Promise((r) => setTimeout(r, 150));
          }

          if (settled) return;
          if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs));
          void finish();
        })();
      });

    const p = this.utilQueue.then(run, run);
    this.utilQueue = p.then(
      () => undefined,
      () => undefined,
    );
    return await p;
  }

  /** Lazily created, reused off-screen view for detached reads (SERPs, alternates, crawls). */
  private getUtilView(): WebContentsView {
    if (!this.utilView) {
      const view = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
      });
      try {
        view.webContents.setUserAgent(this.hostProfile.userAgent);
      } catch {
        /* profile optional */
      }
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.utilView = view;
    }
    return this.utilView;
  }

  /**
   * Loads a URL as a *real document navigation* in a detached view and returns its text.
   * Used for advertised per-page Markdown/Text alternates so the request carries the full
   * Chromium header + renderer fingerprint (rather than a synthetic fetch profile).
   */
  public async navigateForText(url: string): Promise<{ body: string | null; contentType: string | null; status: number }> {
    const r = await this.loadDetached<{ contentType: string; text: string }>(
      url,
      '(() => { const b = document.body; const t = b ? b.innerText : (document.documentElement ? document.documentElement.innerText : ""); return { contentType: document.contentType || "", text: t }; })()',
      { timeoutMs: 10000 },
    );
    return { body: r.result?.text ?? null, contentType: r.result?.contentType ?? null, status: r.status };
  }

  /**
   * Runs a web search across a configurable engine chain (TODO_RESEARCH_CRAWL.md §5, Feature 5).
   * Each engine is loaded in a detached view; if it yields nothing (bot-check/consent) the hub
   * falls back to the next. Results are plain URLs for `navigate_to` / `collect_all`.
   */
  public async searchWeb(
    query: string,
    opts: { engine?: string; engines?: string[]; urlTemplate?: string; max?: number } = {},
  ): Promise<SearchOutcome> {
    this.addLog('action', `MCP Directive: search_web("${query}", engine=${opts.engine || (opts.engines ? opts.engines.join('>') : 'auto')})`);
    return await this.searchHub.search(query, opts);
  }

  /** Renders a page in a detached view and returns its Markdown + outgoing links (for deep_crawl). */
  public async crawlRenderPage(
    url: string,
    opts: { selector?: string; waitUntilIdleMs?: number } = {},
  ): Promise<{ title: string; markdown: string; links: string[]; status: number }> {
    const sel = opts.selector ? JSON.stringify(opts.selector) : "'a[href]'";
    const script = `(() => {
      const out = new Set();
      for (const a of document.querySelectorAll(${sel})) {
        const href = a.href;
        if (!href || !/^https?:/i.test(href)) continue;
        out.add(href.split('#')[0]);
      }
      return { title: document.title || '', links: Array.from(out).slice(0, 400) };
    })()`;
    const r = await this.loadDetached<{ title: string; links: string[] }>(url, script, {
      timeoutMs: 25000,
      after: async (wc) =>
        (await RenderedSnapshotEngine.capture(wc, { format: 'markdown', waitUntilIdleMs: opts.waitUntilIdleMs ?? 400 })).content,
    });
    return { title: r.result?.title || url, links: r.result?.links || [], markdown: r.after || '', status: r.status };
  }

  /** Depth/page-budgeted BFS crawl that indexes each page into Cortex (Feature 1). */
  public async deepCrawl(opts: CrawlOptions): Promise<CrawlOutcome> {
    this.addLog('action', `MCP Directive: deep_crawl(${opts.startUrl}, depth=${opts.maxDepth ?? 2}, pages=${opts.maxPages ?? 5})`);
    return await this.crawler.crawl(opts);
  }

  /** search → gather top sources → distill → index; returns cited extractive evidence (Feature 3). */
  public async researchTopic(opts: ResearchOptions): Promise<ResearchOutcome> {
    this.addLog('action', `MCP Directive: research_topic("${opts.query}", maxSources=${opts.maxSources ?? 5})`);
    return await this.researcher.research(opts);
  }

  public async takeAnnotatedScreenshot(opts: { economy?: boolean; textOnly?: boolean; includeOffscreen?: boolean } = {}): Promise<{
    screenshot: { base64Image: string; filePath: string; width: number; height: number; mimeType: string };
    marks: MarkItem[];
  }> {
    const wc = this.getActiveWebContents();
    const economy = Boolean(opts.economy);
    const textOnly = Boolean(opts.textOnly);
    const includeOffscreen = Boolean(opts.includeOffscreen);
    this.addLog('action', `MCP Directive: take_annotated_screenshot(${textOnly ? 'text_only' : economy ? 'economy' : 'full'}${includeOffscreen ? ', include_offscreen' : ''})`);

    // Text-only: badges are only needed to populate the mark registry; no pixels are captured.
    if (textOnly) {
      const textMarks = await this.marksOverlay.injectMarks(wc, { includeOffscreen });
      await this.marksOverlay.removeMarks(wc);
      const viewport = this.getViewportBounds();
      return {
        screenshot: { base64Image: '', filePath: '', width: viewport.width, height: viewport.height, mimeType: 'image/png' },
        marks: textMarks,
      };
    }

    // 1. Inject visual badges into DOM
    const marks = await this.marksOverlay.injectMarks(wc, { includeOffscreen });

    // Wait a brief tick for render paint
    await new Promise((r) => setTimeout(r, 80));

    // 2. Capture annotated screenshot
    const bounds = this.getViewportBounds();
    const image = await this.capturePageWithRetry(wc, bounds);

    // 3. Immediately clean up marks from DOM
    await this.marksOverlay.removeMarks(wc);

    // Economy mode: downscale to max 640px wide and encode as JPEG (~10-20x smaller payload)
    const ECONOMY_MAX_WIDTH = 640;
    let outImage = image;
    if (economy && image.getSize().width > ECONOMY_MAX_WIDTH) {
      outImage = image.resize({ width: ECONOMY_MAX_WIDTH, quality: 'good' });
    }
    const size = outImage.getSize();
    const mimeType = economy ? 'image/jpeg' : 'image/png';
    const buffer = economy ? outImage.toJPEG(45) : outImage.toPNG();
    const base64Image = `data:${mimeType};base64,${buffer.toString('base64')}`;

    // 4. Save to disk & run retention cleanup
    const screenshotsDir = this.getScreenshotsDir();
    const filename = `annotated_${economy ? 'eco_' : ''}${Date.now()}.${economy ? 'jpg' : 'png'}`;
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, buffer);
    this.cleanupScreenshots(50);

    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Set-of-Marks: Tagged ${marks.length} interactive targets, saved to ${filePath}`,
    });

    return {
      screenshot: {
        base64Image,
        filePath,
        width: size.width,
        height: size.height,
        mimeType,
      },
      marks,
    };
  }

  public async clickMark(markId: number): Promise<string> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: click_mark(#${markId})`);
    const target = await this.marksOverlay.getMarkTarget(wc, markId);
    if (!target) {
      throw new Error(`Mark #${markId} not found. Call take_annotated_screenshot() to refresh interactive marks.`);
    }

    this.state.agentStatus = 'SIMULATING_INPUT';
    this.broadcastState();

    await this.simulator.clickAt(wc, target.currentCenter);

    this.state.agentStatus = 'IDLE';
    this.broadcastState();

    this.emitTelemetry({
      type: 'click',
      x: target.currentCenter.x,
      y: target.currentCenter.y,
      timestamp: Date.now(),
      details: `Set-of-Marks: Clicked mark #${markId} [${target.mark.tag}: "${target.mark.text}"]`,
    });

    this.bumpRevision();
    return `Clicked mark #${markId} (${target.mark.tag}: "${target.mark.text}")`;
  }

  public async typeMark(markId: number, text: string, opts: { secret?: boolean } = {}): Promise<string> {
    const wc = this.getActiveWebContents();
    const shown = opts.secret ? `[REDACTED ${String(text).length} chars]` : `"${text}"`;
    this.addLog('action', `MCP Directive: type_mark(#${markId}, ${shown})`);
    const target = await this.marksOverlay.getMarkTarget(wc, markId);
    if (!target) {
      throw new Error(`Mark #${markId} not found. Call take_annotated_screenshot() to refresh interactive marks.`);
    }

    this.state.agentStatus = 'SIMULATING_INPUT';
    this.broadcastState();

    await this.simulator.clickAt(wc, target.currentCenter);
    await new Promise((r) => setTimeout(r, 100));

    // A stray or occluded click silently sends keystrokes nowhere (sticky headers,
    // lazy re-renders, a hidden window). Verify the target actually took focus and,
    // if not, re-resolve its live centre and click once more before typing.
    const focusedOk = await wc
      .executeJavaScript(
        `(() => { const el = document.querySelector('[data-mark-id="${markId}"]'); if (!el) return true; const a = document.activeElement; if (!a) return false; return a === el || (el.contains && el.contains(a)) || (a.closest && a.closest('[data-mark-id="${markId}"]') === el); })()`
      )
      .catch(() => true);
    if (focusedOk === false) {
      this.addLog('warn', `type_mark(#${markId}): target did not take focus after click; retrying once.`);
      const retry = await this.marksOverlay.getMarkTarget(wc, markId);
      if (retry) {
        await this.simulator.clickAt(wc, retry.currentCenter);
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    await this.simulator.typeText(wc, text);

    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();

    return opts.secret
      ? `Focused mark #${markId} and typed ${String(text).length} chars (redacted)`
      : `Focused mark #${markId} and typed "${text}"`;
  }

  public getActiveMarks(): MarkItem[] {
    return this.marksOverlay.getActiveMarks();
  }

  public async saveScript(data: {
    name: string;
    code: string;
    description?: string;
    domain?: string;
    tags?: string[];
  }): Promise<ScriptItem> {
    this.addLog('action', `MCP Directive: save_script("${data.name}")`);
    const saved = await this.scriptVault.saveScript(data);
    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Saved & indexed script "${saved.name}" in Cortex Vault`,
    });
    return saved;
  }

  public async recallScripts(query?: string, options?: { domain?: string; tag?: string; limit?: number }): Promise<ScriptItem[]> {
    this.addLog('action', `MCP Directive: recall_scripts("${query || '*'}")`);
    return await this.scriptVault.recallScripts(query, options);
  }

  public async runScript(name: string, args: Record<string, any> = {}) {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: run_script("${name}")`);
    this.state.agentStatus = 'SIMULATING_INPUT';
    this.broadcastState();

    try {
      const res = await this.scriptVault.runScript(wc, name, args);
      this.state.agentStatus = 'IDLE';
      this.broadcastState();
      this.emitTelemetry({
        type: 'harvest',
        timestamp: Date.now(),
        details: `Executed macro "${name}" in ${res.executionDurationMs}ms`,
      });
      return res;
    } catch (err: any) {
      this.state.agentStatus = 'IDLE';
      this.broadcastState();
      throw err;
    }
  }

  public async listScripts(domain?: string, tag?: string): Promise<ScriptItem[]> {
    return await this.scriptVault.listScripts(domain, tag);
  }

  public async deleteScript(name: string): Promise<boolean> {
    this.addLog('action', `MCP Directive: delete_script("${name}")`);
    return await this.scriptVault.deleteScript(name);
  }

  // System Tray & Window Visibility
  public setWindowVisibility(visible: boolean): void {
    if (visible) {
      this.trayManager?.showWindow();
    } else {
      this.trayManager?.hideWindow();
    }
  }

  public isWindowVisible(): boolean {
    return this.trayManager ? this.trayManager.isWindowVisible() : true;
  }

  /** True when the app window currently owns OS focus (required for synthetic input). */
  public isWindowFocused(): boolean {
    try {
      return Boolean(this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused());
    } catch {
      return false;
    }
  }

  /** Brings the app window to the foreground (best effort). */
  public focusWindow(): boolean {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (!this.mainWindow.isVisible()) this.trayManager?.showWindow();
        this.mainWindow.show();
        this.mainWindow.focus();
        this.mainWindow.moveTop();
      }
    } catch {}
    return this.isWindowFocused();
  }

  public setCloseToTray(enabled: boolean): void {
    this.trayManager?.setCloseToTray(enabled);
  }

  public isCloseToTray(): boolean {
    return this.trayManager ? this.trayManager.isCloseToTray() : true;
  }

  // Human-In-The-Loop & Notifications
  public async requestHumanIntervention(
    reason: string,
    options?: { url?: string; timeoutSeconds?: number; bringToFront?: boolean }
  ): Promise<HilResolution> {
    this.addLog('warn', `⚠️ Human Intervention Requested: ${reason}`);
    this.emitTelemetry({
      type: 'navigation',
      timestamp: Date.now(),
      details: `HIL Intervention: ${reason}`,
    });
    return this.hilManager.requestIntervention({
      reason,
      url: options?.url,
      timeoutSeconds: options?.timeoutSeconds,
      bringToFront: options?.bringToFront,
    });
  }

  public resolveHumanIntervention(id?: string, notes?: string): boolean {
    const success = this.hilManager.resolveIntervention(id, notes);
    if (success) {
      this.addLog('info', `Human intervention resolved: ${notes || 'User confirmed.'}`);
    }
    return success;
  }

  public cancelHumanIntervention(id?: string): boolean {
    return this.hilManager.cancelIntervention(id);
  }

  public getActiveHumanIntervention(): HilRequest | null {
    return this.hilManager.getActiveRequest();
  }

  public getHumanInterventionHistory(): HilRequest[] {
    return this.hilManager.getHistory();
  }

  public sendNotification(
    title: string,
    message: string,
    urgency?: 'normal' | 'critical' | 'low',
    sound?: boolean
  ): boolean {
    this.addLog('info', `Desktop Notification Dispatched: [${title}] ${message}`);
    return this.hilManager.sendNotification({ title, message, urgency, sound });
  }

  // Bio-Kinematic Chaos Trajectory Methods
  public testChaosTrajectory(target: { x: number; y: number }, options?: ChaosKinematicsOptions): PathStep[] {
    const start = this.simulator.getCursorPosition();
    return generateChaosTrajectory(start, target, options);
  }

  public async moveMouse(target: { x: number; y: number }, options?: ChaosKinematicsOptions): Promise<void> {
    const wc = this.getActiveWebContents();
    await this.simulator.moveMouseTo(wc, target, options);
  }

  public getSimulator(): HumanizedInputSimulator {
    return this.simulator;
  }

  // ---- Primitives layer (observe / act / wait / extract / collect / find) ----

  public getPrimitives(): Primitives {
    return this.primitives;
  }

  public getRevision(): number {
    return this.revision;
  }

  public bumpRevision(): number {
    return ++this.revision;
  }

  /** Executes page script without per-poll log spam (used by primitives probes). */
  public async evaluateQuiet(script: string): Promise<any> {
    const wc = this.getActiveWebContents();
    return await wc.executeJavaScript(script);
  }

  /** Advertised capability surface for `bridge_health`. */
  public getCapabilities(): string[] {
    return [
      'observe:v2',
      'wait_for',
      'extract:list,table,app_data',
      'collect_all',
      'find',
      'expect',
      'act',
      'page_state',
      'diff',
      'network_since',
      'export_har',
      'contexts',
      'marks_offscreen',
      'llm_surface',
      'llm_fetch',
      'search_web',
      'deep_crawl',
      'research_topic',
    ];
  }
}
