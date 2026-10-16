<p align="center">
  <img src="public/assets/ono-sendai.png" width="30%" alt="Ono-Sendai Cyberspace 7" />
  &nbsp;&nbsp;
  <img src="public/assets/kuang-grade.png" width="30%" alt="Kuang Grade Icebreaker" />
  &nbsp;&nbsp;
  <img src="public/assets/mark-eleven.png" width="30%" alt="Mark Eleven Tactical Core" />
</p>

# ⚡ Kuang Grade Mark Eleven

> *"I'll hack the Gibson"*  
> — **Dade Murphy (AKA Crash Override)**, Circa 1995

---

### **Grade Eleven is a Web Browser for your Local AI.**

> [!WARNING]
> **EXPERIMENTAL PROTOTYPE**: Kuang Grade Mark Eleven is currently under active, experimental development. Tool contracts, telemetry tuning, and database schemas may evolve rapidly. Built for developers experimenting with multimodal local AI agents.

> [!IMPORTANT]
> **RESEARCH PURPOSES ONLY**: This software is provided strictly for educational, testing, and local AI agent research purposes. It is **not intended for malicious use**, automated credential stuffing, unauthorized exploitation, or violating third-party websites' Terms of Service. Users are responsible for complying with all applicable laws and terms.

Mark Eleven is an interactive, stateful web-browsing Model Context Protocol (MCP) server that empowers multimodal LLM Agents (such as Bonsai 2 27B, Gemini, Claude, and GPT-4o) to operate the live, open web **like a human operator inside a real, visible Chromium browser instance**.

### 🎯 Core Architecture Principles
1. **100% Real Browser Chassis:** No headless emulation, synthetic user-agent spoofing, or sandboxed scraping. Mark Eleven runs a full-fledged, visible Chromium instance (`headless: false`) with hardware acceleration, audio/video capabilities, and authentic cookie/session persistence.
2. **Multimodal Vision Integration:** Specifically tailored for multimodal models (e.g. Bonsai 2 27B). The agent takes high-res viewport screenshots (`take_screenshot`) to visually understand layouts, buttons, and dynamic canvas states, and can click directly by coordinate or selector (`click_element`).
3. **Full Developer Console & Script Execution:** Gives the agent full console access (`get_console_logs`) to inspect runtime errors and API output, plus arbitrary JavaScript evaluation (`evaluate_javascript`) to interact with complex SPAs.
4. **Behavioral Bot Detection Bypass:** Bypasses Cloudflare, Akamai, Datadome, and behavioral bot sensors by avoiding synthetic `element.click()` events (`isTrusted: false`). Instead, it dispatches native OS-level hardware input events (`webContents.sendInputEvent`) accompanied by organic cubic Bézier pointer movement and human Gaussian typing cadence.

---

## 🌌 Neuromancer Inspiration & Cyberpunk Canon

> *"A Kuang Grade Mark Eleven penetration program. Icebreaker. The military stuff, the heavy artillery."*  
> — **William Gibson, *Neuromancer* (1984)**

In William Gibson's genre-defining cyberpunk masterpiece *Neuromancer*, console cowboys Case and the ROM personality construct of the Dixie Flatline jack into the Matrix using an **Ono-Sendai Cyberspace 7** deck. Their ultimate weapon: the **Kuang Grade Mark Eleven**—a mythical military-grade icebreaker designed to slice through the impenetrable corporate ICE surrounding the Tessier-Ashpool mainframe.

**Kuang Grade Mark Eleven** channels this lineage:
- **Piercing the Modern Web's "ICE":** Headless automation (Puppeteer, Playwright) is routinely flagged and blocked by Cloudflare, Datadome, and behavioral bot sensors. Mark Eleven provides a tactile, visible Chromium cyberdeck that operates with authentic human telemetry.
- **The Ghost Cursor as Neural Trodes:** Dispatches organic cubic Bézier pointer movement and Gaussian typing cadences, behaving like an authentic human operator seated at the console.
- **The LanceDB Cortex as ROM Personality Construct:** Provides persistent semantic recall and memory traces so your local AI agent retains research context and bookmarks across browsing sessions.

---

## 🎨 Theme & Cyberdeck Interface

Built with **Tailwind CSS v4** and **DaisyUI 5**:
- **Custom Theme:** `mark-eleven`
- **Color Inspiration:** Antigravity electric cyan (`oklch(75% 0.18 215)`), VS Code workspace slate (`oklch(21% 0.012 250)`), and Photoshop deep charcoal neutrals.
- **DaisyUI Components:**
  - `navbar` & `mockup-browser` address bar with real-time navigation and SSL/protocol status.
  - `status` and `badge` indicators reflecting live agent lifecycle (`IDLE`, `TRAVERSING`, `SIMULATING_INPUT`, `HARVESTING`).
  - `tabs` (`tabs-border`) for switching between **Telemetry Kinematics**, **Construct Terminal**, and **MCP Matrix Logs**.
  - `stats` / `stat` blocks tracking coordinates, Bézier velocity, tokens saved, and interaction counters.
  - `mockup-code` for viewing synthesized Markdown memory constructs with token downsampling ratios.

---

## 🕹️ Ghost Cursor Telemetry Engine

- **Organic Bézier Trajectories:** Natural cubic Bézier curve calculation with quintic ease-in/ease-out acceleration, micro-jitter, and target deceleration.
- **Hardware Event Piping:** Directly dispatches Chromium input events via Electron's `webContents.sendInputEvent` (mouse movement, button press dwell time, variable-cadence keystrokes, and momentum mousewheel scrolling).
- **Anti-Bot Defense Bypass:** Avoids heuristic bot triggers by behaving like an authentic human operator.

---

## 📄 Token-Efficient Construct Harvester

- **Pure Node.js:** Powered by Mozilla Readability and Turndown. No external Python or platform-specific binaries required.
- **Semantic Flattening:** Strips ads, navigation sidebars, and script clutter.
- **Automated Envelope Front-Matter:**
  ```yaml
  ---
  designation: "KUANG_GRADE_MARK_ELEVEN_CONSTRUCT"
  source_url: "https://example.com"
  title: "Example Domain"
  harvested_at: "2026-10-16T07:10:00.000Z"
  raw_bytes: 48920
  construct_bytes: 2140
  estimated_tokens: 535
  compression_ratio: "4.4%"
  ---
  ```

---

---

## 🧠 LanceDB Persistent Cortex & Semantic Recall

Mark Eleven features an embedded, serverless vector database (**LanceDB**) combined with Tantivy-powered Full-Text Search (BM25) stored locally under `./data/cortex/`.

- **Auto-Harvest on Navigation:** Every web page visited is automatically chunked, embedded, and indexed into the `page_history` table in the background.
- **Hybrid Semantic Recall:** Models can invoke `recall_memory` to execute hybrid vector + BM25 search across past research sessions, retrieving verbatim snippets, page titles, and relevance match scores.
- **Persistent Bookmarks:** Save critical research nodes, documentation hubs, or matrix targets with semantic tags and research notes.
- **DaisyUI 5 Cortex HUD:** Open the Cortex modal (`🧠 CORTEX`) from the navbar to browse recent history, execute live semantic queries, or manage bookmarked cards.

---

## 📑 Hardware-Accelerated Multi-Tab Browsing

- **Electron `WebContentsView` Isolation:** Independent navigation state, separate history stacks, and zero-flicker view swapping.
- **Automatic Popup Trapping:** Links configured with `target="_blank"` or `window.open` are cleanly trapped into managed child tabs rather than escaping as detached OS windows.
- **Dynamic DaisyUI 5 Tab Bar Strip:** Real-time loading spinners, active indicators, title truncations, and memory reclamation upon tab closure.

---

## 🔌 Standardized Semantic MCP Tools (25 Tools Total)

| Category | Tool | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **Navigation** | `navigate_to` | `url: string`, `auto_dismiss_consent?: boolean` | Navigates active tab to URL. Auto-dismisses GDPR/cookie overlays by default. *(alias: `go_to_url`)* |
| | `navigate_history` | `action: 'back' \| 'forward' \| 'reload'` | Browser history navigation and reload controls. |
| | `get_page_info` | _none_ | Returns current URL, title, and load state without full extraction. |
| **Shield & Defense** | `dismiss_consent` | _none_ | Autonomously detects and dismisses GDPR/cookie banners via Bézier mouse click. |
| **Interaction** | `click_element` | `selector?: string`, `x?: number`, `y?: number` | Clicks element by CSS selector or direct viewport (x, y) coordinates. |
| | `type_text` | `text: string`, `selector?: string` | Types text with human Gaussian cadence variance (60–240ms). |
| | `press_key` | `key: string` | Presses specific key (e.g. `Enter`, `Tab`, `Escape`, `Backspace`). |
| | `scroll_page` | `direction: 'up' \| 'down'`, `amount?: number` | Incremental momentum wheel scrolling. |
| **Observation** | `take_screenshot` | _none_ | High-res PNG image capture for multimodal visual inspection. |
| | `get_page_markdown` | _none_ | Downsamples active DOM to clean token-efficient Markdown with YAML metadata. *(alias: `harvest_markdown`)* |
| | `evaluate_javascript` | `script: string` | Evaluates custom JS expression in page context and returns JSON. |
| | `get_console_logs` | `limit?: number` | Returns recent web page and script console logs, warnings, and errors. |
| | `get_fingerprint_profile` | _none_ | Returns active stealth host browser fingerprint and spoofed headers. |
| **Multi-Tab** | `new_tab` | `url?: string` | Spawns a new independent browser tab instance. |
| | `switch_tab` | `tab_id: string` | Activates and focuses the specified tab. |
| | `close_tab` | `tab_id?: string` | Closes tab and reclaims memory resources. |
| | `list_tabs` | _none_ | Returns structured array of all open tabs (IDs, titles, URLs, active status). |
| **LanceDB Memory** | `recall_memory` | `query: string`, `limit?: number`, `domain?: string` | Performs hybrid vector and BM25 full-text search across visited pages and markdown. |
| | `get_history` | `limit?: number`, `domain?: string` | Chronological browsing history from persistent LanceDB cortex. |
| | `clear_history` | `older_than?: string` | Prunes or purges browsing history from persistent storage. |
| | `add_bookmark` | `url?: string`, `title?: string`, `notes?: string`, `tags?: string[]` | Saves active or specified page with tags and notes in LanceDB. |
| | `list_bookmarks` | `query?: string`, `tag?: string`, `limit?: number` | Retrieves or semantically filters saved bookmarks. |
| | `delete_bookmark` | `url_or_id: string` | Deletes bookmark by URL or unique ID. |

---

## 🗺️ Codebase Directory Structure & Documentation

Each folder contains a dedicated `README.md` detailing its responsibilities, dependencies, and internal workflows:

| Directory | Documentation Link | Description |
| :--- | :--- | :--- |
| **`docs/`** | [docs/README.md](./docs/README.md) | Central documentation hub, concept lore, and architectural specifications. |
| **`scripts/`** | [scripts/README.md](./scripts/README.md) | Automated test harnesses, logo embedders, and the standalone `mcp-server.js` stdio runner. |
| **`public/`** | [public/README.md](./public/README.md) | Static web root and the built-in offline Cyberdeck Manual (`welcome.html`). |
| **`public/assets/`** | [public/assets/README.md](./public/assets/README.md) | Tactical high-resolution brand insignia (Ono-Sendai 7, Kuang Grade, Mark Eleven). |
| **`src/`** | [src/README.md](./src/README.md) | Root source directory organizing process-isolated TypeScript modules. |
| **`src/main/`** | [src/main/README.md](./src/main/README.md) | Electron main process, `BrowserChassis` coordinator, and HTTP bridge (`:4111`). |
| **`src/main/cortex/`** | [src/main/cortex/README.md](./src/main/cortex/README.md) | Embedded LanceDB vector database, 128-d embedder, chunker, and hybrid semantic recall. |
| **`src/main/tabs/`** | [src/main/tabs/README.md](./src/main/tabs/README.md) | Hardware-accelerated `WebContentsView` multi-tab pooling and popup trapping. |
| **`src/main/shield/`** | [src/main/shield/README.md](./src/main/shield/README.md) | Autonomous Shield Breaker engine auto-dismissing cookie banners and GDPR modals. |
| **`src/main/telemetry/`** | [src/main/telemetry/README.md](./src/main/telemetry/README.md) | Organic cubic Bézier mouse kinematics, Gaussian typing cadence, and stealth fingerprinting. |
| **`src/main/harvester/`** | [src/main/harvester/README.md](./src/main/harvester/README.md) | Mozilla Readability & Turndown token-efficient markdown distillation. |
| **`src/preload/`** | [src/preload/README.md](./src/preload/README.md) | Sandboxed ContextBridge IPC exposing typed `window.electronAPI` to the DOM. |
| **`src/renderer/`** | [src/renderer/README.md](./src/renderer/README.md) | DaisyUI 5 Cyberdeck HUD, phosphor radar trail canvas, and Cortex modal dialogs. |
| **`src/shared/`** | [src/shared/README.md](./src/shared/README.md) | Shared TypeScript contracts, telemetry events, and construct schemas. |
| **`src/mcp/`** | [src/mcp/README.md](./src/mcp/README.md) | In-process TypeScript MCP server definition for zero-overhead unified execution. |

---

## 🚀 Quickstart

### Development Mode (with Live Reloading)
```bash
pnpm dev
```

### Production Build & Launch
```bash
pnpm run build
pnpm start
```

### MCP Client Configuration (e.g. Claude Desktop, Cursor, Antigravity)
Add this to your MCP configuration (`claude_desktop_config.json` / `mcp_config.json`):
```json
{
  "mcpServers": {
    "mark-eleven": {
      "command": "npx",
      "args": [
        "electron",
        "./dist-electron/main/index.js"
      ]
    }
  }
}
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) © 2026 hyperbolictonic.
