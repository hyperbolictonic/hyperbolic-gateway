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

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.2.0-22d3ee" />
  <img alt="tools" src="https://img.shields.io/badge/MCP%20tools-59-a3e635" />
  <img alt="resources" src="https://img.shields.io/badge/MCP%20resources-7-f472b6" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20x64-64748b" />
</p>

---

### **Grade Eleven is a Web Browser for your Local AI.**

> [!WARNING]
> **EXPERIMENTAL PROTOTYPE**: Kuang Grade Mark Eleven is currently under active, experimental development. Tool contracts, telemetry tuning, and database schemas may evolve rapidly. Built for developers experimenting with multimodal local AI agents.

> [!IMPORTANT]
> **RESEARCH PURPOSES ONLY**: This software is provided strictly for educational, testing, and local AI agent research purposes. It is **not intended for malicious use**, automated credential stuffing, unauthorized exploitation, or violating third-party websites' Terms of Service. Users are responsible for complying with all applicable laws and terms.

Mark Eleven is an interactive, stateful web-browsing Model Context Protocol (MCP) server that empowers multimodal LLM Agents (such as Bonsai 2 27B, Gemini, Claude, and GPT-4o) to operate the live, open web **like a human operator inside a real, visible Chromium browser instance**.

> [!NOTE]
> **What's new in 1.2.0** — an **autonomous discovery layer**. `llm_surface` detects a site's own Markdown/Text representation (`/llms.txt`, a `<link rel="alternate">` hint, or content negotiation) and `llm_fetch` reads it (**gated** on an advertised surface); `search_web` runs multi-engine search in a detached view with automatic fallback; `deep_crawl` walks a site breadth-first, distilling and indexing every page into Cortex; `research_topic` searches → gathers → distils → indexes and returns **cited extractive evidence**. Plus typed JSON-LD (`schema_org`) and every-table extraction on `extract`, one shared reusable off-screen view (fixes flaky detached reads), and an explicit **TIER 1/2/3 map** across the docs and the default-tab Manual. **59 advertised tools.** See [CHANGELOG.md](./CHANGELOG.md) and [TODO_RESEARCH_CRAWL.md](./TODO_RESEARCH_CRAWL.md).
>
> **What's new in 1.1.1** — **MCP stdio reliability hardening** so the `kuang` tool namespace can no longer "just go away". Per-call diagnostics now go to the file log only, stderr is a short bounded boot banner (backpressure-aware, 16 KiB hard cap, lines dropped rather than queued), a `KUANG_BRIDGE_TIMEOUT_MS` ceiling (default 300 s) stops a wedged Cyberdeck from hanging a tool call, and closing `stdin` shuts the child down cleanly. Reproduced and verified: stderr unread, 600 calls → **601/601 responses, 0 timeouts** (was 158 responses then a stall). See [CHANGELOG.md](./CHANGELOG.md) and [docs/HANDOFF_ORCHA_MCP_STDERR.md](./docs/HANDOFF_ORCHA_MCP_STDERR.md).
>
> **What's new in 1.1.0** — an **orthogonal primitive layer** (`observe` · `act` · `wait_for` · `expect` · `find` · `extract` · `collect_all` · `page_state`/`diff` · `export_har` · `context_*`) that removes blind sleeps and guessy selectors, **focus-independent CDP input** (clicks/typing land even when another app owns the foreground), and **background-render hardening** so occluded windows still hydrate and scroll. 16 new tools, 1 new OKF playbook partition. See [docs/PROPOSED_ABSTRACTIONS.md](./docs/PROPOSED_ABSTRACTIONS.md).

### 🎯 Core Architecture Principles
1. **100% Real Browser Chassis:** No headless emulation, synthetic user-agent spoofing, or sandboxed scraping. Mark Eleven runs a full-fledged, visible Chromium instance (`headless: false`) with hardware acceleration, audio/video capabilities, and authentic cookie/session persistence.
2. **Multimodal Vision Integration:** Specifically tailored for multimodal models (e.g. Bonsai 2 27B). The agent takes high-res viewport screenshots (`take_screenshot`) to visually understand layouts, buttons, and dynamic canvas states, and can act directly by coordinate, selector, or mark badge (`act`).
3. **Full Developer Console & Script Execution:** Gives the agent full console access (`get_console_logs`) to inspect runtime errors and API output, plus arbitrary JavaScript evaluation (`evaluate_javascript`) to interact with complex SPAs.
4. **Behavioral Bot Detection Bypass:** Bypasses Cloudflare, Akamai, Datadome, and behavioral bot sensors by avoiding synthetic `element.click()` events (`isTrusted: false`). Instead, it dispatches **real input events over the Chrome DevTools Protocol** (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `mouseWheel`) accompanied by organic cubic Bézier pointer movement and human Gaussian typing cadence. CDP delivery is **focus-independent** — it lands even when another application owns the OS foreground — with `webContents.sendInputEvent` kept only as a fallback.

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

## 🤘 A Punk-Ethos, DIY Alternative to browser-use, Playwright Agents & Hosted Browser Clouds

Most "AI browser" tooling today is a **library you integrate, or a cloud you rent**. [`browser-use`](https://github.com/browser-use/browser-use) is a popular MIT-licensed Python framework that drives Playwright *with its own agent loop* (plus an optional hosted cloud); Playwright / Puppeteer / Selenium are general-purpose drivers where **you** write the loop; and managed browser clouds run a remote Chromium and bill per session. They're good tools — this isn't a rivalry, it's a different **shape**.

**Kuang Grade Mark Eleven is the other road:** a single, self-hosted **Electron icebreaker** that *you* own. It runs a **real, visible Chromium** on your own machine and speaks **MCP** over `stdio` (+ a localhost bridge), so it drops into whatever agent runner and whichever model you already use — **local or remote, with no cloud account, no API key, no seat pricing, and no telemetry leaving your box.**

That's the punk ethos: **one operator, one machine, a tool you can read, fork and keep.** Built by one person, not a company. No VC, no roadmap-by-committee, no dashboard.

### How it differs, honestly

| | `browser-use` (Python / Playwright) | Playwright · Puppeteer agents | Hosted browser clouds | **Kuang Grade Mark Eleven** |
| :--- | :--- | :--- | :--- | :--- |
| **Shape** | Library **with its own agent loop** | Driver — you write the loop | Managed remote browser | **MCP server** any MCP client can call |
| **Browser** | Playwright Chromium (often headless) | Playwright / Puppeteer | Remote Chromium | **Visible Chromium** (`headless: false`) in an Electron chassis |
| **Where it runs** | Your machine, or their cloud | Your machine / your CI | Their datacentre | **Your machine, always** — local-first |
| **Model** | Bring your own (usually a cloud LLM) | Bring your own | Bring your own | **Bring your own — local or remote** |
| **Input** | Playwright-driven events | Playwright-driven events | CDP over the wire | **Focus-independent CDP input** + Bézier ghost cursor + Gaussian typing (`isTrusted: true`) |
| **Memory** | Framework-level, BYO store | none | Their store | **Local LanceDB "Cortex"** — semantic recall of everything it harvests |
| **Cost** | MIT + your LLM (+ optional cloud) | Free + your LLM | **Per-session billing** | **MIT. No cloud, no metering, no telemetry.** |

### What that buys you in practice

- **Self-hosted and local-first.** The browser, the memory, the logs and the model all stay on the box.
- **Built for a machine you're *also* using.** Input goes over CDP and is **focus-independent** — clicks and typing land while your editor owns the foreground — and occluded windows keep hydrating and scrolling, so long harvests keep running behind your other apps.
- **Tier-graded tool surface, not a token bonfire.** Reading is `observe(as:"markdown")` with inline `[#id]` marks (no screenshot tax); interaction is one `act`; `[TIER 1/2/3]` prefixes plus a `tools/recommended` resource tell the agent what to prefer.
- **Honest about its limits.** Detached reads are gated, `evaluate_javascript` is *"use deliberately"* rather than banned, and failures are machine-coded (`STALE_REF`, `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED`) instead of vibes.
- **No framework lock-in.** Because the interface is MCP, your runner stays yours: swap the agent, swap the model, keep the icebreaker.

### FAQ (the searches that land people here)

**Is there a self-hosted, open-source alternative to browser-use?**
Yes — MIT-licensed and entirely local. But note the shape: this is a *tool surface*, not an agent framework. If you want a Python framework that owns the loop, `browser-use` is the right tool; if you want a self-hosted browser that *your own* agent drives, this is it.

**Can I use it with Claude Desktop, Cursor, or a local LLM?**
Yes. It's an MCP server, so any MCP client works — point your client at `bin/mcp-server.cjs` and the `kuang` tool namespace appears.

**Does it need a cloud account, API key, or per-session billing?**
No. There is no cloud tier. The only network calls are the ones your agent makes to the pages it visits (plus, optionally, a search engine via `search_web`).

**Is it headless?**
Deliberately the opposite. It runs a **visible** Chromium so a human can watch, take over at a CAPTCHA, and so the session stays an honest, real browser. Headless-at-scale scraping is a different job; this is a single operator's console.

**Will Cloudflare block it like Puppeteer / Playwright?**
It's built for exactly that fight: real CDP input with `isTrusted: true`, cubic Bézier pointer kinematics, Gaussian typing cadence, a genuine cookie jar, and an autonomous consent-modal breaker. No promises — anti-bot is an arms race — but it is **not** naive headless emulation.

**Can I point it at my existing Playwright test suite?**
No. This isn't a test driver; Playwright remains excellent for deterministic suites. Grade Eleven is an agent-facing browser an LLM operates.

**Where does memory live?**
Locally, in LanceDB ("Cortex"): harvested pages and vaulted scripts are embedded and semantically recallable, so your agent keeps research context across sessions without a hosted vector store.

**Is it production-ready?**
No — it's an experimental prototype for local AI research. That's rather the point.

> **Punk ethos, not carte blanche.** Owning your tooling doesn't change the law: the **RESEARCH PURPOSES ONLY** terms at the top of this README still apply. The point is *ownership and readability*, not immunity.

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
- **Focus-Independent CDP Delivery:** Input events are dispatched over the tab's already-attached Chrome DevTools Protocol debugger (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.mouseWheel`), with `Emulation.setFocusEmulationEnabled` so focus-gated page JS still responds. Clicks, keystrokes, and momentum wheel scrolling land **regardless of which window owns the OS foreground**. `webContents.sendInputEvent` remains only as a fallback (and only that path needs the window focused). The active transport is reported by `bridge_health` → `input.transport` (`cdp` | `native`).
- **Anti-Bot Defense Bypass:** Avoids heuristic bot triggers by behaving like an authentic human operator; every interaction is `isTrusted: true` because it is genuine browser input, not a synthetic DOM `.click()`.

---

## 🎛️ Focus-Independent Input & Background Rendering

Two real-desktop failure modes are handled explicitly so long harvests and HIL flows stay reliable:

- **Input is not tied to OS focus.** Synthetic input is delivered over CDP and therefore reaches the renderer even while you work in another application. If the debugger is unavailable the simulator falls back to `webContents.sendInputEvent` and brings the window forward first (that path is the only one that steals the foreground). `bridge_health` exposes `input.transport` so an agent can tell which path is live.
- **Occluded windows keep rendering.** Browsing tabs run with `backgroundThrottling: false`, and the app boots with `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, and `--disable-background-timer-throttling`. Without these, Chromium reports the page `hidden`, throttles timers to ≥1s, and stops producing frames — so `scroll` events never fire and `IntersectionObserver`/rAF hydration stalls (the classic "lazy list stops growing" bug).
- **Viewport gating is explicit.** Real input needs a non-zero viewport; a fresh or hidden tab can briefly report `0x0`. Call `set_window_visibility({ visible: true })` and wait for a non-zero viewport before acting. Showing the window is otherwise only needed to make it visible to a human (HIL).

---

## 🧩 Orthogonal Primitive Layer

The older tool list is being consolidated onto **a few orthogonal verbs** — one observation model, one action model, one wait model — with the flat tools becoming projections. All primitives run on the TIER-1 humanlike path (real input events; no page DOM mutation beyond Mark Eleven's own `data-mark-id` stamp).

| Primitive | Job | Replaces |
| :--- | :--- | :--- |
| `observe(as, region, budget, cursor)` | One budgeted, cursor-paged observation model (`markdown`/`text`/`ax`/`som`/`list`/`table`/`app_data`) | `get_page_markdown` + `snapshot_rendered_page` + `list_marks` |
| `act(mark_id \| selector \| x+y, action, text, secret, await_conditions, dry_run)` | Unified humanlike click/focus/hover/type/press on a **mark ref, CSS selector, or coordinate** **+ optional post-conditions + delta report** | `click_mark`/`type_mark`/`click_element`/`type_text` plus a following wait |
| `wait_for(conditions, require, timeout_ms)` | Declarative readiness gate — the primitive that replaces blind sleeps | every `sleep`/"did it load?" guess |
| `expect(conditions)` | Immediate assertion (no polling) with per-condition evidence | agent-side guessing |
| `find(role, name, contains, regex, tag, selector)` | Semantic element search → **refs** (mark ids) | hand-written CSS/XPath |
| `extract(kind, ref, selector)` | Structured reads: repeating `list` rows, `table` records, embedded `app_data` | regex over HTML |
| `collect_all(selector, scroll, max_scrolls)` | Scroll a lazy/virtualized list to the end and dedupe rows in **one call** | a manual scroll-and-harvest sweep |
| `page_state()` / `diff(since)` | Cheap monotonic change signature + field-by-field diff for loops | re-reading the whole page |
| `bridge_health()` | Liveness, `capabilities[]`, `revision`, `window`, `input.transport` | assuming the bridge is up |
| `export_har(pattern, save)` · `context_*` | HAR 1.2 export · named cookie/storage profiles | ad-hoc replay · manual session juggling |

**Refs are marks.** A ref *is* a Set-of-Marks badge id — `find` returns rows carrying the `mark`, and `act(mark_id=…)` consumes it (re-resolving the live centre each time). When there is no badge, the **same** `act` also takes `selector="…"` or `x=`/`y=` — one action tool, three address modes.

**Wait vocabulary:** `selector` · `gone` · `text`/`regex` · `url` · `role_name` · `count(min/equals/max)` · `network_idle` · `stable(marks|height|text|nodes)` · `revision`.

**Structured errors:** new endpoints return a machine code (HTTP 400) — `STALE_REF` (re-scan and re-issue), `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED`.

> Full recipes (R1–R5), the wait table, and the error catalogue live in the OKF partition [`kuang_docs/partitions/primitives_and_workflows.md`](./kuang_docs/partitions/primitives_and_workflows.md), also readable as the MCP resource `mark-eleven://okf/partitions/primitives-and-workflows`.

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

## 🛡️ Autonomous Shield-Breaker (Cookie & GDPR Destroyer)

- **Zero-Token Modal Clearance:** Saves 1–2 LLM tool calls on almost every new domain.
- **Preload Framework Detection:** Detects OneTrust, Cookiebot, Google GDPR (`#L2AGLb`), TrustArc, and generic consent frameworks.
- **Bézier Dismissal:** Dispatches authentic Bézier cursor movement and hardware clicks to "Accept All" or "Agree" before notifying the agent that the page is ready.
- **Manual Directive:** Agents can also manually call `dismiss_consent` whenever unexpected overlays block the viewport.

---

## 🎯 Set-of-Marks (SoM) Visual Grounding

- **Zero Coordinate Hallucination:** Completely eliminates hallucinated pixel coordinates or fragile CSS selectors.
- **High-Contrast Neon Badges:** Ephemerally injects high-contrast amber neon numbered badges (`[1]`, `[2]`, `[3]`, etc.) over every visible, interactable DOM element (`<a>`, `<button>`, `<input>`, `select`, `[role="button"]`).
- **Precision Multimodal Actuation:**
  1. `take_screenshot({ marks: true })` captures the badge overlay and returns an element lookup table (`{ id: 1, tag: "BUTTON", text: "Submit", bbox: [...] }`).
  2. `act(1)` moves the Bézier ghost cursor to the element's centroid with sub-pixel accuracy and clicks.
  3. `act(2, action: "type", text: "cyberdeck")` focuses the input and types text with human cadence.
- **One tool, three cost tiers** via `take_screenshot({ marks: true, detail: … })` (pick the cheapest that fits your model):

  | `detail` | Payload | Use when |
  | :--- | :--- | :--- |
  | `"full"` (default) | Marks table + full-resolution PNG | Vision model, fine visual detail matters |
  | `"economy"` | Marks table + 640px-wide JPEG (q45), roughly 10-20x smaller | Vision model, tokens/bandwidth matter |
  | `"markdown"` | Marks table only, **no image** | Text-only models (e.g. local GGUFs) or the cheapest page scan |

  All three return the same mark IDs, so `act(mark_id, …)` works after any of them. Text-only models must not be sent images: a base64 PNG inlined into the prompt can be 100k+ tokens and will stall local inference servers.

---

## 📝 Single-Turn Batch Form Filler

- **Instantaneous Multi-Input Population:** Fills complex checkout forms, flight booking screens, or multi-field search bars in a single turn without round-trip LLM latency.
- **Human Typing Cadence:** Simulates variable human inter-key delays (60–240ms) with Gaussian jitter between fields.
- **Flexible Field Types:** Supports text inputs, password fields, dropdown `<select>` menus, checkboxes, and radio buttons with optional automatic form submission (`submit_selector`).

---

## 📥 Download Manager & Cortex Harvester

- **Workspace-Local Routing:** Intercepts Chromium's `will-download` session events, routing all files into `./data/downloads/` rather than the OS user folder.
- **Automated Text Extraction:** Automatically extracts clean Markdown text from downloaded **PDFs** (`pdf-parse`), **CSVs**, and **JSON** files.
- **LanceDB Vector Ingestion:** Automatically ingests downloaded document text into the **LanceDB Cortex** vector store for instant conversational recall.
- **MCP Inspection:** `list_downloads` and `read_download(filename)` allow agents to inspect and read downloaded files on demand.

---

## 🔐 Session & Cookie Jar Vault

- **Stateful Auth Persistence:** Captures and restores active session cookies, `localStorage`, and `sessionStorage` into encrypted/structured snapshots under `./data/sessions/<name>.json`.
- **Bypass 2FA & Logins:** Resume authenticated states on GitHub, airline portals, news sites, or internal dashboards across agent sessions without triggering repetitive logins or CAPTCHAs.
- **MCP Tools:** `context_save(name)`, `context_open(name)`, `context_list()`, and `context_delete(name)`.
- **Legacy aliases:** `save_session(name)` / `restore_session(name)` / `list_sessions()` still work (same vault) but are hidden from `tools/list`.

---

## 📡 Live Network & API Stream Interceptor

- **Direct Chrome DevTools Protocol Wire:** Attaches directly via CDP (`Network.enable`) to monitor all incoming and outgoing network traffic.
- **Direct JSON Extraction:** Bypasses DOM scraping entirely for modern Single-Page Applications (SPAs like Twitter, Reddit, Skyscanner). Captures completed XHR/Fetch response bodies (`Network.getResponseBody`).
- **MCP Inspection:** `get_network_traffic` filters requests by URL pattern or method, and `query_json_data({ source: "network_payload", source_id })` returns parsed JSON (sliced by `path`/`view`) directly into the LLM context.
- **Action-Correlated Capture:** `get_network_traffic({ since: 'last_action' })` returns only the requests fired by the most recent mutating action (also accepts an epoch-ms timestamp or a page revision). `export_har` writes a **HAR 1.2** log of captured traffic for offline replay.

---

## ⚡ Real-Time WebSocket & SSE Interceptor

- **Duplex Stream Surveillance:** Captures duplex frames across persistent `wss://` WebSockets and Server-Sent Events (`text/event-stream`).
- **Auto-Parsed Payloads:** Automatically detects and parses JSON streaming frames from live crypto tickers, chat platforms, financial feeds, and streaming LLM APIs.
- **In-Memory Ring Buffer:** Rolling buffer of 500 frames with filtering by stream ID, direction (`sent` / `received`), and message limit.
- **MCP Tools:** `list_realtime_streams` and `clear_capture({ scope: "streams" })`; inspect frames with `query_json_data({ source: "stream_messages", source_id })`.

---

## 💾 Script Vault & LanceDB Semantic Macro Engine

- **Reusable Automation Macros:** Store, recall, and execute custom JavaScript DOM extraction and automation scripts under `./data/scripts/<name>.json`.
- **Vector-Indexed Semantic Recall:** Every vaulted script is automatically embedded into the LanceDB `scripts` table. Models can recall scripts using conversational natural language queries (`list_scripts({ query: "extract table rows as json" })`).
- **Parameter Injection:** `run_script(name, args)` executes vaulted scripts inside the active tab with dynamic runtime arguments and closure isolation.

---

## 🗔 System Tray & Background Minimization ("Out of the Way")

- **Unobtrusive Background Operation:** Keeps the Cyberdeck running completely out of the way in the Windows notification tray during long-running automated tasks, batch scrapes, and research pipelines.
- **Single-Click Summon:** Left-clicking or double-clicking the system tray icon toggles window visibility instantly.
- **Close-to-Tray Protection:** Closing the window (`X`) minimizes to the system tray rather than killing active background tasks and MCP sessions.
- **MCP Tools:** `set_window_visibility({ visible?, focus? })` and `configure_system_tray({ close_to_tray })`.

---

## 🚨 Human-In-The-Loop (HIL) Intervention Protocol

- **Graceful Human Collaboration:** When the agent hits Cloudflare Turnstile, CAPTCHAs, 2FA/SMS OTPs, or payment confirmations, it invokes `request_human_intervention`.
- **Multi-Channel Alerting:**
  1. **OS Native Desktop Notification:** Fires an urgent desktop notification banner with sound.
  2. **Window Summon & Taskbar Flash:** Automatically restores the window from the tray, brings it to the front, and flashes the Windows taskbar amber (`flashFrame(true)`).
  3. **Interactive In-Page Cyberdeck Banner:** Injects an amber neon cyberdeck banner (`#__kuang_hil_banner`) directly into the active webpage with a **"RESUME AGENT (DONE)"** button.
  4. **HUD Action Indicator:** Changes the status badge to `AWAITING_INPUT` with live prompt text.
- **Instant Unpause:** When the user completes the action and clicks "DONE", the agent immediately resumes its autonomous turn.
- **MCP Tools:** `request_human_intervention`, `resolve_human_intervention`, `get_human_intervention_status`, and non-blocking `send_notification`.

---

## 🔌 Standardized Semantic MCP Tools (59 Advertised)

> **59 advertised tools** (81 registered entries; **23 deprecated aliases are hidden from `tools/list`** but stay callable by name and return a `deprecated → use "X"` notice — rows marked `†` below). Seven MCP **resources** are also exposed: `mark-eleven://skills/guide`, `mark-eleven://tools/recommended`, `mark-eleven://okf/manifest`, and four partition playbooks.

> **Tier map** (mirrors the `[TIER n]` prefixes the MCP surface puts on the advertised descriptions). **TIER 1 · prefer:** `observe` · `act` · `wait_for` · `expect` · `find` · `extract` · `collect_all` · `page_state` · `diff`. **TIER 2 · fallback:** `take_screenshot` · `snapshot_rendered_page` · `press_key`. **TIER 3 · use deliberately:** `evaluate_javascript` — powerful, just not the default. Every **other** tool is **unprefixed** — it is the only way to do its job. Start with `observe` → `act` → `wait_for` → `find` → `extract`/`collect_all`; the **Primitives & Abstraction** block is listed first for exactly that reason. **Editing this table?** Run `npm run manual:tools` to regenerate the default-tab Manual's collapsible full list from it.

| Category | Tool | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **Primitives & Abstraction** | `observe` | `as?: 'markdown' \| 'text' \| 'ax' \| 'som'`, `region?: number \| string`, `budget?: number`, `cursor?: string`, `include_offscreen?: boolean`, `limit?: number` | **The page read (TIER 1).** One budgeted observation model with projections. Use `budget` + `next_cursor` to page a large page instead of truncating. Absorbed `get_page_markdown` / `harvest_markdown` / `list_marks`; structured reads live on `extract`. |
| | `act` | `mark_id?: number`, `selector?: string`, `x?: number`, `y?: number`, `action?: 'click' \| 'focus' \| 'hover' \| 'type' \| 'press'`, `text?: string`, `secret?: boolean`, `clear_first?: boolean`, `await_conditions?: object[]`, `timeout_ms?: number`, `dry_run?: boolean` | **The** interaction entry point: one humanlike action addressed by mark ref, CSS selector, or coordinates, with optional post-conditions and a delta report. `secret: true` redacts typed text from logs; `dry_run: true` resolves without acting. **Typing appends by default** — pass `clear_first: true` on a pre-filled field (origins, search boxes, comboboxes) to replace instead (trusted Ctrl+A + Backspace). |
| | `wait_for` | `conditions: object[]`, `require?: 'any' \| 'all'`, `timeout_ms?: number`, `poll_ms?: number` | Declarative readiness gate — polls until every/any condition holds, then returns. The primitive that replaces blind sleeps. |
| | `find` | `role?: string`, `name?: string`, `contains?: string`, `regex?: string`, `tag?: string`, `selector?: string`, `limit?: number`, `include_offscreen?: boolean` | Semantic element search returning Set-of-Marks **refs** (mark ids) instead of pixels. Feed ids straight into `act`. |
| | `extract` | `kind?: 'list' \| 'table' \| 'tables' \| 'app_data' \| 'schema_org'`, `ref?: number`, `selector?: string`, `type?: string`, `limit?: number` | Structured, read-only extraction: repeating rows, one table, **every** table, embedded app JSON (`__NEXT_DATA__`/JSON-LD), or **typed schema.org items** (`kind:"schema_org"` flattens `@graph`; `type` filters to e.g. `"Recipe"`). Article extraction is `observe(as:"markdown")` (Readability). |
| | `collect_all` | `selector?: string`, `ref?: number`, `scroll?: 'container' \| 'window'`, `step?: number`, `delay_ms?: number`, `max_scrolls?: number`, `max?: number` | Scrolls a virtualized/lazy list to the end and collects every distinct row (deduped by text+href) in **one call**, with scroll diagnostics. |
| | `expect` | `conditions: object[]` | Immediate assertion (no polling) over the same vocabulary as `wait_for`; returns pass/fail plus per-condition evidence. |
| | `page_state` | _none_ | Cheap monotonic state signature (`revision`, `url`, `marks`, `nodeCount`, `height`, `scrollY`, `textLen`, `textHash`) for change detection without re-reading the page. |
| | `diff` | `since?: number` | Field-by-field diff between the current state and a previously observed revision — shows exactly what changed. |
| | `llm_surface` | `url?: string` | Checks whether a site publishes an LLM-friendly representation (`/llms.txt` / `/llms-full.txt`, `/sitemap.xml`, a `<link rel="alternate">`, or Markdown content negotiation) and returns `recommended`. Well-known paths only; cached per origin. |
| | `llm_fetch` | `url?: string`, `as?: 'llms_txt' \| 'llms_full' \| 'markdown' \| 'text'` | Fetches that advertised Markdown/Text representation (~5–10× cheaper than a render). **Gated:** refuses (`NO_LLM_SURFACE`) unless the site advertises a surface. Per-page alternates load via a real navigation, not a synthetic fetch. |
| | `search_web` | `query: string`, `engine?: 'google' \| 'duckduckgo' \| 'bing' \| 'brave' \| 'startpage' \| 'custom'`, `engines?: string[]`, `url_template?: string`, `max_results?: number` | Multi-engine web search run in a **detached view** (your active tab is untouched) with automatic fallback when an engine bot-checks. Returns ranked `{title, url, snippet}` to feed `navigate_to`/`collect_all`. `custom` takes a `{query}` template (e.g. SearXNG). |
| | `deep_crawl` | `url: string`, `max_depth?: number`, `max_pages?: number`, `match_patterns?: string[]`, `same_origin?: boolean`, `prefer_llm?: boolean`, `harvest_to_cortex?: boolean`, `selector?: string`, `delay_ms?: number` | **Autonomous BFS crawl** from a seed: follows same-origin links within depth/page budgets, distills each page to Markdown, and **indexes it into LanceDB Cortex**. Each page takes the cheap path first (content-negotiated Markdown/Text, else a detached render). `match_patterns` scopes by glob or `/regex/`. |
| | `research_topic` | `query: string`, `max_sources?: number`, `engine?`, `engines?: string[]`, `url_template?: string`, `excerpt_chars?: number`, `harvest_to_cortex?: boolean`, `prefer_llm?: boolean` | **Autonomous research mode:** searches, gathers the top sources (cheap Markdown path first), distills them, and indexes them into Cortex. Returns **extractive, cited evidence** — each highlight is a real paragraph mentioning the query terms. It does **not** write prose; you synthesize the answer. |
| | `bridge_health` | _none_ | Liveness + capability discovery: `version`, `revision`, `capabilities[]`, `window {visible, focused}`, `input {transport}`, `lastActionAt`. |
| | `context_save` | `name?: string` | Saves the current browsing context (cookies + storage) as a named profile. |
| | `context_open` | `name: string` | Restores (switches to) a named browsing context/profile. |
| | `context_list` | _none_ | Lists saved browsing contexts (cookie/storage profiles). |
| | `context_delete` | `name: string` | Deletes a saved browsing context/profile. |
| | † `focus_window` | _none_ | **Deprecated** — use `set_window_visibility({ visible: true })`. Brings the Cyberdeck window to the foreground (HIL visibility, or the legacy `native` input fallback). |
| **Navigation** | `navigate_to` | `url: string`, `auto_dismiss_consent?: boolean` | Navigates active tab to URL. Auto-dismisses GDPR/cookie overlays by default. Supports 0ms instant elevation if pre-rendered. |
| | † `go_to_url` | `url: string`, `auto_dismiss_consent?: boolean` | Primary alias for `navigate_to`. Dispatches visible window navigation. |
| | `navigate_history` | `action: 'back' \| 'forward' \| 'reload'` | Browser history navigation and reload controls. |
| | † `get_page_info` | _none_ | Returns current URL, title, and load state without full extraction. |
| **Shield & Defense** | `dismiss_consent` | _none_ | Autonomously detects and dismisses GDPR/cookie banners via Bézier mouse click. |
| **Interaction** | † `click_element` | `selector?: string`, `x?: number`, `y?: number` | **Deprecated** — folded into `act(selector: …)` / `act(x: …, y: …)`. Clicks element by CSS selector or direct viewport (x, y) coordinates. |
| | † `type_text` | `text: string`, `selector?: string` | **Deprecated** — folded into `act(action: "type", text: …, selector: …)`. Types text with human Gaussian cadence variance (60–240ms). |
| | `fill_form` | `fields: Record<string, string \| boolean \| number>`, `submit_selector?: string` | Fills multiple form inputs, selects, and checkboxes in a single turn. |
| | `press_key` | `key: string` | Presses specific key (e.g. `Enter`, `Tab`, `Escape`, `Backspace`). |
| | `scroll_page` | `direction: 'up' \| 'down'`, `amount?: number` | Incremental momentum wheel scrolling. |
| **Observation & Vision** | `take_screenshot` | `marks?: boolean`, `detail?: 'full' \| 'economy' \| 'markdown'`, `include_offscreen?: boolean`, `max_width?: number`, `format?: 'jpeg' \| 'png'`, `quality?: number` | Viewport capture. Plain mode (default) returns a **bounded 768px fast JPEG** (~15ms encode, tiny wire payload); `marks: true` returns Set-of-Marks with `detail: 'full'` (PNG), `'economy'` (640px JPEG), or `'markdown'` (marks table, no image). Returns file path text & native MCP image block. Saved to `data/screenshots/` with automatic retention pruning. |
| | † `get_page_markdown` | _none_ | Downsamples active DOM to clean token-efficient Markdown with YAML metadata. |
| | † `harvest_markdown` | _none_ | Primary alias for `get_page_markdown`. Extracts clean markdown from the active tab. |
| | `snapshot_rendered_page` | `format?: 'ax_tree' \| 'markdown' \| 'html' \| 'unrendered_html'`, `wait_until_idle_ms?: number`, `pierce_shadow_dom?: boolean`, `force_rerender?: boolean`, `save_to_disk?: boolean` | **Rendered Point-in-Time Snapshot.** Freezes dynamic SPAs, pierces Shadow DOM, and extracts ultra-token-efficient Accessibility (AX) Trees, rendered Markdown, or unrendered source HTML. |
| | `prerender_links` | `urls?: string[]`, `selector?: string`, `max_pages?: number`, `harvest_to_cortex?: boolean`, `wait_until_idle_ms?: number` | **Speculative Pre-rendering Engine.** Pre-hydrates candidate links in background views for **0ms instant navigation**, and auto-indexes into LanceDB Cortex memory. |
| | `evaluate_javascript` | `script: string` | Evaluates custom JS expression in page context and returns serialized JSON. Accepts `script`, `code`, or `expression`. A powerful tool that can read **and** mutate — reach for it deliberately (`observe`/`act` cover the common cases, and injected JS is a bot-detection signal). |
| | `get_console_logs` | `limit?: number` | Returns recent web page and script console logs, warnings, and errors. |
| | `get_fingerprint_profile` | _none_ | Returns active stealth host browser fingerprint and spoofed headers. |
| **Multi-Tab** | `new_tab` | `url?: string` | Spawns a new independent browser tab instance. |
| | `switch_tab` | `tab_id: string` | Activates and focuses the specified tab. |
| | `close_tab` | `tab_id?: string` | Closes tab and reclaims memory resources. |
| | `list_tabs` | _none_ | Returns structured array of all open tabs (IDs, titles, URLs, active status). |
| **LanceDB Memory** | `recall_memory` | `query: string`, `limit?: number`, `domain?: string` | Performs hybrid vector and BM25 full-text search across visited pages and markdown. |
| | `browsing_history` | `limit?: number`, `domain?: string` | Chronological browsing history from persistent LanceDB cortex. |
| | `browsing_history_clear` | `older_than?: string` | Prunes or purges browsing history from persistent storage. |
| | `add_bookmark` | `url?: string`, `title?: string`, `notes?: string`, `tags?: string[]` | Saves active or specified page with tags and notes in LanceDB. |
| | `list_bookmarks` | `query?: string`, `tag?: string`, `limit?: number` | Retrieves or filters saved bookmarks by query terms (title/notes/URL/tags) or exact tag. |
| | `delete_bookmark` | `url_or_id: string` | Deletes bookmark by URL or unique ID. |
| **Downloads & Docs** | `list_downloads` | _none_ | Lists all files downloaded into `data/downloads/` with sizes, state, and timestamps. |
| | `read_download` | `filename_or_id: string` | Parses downloaded file (PDF, CSV, JSON, text) into token-efficient markdown. |
| **Session Vault** | † `save_session` | `name?: string` | Captures active cookies and localStorage state into persistent JSON vault. |
| | † `restore_session` | `name: string` | Rehydrates cookies and localStorage state into browser session. |
| | † `list_sessions` | _none_ | Lists all stored session snapshots with timestamps and cookie counts. |
| **Network Intelligence** | `get_network_traffic` | `url_pattern?: string`, `method?: string`, `resource_type?: string`, `limit?: number`, `since?: number \| 'last_action'` | Inspects live HTTP/XHR/Fetch requests captured via Chrome DevTools Protocol (returns compact 1-line markdown summaries). `since` narrows to requests after an epoch-ms timestamp, a page revision, or the last mutating action. |
| | † `get_api_payload` | `request_id: string` | Retrieves and parses the full raw JSON or text response body for an intercepted request. |
| | `query_json_data` | `source: string`, `source_id?: string`, `path?: string`, `view?: string`, `filter_predicate?: string`, `max_items?: number`, `max_string_length?: number` | **Token-Efficient JSON Navigator.** Queries large payloads/streams/files via dot/bracket paths (`items[0..3].price`), extracts schemas, searches keys, and applies filters without context-window blowup. |
| | † `clear_network_traffic` | _none_ | **Deprecated** — use `clear_capture({ scope: "network" })`. Resets the in-memory network traffic ring buffer. |
| | `export_har` | `pattern?: string`, `limit?: number`, `save?: boolean` | Exports captured traffic as a **HAR 1.2** log (request/response headers + body previews). `save: true` writes `data/har/har_<ts>.har` and returns the path. |
| | `list_realtime_streams` | `type?: 'websocket' \| 'sse'`, `active_only?: boolean` | Lists active WebSocket connections and open SSE channels in compact 1-line format. |
| | † `get_stream_messages` | `stream_id?: string`, `type?: string`, `direction?: string`, `limit?: number` | Inspects captured incoming/outgoing frames from WebSockets and SSE token streams. |
| | † `clear_stream_messages` | `stream_id?: string` | **Deprecated** — use `clear_capture({ scope: "streams" })`. Clears the in-memory WebSocket and SSE message frame buffer. |
| | `clear_capture` | `scope?: 'network' \| 'streams' \| 'all'` | Clears the in-memory capture ring buffers: HTTP traffic (`"network"`), WebSocket/SSE frames (`"streams"`), or both (`"all"`, default). |
| **Visual Grounding** | † `take_annotated_screenshot` | _none_ | Tags all visible interactive elements with numbered neon badges (`[1]`, `[2]`, etc.). Returns dual content: Set-of-Marks table text & native MCP image block (`type: 'image'`). Saved to `data/screenshots/`. |
| | † `take_economy_screenshot` | _none_ | Lightweight variant: same marks table, but the image is downscaled to 640px wide and JPEG-encoded (q45, `image/jpeg`). Saved to `data/screenshots/` as `annotated_eco_*.jpg`. |
| | † `list_marks` | _none_ | Text-only variant: returns the marks table with no image and no file written. Ideal for text-only models. |
| | † `click_mark` | `mark_id: number` | **Deprecated** — folded into `act(mark_id: …)`. Moves humanized Bézier ghost cursor to mark #ID and clicks with 100% accuracy. |
| | † `type_mark` | `mark_id: number`, `text: string`, `clear_first?: boolean` | **Deprecated** — folded into `act(mark_id: …, action: "type", text: …)`. Focuses mark #ID and types with variable human typing cadence. |
| **Script Vault & Macros** | `save_script` | `name: string`, `code: string`, `description?: string`, `domain?: string`, `tags?: string[]` | Saves and embeds a custom JavaScript macro into LanceDB Cortex. |
| | † `recall_script` | `query?: string`, `domain?: string`, `tag?: string`, `limit?: number` | **Deprecated** — use `list_scripts({ query })`. Semantically searches saved scrapers & macros using natural language. |
| | `run_script` | `name: string`, `args?: object` | Executes a saved script in active tab with dynamic runtime arguments. |
| | `list_scripts` | `query?: string`, `tag?: string`, `limit?: number` | Lists or semantically searches registered macros in the persistent vault (`query` ranks by relevance). |
| | `delete_script` | `name: string` | Removes a script from the persistent vault and vector index. |
| **Desktop & System Tray** | `set_window_visibility` | `visible?: boolean`, `focus?: boolean` | Shows/restores the window (and focuses it by default) to make it visible to a human, or minimizes it to the Windows notification tray. |
| | `configure_system_tray` | `close_to_tray?: boolean` | Configures tray options such as close-to-tray background operation. |
| **Human-In-The-Loop & Alert** | `request_human_intervention` | `reason: string`, `timeout_seconds?: number`, `bring_to_front?: boolean` | Halts agent, triggers native OS alert, unhides window, and injects interactive banner for CAPTCHAs/credentials. |
| | `resolve_human_intervention` | `id?: string`, `notes?: string` | Resolves active intervention request and resumes agent execution. |
| | `get_human_intervention_status` | _none_ | Checks active intervention status and history log. |
| | `send_notification` | `title: string`, `message: string`, `urgency?: string`, `sound?: boolean` | Emits non-blocking OS native desktop banner notification to user. |
| | † `send_desktop_notification` | `message: string`, `title?: string`, `urgency?: string`, `sound?: boolean` | Dedicated HIL notification tool to summon the human operator with high-priority desktop sound and alert banner. |
| **Assistance & Discovery** | `help` | `category?: 'all' \| 'recommended' \| 'navigation' \| 'interaction' \| 'primitives' \| 'inspection' \| 'tabs' \| 'memory' \| 'macros' \| 'network' \| 'system'` | Returns a categorized operational cheatsheet of all available browser automation capabilities (served directly in OKF). |

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
| **`src/main/downloads/`** | [src/main/downloads/README.md](./src/main/downloads/README.md) | Deterministic workspace file download routing and automatic document-to-Cortex ingestion. |
| **`src/main/session/`** | [src/main/session/README.md](./src/main/session/README.md) | Persistent cookie jar and session snapshot vault for cross-run auth persistence. |
| **`src/main/network/`** | [src/main/network/README.md](./src/main/network/README.md) | Chrome DevTools Protocol wire interceptor capturing background XHR/Fetch JSON streams. |
| **`src/main/marks/`** | [src/main/marks/README.md](./src/main/marks/README.md) | Set-of-Marks visual grounding engine injecting numbered neon badges for zero-ambiguity LLM actuation. |
| **`src/main/primitives/`** | [src/main/primitives/README.md](./src/main/primitives/README.md) | Orthogonal primitive layer (`observe` · `act` · `wait_for` · `expect` · `find` · `extract` · `collect_all` · `page_state`/`diff` · `export_har`) with structured error codes and injected DOM probes. |
| **`kuang_docs/`** | [kuang_docs/okf.json](./kuang_docs/okf.json) | OKF (Open Knowledge Format) bundle `kuang_browser_docs` — playbook/reference partitions exposed as MCP resources. |
| **`src/main/scripts/`** | [src/main/scripts/README.md](./src/main/scripts/README.md) | Persistent script vault and LanceDB semantic macro recall engine with parameter injection. |
| **`src/main/tray/`** | [src/main/tray/README.md](./src/main/tray/README.md) | Windows System Tray integration and close-to-tray background minimization. |
| **`src/main/hil/`** | [src/main/hil/README.md](./src/main/hil/README.md) | Human-In-The-Loop cooperative intervention protocol, OS notifications, and in-page alert banners. |
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

### MCP Client Configuration (e.g. Claude Desktop, Cursor, Antigravity, Agent-Orcha)
Add this to your MCP configuration (`claude_desktop_config.json` / `mcp_config.json`):
```json
{
  "mcpServers": {
    "mark-eleven": {
      "command": "node",
      "args": [
        "<user>/Documents/<workspace>/kuang_grade_mark_eleven/bin/mcp-server.cjs"
      ]
    }
  }
}
```
> **Note:** The Mark Eleven Cyberdeck application must be running in the background (`pnpm run dev` or `pnpm start`) so the MCP stdio bridge runner can communicate with the active browser instance on `http://127.0.0.1:4111`.

---

## 🧪 Testing

All suites run against the live Cyberdeck on `http://127.0.0.1:4111` (start the app first):

| Command | Suite | What it proves |
| :--- | :--- | :--- |
| `npm run test:harvest` | Harvest regression (4 checks) | Markdown extraction, marks, off-screen marks still work end-to-end. |
| `npm run test:primitives` | Offline primitives (25 checks) | `wait_for`, `extract`, `observe` budget/cursor, `collect_all`, `find`+`act`+delta, `expect`, `page_state`/`diff`, `bridge_health` capabilities. |
| `npm run test:mcp:primitives` | MCP stdio primitives (14 checks) | The same primitives through a real MCP client — tool schemas, viewport gating, `find`→`act`, contexts, `focus_window`. |
| `npm run test:focus` | Focus independence (4 checks) | Hands the OS foreground to another app (Notepad) and asserts typing/clicks/wheel still land **and** that `input.transport === 'cdp'`. |

Type-check and bundles: `npx tsc --noEmit`, `npm run build`, `npm run build:mcp`.

---

## 📚 Documentation & Knowledge (OKF)

- **[`CHANGELOG.md`](./CHANGELOG.md)** — release history and migration-relevant changes.
- **[`docs/`](./docs/README.md)** — the documentation hub: concept lore, subsystem specs, field notes, and the abstraction roadmap.
- **[`docs/PROPOSED_ABSTRACTIONS.md`](./docs/PROPOSED_ABSTRACTIONS.md)** — the primitive-layer design and its status (A1–A6, B, C, D).
- **[`docs/FIELD_NOTES_2026-10-18.md`](./docs/FIELD_NOTES_2026-10-18.md)** — root-caused findings from hardening the TIER-1 path on real SPAs.
- **[`kuang_docs/`](./kuang_docs/okf.json)** — the **OKF bundle** (`kuang_browser_docs`): playbook/reference partitions, also served to agents as standard MCP resources:
  - `mark-eleven://skills/guide` — the full operational manual.
  - `mark-eleven://okf/manifest` — the bundle manifest.
  - `mark-eleven://okf/partitions/selector-and-som` · `captcha-and-anti-bot` · `browser-navigation` · `primitives-and-workflows`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) © 2026 hyperbolictonic.
