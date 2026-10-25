import { BrowserWindow, WebContentsView } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostBrowserProfile } from '../telemetry/host-fingerprint.js';
import type { TabSummary } from '../../shared/types.js';
import { attachContextMenu } from '../menu/context-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TabInstance {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  view: WebContentsView;
  createdAt: number;
}

export interface TabManagerOptions {
  mainWindow: BrowserWindow;
  hostProfile: HostBrowserProfile;
  getViewportBounds: () => { x: number; y: number; width: number; height: number };
  onTabUpdated?: (tab: TabInstance) => void;
  onTabsChanged?: (tabs: TabSummary[]) => void;
  onTabCreated?: (tab: TabInstance) => void;
  /** Called after a tab's native view is attached, so an overlay can stay on top. */
  onViewAdded?: () => void;
  onLog?: (level: 'info' | 'warn' | 'action', message: string) => void;
  onConsoleLog?: (log: { level: string; message: string; line: number; sourceId: string; timestamp: number }) => void;
}

export class TabManager {
  private tabs: Map<string, TabInstance> = new Map();
  private activeTabId: string = '';
  private counter: number = 0;
  /** Set while a full-window settings/dialog surface owns the UI. */
  private viewportHidden: boolean = false;

  constructor(private options: TabManagerOptions) {}

  public getWelcomePagePath(): string {
    const candidates = [
      path.join(__dirname, '../../public/welcome.html'),
      path.join(__dirname, '../../dist/welcome.html'),
      path.join(process.cwd(), 'public/welcome.html'),
      path.join(process.cwd(), 'dist/welcome.html'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  public getActiveTab(): TabInstance {
    const active = this.tabs.get(this.activeTabId);
    if (!active) {
      throw new Error('No active tab available in Cyberdeck');
    }
    return active;
  }

  public getActiveTabId(): string {
    return this.activeTabId;
  }

  /** All open tabs, for tab-wide policy updates (force-open arming). */
  public allTabs(): TabInstance[] {
    return [...this.tabs.values()];
  }

  public createTab(initialUrl: string = 'about:blank', existingView?: WebContentsView): TabInstance {
    this.counter++;
    const id = `tab_${this.counter}`;

    const view = existingView || new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // An automated browser is routinely occluded (the human's editor/terminal owns the
        // foreground), and Chromium then reports the page as hidden and throttles its timers
        // to >=1s. That silently breaks lazy-loading harvests and 'infinite' feeds. Keep
        // browsing tabs running at full speed while we drive them.
        backgroundThrottling: false,
      },
    });

    // Soft matte light zinc gray (#f4f4f5): prevents harsh white glare while making black typography 100% legible
    view.setBackgroundColor('#f4f4f5');
    this.options.mainWindow.contentView.addChildView(view);
    this.options.onViewAdded?.();

    const wc = view.webContents;

    // Right-click: copy/paste/select-all, link and image actions, reload, inspect element.
    // A WebContentsView has no default context menu, so without this the browser is unusable
    // by hand even though every action exists in the API.
    if (!(wc as any).__kuangContextMenu) {
      (wc as any).__kuangContextMenu = true;
      attachContextMenu(wc, {
        window: this.options.mainWindow,
        onOpenLinkInNewTab: (url) => {
          try {
            const tab = this.createTab(url);
            this.switchTab(tab.id);
          } catch (err) {
            // Worst case the link still opens via "open in system browser".
            this.options.onLog?.('warn', `Could not open link in a new tab: ${(err as Error)?.message || err}`);
          }
        },
        onLog: (level, message) => this.options.onLog?.(level, message),
      });
    }

    // Also covers reused views (e.g. a prerendered view promoted to a tab), where the
    // webPreferences above are not re-applied.
    try { wc.setBackgroundThrottling(false); } catch {}

    // Apply Host Browser Stealth Profile
    wc.setUserAgent(this.options.hostProfile.userAgent);
    wc.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = this.options.hostProfile.userAgent;
      details.requestHeaders['sec-ch-ua'] = this.options.hostProfile.secChUa;
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = this.options.hostProfile.secChUaPlatform;
      callback({ requestHeaders: details.requestHeaders });
    });

    // Auto-spawn new tabs for target="_blank" and window.open
    wc.setWindowOpenHandler((details) => {
      this.options.onLog?.('action', `Intercepted popup/external link: opening new Cyberdeck tab -> ${details.url}`);
      this.createTab(details.url);
      return { action: 'deny' };
    });

    const tab: TabInstance = {
      id,
      title: 'New Tab',
      url: initialUrl,
      isLoading: false,
      view,
      createdAt: Date.now(),
    };

    this.options.onTabCreated?.(tab);

    // Navigation and status listeners
    wc.on('did-start-loading', () => {
      tab.isLoading = true;
      this.options.onTabUpdated?.(tab);
      this.notifyTabsChanged();
    });

    wc.on('did-finish-load', () => {
      tab.isLoading = false;
      const rawUrl = wc.getURL();
      if (rawUrl.includes('welcome.html')) {
        tab.url = 'mark-eleven://manual';
        tab.title = 'Kuang Grade // Manual';
      } else {
        tab.url = rawUrl;
        tab.title = wc.getTitle() || tab.url;
      }
      this.options.onLog?.('info', `[${tab.id}] Loaded: ${tab.title} (${tab.url})`);
      this.options.onTabUpdated?.(tab);
      this.notifyTabsChanged();
    });

    wc.on('page-title-updated', (_, title) => {
      if (!wc.getURL().includes('welcome.html')) {
        tab.title = title;
        this.options.onTabUpdated?.(tab);
        this.notifyTabsChanged();
      }
    });

    wc.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
      tab.isLoading = false;
      this.options.onLog?.('warn', `[${tab.id}] Barrier [${errorCode}]: ${errorDescription} (${validatedURL})`);
      this.options.onTabUpdated?.(tab);
      this.notifyTabsChanged();
    });

    wc.on('console-message', (event: any, ...legacyArgs: any[]) => {
      const level = typeof event?.level === 'number' ? event.level : (legacyArgs[0] ?? 0);
      const message = event?.message ?? legacyArgs[1] ?? String(event ?? '');
      const line = event?.lineNumber ?? legacyArgs[2] ?? 0;
      const sourceId = event?.sourceId ?? legacyArgs[3] ?? '';
      const levelStr = level === 0 ? 'info' : level === 1 ? 'warn' : 'error';

      this.options.onConsoleLog?.({
        level: levelStr,
        message,
        line,
        sourceId,
        timestamp: Date.now(),
      });
    });

    this.tabs.set(id, tab);

    // If view was already prerendered, it is already loaded
    if (existingView) {
      tab.title = wc.getTitle() || 'Prerendered Page';
      tab.isLoading = false;
      this.options.onTabUpdated?.(tab);
      this.notifyTabsChanged();
    } else if (initialUrl && initialUrl !== 'about:blank' && initialUrl !== 'mark-eleven://manual') {
      const formatted = initialUrl.startsWith('http://') || initialUrl.startsWith('https://')
        ? initialUrl
        : `https://${initialUrl}`;
      wc.loadURL(formatted);
    } else {
      wc.loadFile(this.getWelcomePagePath());
    }

    // Switch focus to new tab
    this.switchTab(id);
    return tab;
  }

  public switchTab(tabId: string): void {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} does not exist`);
    }

    // Hide previous active tab view by tucking its bounds away
    if (this.activeTabId && this.tabs.has(this.activeTabId) && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId)!;
      prev.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    this.activeTabId = tabId;
    const current = this.tabs.get(tabId)!;

    // Expand current active tab to viewport container, unless a settings
    // surface is currently covering the window.
    current.view.setBounds(
      this.viewportHidden ? { x: 0, y: 0, width: 0, height: 0 } : this.options.getViewportBounds(),
    );

    this.options.onLog?.('info', `Switched active browsing node to [${current.id}] "${current.title}"`);
    this.options.onTabUpdated?.(current);
    this.notifyTabsChanged();
  }

  public closeTab(tabId?: string): void {
    const targetId = tabId || this.activeTabId;
    if (!this.tabs.has(targetId)) return;

    const tabToClose = this.tabs.get(targetId)!;

    // If only 1 tab remaining, reset it to Cyberdeck manual rather than closing window
    if (this.tabs.size <= 1) {
      tabToClose.view.webContents.loadFile(this.getWelcomePagePath());
      tabToClose.title = 'Kuang Grade // Manual';
      tabToClose.url = 'mark-eleven://manual';
      this.options.onTabUpdated?.(tabToClose);
      this.notifyTabsChanged();
      return;
    }

    // Remove view from window and close webContents
    this.options.mainWindow.contentView.removeChildView(tabToClose.view);
    tabToClose.view.webContents.close();
    this.tabs.delete(targetId);

    // If closed the active tab, switch to adjacent tab
    if (this.activeTabId === targetId) {
      const remaining = Array.from(this.tabs.keys());
      const nextId = remaining[remaining.length - 1];
      this.switchTab(nextId);
    } else {
      this.notifyTabsChanged();
    }

    this.options.onLog?.('info', `Closed tab [${targetId}]`);
  }

  public updateActiveTabBounds(): void {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return;
    const active = this.tabs.get(this.activeTabId)!;
    active.view.setBounds(
      this.viewportHidden ? { x: 0, y: 0, width: 0, height: 0 } : this.options.getViewportBounds(),
    );
  }

  public setViewportVisibility(visible: boolean): void {
    this.viewportHidden = !visible;
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return;
    const active = this.tabs.get(this.activeTabId)!;
    if (visible) {
      active.view.setBounds(this.options.getViewportBounds());
    } else {
      active.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  public getTabsSummary(): TabSummary[] {
    return Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      title: t.title || 'New Tab',
      url: t.url || 'about:blank',
      isLoading: t.isLoading,
      isActive: t.id === this.activeTabId,
    }));
  }

  private notifyTabsChanged(): void {
    this.options.onTabsChanged?.(this.getTabsSummary());
  }
}
