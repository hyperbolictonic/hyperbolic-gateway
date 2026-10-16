# 📑 Kuang Grade Mark Eleven — Multi-Tab Manager (`src/main/tabs/`)

This directory contains the tabbed browsing orchestration layer, designed around Electron's modern, hardware-accelerated `WebContentsView` architecture.

---

## 🏛️ Key Capabilities

1. **Native `WebContentsView` Isolation**:
   Replaces deprecated `BrowserView` with native `WebContentsView` instances attached to the `mainWindow.contentView`. Each tab retains an independent navigation stack, separate DOM tree, and isolated JavaScript execution context.
2. **Zero-Flicker Hardware Swapping**:
   Active tab transitions are performed by bringing the target view to the top of the view hierarchy, eliminating White/Dark flash artifacts common in legacy webview wrappers.
3. **Popup & `target="_blank"` Trapping**:
   Hooks into `setWindowOpenHandler` and `did-create-window` to automatically catch external link popups and spawn them as managed child tabs inside the Cyberdeck tab bar instead of opening unmanaged OS windows.
4. **Calibrated Viewport Background**:
   Initializes views with `#f4f4f5` (soft matte zinc gray), ensuring raw unstyled HTML sites (like `motherfuckingwebsite.com`) are fully legible with sharp black text without harsh pure-white screen glare.

---

## 📄 Source Files

- **[`tab-manager.ts`](./tab-manager.ts)**:
  Defines the `TabManager` and `TabInstance` abstractions. Handles tab creation, tab switching, tab closure, geometry recalculation on window resize, and fallback navigation to `mark-eleven://manual`.
