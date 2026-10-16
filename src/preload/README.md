# 🔒 Kuang Grade Mark Eleven — Preload Script (`src/preload/`)

This directory contains the secure IPC boundary between Electron's Node.js main process and the sandboxed Chromium DOM renderer.

---

## 🏛️ Security & Architecture

- **`contextIsolation: true`**:
  Prevents client-side website scripts or malicious DOM injections from accessing Node.js primitives or native system APIs.
- **`contextBridge.exposeInMainWorld('electronAPI', ...)`**:
  Provides a strictly typed, promise-based API surface (`ElectronAPI`) allowing the DaisyUI frontend to:
  - Query chassis state (`getState()`).
  - Listen for live telemetry pulses (`onTelemetry()`).
  - Manage browser tabs (`getTabs()`, `createTab()`, `switchTab()`, `closeTab()`).
  - Toggle viewport hardware visibility (`setViewportVisibility()`).
  - Query persistent LanceDB memory and bookmarks (`recallMemory()`, `getHistory()`, `addBookmark()`, `listBookmarks()`).

---

## 📄 Source Files

- **[`index.ts`](./index.ts)**:
  Preload script that defines the `ElectronAPI` interface and binds `ipcRenderer.invoke` calls.
