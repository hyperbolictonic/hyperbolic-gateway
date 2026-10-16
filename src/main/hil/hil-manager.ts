import { BrowserWindow, Notification, nativeImage, app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export interface HilRequest {
  id: string;
  reason: string;
  url?: string;
  requestedAt: number;
  timeoutSeconds: number;
  status: 'pending' | 'resolved' | 'timeout' | 'cancelled';
  resolvedAt?: number;
  notes?: string;
}

export interface HilResolution {
  status: 'resolved' | 'timeout' | 'cancelled';
  elapsedSeconds: number;
  notes?: string;
}

export interface NotificationOptions {
  title: string;
  message: string;
  urgency?: 'normal' | 'critical' | 'low';
  sound?: boolean;
}

export class HilManager {
  private mainWindow: BrowserWindow | null = null;
  private activeRequest: HilRequest | null = null;
  private activeResolver: ((res: HilResolution) => void) | null = null;
  private activeTimer: NodeJS.Timeout | null = null;
  private requestHistory: HilRequest[] = [];
  private onHilStateChanged?: (pending: boolean, req: HilRequest | null) => void;
  private getActiveWebContents?: () => Electron.WebContents | null;

  constructor(options?: {
    mainWindow?: BrowserWindow;
    getActiveWebContents?: () => Electron.WebContents | null;
    onHilStateChanged?: (pending: boolean, req: HilRequest | null) => void;
  }) {
    if (options?.mainWindow) this.mainWindow = options.mainWindow;
    this.getActiveWebContents = options?.getActiveWebContents;
    this.onHilStateChanged = options?.onHilStateChanged;

    this.registerIpcHandlers();
  }

  public setWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  public setActiveWebContentsGetter(getter: () => Electron.WebContents | null): void {
    this.getActiveWebContents = getter;
  }

  public setOnHilStateChanged(cb: (pending: boolean, req: HilRequest | null) => void): void {
    this.onHilStateChanged = cb;
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('hil:get-active', () => {
      return this.activeRequest;
    });

    ipcMain.handle('hil:resolve', (_event, data?: { id?: string; notes?: string }) => {
      return this.resolveIntervention(data?.id, data?.notes);
    });

    ipcMain.handle('hil:cancel', (_event, data?: { id?: string }) => {
      return this.cancelIntervention(data?.id);
    });
  }

  private resolveIcon(): Electron.NativeImage {
    const candidates = [
      path.join(app.getAppPath(), 'public/assets/mark-eleven.png'),
      path.join(app.getAppPath(), 'dist/assets/mark-eleven.png'),
      path.join(app.getAppPath(), 'public/assets/kuang-grade.png'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const img = nativeImage.createFromPath(p);
          if (!img.isEmpty()) return img.resize({ width: 64, height: 64 });
        } catch {}
      }
    }
    return nativeImage.createEmpty();
  }

  /**
   * Dispatches a native desktop OS notification.
   */
  public sendNotification(options: NotificationOptions): boolean {
    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: options.title || 'Kuang Grade Mark Eleven',
          body: options.message,
          icon: this.resolveIcon(),
          urgency: options.urgency || 'normal',
          silent: options.sound === false,
        });

        notif.on('click', () => {
          this.bringWindowToFront();
        });

        notif.show();
        return true;
      }
    } catch {
      // Fallback
    }
    return false;
  }

  /**
   * Summons and focuses the main cyberdeck window, flashing the taskbar.
   */
  public bringWindowToFront(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
    this.mainWindow.flashFrame(true);
  }

  /**
   * Initiates a Human-In-The-Loop intervention request.
   * Halts agent execution until the user completes the action or timeout occurs.
   */
  public async requestIntervention(options: {
    reason: string;
    url?: string;
    timeoutSeconds?: number;
    bringToFront?: boolean;
  }): Promise<HilResolution> {
    // If a request is already active, cancel it before starting new one
    if (this.activeRequest) {
      this.cancelIntervention();
    }

    const timeoutSec = Math.max(5, Math.min(1800, options.timeoutSeconds ?? 180));
    const reqId = `hil_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const request: HilRequest = {
      id: reqId,
      reason: options.reason,
      url: options.url,
      requestedAt: Date.now(),
      timeoutSeconds: timeoutSec,
      status: 'pending',
    };

    this.activeRequest = request;
    this.onHilStateChanged?.(true, request);

    // 1. Desktop Notification
    this.sendNotification({
      title: '⚠️ Action Required: Kuang Grade Cyberdeck',
      message: `${options.reason} (Window brought to front for input)`,
      urgency: 'critical',
      sound: true,
    });

    // 2. Bring window to front unless explicitly suppressed
    if (options.bringToFront !== false) {
      this.bringWindowToFront();
    }

    // 3. Inject In-Page Cyberdeck Alert Banner into active WebContents
    const targetWc = this.getActiveWebContents?.();
    if (targetWc && !targetWc.isDestroyed()) {
      this.injectInPageBanner(targetWc, request);
    }

    // 4. Notify Main Renderer HUD
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('hil:requested', request);
    }

    // 5. Return promise awaiting user resolution or timeout
    return new Promise<HilResolution>((resolve) => {
      this.activeResolver = resolve;

      this.activeTimer = setTimeout(() => {
        if (this.activeRequest?.id === reqId && this.activeRequest.status === 'pending') {
          this.activeRequest.status = 'timeout';
          this.activeRequest.resolvedAt = Date.now();
          this.cleanup(targetWc);

          const elapsed = Math.round((Date.now() - request.requestedAt) / 1000);
          this.requestHistory.push(this.activeRequest);
          this.activeRequest = null;
          this.onHilStateChanged?.(false, null);

          resolve({
            status: 'timeout',
            elapsedSeconds: elapsed,
            notes: `Human intervention timed out after ${elapsed} seconds.`,
          });
        }
      }, timeoutSec * 1000);
    });
  }

  /**
   * Resolves the active intervention request (e.g. user clicked 'Resume Agent').
   */
  public resolveIntervention(id?: string, notes?: string): boolean {
    if (!this.activeRequest || this.activeRequest.status !== 'pending') {
      return false;
    }

    if (id && this.activeRequest.id !== id) {
      return false;
    }

    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }

    this.activeRequest.status = 'resolved';
    this.activeRequest.resolvedAt = Date.now();
    this.activeRequest.notes = notes || 'User confirmed action completed.';

    const elapsed = Math.round((Date.now() - this.activeRequest.requestedAt) / 1000);
    const resolvedReq = this.activeRequest;

    const targetWc = this.getActiveWebContents?.();
    this.cleanup(targetWc);

    this.requestHistory.push(resolvedReq);
    this.activeRequest = null;
    this.onHilStateChanged?.(false, null);

    if (this.activeResolver) {
      const resolver = this.activeResolver;
      this.activeResolver = null;
      resolver({
        status: 'resolved',
        elapsedSeconds: elapsed,
        notes: resolvedReq.notes,
      });
    }

    return true;
  }

  /**
   * Cancels the active intervention request.
   */
  public cancelIntervention(id?: string): boolean {
    if (!this.activeRequest || this.activeRequest.status !== 'pending') {
      return false;
    }

    if (id && this.activeRequest.id !== id) {
      return false;
    }

    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }

    this.activeRequest.status = 'cancelled';
    this.activeRequest.resolvedAt = Date.now();
    const elapsed = Math.round((Date.now() - this.activeRequest.requestedAt) / 1000);
    const cancelledReq = this.activeRequest;

    const targetWc = this.getActiveWebContents?.();
    this.cleanup(targetWc);

    this.requestHistory.push(cancelledReq);
    this.activeRequest = null;
    this.onHilStateChanged?.(false, null);

    if (this.activeResolver) {
      const resolver = this.activeResolver;
      this.activeResolver = null;
      resolver({
        status: 'cancelled',
        elapsedSeconds: elapsed,
        notes: 'Human intervention was cancelled.',
      });
    }

    return true;
  }

  public getActiveRequest(): HilRequest | null {
    return this.activeRequest;
  }

  public getHistory(): HilRequest[] {
    return [...this.requestHistory];
  }

  private cleanup(wc?: Electron.WebContents | null): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.flashFrame(false);
      this.mainWindow.webContents.send('hil:cleared');
    }

    if (wc && !wc.isDestroyed()) {
      this.removeInPageBanner(wc);
    }
  }

  private injectInPageBanner(wc: Electron.WebContents, request: HilRequest): void {
    const bannerScript = `
      (function() {
        try {
          const old = document.getElementById('__kuang_hil_banner');
          if (old) old.remove();

          const container = document.createElement('div');
          container.id = '__kuang_hil_banner';
          container.setAttribute('style', [
            'position: fixed',
            'top: 14px',
            'left: 50%',
            'transform: translateX(-50%)',
            'z-index: 2147483647',
            'background: rgba(18, 18, 24, 0.96)',
            'color: #f43f5e',
            'border: 2px solid #f59e0b',
            'box-shadow: 0 8px 32px rgba(245, 158, 11, 0.4), 0 0 12px rgba(245, 158, 11, 0.6)',
            'border-radius: 8px',
            'padding: 12px 20px',
            'display: flex',
            'align-items: center',
            'gap: 16px',
            'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size: 13px',
            'max-width: 90vw',
            'animation: __kuang_pulse 2s infinite ease-in-out'
          ].join(';'));

          const style = document.createElement('style');
          style.id = '__kuang_hil_style';
          style.textContent = \`
            @keyframes __kuang_pulse {
              0%, 100% { border-color: #f59e0b; box-shadow: 0 0 16px rgba(245, 158, 11, 0.5); }
              50% { border-color: #ef4444; box-shadow: 0 0 24px rgba(239, 68, 68, 0.7); }
            }
          \`;
          document.head.appendChild(style);

          container.innerHTML = \`
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">⚠️</span>
              <div>
                <div style="font-weight:bold; color:#fbbf24; text-transform:uppercase; letter-spacing:1px; font-size:11px;">Human Intervention Required</div>
                <div style="color:#ffffff; margin-top:2px;">\${request.reason.replace(/</g, '&lt;')}</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-left:12px;">
              <button id="__kuang_hil_done_btn" style="background:#10b981; color:#ffffff; border:none; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px; font-family:monospace; box-shadow:0 0 8px rgba(16,185,129,0.5);">
                RESUME AGENT (DONE)
              </button>
            </div>
          \`;

          document.body.appendChild(container);

          const doneBtn = document.getElementById('__kuang_hil_done_btn');
          if (doneBtn) {
            doneBtn.onclick = function() {
              doneBtn.textContent = 'RESUMING...';
              doneBtn.style.background = '#64748b';
              fetch('http://127.0.0.1:4111/hil/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: '\${request.id}', notes: 'User confirmed via in-page banner' })
              }).catch(() => {});
            };
          }
        } catch (e) {
          console.warn('[Kuang Grade] Banner injection notice:', e);
        }
      })();
    `;

    wc.executeJavaScript(bannerScript).catch(() => {});
  }

  private removeInPageBanner(wc: Electron.WebContents): void {
    const removeScript = `
      (function() {
        try {
          const b = document.getElementById('__kuang_hil_banner');
          if (b) b.remove();
          const s = document.getElementById('__kuang_hil_style');
          if (s) s.remove();
        } catch {}
      })();
    `;
    wc.executeJavaScript(removeScript).catch(() => {});
  }
}
