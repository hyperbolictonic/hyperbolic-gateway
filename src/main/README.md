# 🖥️ Kuang Grade Mark Eleven — Main Process (`src/main/`)

> The full architecture lowdown (system maps, call paths, findings) lives in
> [docs/CODEBASE.md](../../docs/CODEBASE.md).

This directory is the brain of the Electron desktop application and visible Chromium navigator. It runs in pure Node.js with direct access to native operating system APIs, window management, and hardware acceleration.

---

## 📁 Submodules

- **[`cortex/`](./cortex/README.md)**:
  Embedded **LanceDB** vector database with BM25 full-text indexing, deterministic 128-dimensional embedder, markdown chunking, and persistent research bookmarks.
- **[`tabs/`](./tabs/README.md)**:
  Multi-tab manager powered by modern Electron `WebContentsView` instances, featuring popup trapping (`target="_blank"`), soft matte zinc backgrounds (`#f4f4f5`), and isolated navigation states.
- **[`shield/`](./shield/README.md)**:
  Autonomous Shield-Breaker engine auto-dismissing OneTrust, Cookiebot, Google GDPR, and TrustArc modal consent banners with human Bézier clicks.
- **[`downloads/`](./downloads/README.md)**:
  Download Manager intercepting Electron file downloads into `./data/downloads/`, parsing PDFs/CSVs/JSON into Markdown, and auto-indexing into Cortex.
- **[`session/`](./session/README.md)**:
  Session & Cookie Jar Vault capturing and restoring cookies, localStorage, and sessionStorage across runs.
- **[`network/`](./network/README.md)**:
  Chrome DevTools Protocol (CDP) live network interceptor capturing XHR/Fetch API JSON responses and duplex WebSocket/SSE frames.
- **[`marks/`](./marks/README.md)**:
  Set-of-Marks (SoM) visual grounding engine injecting high-contrast neon badges (`[1]`, `[2]`) over interactable DOM elements for zero-ambiguity LLM actuation.
- **[`primitives/`](./primitives/README.md)**:
  Orthogonal primitive layer (`observe` · `act` · `wait_for` · `expect` · `find` · `extract` · `collect_all` · `page_state`/`diff` · `export_har`) with structured error codes (`STALE_REF`/`TIMEOUT`/`NO_TARGET`/`BAD_REQUEST`/`NOT_SUPPORTED`) and injected DOM probes. Exposed via `chassis.getPrimitives()`.
- **[`scripts/`](./scripts/README.md)**:
  Script Vault and LanceDB semantic macro recall engine enabling natural language script search and parameter-injected runtime execution.
- **[`tray/`](./tray/README.md)**:
  Windows System Tray manager supporting background operation, tray toggle, dynamic context menus, and close-to-tray minimization.
- **[`hil/`](./hil/README.md)**:
  Human-In-The-Loop cooperative intervention protocol with OS native desktop notifications, window summoning, and in-page cyberdeck alert banners.
- **[`telemetry/`](./telemetry/README.md)**:
  Humanized cubic Bézier cursor movement, Gaussian typing cadence variance, and stealth browser profile detection. Input is dispatched **CDP-first** (`Input.dispatchMouseEvent`/`dispatchKeyEvent`/`mouseWheel`) so it is focus-independent, with `webContents.sendInputEvent` as a fallback.
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
