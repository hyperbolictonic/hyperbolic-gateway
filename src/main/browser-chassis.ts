import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, nativeImage, ipcMain, clipboard, session, WebContentsView, type Session, type WebContents } from 'electron';
import type { AgentStatus, ChassisState, HarvestedConstruct, TelemetryEvent, TabSummary } from '../shared/types.js';
import { HumanizedInputSimulator } from './telemetry/input-simulator.js';
import { loadInputProfile, saveInputProfile, type InputProfile } from './telemetry/input-profile.js';
import { HumanActivityMonitor, humanListenerScript, SYNTHETIC_GRACE_MS, type HumanActivity } from './input/human-activity.js';
import { bump } from './metrics.js';
import { ActionLedger } from './telemetry/action-ledger.js';
import { ConstructHarvester } from './harvester/markdown.js';
import { captureComposedDom } from './harvester/dom-serializer.js';
import { readStoredDecisionConfig, saveDecisionConfig, decisionStatus, runDecision, onDecision, type DecisionEvent } from './decide/decision-client.js';
import { targetBoxScript, focusControlScript, DEEP_DOM_HELPERS, type TargetBox } from './primitives/dom-targeting.js';
import { detectHostBrowserProfile, type HostBrowserProfile } from './telemetry/host-fingerprint.js';
import { TabManager, type TabInstance } from './tabs/tab-manager.js';
import { cortex, CortexDB } from './cortex/cortex-db.js';
import { ShieldBreaker, type ShieldDismissResult, type ConsentPolicy } from './shield/shield-breaker.js';
import { evaluateInFrames, type FrameEvalOptions, type FrameEvalResult } from './browser/frame-eval.js';
import { listFrames, type FrameInfo } from './browser/frames.js';
import { clearFrameMarks, registerFrameMarks, resolveFrameMark } from './browser/frame-marks.js';
import { findSealedControls, type SealedFindOptions, type SealedFindResult } from './shadow-walk/ax-controls.js';
import { runTabWalk, type TabWalkOptions, type TabWalkResult } from './shadow-walk/tab-walk.js';
import { loadShadowWalkSettings, shadowWalkRefusal, type ShadowWalkSurface } from './shadow-walk/settings.js';
import {
  syncForceOpen,
  isForceOpenArmed,
  detectForceOpen,
  type ForceOpenDetection,
} from './shadow-walk/force-open.js';
import { controlFactsExpression, parseControlFacts, type ControlFacts, type ControlFactsOptions } from './primitives/control-facts.js';
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
import {
  DEFAULT_RESEARCH_SETTINGS,
  looksLikeChallenge,
  type ResearchSettings,
} from './research/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { HilManager, type HilRequest, type HilResolution, type NotificationOptions } from './hil/hil-manager.js';
import {
  generateChaosTrajectory,
  type ChaosKinematicsOptions,
  type PathStep,
} from './telemetry/chaos-kinematics.js';
import { JsonNavigator, type JsonQueryOptions, type JsonQueryResult } from './utils/json-navigator.js';
import { RenderedSnapshotEngine, type RenderedSnapshotOptions, type RenderedSnapshotResult } from './snapshots/rendered-snapshot.js';
import { PrerenderEngine, type PrerenderOptions } from './prerender/prerender-engine.js';
import { LlmSurface, type LlmSurfaceReport, type LlmSurfaceKind, type LlmFetchResult, type ReadUrlResult } from './llm/llm-surface.js';
import { SearchHub, type SearchOutcome } from './search/search-engine.js';
import { Crawler, type CrawlOptions, type CrawlOutcome } from './crawl/crawler.js';
import { Researcher, type ResearchOptions, type ResearchOutcome } from './research/researcher.js';

/**
 * Width of the page's classic scrollbar in the browsing view. Floating/docked panels are inset by
 * this much so they never sit on top of the scrollbar track (Chromium reserves 15px on Windows).
 */
const PAGE_SCROLLBAR_GUTTER = 16;

export class BrowserChassis {
  private mainWindow: BrowserWindow | null = null;
  /** Recent decision-model calls, mirrored to the HUD (newest last, capped at 50). */
  private decisionLog: DecisionEvent[] = [];
  /** Throttle for gate-triggered human hand-offs (one per URL per few minutes). */
  private lastGateHil: { url: string; at: number } | null = null;
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
  private researchLlmSurface: LlmSurface;
  private searchHub: SearchHub;
  private crawler: Crawler;
  private researcher: Researcher;
  private actionLedger: ActionLedger;
  /** Reused off-screen view for detached reads (SERPs, Markdown alternates, crawls). */
  private utilView: WebContentsView | null = null;
  private researchSettings: ResearchSettings = {
    ...DEFAULT_RESEARCH_SETTINGS,
    engineChain: [...DEFAULT_RESEARCH_SETTINGS.engineChain],
  };
  private researchCooldowns = new Map<string, number>();
  private researchSessionConfigured = false;

  private sidebarView: WebContentsView | null = null;
  private sidebarMode: 'docked' | 'floating' | 'collapsed' = 'floating';
  /** Origins whose consent wall has already been answered (or deliberately left) this session. */
  private consentAnsweredOrigins = new Set<string>();
  /** Human takeover state: synthetic input is refused until this timestamp. */
  private humanMonitor = new HumanActivityMonitor();
  private humanActiveUntil = 0;
  private humanResetTimer: NodeJS.Timeout | null = null;
  /** How to answer a consent wall. KUANG_CONSENT_POLICY=essential|accept|reject. */
  private consentPolicy: ConsentPolicy = (() => {
    const raw = String(process.env.KUANG_CONSENT_POLICY || '').toLowerCase();
    return raw === 'accept' || raw === 'reject' ? (raw as ConsentPolicy) : 'essential';
  })();
  private lastOpenSidebarMode: 'docked' | 'floating' = 'floating';
  /** False while a full-window settings/dialog surface is open. */
  private sidebarOverlayVisible = true;
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
    canGoBack: false,
    canGoForward: false,
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
    // Mirror every decision call into the HUD's DECISIONS tab. The listener is passive: it cannot
    // delay or fail a decision (see emitDecision), and the ring buffer lets a late-joining renderer
    // catch up.
    onDecision((event) => {
      this.decisionLog.push(event);
      if (this.decisionLog.length > 50) this.decisionLog.shift();
      this.sendToSurfaces('chassis:decision', event);
    });

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

    // Human pacing knobs (Settings → INPUT); loaded once at boot, updated live over IPC.
    this.simulator.setProfile(loadInputProfile());
    // Takeover arbitration: every synthetic dispatch is stamped so the monitor can tell our input
    // from the person's, and the gate refuses input while the human has the wheel.
    this.simulator.setSyntheticMarker((at) => this.humanMonitor.markSynthetic(at));
    this.simulator.setHumanGate(() => this.isHumanActive());

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

    // Action ledger — local, append-only record of executed actions and their outcomes
    // (data/transitions.jsonl). This is the dataset a runner-side decision model learns from;
    // it never leaves the machine and never stores typed text.
    this.actionLedger = new ActionLedger({
      dir: path.join(process.cwd(), 'data'),
      log: (level, msg) => this.addLog(level, msg),
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
      getMarkTarget: (id) =>
        Number(id) >= 100
          ? resolveFrameMark(this.getActiveWebContents(), Number(id))
          : this.marksOverlay.getMarkTarget(this.getActiveWebContents(), id),
      getFrames: (opts) => this.getFrames(opts),
      clickMark: (id) => this.clickMark(id),
      typeMark: (id, text, opts) => this.typeMark(id, text, opts),
      clickElement: (selector, coords) => this.clickElement(selector, coords),
      typeText: (text, selector, opts) => this.typeText(text, selector, opts),
      findSealed: (opts) => this.findSealed(opts),
      componentSurfaceEnabled: () => this.componentSurfaceEnabled(),
      insertText: (text) => this.simulator.insertText(this.getActiveWebContents(), text),
      pasteText: (text) => this.simulator.pasteText(this.getActiveWebContents(), text),
      moveMouseTo: (target) => this.moveMouse(target),
      pressKey: (key) => this.pressKey(key),
      snapshotRenderedPage: (opts) => this.snapshotRenderedPage(opts),
      getNetworkTraffic: (filter) => this.getNetworkTraffic(filter),
      getPageInfo: () => this.getPageInfo(),
      revision: () => this.revision,
      windowFocused: () => this.isWindowFocused(),
      recordTransition: (record) => this.actionLedger.record(record),
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
      renderPage: (url) => this.readUrlRender(url),
      userAgent: this.hostProfile.userAgent,
      log: (level, msg) => this.addLog(level, msg),
    });

    this.researchLlmSurface = new LlmSurface({
      getSession: () => this.getResearchSession(),
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
        const report = await this.researchLlmSurface.probe(url);
        if (!report.content_negotiation?.accepts_markdown) return null;
        const r = await this.researchLlmSurface.fetch({ url, as: 'markdown' });
        return { content: r.content, via: r.via };
      },
      renderPage: (url, pageOpts) => this.crawlRenderPage(url, pageOpts),
      beforePage: (url) => this.assertResearchCooldown(url),
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
    this.setupSidebarView();
    void this.configureResearchSession();
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

          // Re-arm the takeover listener after every document (listeners die with the page).
          if (!tab.isLoading && tab.url && !tab.url.startsWith('mark-eleven:') && tab.url !== 'about:blank') {
            void tab.view.webContents.executeJavaScript(humanListenerScript()).catch(() => null);
          }
          if (!tab.isLoading && tab.url && !tab.url.startsWith('mark-eleven:') && tab.url !== 'about:blank') {
            this.indexTabQuietly(tab);
          }
        }
      },
      onTabsChanged: (tabs: TabSummary[]) => {
        this.state.tabs = tabs;
        this.broadcastState();
        this.trayManager?.updateStatus(this.state.agentStatus, tabs.length, !!this.hilManager.getActiveRequest());
        this.sendToSurfaces('chassis:tabs-updated', tabs);
      },
      onTabCreated: (tab: TabInstance) => {
        this.networkInterceptor.attach(tab.view.webContents);
        // A tab created while force-open is armed must be patched *before* its document runs.
        // onTabCreated fires before the first load, but CDP arming is async; if the first document
        // already started, reload once so the patch is actually present.
        void this.syncForceOpenFor(tab.view.webContents).then((result) => {
          if (result.changed && result.armed && !tab.view.webContents.isDestroyed()) {
            setTimeout(() => {
              try {
                tab.view.webContents.reload();
              } catch {}
            }, 60);
          }
        });
      },
      onViewAdded: () => this.bringSidebarToFront(),
      onLog: (level, msg) => this.addLog(level, msg),
      onConsoleLog: (log) => {
        this.targetConsoleLogs.push(log);
        if (this.targetConsoleLogs.length > 200) this.targetConsoleLogs.shift();
        // Takeover channel: the page reports trusted pointer/key/wheel activity with a magic prefix.
        const human = this.humanMonitor.ingest(log.message);
        if (human) this.noteHumanInput(human);
      },
    });

    this.addLog('info', `Stealth Profile Active: Spoofing host ${this.hostProfile.name} v${this.hostProfile.version}`);

    // Create initial default tab
    this.tabManager.createTab('about:blank');

    this.mainWindow.on('resize', () => {
      this.positionSidebar();
      this.tabManager?.updateActiveTabBounds();
    });
  }

  public getViewportBounds(): { x: number; y: number; width: number; height: number } {
    if (!this.mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    const [winWidth, winHeight] = this.mainWindow.getSize();
    const rightPanelWidth = this.sidebarMode === 'docked' ? 420 : 0;
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

  public getSidebarMode(): 'docked' | 'floating' | 'collapsed' {
    return this.sidebarMode;
  }

  public setSidebarMode(mode: 'docked' | 'floating' | 'collapsed'): void {
    if (mode !== 'docked' && mode !== 'floating' && mode !== 'collapsed') return;
    if (mode === 'docked' || mode === 'floating') this.lastOpenSidebarMode = mode;
    this.sidebarMode = mode;
    this.addLog('action', `Sidebar mode: ${mode}`);
    this.positionSidebar();
    this.tabManager?.updateActiveTabBounds();
    this.broadcastSidebarMode();
  }

  public toggleSidebarMode(): void {
    if (this.sidebarMode === 'collapsed') {
      this.setSidebarMode(this.lastOpenSidebarMode);
    } else {
      this.lastOpenSidebarMode = this.sidebarMode;
      this.setSidebarMode('collapsed');
    }
  }

  private sendToSurfaces(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
    if (this.sidebarView && !this.sidebarView.webContents.isDestroyed()) {
      this.sidebarView.webContents.send(channel, payload);
    }
  }

  private broadcastSidebarMode(): void {
    this.sendToSurfaces('chassis:sidebar-mode', this.sidebarMode);
  }

  private positionSidebar(): void {
    if (!this.mainWindow || !this.sidebarView) return;
    if (!this.sidebarOverlayVisible) {
      this.sidebarView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    const [winWidth, winHeight] = this.mainWindow.getSize();
    // Leave the page's right-edge scrollbar out from under the panel. The browsing view spans the
    // full window width (floating panels sit *over* the page), so a panel flush to the right edge
    // covers the scrollbar track completely and the page becomes undraggable by hand.
    const scrollbarGutter = PAGE_SCROLLBAR_GUTTER;
    const usableWidth = Math.max(0, winWidth - scrollbarGutter);

    if (this.sidebarMode === 'collapsed') {
      // Keep the collapsed overlay small so it only captures the toggle, not
      // the page's right-edge scrollbar.
      const width = 36;
      const height = 60;
      this.sidebarView.setBounds({
        x: Math.max(0, usableWidth - width),
        y: 108,
        width: Math.min(width, usableWidth),
        height: Math.min(height, Math.max(0, winHeight - 108)),
      });
      return;
    }

    const width = 420;
    this.sidebarView.setBounds({
      x: Math.max(0, usableWidth - width),
      y: 100,
      width: Math.min(width, usableWidth),
      height: Math.max(0, winHeight - 100),
    });
  }

  public async setResearchSettings(settings: ResearchSettings): Promise<void> {
    this.researchSettings = {
      ...settings,
      engineChain: [...settings.engineChain],
    };
    await this.configureResearchSession();
  }

  public getResearchSettings(): ResearchSettings {
    return {
      ...this.researchSettings,
      engineChain: [...this.researchSettings.engineChain],
    };
  }

  public async resetResearchSession(): Promise<void> {
    const researchSession = this.getResearchSession();
    await researchSession.clearStorageData().catch(() => undefined);
    await researchSession.clearCache().catch(() => undefined);
    this.researchCooldowns.clear();
    this.addLog('info', 'Research session cookies/cache cleared.');
  }

  private getResearchSession(): Session {
    return session.fromPartition('persist:kuang-research');
  }

  private async configureResearchSession(): Promise<void> {
    const researchSession = this.getResearchSession();
    try {
      researchSession.setUserAgent(this.hostProfile.userAgent);
    } catch {
      /* profile optional */
    }

    try {
      await researchSession.setProxy(
        this.researchSettings.proxyUrl ? { proxyRules: this.researchSettings.proxyUrl } : { mode: 'direct' },
      );
    } catch (err: any) {
      this.addLog('warn', `Research proxy could not be applied: ${err?.message || err}`);
    }

    if (!this.researchSessionConfigured) {
      this.researchSessionConfigured = true;
      researchSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = this.hostProfile.userAgent;
        details.requestHeaders['sec-ch-ua'] = this.hostProfile.secChUa;
        details.requestHeaders['sec-ch-ua-platform'] = this.hostProfile.secChUaPlatform;
        callback({ requestHeaders: details.requestHeaders });
      });
    }
  }

  private async activateResearchView(wc: WebContents): Promise<void> {
    if (!this.researchSettings.enabled || !this.researchSettings.activateView) return;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable').catch(() => undefined);
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
      await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }).catch(() => undefined);
    } catch {
      // The page can still be read without the CDP activation.
    }
  }

  private engineHost(engine: string): string {
    if (engine === 'custom' && this.researchSettings.urlTemplate) {
      try {
        return new URL(this.researchSettings.urlTemplate.replace('{query}', 'test')).hostname;
      } catch {
        return '';
      }
    }
    return (
      {
        google: 'www.google.com',
        duckduckgo: 'html.duckduckgo.com',
        bing: 'www.bing.com',
        brave: 'search.brave.com',
        startpage: 'www.startpage.com',
      } as Record<string, string>
    )[engine] || '';
  }

  private isResearchCooling(host: string): boolean {
    if (!host) return false;
    return (this.researchCooldowns.get(host) || 0) > Date.now();
  }

  private markResearchCooldown(host: string, reason: string): void {
    if (!host || !this.researchSettings.enabled) return;
    const until = Date.now() + this.researchSettings.domainCooldownSec * 1000;
    this.researchCooldowns.set(host, until);
    this.addLog(
      'warn',
      `Research cooldown: ${host} paused for ${this.researchSettings.domainCooldownSec}s after ${reason}.`,
    );
  }

  private assertResearchCooldown(url: string): void {
    if (!this.researchSettings.enabled) return;
    try {
      const host = new URL(url).hostname;
      const until = this.researchCooldowns.get(host) || 0;
      if (until > Date.now()) {
        const seconds = Math.ceil((until - Date.now()) / 1000);
        throw this.researchError('RESEARCH_COOLDOWN', `${host} is cooling down after a WAF/challenge; try again in ${seconds}s.`);
      }
    } catch (err: any) {
      if (err?.code === 'RESEARCH_COOLDOWN') throw err;
    }
  }

  private researchError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  }

  private setSidebarOverlayVisible(visible: boolean): void {
    this.sidebarOverlayVisible = visible;
    this.positionSidebar();
  }

  private bringSidebarToFront(): void {
    if (!this.mainWindow || !this.sidebarView) return;
    try {
      this.mainWindow.contentView.removeChildView(this.sidebarView);
    } catch {
      // Not currently attached.
    }
    this.mainWindow.contentView.addChildView(this.sidebarView);
    this.positionSidebar();
  }

  private setupSidebarView(): void {
    if (!this.mainWindow) return;

    this.sidebarView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        // The preload is an ESM bundle; sandboxed preloads must be CJS. The
        // overlay only loads our local index.html, so context isolation is the
        // relevant boundary here.
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.sidebarView.setBackgroundColor('#00000000');
    this.mainWindow.contentView.addChildView(this.sidebarView);

    try {
      const devUrl = process.env.VITE_DEV_SERVER_URL;
      if (devUrl) {
        const url = new URL(devUrl);
        url.searchParams.set('sidebar', '1');
        this.sidebarView.webContents.loadURL(url.toString());
      } else {
        this.sidebarView.webContents.loadFile(path.join(__dirname, '../../dist/index.html'), {
          query: { sidebar: '1' },
        });
      }
    } catch (err: any) {
      this.addLog('warn', `Sidebar overlay failed to load: ${err?.message || err}`);
    }

    this.sidebarView.webContents.on('did-finish-load', () => {
      this.sidebarView?.webContents.send('chassis:decision-status', decisionStatus());
    });

    this.positionSidebar();
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
    // A tab opened directly at a URL is a navigation too: arm the same late-consent sweep, or a
    // cookie wall on a freshly opened tab would never be dismissed.
    if (url && /^https?:/i.test(url)) this.scheduleConsentSweep();
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

    // Toolbar history controls. These are the same entry points the MCP `navigate_history` tool and
    // the right-click menu use, so a human and an agent cannot drift apart.
    ipcMain.handle('chassis:go-back', async () => ({ message: await this.goBack() }));
    ipcMain.handle('chassis:go-forward', async () => ({ message: await this.goForward() }));
    ipcMain.handle('chassis:reload', async () => ({ message: await this.reload() }));
    ipcMain.handle('chassis:get-nav-state', () => {
      const wc = this.tabManager?.getActiveTab()?.view?.webContents;
      const usable = wc && !wc.isDestroyed();
      return {
        canGoBack: usable ? wc.navigationHistory.canGoBack() : false,
        canGoForward: usable ? wc.navigationHistory.canGoForward() : false,
      };
    });

    // Human-input pacing (Settings → INPUT). IPC only: settings are never changed over HTTP.
    ipcMain.handle('input:get-profile', () => loadInputProfile());
    ipcMain.handle('input:save-profile', (_: any, patch: Partial<InputProfile>) => {
      const result = saveInputProfile(patch || {});
      if (result.ok) this.simulator.setProfile(result.profile);
      return result;
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
      this.setSidebarOverlayVisible(visible);
    };

    ipcMain.handle('chassis:set-viewport-visibility', setVisibility);
    ipcMain.on('chassis:set-viewport-visibility', setVisibility);

    ipcMain.handle('chassis:get-sidebar-mode', () => this.getSidebarMode());
    ipcMain.on('chassis:set-sidebar-mode', (_: any, mode: 'docked' | 'floating' | 'collapsed') =>
      this.setSidebarMode(mode),
    );
    ipcMain.on('chassis:toggle-sidebar-mode', () => this.toggleSidebarMode());

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

    // Settings → decision model (optional). The renderer reads/writes data/decision.json through
    // these; the same file the bridge and the MCP server read, so there is one source of truth.
    ipcMain.handle('settings:get-decision', async () => ({
      stored: readStoredDecisionConfig(),
      status: decisionStatus(),
    }));
    ipcMain.handle('settings:save-decision', async (_, config: any) => {
      const result = await saveDecisionConfig(config);
      this.sendToSurfaces('chassis:decision-status', decisionStatus());
      return result;
    });
    ipcMain.handle('chassis:get-decisions', async () => this.decisionLog);
    // Reliable text copy for the HUD: selecting text inside a WebContentsView shell is not always
    // possible, and the clipboard is async in Electron 44.
    ipcMain.handle('app:copy-text', async (_, text: string) => {
      await clipboard.writeText(String(text ?? ''));
      return { ok: true };
    });
    ipcMain.handle('settings:test-decision', async () => {
      const started = Date.now();
      const result = await runDecision({
        state: { page: this.getPageInfo().url, note: 'connectivity probe from the Settings tab' },
        questions: { reachable: { type: 'noul', instructions: 'Is this a page URL?' } },
      });
      return { ...result, totalMs: Date.now() - started };
    });
  }

  public getCortex(): CortexDB {
    return cortex;
  }

  /**
   * Capture the visible viewport as a baseline JPEG inside TypeSafe's image limits (longest side
   * ≤ 1568, shortest ≥ 280). Used by `decide(include_screenshot)` so the model can see the page.
   */
  public async captureScreenshotJpeg(maxSide = 1400, quality = 82): Promise<{ base64: string; width: number; height: number } | null> {
    try {
      const wc = this.getActiveWebContents();
      const image = await this.capturePageWithRetry(wc, this.getViewportBounds());
      if (!image || image.isEmpty()) return null;
      const size = image.getSize();
      if (!size.width || !size.height) return null;

      const shrink = Math.min(1, maxSide / Math.max(size.width, size.height));
      let out = shrink < 1
        ? image.resize({ width: Math.round(size.width * shrink), height: Math.round(size.height * shrink), quality: 'good' })
        : image;

      const after = out.getSize();
      const smallest = Math.min(after.width, after.height);
      if (smallest > 0 && smallest < 280) {
        const grow = 280 / smallest;
        out = out.resize({ width: Math.round(after.width * grow), height: Math.round(after.height * grow), quality: 'good' });
      }

      const final = out.getSize();
      const buffer = out.toJPEG(quality);
      return { base64: buffer.toString('base64'), width: final.width, height: final.height };
    } catch (err: any) {
      this.addLog('warn', `Screenshot capture failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * A sensitive gate needs a person. Raise the hand-off from Kuang itself rather than relying on the
   * caller to do it: the rule already decided that a human is required, so waiting for another round
   * trip only wastes the agent's turn. Throttled per URL, and skipped while a request is already open.
   */
  public async requestHumanForGate(gate: { kind?: string; reason: string; evidence?: string[] }, url?: string): Promise<void> {
    // Only one request at a time: while one is open the human is already being asked. Once it is
    // resolved, a fresh gate may ask again — that is the correct behaviour, not spam, because the
    // human explicitly cleared the previous request.
    if (this.hilManager.getActiveRequest()) return;
    const pageUrl = url || this.getPageInfo().url;
    const detail = gate.evidence && gate.evidence.length ? ` — matched: ${gate.evidence.join(' | ')}` : '';
    await this.requestHumanIntervention(`${gate.reason}${detail}`, { url: pageUrl, bringToFront: true }).catch(() => null);
  }

  /** Recent decision-model calls, for `GET /decisions` and the HUD's DECISIONS tab. */
  public getDecisionEvents(): DecisionEvent[] {
    return this.decisionLog;
  }

  // ---- human takeover ------------------------------------------------------

  /** Synthetic input is refused while a human was active within the grace window. */
  public isHumanActive(): boolean {
    return Date.now() < this.humanActiveUntil;
  }

  public getHumanStatus(): { active: boolean; activeForMs: number; last: HumanActivity | null } {
    const active = this.isHumanActive();
    return {
      active,
      activeForMs: active ? this.humanActiveUntil - Date.now() : 0,
      last: this.humanMonitor.getLastHuman(),
    };
  }

  /** Clear the takeover window (the agent asks to resume, or the HUD button does). */
  public resumeHuman(): { resumed: boolean } {
    this.humanActiveUntil = 0;
    if (this.humanResetTimer) {
      clearTimeout(this.humanResetTimer);
      this.humanResetTimer = null;
    }
    if (this.state.agentStatus === 'HUMAN_INPUT') {
      this.state.agentStatus = 'IDLE';
      this.state.activeAction = 'Human handed back control';
      this.broadcastState();
    }
    this.addLog('info', 'Human takeover cleared — agent may act again.');
    return { resumed: true };
  }

  private noteHumanInput(activity: HumanActivity): void {
    if (activity.url && this.state.currentUrl && activity.url !== this.state.currentUrl) return; // stale tab
    // A human keeps the wheel for a short quiet period; every new event extends it.
    this.humanActiveUntil = Date.now() + 2000;
    if (this.humanResetTimer) clearTimeout(this.humanResetTimer);
    this.humanResetTimer = setTimeout(() => {
      if (this.state.agentStatus === 'HUMAN_INPUT' && !this.isHumanActive()) {
        this.state.agentStatus = 'IDLE';
        this.state.activeAction = 'Human idle — agent may resume';
        this.broadcastState();
        this.addLog('info', 'Human went idle — agent may resume.');
      }
    }, 2100);

    const wasActive = this.state.agentStatus === 'HUMAN_INPUT';
    this.state.agentStatus = 'HUMAN_INPUT';
    this.state.activeAction = `Human takeover (${activity.kind}${activity.target ? `: ${activity.target}` : ''}) — agent paused`;
    this.emitTelemetry({
      type: 'click',
      timestamp: activity.at,
      details: `HUMAN ${activity.kind}${activity.target ? ` on ${activity.target}` : ''} — synthetic input paused`,
    });
    if (!wasActive) this.addLog('warn', `Human takeover detected (${activity.kind}${activity.target ? `: ${activity.target}` : ''}) — synthetic input paused for ${SYNTHETIC_GRACE_MS}ms+ quiet.`);
    this.broadcastState();
  }

  /**
   * A guarded decision that cannot clear its threshold is a HUMAN decision, not an agent guess.
   * Raise the HIL banner (with the options) and hand the caller a `human_required` result so it
   * stops instead of acting on a coin flip. Non-blocking: the request is registered synchronously,
   * and the promise is left to resolve when the person acts or the request times out.
   */
  public requestHumanForDecision(
    info: { question?: string; options?: string[]; confidence?: number; reasons?: string[] },
    url?: string
  ): string | null {
    const existing = this.hilManager.getActiveRequest();
    if (existing) return existing.id; // already asking the human; do not stack requests

    const pageUrl = url || this.getPageInfo().url;
    const options = (info.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6);
    const bits = [
      info.question ? `Decision needed: ${info.question}` : 'Decision needed',
      options.length ? `Options: ${options.map((o) => `"${o}"`).join(', ')}` : '',
      typeof info.confidence === 'number' ? `(model confidence ${info.confidence.toFixed(2)})` : '',
      info.reasons?.length ? `— ${info.reasons.slice(0, 2).join('; ')}` : '',
    ].filter(Boolean);
    const reason = bits.join(' ').slice(0, 400);

    const pending = this.requestHumanIntervention(reason, { url: pageUrl, bringToFront: true, timeoutSeconds: 300 });
    const id = this.hilManager.getActiveRequest()?.id ?? null;
    void pending.catch(() => null); // resolves when the human acts; we do not block the HTTP call
    return id;
  }
  private async indexTabQuietly(tab: TabInstance) {
    try {
      const url = tab.url;
      const title = tab.title;
      if (!url || url === 'about:blank' || url.startsWith('mark-eleven:') || url.startsWith('file:')) return;
      
      const wc = tab.view.webContents;
      const composed = await captureComposedDom(wc);
      const rawHtml = composed.html;
      const construct = this.harvester.harvest(rawHtml, url, title, { shadowRoots: composed.shadowRoots });
      const indexedCount = await cortex.indexPage(url, construct.title, construct.content);
      if (indexedCount > 0) {
        this.addLog('info', `Cortex indexed: ${construct.title} (${indexedCount} semantic chunks)`);
      }
    } catch {
      // Background indexing failure is non-fatal
    }
  }

  private broadcastState() {
    // History availability is read at broadcast time, not cached on navigation: SPAs use pushState,
    // which fires no navigation event, and a tab switch swaps the history stack under the toolbar.
    try {
      const wc = this.tabManager?.getActiveTab()?.view?.webContents;
      if (wc && !wc.isDestroyed()) {
        this.state.canGoBack = wc.navigationHistory.canGoBack();
        this.state.canGoForward = wc.navigationHistory.canGoForward();
      }
    } catch {
      // A tab mid-teardown has no usable history; leave the previous flags alone.
    }
    this.sendToSurfaces('chassis:state-updated', this.state);
  }

  private emitTelemetry(event: TelemetryEvent) {
    this.sendToSurfaces('chassis:telemetry', event);
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

    this.sendToSurfaces('chassis:log', entry);
  }

  // MCP Operations on Active Tab
  public async navigateTo(url: string, autoDismissConsent: boolean = true): Promise<string> {
    bump('nav');
    const wc = this.getActiveWebContents();
    await this.syncForceOpenFor(wc);
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
      // Consent walls frequently mount *after* load — a hydration delay, or after a login/redirect
      // (Reddit's cookie dialog arrives post-signin). One timed attempt at 1.8s missed those, so
      // sweep a few settle points; each sweep is gated by a cheap consent-only DOM check, so this
      // never clicks an ordinary dialog.
      this.scheduleConsentSweep();
    }

    await navPromise;
    this.bumpRevision();
    return `Navigated to ${formattedUrl}`;
  }

  private consentSweepTimers: NodeJS.Timeout[] = [];

  private clearConsentSweep(): void {
    for (const timer of this.consentSweepTimers) clearTimeout(timer);
    this.consentSweepTimers = [];
  }

  /** Schedule late consent attempts after a navigation; replaces any sweep already pending. */
  private scheduleConsentSweep(delays: number[] = [900, 2600, 6000]): void {
    this.clearConsentSweep();
    for (const delay of delays) {
      const timer = setTimeout(() => {
        void this.sweepConsent();
      }, delay);
      timer.unref?.();
      this.consentSweepTimers.push(timer);
    }
  }

  /**
   * Answer a consent wall the way a person would, once per origin, and stop.
   *
   * Deliberately narrower than the old three-pass sweep: a repeated click on a CMP that re-renders
   * is what made the banner flicker on/off, and auto-removing it is not a human behaviour. So:
   *  - one attempt after the page settles,
   *  - the least invasive real option (reject/only-necessary before accept),
   *  - if it reappears, remember the origin and leave it alone,
   *  - never strip the DOM from here (`forceRemove` is only for an explicit dismiss_consent call).
   */
  private async sweepConsent(): Promise<void> {
    let wc: WebContents;
    try {
      wc = this.getActiveWebContents();
    } catch {
      return;
    }
    if (!wc || wc.isDestroyed()) return;

    let origin = '';
    try {
      origin = new URL(wc.getURL()).origin;
    } catch {
      return;
    }
    if (origin && this.consentAnsweredOrigins.has(origin)) return;

    const result = await this.dismissConsent({ policy: this.consentPolicy, forceRemove: false }).catch(() => null);
    if (!result) return;

    if (result.dismissed) {
      if (origin) this.consentAnsweredOrigins.add(origin);
      this.addLog('info', `Consent handled once (${result.intent || 'accept'} via ${result.framework || 'generic'}): ${result.message}`);
      return;
    }
    if (result.blocked) {
      // A wall we cannot answer is a human's call, not ours. Remember it so we stop re-scanning,
      // and leave the overlay exactly where it is.
      if (origin) this.consentAnsweredOrigins.add(origin);
      this.addLog('warn', 'Consent wall present but no reject/accept control matched — left for the human (no auto-removal).');
    }
  }

  public async dismissConsent(options: { policy?: ConsentPolicy; forceRemove?: boolean } = {}): Promise<ShieldDismissResult> {    const wc = this.getActiveWebContents();
    this.addLog('action', 'Shield Directive: dismiss_consent()');
    // An explicit call is allowed the last-resort removal; the background sweep is not.
    const result = await this.shieldBreaker.dismissConsent(wc, {
      policy: options.policy || this.consentPolicy,
      forceRemove: options.forceRemove === true,
    });
    if (result.dismissed) {
      this.addLog('info', `Shield Breaker: ${result.message}`);
      this.emitTelemetry({
        type: 'click',
        x: result.coordinates?.x,
        y: result.coordinates?.y,
        timestamp: Date.now(),
        details: `Shield Breaker: answered ${result.framework} consent wall (${result.intent || 'accept'})`,
      });
    }
    return result;
  }

  public async clickElement(selector?: string, coordinates?: { x: number; y: number }): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';

    let targetX = coordinates?.x;
    let targetY = coordinates?.y;
    let targetTag: string | undefined;
    let viaShadowRoot = false;

    if (selector) {
      this.addLog('action', `MCP Directive: click_element(selector="${selector}")`);
      const box = (await wc.executeJavaScript(targetBoxScript({ selector })).catch(() => null)) as TargetBox | null;

      if (!box) {
        this.state.agentStatus = 'ERROR';
        this.broadcastState();
        throw new Error(`Target element not found: ${selector}`);
      }
      if (box.vw === 0 || box.vh === 0) {
        this.state.agentStatus = 'ERROR';
        this.broadcastState();
        throw new Error(
          'Page viewport is 0x0 — the tab is not laid out yet (window hidden or minimised?), so the target box is meaningless. Make the window visible and retry.'
        );
      }

      // The selector resolves to the control a *mouse* would hit — through shadow roots,
      // and past a custom-element host whose centre sits on a label rather than the input.
      targetX = box.x;
      targetY = box.y;
      targetTag = box.tag;
      viaShadowRoot = box.sameAsHost === false;
    } else if (targetX !== undefined && targetY !== undefined) {
      this.addLog('action', `MCP Directive: click_element(x=${targetX}, y=${targetY})`);
    } else {
      throw new Error('Must provide either selector or coordinates');
    }

    await this.simulator.clickAt(wc, { x: targetX!, y: targetY! });

    // NOTE: no synthetic `el.click()` here. The trusted CDP click above already
    // actuates the element; firing a second JS click double-submitted forms and
    // double-opened links.
    //
    // The focus nudge is applied to the **resolved control**, never to a custom-element
    // host: `host.focus()` either moves focus off the inner <input> or does nothing, and
    // either way the keystrokes that follow go nowhere (the silent-typing bug in
    // docs/FIELD_NOTES_2026-10-20_SIGNUP.md). The result is reported, not assumed.
    let focusReport: { focused: boolean | null; tag?: string; activeTag?: string } | null = null;
    if (selector) {
      focusReport = (await wc.executeJavaScript(focusControlScript({ selector })).catch(() => null)) as {
        focused: boolean | null;
        tag?: string;
        activeTag?: string;
      } | null;
    }
    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();

    if (focusReport && focusReport.focused === false && focusReport.tag) {
      this.addLog(
        'warn',
        `Click reached <${targetTag || '?'}> but focus is on <${focusReport.activeTag || 'nothing'}> — the control may be occluded or not focusable.`
      );
    }

    const label = targetTag ? `<${targetTag}>` : 'element';
    return `Clicked ${label} at (${targetX}, ${targetY})${viaShadowRoot ? ' (resolved inside a shadow root)' : ''}`;
  }

  public async typeText(text: string, selector?: string, opts: { clearFirst?: boolean } = {}): Promise<string> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'SIMULATING_INPUT';
    this.addLog('action', `MCP Directive: type_text("${text.substring(0, 15)}..."${selector ? ` on ${selector}` : ''}${opts.clearFirst ? ' clear_first' : ''})`);

    if (selector) {
      await this.clickElement(selector);
    }

    if (opts.clearFirst) {
      await this.simulator.clearFocusedField(wc);
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
    const readScroll = () =>
      wc
        .executeJavaScript(
          `(() => { const el = document.scrollingElement || document.documentElement; return { y: Math.round(window.scrollY || el.scrollTop || 0) }; })()`
        )
        .catch(() => null);
    const before = await readScroll();

    await this.simulator.scrollPage(wc, deltaY);

    // A wheel event lands on whatever is under the cursor. On pages with a fixed header, a
    // cookie layer or a custom inner scroller, the wheel is swallowed and the "successful" call
    // moves nothing (seen on Mobalytics: html is 2 783px tall, scrollY stayed 0). Verify, and
    // fall back to scrolling the real scroller under the viewport centre.
    const after = await readScroll();
    let usedFallback = false;
    if (before && after && Math.abs(after.y - before.y) < 2) {
      const fallback = await wc
        .executeJavaScript(
          `(() => {
            const delta = ${deltaY};
            const doc = document.scrollingElement || document.documentElement;
            let node = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
            let inner = null;
            while (node && node !== document.body && node !== document.documentElement) {
              const st = getComputedStyle(node);
              if (node.scrollHeight > node.clientHeight + 40 && /auto|scroll|overlay/.test(st.overflowY)) { inner = node; break; }
              node = node.parentElement;
            }
            const y0 = inner ? inner.scrollTop : doc.scrollTop;
            (inner || doc).scrollBy(0, delta);
            const y1 = inner ? inner.scrollTop : doc.scrollTop;
            return JSON.stringify({ target: inner ? 'inner' : 'document', before: Math.round(y0), after: Math.round(y1) });
          })()`
        )
        .catch(() => null);
      usedFallback = true;
      this.addLog('info', `scroll_page fell back to the real scroller: ${fallback || 'unknown'}`);
    }

    this.state.agentStatus = 'IDLE';
    this.broadcastState();
    this.bumpRevision();
    return `Scrolled ${direction} by ${amount}px${usedFallback ? ' (wheel was swallowed — scrolled the active scroll container instead)' : ''}`;
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

    const composed = await captureComposedDom(wc);
    const rawHtml = composed.html;
    const url = wc.getURL();
    const title = wc.getTitle();

    const construct = this.harvester.harvest(rawHtml, url, title, { shadowRoots: composed.shadowRoots });
    this.latestConstruct = construct;
    this.sendToSurfaces('chassis:construct-harvested', construct);

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

  /**
   * Evaluate in the main frame and its child frames (cross-origin included), via CDP isolated
   * worlds. Opt-in: two CDP commands per frame, so callers pass a frame budget.
   */
  public async evaluateInFrames(script: string, options?: FrameEvalOptions): Promise<FrameEvalResult[]> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: evaluate_in_frames(${options?.maxFrames ?? 8} max)`);
    return evaluateInFrames(wc, script, options);
  }

  /**
   * Shared control description used by marks, find, the decision guard and recipes.
   * One injected expression, no per-element round trips.
   */
  public async describeControls(options: ControlFactsOptions = {}): Promise<{ url?: string; controls: ControlFacts[] }> {
    if (options.deep === true) this.refuseShadow('deepOpenRoots');
    const wc = this.getActiveWebContents();
    const raw = await wc.executeJavaScript(controlFactsExpression(options)).catch(() => null);
    return parseControlFacts(raw);
  }

  /** Throws a structured refusal when a Shadow Walk surface is disabled. */
  private refuseShadow(surface: ShadowWalkSurface): void {
    const refusal = shadowWalkRefusal(surface);
    if (!refusal) return;
    const err: any = new Error(refusal.message);
    err.code = refusal.code;
    throw err;
  }

  /** Arm/disarm the force-open patch for the next document in this tab. */
  private async syncForceOpenFor(wc: WebContents): Promise<{ armed: boolean; changed: boolean; error?: string }> {
    const settings = loadShadowWalkSettings();
    return syncForceOpen(wc, settings.enabled && settings.shadow.forceOpen);
  }

  /**
   * Apply the current Shadow Walk policy to every open tab. Existing documents are not patched;
   * the patch applies on their next navigation (the UI says so).
   */
  public async applyShadowWalkSettings(): Promise<{ tabs: number; errors: string[] }> {
    const settings = loadShadowWalkSettings();
    const shouldArm = settings.enabled && settings.shadow.forceOpen;
    const tabs = this.tabManager?.allTabs() || [];
    const errors: string[] = [];
    for (const tab of tabs) {
      const result = await syncForceOpen(tab.view.webContents, shouldArm);
      if (result.error) errors.push(result.error);
    }
    return { tabs: tabs.length, errors };
  }

  public forceOpenArmed(): boolean {
    try {
      return isForceOpenArmed(this.getActiveWebContents());
    } catch {
      return false;
    }
  }

  /** A fingerprinting-style probe of the active document (read-only). */
  public async detectShadowPatch(): Promise<ForceOpenDetection> {
    return detectForceOpen(this.getActiveWebContents());
  }

  /** Frame tree + top-level geometry (no content scan). */
  public async listFrames(options: { maxFrames?: number } = {}): Promise<FrameInfo[]> {
    this.refuseShadow('frames');
    return listFrames(this.getActiveWebContents(), options);
  }

  /** Closed-shadow-root discovery (opt-in, cached, rate-limited). */
  public async findSealed(options: SealedFindOptions = {}): Promise<SealedFindResult> {
    this.refuseShadow('sealed');
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: find(sealed=true${options.name ? `, name="${options.name}"` : ''})`);
    return findSealedControls(wc, { ...options, revision: this.revision });
  }

  /** Whether component signatures are allowed by Settings → Shadow Walk. */
  public componentSurfaceEnabled(): boolean {
    return loadShadowWalkSettings().shadow.componentSurface;
  }

  /** Trusted Tab/Shift+Tab walk into a (possibly closed) shadow subtree. */
  public async focusWalk(options: TabWalkOptions): Promise<TabWalkResult> {
    this.refuseShadow('tabWalk');
    const settings = loadShadowWalkSettings();
    const wc = this.getActiveWebContents();
    const maxSteps = Math.min(
      options.maxSteps ?? settings.shadow.tabWalkMaxSteps,
      settings.shadow.tabWalkMaxSteps
    );
    const restore = options.restore ?? settings.shadow.tabWalkRestoreFocus;
    this.addLog('action', `MCP Directive: focus_walk(${options.selector || `${options.x},${options.y}`}, ${options.direction || 'forward'})`);
    const result = await runTabWalk(wc, { ...options, maxSteps, restore }, (key) => this.simulator.pressKey(wc, key));
    this.bumpRevision();
    return result;
  }

  /**
   * A frame as first-class content: where it is, what is inside it, and (optionally) what it looks
   * like. Frame-local control rects are offset into the top-level viewport, so the result can be
   * clicked with act(x, y) or read coordinate-free.
   *
   * Opt-in and bounded: the frame walk costs CDP commands per frame, and screenshots cost one
   * capture plus one crop per visible frame. `find(include_frames)` uses the same scan.
   */
  public async getFrames(options: {
    includeControls?: boolean;
    screenshots?: boolean;
    maxFrames?: number;
    maxControls?: number;
    selector?: string;
    includeOffscreen?: boolean;
    skipHitTest?: boolean;
    maxSide?: number;
  } = {}): Promise<{
    viewport: { width: number; height: number };
    frames: Array<FrameInfo & { controls?: ControlFacts[]; controlsTotal?: number }>;
    images: Array<{ frameId: string; url: string; name: string; base64Image: string; width: number; height: number; mimeType: string }>;
    notes: string[];
  }> {
    this.refuseShadow('frames');
    const settings = loadShadowWalkSettings();
    const wc = this.getActiveWebContents();
    const includeControls = options.includeControls !== false && settings.frames.controls;
    const wantScreenshots = options.screenshots === true && settings.frames.screenshots;
    const maxFrames = Math.min(options.maxFrames ?? settings.frames.maxFrames, settings.frames.maxFrames);
    const maxControls = Math.min(options.maxControls ?? settings.frames.maxControls, settings.frames.maxControls);
    const maxSide = Math.min(options.maxSide ?? settings.frames.screenshotMaxSide, settings.frames.screenshotMaxSide);
    this.addLog('action', `MCP Directive: frames(controls=${includeControls}, screenshots=${wantScreenshots})`);

    const frames = await listFrames(wc, { maxFrames });
    const notes: string[] = [];
    const main = frames.find((f) => f.depth === 0);
    const viewport = {
      width: main?.rect.width || 0,
      height: main?.rect.height || 0,
    };
    if (!frames.length) {
      notes.push('No frame tree: the CDP debugger is not attached to the active tab.');
      return { viewport, frames: [], images: [], notes };
    }
    if (frames.length === 1) notes.push('No child frames on this page.');
    if (options.includeControls !== false && !settings.frames.controls) {
      notes.push('Frame controls are off in Settings → Shadow Walk.');
    }
    if (options.screenshots === true && !settings.frames.screenshots) {
      notes.push('Frame screenshots are off in Settings → Shadow Walk.');
    }

    const out: Array<FrameInfo & { controls?: ControlFacts[]; controlsTotal?: number }> = frames.map((f) => ({ ...f }));

    if (includeControls && frames.length > 1) {
      const limit = Math.max(1, Math.min(maxControls, 200));
      clearFrameMarks(wc);
      // One expression, one frame-tree walk. Each child frame gets its own mark-id block
      // (100 + child_index * 100); the main frame is not stamped by this scan.
      const evaluated = await evaluateInFrames(
        wc,
        'null',
        {
          maxFrames,
          expressionForFrame: (_frame, index) =>
            index === 0
              ? 'null'
              : controlFactsExpression({
                  selector: options.selector,
                  limit,
                  includeOffscreen: true,
                  skipHitTest: options.skipHitTest === true,
                  deep: settings.shadow.deepOpenRoots,
                  markIdBase: 100 + (index - 1) * 100,
                  component: settings.shadow.componentSurface,
                }),
        }
      );

      const byId = new Map(out.map((f) => [f.frameId, f]));
      for (const result of evaluated) {
        const frame = byId.get(result.frameId);
        if (!frame || frame.depth === 0 || !result.ok) continue;
        const parsed = parseControlFacts(result.value);
        const controls: ControlFacts[] = [];
        for (const control of parsed.controls) {
          const rect = {
            x: control.rect.x + frame.rect.x,
            y: control.rect.y + frame.rect.y,
            width: control.rect.width,
            height: control.rect.height,
          };
          const onScreen =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.x < viewport.width &&
            rect.y < viewport.height &&
            rect.x + rect.width > 0 &&
            rect.y + rect.height > 0;
          if (!options.includeOffscreen && !onScreen) continue;
          controls.push({
            ...control,
            rect,
            visible: control.visible && !!frame.visibleRect,
            occluded: control.occluded || !onScreen,
          });
        }
        frame.controls = controls;
        frame.controlsTotal = parsed.controls.length;
        registerFrameMarks(
          wc,
          controls
            .filter((control) => typeof control.id === 'number' && control.id >= 100)
            .map((control) => ({ id: Number(control.id), frameId: frame.frameId }))
        );
      }
    }

    let images: Array<{ frameId: string; url: string; name: string; base64Image: string; width: number; height: number; mimeType: string }> = [];
    if (wantScreenshots && frames.length > 1) {
      images = await this.captureFrameShots(wc, frames, maxSide).catch(() => []);
      if (!images.length) notes.push('Frame screenshots unavailable (capture failed or every frame is offscreen).');
    }

    return { viewport, frames: out, images, notes };
  }

  /**
   * One viewport capture, cropped per visible frame. Cheaper and more predictable than a CDP clip
   * per frame: Chromium clips live in page coordinates, while the frame rects here are already in
   * viewport coordinates.
   */
  private async captureFrameShots(
    wc: WebContents,
    frames: FrameInfo[],
    maxSide: number
  ): Promise<Array<{ frameId: string; url: string; name: string; base64Image: string; width: number; height: number; mimeType: string }>> {
    const css = await wc.executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })').catch(() => null);
    if (!css?.width || !css?.height) return [];

    const image = await this.capturePageWithRetry(wc, { x: 0, y: 0, width: css.width, height: css.height });
    if (!image || image.isEmpty()) return [];
    const size = image.getSize();
    // NativeImage coordinates and getSize() share a unit; derive the ratio instead of assuming DPR.
    const scale = size.width / css.width;

    const shots: Array<{ frameId: string; url: string; name: string; base64Image: string; width: number; height: number; mimeType: string }> = [];
    for (const frame of frames) {
      if (frame.depth === 0 || !frame.visibleRect) continue;
      const rect = frame.visibleRect;
      const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x * scale)));
      const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y * scale)));
      const width = Math.max(1, Math.min(size.width - x, Math.round(rect.width * scale)));
      const height = Math.max(1, Math.min(size.height - y, Math.round(rect.height * scale)));
      if (width < 8 || height < 8) continue;

      try {
        let cropped = image.crop({ x, y, width, height });
        const croppedSize = cropped.getSize();
        const shrink = Math.min(1, maxSide / Math.max(croppedSize.width, croppedSize.height));
        if (shrink < 1) {
          cropped = cropped.resize({
            width: Math.max(1, Math.round(croppedSize.width * shrink)),
            height: Math.max(1, Math.round(croppedSize.height * shrink)),
            quality: 'good',
          });
        }
        const final = cropped.getSize();
        shots.push({
          frameId: frame.frameId,
          url: frame.url,
          name: frame.name,
          base64Image: cropped.toJPEG(82).toString('base64'),
          width: final.width,
          height: final.height,
          mimeType: 'image/jpeg',
        });
      } catch (err: any) {
        this.addLog('warn', `Frame crop failed for ${frame.url || frame.frameId}: ${err?.message || err}`);
      }
    }
    return shots;
  }

  public async goBack(): Promise<string> {
    const wc = this.getActiveWebContents();
    await this.syncForceOpenFor(wc);
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
      this.bumpRevision();
      this.broadcastState();
      return 'Navigated back in history';
    }
    return 'Cannot navigate back; at start of history';
  }

  public async goForward(): Promise<string> {
    const wc = this.getActiveWebContents();
    await this.syncForceOpenFor(wc);
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
      this.bumpRevision();
      this.broadcastState();
      return 'Navigated forward in history';
    }
    return 'Cannot navigate forward; at end of history';
  }

  public async reload(): Promise<string> {
    const wc = this.getActiveWebContents();
    await this.syncForceOpenFor(wc);
    wc.reload();
    this.bumpRevision();
    this.broadcastState();
    return 'Reloaded active web page';
  }

  public getPageInfo(): { url: string; title: string; isLoading: boolean; activeTabId?: string } {
    // Read the live document URL/title. Reddit (and most SPAs) navigate with pushState, which fires
    // no did-navigate event — the cached tab URL then stays stale and an `act` delta reports
    // urlChanged:false for a click that actually worked.
    let url = this.state.currentUrl;
    let title = this.state.pageTitle;
    try {
      const active = this.tabManager?.getActiveTab();
      const live = active?.view?.webContents;
      if (live && !live.isDestroyed()) {
        const liveUrl = live.getURL();
        const liveTitle = live.getTitle();
        if (liveUrl) url = liveUrl;
        if (liveTitle) title = liveTitle;
        // Keep the tab bar's cached values in step with what the page actually is.
        if (active.url !== url) active.url = url;
        if (active.title !== title) active.title = title;
      }
    } catch {
      // No active tab yet — fall back to the cached state.
    }
    return {
      url,
      title,
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
   * Composite read (issue #1): site-provided Markdown/Text when advertised, else a detached
   * render distilled to Markdown — one call, always text, paged for long documents.
   */
  public async readUrl(
    opts: { url?: string; maxChars?: number; cursor?: number | string; as?: LlmSurfaceKind } = {},
  ): Promise<ReadUrlResult> {
    this.addLog(
      'action',
      `MCP Directive: read_url(${opts.url || 'active tab'}${opts.maxChars ? `, max_chars=${opts.maxChars}` : ''}${opts.cursor ? `, cursor=${opts.cursor}` : ''})`,
    );
    return await this.llmSurface.readUrl(opts);
  }

  /**
   * Renders a URL in the shared detached view and distils it to Markdown — the composite
   * `read_url` fallback. Deliberately not `crawlRenderPage`: `read_url` is a single-page
   * *read* (no crawl budgets, no link harvesting), so it does not consume crawl policy.
   */
  public async readUrlRender(
    url: string,
  ): Promise<{ markdown: string; title: string; status: number; contentType: string | null }> {
    const r = await this.loadDetached<{ title: string }>(
      url,
      '(() => ({ title: document.title || "" }))()',
      {
        timeoutMs: 25000,
        after: async (wc) => (await RenderedSnapshotEngine.capture(wc, { format: 'markdown', waitUntilIdleMs: 400 })).content,
      },
    );
    return { markdown: r.after || '', title: r.result?.title || url, status: r.status, contentType: r.contentType };
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
            await this.activateResearchView(wc);
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
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
          partition: 'persist:kuang-research',
        },
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
    const effective = { ...opts };
    if (effective.max === undefined) effective.max = this.researchSettings.searchMaxResults;
    if (this.researchSettings.enabled) {
      if (!effective.engine && (!effective.engines || effective.engines.length === 0)) {
        effective.engines = this.researchSettings.urlTemplate
          ? ['custom', ...this.researchSettings.engineChain]
          : [...this.researchSettings.engineChain];
      }
      if (this.researchSettings.urlTemplate && !effective.urlTemplate) {
        effective.urlTemplate = this.researchSettings.urlTemplate;
      }

      const chain = effective.engines || (effective.engine ? [effective.engine] : []);
      if (chain.length > 0) {
        const allowed = chain.filter((engine) => !this.isResearchCooling(this.engineHost(engine)));
        if (allowed.length === 0) {
          throw this.researchError(
            'RESEARCH_COOLDOWN',
            'All selected search engines are cooling down after WAF/challenge responses.',
          );
        }
        effective.engines = allowed;
        effective.engine = undefined;
      }
    }

    this.addLog(
      'action',
      `MCP Directive: search_web("${query}", engine=${effective.engine || (effective.engines ? effective.engines.join('>') : 'auto')}${this.researchSettings.enabled ? ', stealth' : ''})`,
    );
    const outcome = await this.searchHub.search(query, effective);
    if (this.researchSettings.enabled && outcome.blocked) {
      for (const attempt of outcome.attempts) {
        if (attempt.blocked) this.markResearchCooldown(this.engineHost(attempt.engine), 'bot-check/consent');
      }
    }
    return outcome;
  }

  /** Renders a page in a detached view and returns its Markdown + outgoing links (for deep_crawl). */
  public async crawlRenderPage(
    url: string,
    opts: { selector?: string; waitUntilIdleMs?: number } = {},
  ): Promise<{ title: string; markdown: string; links: string[]; status: number }> {
    this.assertResearchCooldown(url);
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

    if (this.researchSettings.enabled && looksLikeChallenge(r.status, r.after || '')) {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        /* ignore */
      }
      this.markResearchCooldown(host, 'WAF/challenge page');
      throw this.researchError('WAF_CHALLENGE', `${host || url} returned a WAF/challenge page.`);
    }

    return { title: r.result?.title || url, links: r.result?.links || [], markdown: r.after || '', status: r.status };
  }

  /** Depth/page-budgeted BFS crawl that indexes each page into Cortex (Feature 1). */
  public async deepCrawl(opts: CrawlOptions): Promise<CrawlOutcome> {
    const effective: CrawlOptions = {
      ...opts,
      maxPages: opts.maxPages ?? this.researchSettings.defaultMaxPages,
      preferLlm: opts.preferLlm ?? this.researchSettings.preferLlm,
      concurrency: opts.concurrency ?? this.researchSettings.crawlConcurrency,
    };
    if (this.researchSettings.enabled) {
      effective.delayMs = Math.max(Number(opts.delayMs ?? 0), this.researchSettings.delayMs);
    }
    this.addLog(
      'action',
      `MCP Directive: deep_crawl(${effective.startUrl}, depth=${effective.maxDepth ?? 2}, pages=${effective.maxPages ?? 5}, concurrency=${effective.concurrency ?? 1}${this.researchSettings.enabled ? ', stealth' : ''})`,
    );
    return await this.crawler.crawl(effective);
  }

  /** search → gather top sources → distill → index; returns cited extractive evidence (Feature 3). */
  public async researchTopic(opts: ResearchOptions): Promise<ResearchOutcome> {
    const effective: ResearchOptions = {
      ...opts,
      maxSources: opts.maxSources ?? this.researchSettings.defaultMaxSources,
      preferLlm: opts.preferLlm ?? this.researchSettings.preferLlm,
    };
    if (this.researchSettings.enabled) {
      effective.delayMs = Math.max(Number(opts.delayMs ?? 0), this.researchSettings.delayMs);
    }
    this.addLog(
      'action',
      `MCP Directive: research_topic("${effective.query}", maxSources=${effective.maxSources ?? 5}${this.researchSettings.enabled ? ', stealth' : ''})`,
    );
    return await this.researcher.research(effective);
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
    const target = markId >= 100
      ? await resolveFrameMark(wc, markId)
      : await this.marksOverlay.getMarkTarget(wc, markId);
    if (!target) {
      throw new Error(`Mark #${markId} not found. Call find(include_frames:true) or take_annotated_screenshot() to refresh marks.`);
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

  public async typeMark(markId: number, text: string, opts: { secret?: boolean; clearFirst?: boolean } = {}): Promise<string> {
    const wc = this.getActiveWebContents();
    const shown = opts.secret ? `[REDACTED ${String(text).length} chars]` : `"${text}"`;
    this.addLog('action', `MCP Directive: type_mark(#${markId}, ${shown}${opts.clearFirst ? ', clear_first' : ''})`);
    const target = markId >= 100
      ? await resolveFrameMark(wc, markId)
      : await this.marksOverlay.getMarkTarget(wc, markId);
    if (!target) {
      throw new Error(`Mark #${markId} not found. Call find(include_frames:true) or take_annotated_screenshot() to refresh marks.`);
    }

    this.state.agentStatus = 'SIMULATING_INPUT';
    this.broadcastState();

    await this.simulator.clickAt(wc, target.currentCenter);
    await new Promise((r) => setTimeout(r, 100));

    // A stray or occluded click silently sends keystrokes nowhere (sticky headers,
    // lazy re-renders, a hidden window). Verify the target actually took focus and,
    // if not, re-resolve its live centre and click once more before typing.
    const focusedOk = markId >= 100
      ? true
      : await wc
          .executeJavaScript(
            `(() => {${DEEP_DOM_HELPERS}
              const el = kqDeep('[data-mark-id="${markId}"]');
              if (!el) return true;
              const a = kqActive();
              if (!a) return false;
              return a === el || kqContainsComposed(el, a) || kqContainsComposed(a, el);
            })()`
          )
          .catch(() => true);
    if (focusedOk === false) {
      this.addLog('warn', `type_mark(#${markId}): target did not take focus after click; retrying once.`);
      const retry = markId >= 100 ? await resolveFrameMark(wc, markId) : await this.marksOverlay.getMarkTarget(wc, markId);
      if (retry) {
        await this.simulator.clickAt(wc, retry.currentCenter);
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (opts.clearFirst) {
      // Replace rather than append: the target may already hold a value (e.g. a pre-filled
      // origin/airport field), and appending silently corrupts it.
      await this.simulator.clearFocusedField(wc);
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
      'read_url',
      'search_web',
      'deep_crawl',
      'research_topic',
    ];
  }
}
