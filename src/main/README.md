# 🖥️ Kuang Grade Mark Eleven — Main Process (`src/main/`)

This directory is the brain of the Electron desktop application and visible Chromium navigator. It runs in pure Node.js with direct access to native operating system APIs, window management, and hardware acceleration.

---

## 📁 Submodules

- **[`cortex/`](./cortex/README.md)**:
  Embedded **LanceDB** vector database with BM25 full-text indexing, deterministic 128-dimensional embedder, markdown chunking, and persistent research bookmarks.
- **[`tabs/`](./tabs/README.md)**:
  Multi-tab manager powered by modern Electron `WebContentsView` instances, featuring popup trapping (`target="_blank"`), soft matte zinc backgrounds (`#f4f4f5`), and isolated navigation states.
- **[`telemetry/`](./telemetry/README.md)**:
  Humanized cubic Bézier cursor movement, Gaussian typing cadence variance, and stealth browser profile detection.
- **[`harvester/`](./harvester/README.md)**:
  Token-efficient Markdown distillation engine powered by Mozilla Readability and Turndown.

---

## 📄 Key Files

- **[`index.ts`](./index.ts)**:
  Application entrypoint. Configures the main `BrowserWindow`, sets window flags, and initiates the chassis lifecycle.
- **[`browser-chassis.ts`](./browser-chassis.ts)**:
  The central coordinator (`BrowserChassis`). Routes MCP tool commands to the active tab, registers IPC listeners, manages viewport geometry, and automatically indexes visited pages into LanceDB.
- **[`http-bridge.ts`](./http-bridge.ts)**:
  Lightweight HTTP REST API running on `127.0.0.1:4111`. Allows the external `mcp-server.js` process or test scripts to control the browser, trigger actions, and query LanceDB memory over localhost.
