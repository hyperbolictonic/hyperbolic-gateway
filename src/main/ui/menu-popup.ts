import path from 'node:path';
import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import type { PopupAnchor, PopupMenuItem, PopupMenuSelection } from '../../shared/menu.js';

const POPUP_WIDTH = 320;
const POPUP_ITEM_HEIGHT = 34;
const POPUP_PADDING = 14;

/**
 * Themed, frameless dropdown hosted in its own small transparent window.
 *
 * Shell DOM cannot paint above the native browser views (the reason the old
 * header menu used a native `Menu.popup`), so in-product menus get their own
 * surface instead. One shared instance renders every menu: `open()` anchors it
 * below a trigger rect, pushes the items to the popup surface
 * (src/renderer/menu-popup.ts) and resolves with `{ id, action? }` — or null
 * when dismissed via Escape, blur or an outside click. New menus are just more
 * `PopupMenuItem` arrays, so every themed menu in the app shares this host.
 */
export class MenuPopup {
  private static instance: MenuPopup | null = null;
  private win: BrowserWindow | null = null;
  private items: PopupMenuItem[] = [];
  private resolver: ((selection: PopupMenuSelection | null) => void) | null = null;
  private readonly preloadPath: string;

  private constructor(preloadPath: string) {
    this.preloadPath = preloadPath;
    ipcMain.handle('menu-popup:items', (event: IpcMainInvokeEvent) => {
      // First-fetch on popup surface boot (covers the initial load race).
      if (!this.win || this.win.isDestroyed() || event.sender.id !== this.win.webContents.id) return [];
      return this.items;
    });
    ipcMain.on('menu-popup:select', (event, id: unknown, action: unknown) => {
      if (this.win && !this.win.isDestroyed() && event.sender.id === this.win.webContents.id) {
        this.finish(
          typeof id === 'string'
            ? { id, action: typeof action === 'string' ? action : undefined }
            : null,
        );
      }
    });
    ipcMain.on('menu-popup:close', (event) => {
      if (this.win && !this.win.isDestroyed() && event.sender.id === this.win.webContents.id) {
        this.finish(null);
      }
    });
  }

  static shared(preloadPath: string): MenuPopup {
    MenuPopup.instance ??= new MenuPopup(preloadPath);
    return MenuPopup.instance;
  }

  /** True while a menu is visible (callers can skip toggling). */
  get isOpen(): boolean {
    return Boolean(this.resolver);
  }

  /** Close a visible popup (resolves its open promise with null). */
  dismiss(): void {
    this.finish(null);
  }

  /**
   * Show `items` anchored to `anchor` (coordinates in the parent window's
   * content area). `align` picks where the popup lands relative to the anchor:
   * snapped below the trigger and right-aligned (default), or placed to the
   * left of the trigger with tops aligned. Resolves with the clicked item id
   * and optional secondary action, or null if dismissed.
   */
  open(
    parent: BrowserWindow,
    anchor: PopupAnchor,
    items: PopupMenuItem[],
    opts: { align?: 'below-right' | 'left-of'; itemHeight?: number; width?: number } = {},
  ): Promise<PopupMenuSelection | null> {
    this.finish(null);
    if (parent.isDestroyed() || !items.length) return Promise.resolve(null);
    this.items = items;

    const width = Math.max(POPUP_WIDTH, opts.width ?? POPUP_WIDTH);
    const itemHeight = opts.itemHeight ?? POPUP_ITEM_HEIGHT;
    const height = POPUP_PADDING + items.length * itemHeight;
    const content = parent.getContentBounds();
    const area = screen.getDisplayMatching(content).workArea;
    let x: number;
    let y: number;
    if (opts.align === 'left-of') {
      x = Math.round(content.x + anchor.x - width - 8);
      y = Math.round(content.y + anchor.y);
    } else {
      x = Math.round(content.x + anchor.x + anchor.width - width);
      y = Math.round(content.y + anchor.y + anchor.height + 4);
    }
    x = Math.max(area.x + 6, Math.min(x, area.x + area.width - width - 6));
    if (y + height > area.y + area.height) y = Math.max(area.y + 6, content.y + anchor.y - height - 4);

    const win = this.ensureWindow();
    win.setBounds({ x, y, width, height });
    return new Promise((resolve) => {
      this.resolver = resolve;
      const deliver = (): void => {
        if (!this.resolver || !this.win || this.win.isDestroyed()) return;
        this.win.webContents.send('menu-popup:show', this.items);
        this.win.show();
        this.win.focus();
      };
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', deliver);
      } else {
        // Defer to the next turn so the resolver is installed before `show`.
        setImmediate(deliver);
      }
    });
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setMenu(null);
    win.on('blur', () => this.finish(null));
    win.on('closed', () => {
      this.win = null;
      this.finish(null);
    });

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      const url = new URL(devUrl);
      url.searchParams.set('menupopup', '1');
      void win.webContents.loadURL(url.toString());
    } else {
      void win.webContents.loadFile(path.join(__dirname, '../../dist/index.html'), {
        query: { menupopup: '1' },
      });
    }
    this.win = win;
    return win;
  }

  private finish(selection: PopupMenuSelection | null): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
    const resolve = this.resolver;
    this.resolver = null;
    this.items = [];
    resolve?.(selection);
  }
}
