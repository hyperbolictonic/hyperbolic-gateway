import { BrowserWindow, nativeImage, ipcMain } from 'electron';
import type { AgentStatus, ChassisState, HarvestedConstruct, TelemetryEvent, TabSummary } from '../shared/types.js';
import { HumanizedInputSimulator } from './telemetry/input-simulator.js';
import { ConstructHarvester } from './harvester/markdown.js';
import { detectHostBrowserProfile, type HostBrowserProfile } from './telemetry/host-fingerprint.js';
import { TabManager, type TabInstance } from './tabs/tab-manager.js';
import { cortex, CortexDB } from './cortex/cortex-db.js';
import { ShieldBreaker, type ShieldDismissResult } from './shield/shield-breaker.js';
import { DownloadManager, type DownloadRecord } from './downloads/download-manager.js';
import { SessionVault, type SessionSnapshot } from './session/session-vault.js';
import { NetworkInterceptor, type CapturedNetworkRequest, type NetworkFilter } from './network/network-interceptor.js';
import { MarksOverlay, type MarkItem } from './marks/marks-overlay.js';
import { ScriptVault } from './scripts/script-vault.js';
import type { ScriptItem } from './cortex/cortex-db.js';

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
  private hostProfile: HostBrowserProfile = detectHostBrowserProfile();

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

    setInterval(() => {
      this.state.stats.uptimeSeconds++;
      this.broadcastState();
    }, 1000);
  }

  public setWindow(win: BrowserWindow) {
    this.mainWindow = win;
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

          if (!tab.isLoading && tab.url && !tab.url.startsWith('mark-eleven:') && tab.url !== 'about:blank') {
            this.indexTabQuietly(tab);
          }
        }
      },
      onTabsChanged: (tabs: TabSummary[]) => {
        this.state.tabs = tabs;
        this.broadcastState();
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

    this.addLog('action', `MCP Directive: navigate_to(${formattedUrl})`);
    const navPromise = wc.loadURL(formattedUrl);

    if (autoDismissConsent) {
      setTimeout(() => {
        this.dismissConsent().catch(() => {});
      }, 1800);
    }

    await navPromise;
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

    if (selector) {
      await wc.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) {
            if (typeof el.focus === 'function') el.focus();
            if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
              el.click();
            }
          }
        })()
      `).catch(() => {});
    }

    this.state.agentStatus = 'IDLE';
    this.broadcastState();
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
    return `Scrolled ${direction} by ${amount}px`;
  }

  public async takeScreenshot(): Promise<{ base64Image: string; width: number; height: number }> {
    const wc = this.getActiveWebContents();
    this.addLog('action', 'MCP Directive: take_screenshot()');

    const bounds = this.getViewportBounds();
    const image = await wc.capturePage({
      x: 0,
      y: 0,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
    const size = image.getSize();
    const base64Image = image.toDataURL();

    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Captured live viewport screenshot: ${size.width}x${size.height}px`,
    });

    return {
      base64Image,
      width: size.width,
      height: size.height,
    };
  }

  public async harvestMarkdown(): Promise<HarvestedConstruct> {
    const wc = this.getActiveWebContents();
    this.state.agentStatus = 'HARVESTING';
    this.broadcastState();
    this.addLog('action', 'MCP Directive: get_page_markdown()');

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
      return 'Navigated back in history';
    }
    return 'Cannot navigate back; at start of history';
  }

  public async goForward(): Promise<string> {
    const wc = this.getActiveWebContents();
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
      return 'Navigated forward in history';
    }
    return 'Cannot navigate forward; at end of history';
  }

  public async reload(): Promise<string> {
    const wc = this.getActiveWebContents();
    wc.reload();
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

  public async takeAnnotatedScreenshot(): Promise<{
    screenshot: { base64Image: string; width: number; height: number };
    marks: MarkItem[];
  }> {
    const wc = this.getActiveWebContents();
    this.addLog('action', 'MCP Directive: take_annotated_screenshot()');

    // 1. Inject visual badges into DOM
    const marks = await this.marksOverlay.injectMarks(wc);

    // Wait a brief tick for render paint
    await new Promise((r) => setTimeout(r, 80));

    // 2. Capture annotated screenshot
    const bounds = this.getViewportBounds();
    const image = await wc.capturePage({
      x: 0,
      y: 0,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
    const size = image.getSize();
    const base64Image = image.toDataURL();

    // 3. Immediately clean up marks from DOM
    await this.marksOverlay.removeMarks(wc);

    this.emitTelemetry({
      type: 'harvest',
      timestamp: Date.now(),
      details: `Set-of-Marks: Tagged ${marks.length} interactive targets`,
    });

    return {
      screenshot: {
        base64Image,
        width: size.width,
        height: size.height,
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

    return `Clicked mark #${markId} (${target.mark.tag}: "${target.mark.text}")`;
  }

  public async typeMark(markId: number, text: string): Promise<string> {
    const wc = this.getActiveWebContents();
    this.addLog('action', `MCP Directive: type_mark(#${markId}, "${text}")`);
    const target = await this.marksOverlay.getMarkTarget(wc, markId);
    if (!target) {
      throw new Error(`Mark #${markId} not found. Call take_annotated_screenshot() to refresh interactive marks.`);
    }

    this.state.agentStatus = 'SIMULATING_INPUT';
    this.broadcastState();

    await this.simulator.clickAt(wc, target.currentCenter);
    await new Promise((r) => setTimeout(r, 100));
    await this.simulator.typeText(wc, text);

    this.state.agentStatus = 'IDLE';
    this.broadcastState();

    return `Focused mark #${markId} and typed "${text}"`;
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
}
