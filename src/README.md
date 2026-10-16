# 💻 Kuang Grade Mark Eleven — Source Code Architecture (`src/`)

This directory houses the entire TypeScript source codebase for Kuang Grade Mark Eleven, structured cleanly into process-isolated domains.

---

## 🏛️ Directory Overview

```
src/
├── main/       # Electron Main Process, Browser Chassis, HTTP Bridge, Cortex & Tabs
├── preload/    # Safe ContextBridge IPC mapping Node.js capabilities to the DOM
├── renderer/   # DaisyUI 5 Cyberdeck HUD, Radar Canvas, and state synchronizer
├── shared/     # Universal TypeScript interfaces, telemetry events, and schemas
└── mcp/        # Model Context Protocol declarations and utilities
```

---

## 🔗 Subsystem Links

- **[`src/main/`](./main/README.md)**:
  Contains the core `BrowserChassis`, native multi-tab management, HTTP bridge (`:4111`), organic mouse simulator, stealth host browser fingerprinting, and embedded LanceDB vector memory.
- **[`src/preload/`](./preload/README.md)**:
  Exposes the typed `window.electronAPI` bridge to the DaisyUI renderer without compromising Chromium sandbox isolation.
- **[`src/renderer/`](./renderer/README.md)**:
  The visual Cyberdeck interface built with Tailwind CSS v4 and DaisyUI 5, featuring the organic ghost cursor canvas trail, active tab pills, and live Cortex modal.
- **[`src/shared/`](./shared/README.md)**:
  Contract types shared seamlessly across Electron main, preload, renderer, and test runners.
