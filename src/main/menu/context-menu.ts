/**
 * Native right-click menu for browsing tabs.
 *
 * Why: a WebContentsView inside Electron has **no** default context menu. Without this,
 * copy / paste / select-all / inspect are unreachable for the human driving the browser —
 * and so is "copy link", "open in new tab" and "reload". The menu is built per right-click
 * from the event's `params`, so it only offers what is true for that pixel: paste is enabled
 * only in an editable field, link actions only over a link, image actions only over an image.
 *
 * The actions are issued against the **tab's own webContents** (`wc.copy()`, `wc.paste()`, …)
 * rather than as Electron menu roles, because roles target whichever window is focused — and
 * in this app the focused window is the Cyberdeck shell, not the browsing tab.
 */
import { BrowserWindow, Menu, clipboard, shell, type MenuItemConstructorOptions, type WebContents } from 'electron';

export interface ContextMenuOptions {
  window: BrowserWindow;
  /** Open a URL in a new browsing tab (the caller owns tab creation/activation). */
  onOpenLinkInNewTab?: (url: string) => void;
  onLog?: (level: 'info' | 'warn' | 'action', message: string) => void;
}

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + '…' : value);

export function attachContextMenu(wc: WebContents, options: ContextMenuOptions): void {
  wc.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    const can = params.editFlags || ({} as Electron.EditFlags);

    // Spellcheck suggestions, when Chromium has them.
    if (params.misspelledWord) {
      for (const suggestion of (params.dictionarySuggestions || []).slice(0, 4)) {
        template.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) });
      }
      template.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      template.push({ type: 'separator' });
    }

    const copySelection = () => {
      // Prefer the text Chromium reports for this click: `wc.copy()` acts on whatever has focus in
      // the webContents, and opening a native menu can move that focus to the shell.
      if (params.selectionText) void clipboard.writeText(params.selectionText);
      else wc.copy();
    };
    const withFocus = (action: () => void) => {
      wc.focus();
      setTimeout(action, 0);
    };

    if (params.isEditable) {
      template.push(
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: can.canUndo, click: () => withFocus(() => wc.undo()) },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', enabled: can.canRedo, click: () => withFocus(() => wc.redo()) },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: can.canCut, click: () => withFocus(() => wc.cut()) },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: can.canCopy, click: copySelection },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: can.canPaste, click: () => withFocus(() => wc.paste()) },
        { label: 'Paste as plain text', enabled: can.canPaste, click: () => withFocus(() => wc.pasteAndMatchStyle()) },
        { label: 'Select all', accelerator: 'CmdOrCtrl+A', click: () => withFocus(() => wc.selectAll()) },
        { type: 'separator' }
      );
    } else if (params.selectionText.trim()) {
      const selected = params.selectionText.trim();
      template.push(
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: copySelection },
        {
          label: `Search the web for “${truncate(selected, 24)}”`,
          click: () => void shell.openExternal(`https://duckduckgo.com/?q=${encodeURIComponent(selected)}`),
        },
        { type: 'separator' }
      );
    }

    if (params.linkURL) {
      template.push(
        {
          label: 'Open link in new tab',
          enabled: Boolean(options.onOpenLinkInNewTab),
          click: () => options.onOpenLinkInNewTab?.(params.linkURL),
        },
        { label: 'Open link in system browser', click: () => void shell.openExternal(params.linkURL) },
        { label: 'Copy link address', click: () => void clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      );
    }

    if (params.mediaType === 'image' && params.srcURL) {
      template.push(
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => void clipboard.writeText(params.srcURL) },
        { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
        { type: 'separator' }
      );
    }

    const history = (wc as any).navigationHistory;
    const canGoBack = history ? history.canGoBack() : (wc as any).canGoBack?.() === true;
    const canGoForward = history ? history.canGoForward() : (wc as any).canGoForward?.() === true;

    template.push(
      { label: 'Back', enabled: canGoBack, click: () => (history ? history.goBack() : (wc as any).goBack?.()) },
      { label: 'Forward', enabled: canGoForward, click: () => (history ? history.goForward() : (wc as any).goForward?.()) },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Copy page URL', click: () => void clipboard.writeText(wc.getURL()) },
      { label: 'Copy page address as Markdown link', click: () => void clipboard.writeText(`[${wc.getTitle()}](${wc.getURL()})`) },
      { type: 'separator' },
      {
        label: 'Inspect element',
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => {
          wc.inspectElement(params.x, params.y);
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
        },
      },
      { label: 'Open DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => wc.toggleDevTools() }
    );

    const menu = Menu.buildFromTemplate(template);
    options.onLog?.('info', `Context menu at (${params.x}, ${params.y}) — ${template.filter((i) => i.type !== 'separator').length} actions`);
    menu.popup({ window: options.window });
  });
}
