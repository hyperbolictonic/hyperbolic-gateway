# 📋 Hypagon Gateway — Agent Roadmap & TODO

This roadmap outlines upcoming agentic capabilities, prioritized from **least exciting / foundational functional utilities** (cookie negotiation, form batching) to **high-bandwidth cognitive features** (network stream interception, Set-of-Marks visual grounding).

---

## 🛠️ Phase 1: Foundational Utilities (Least Exciting, Most Functional)

### [x] 1. Autonomous Shield-Breaker (Auto Cookie & Modal Dismissal) — ✅ *[COMPLETED]*
- **Priority:** P0 (Essential Baseline)
- **Why:** Saves 1–2 LLM tool calls on almost every new domain by clearing blocking overlays before the agent turn begins.
- **Implementation:**
  - Inject a lightweight DOM observer in the chassis preload script that monitors for common consent frameworks:
    - OneTrust (`#onetrust-accept-btn-handler`)
    - Cookiebot (`#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`)
    - Google GDPR (`#L2AGLb`, `button:has(div:contains("Accept all"))`)
    - TrustArc, Civic, and generic `[aria-label*="accept" i]`, `button:contains("Agree")`
  - Actuate an automated click event or execute non-destructive click before dispatching `page-ready` telemetry to the agent.
  - Expose a manual override tool: `dismiss_cookie_dialogs()`.

---

### [x] 2. Single-Turn Batch Form Filler (`fill_form`) — ✅ *[COMPLETED]*
- **Priority:** P1 (High Utility)
- **Why:** Eliminates the latency of sequential tool calls when filling out flight passenger info, checkout screens, or search filters.
- **Implementation:**
  - MCP Tool: `fill_form`
  - Payload:
    ```json
    {
      "fields": {
        "input[name='firstname']": "Dade",
        "input[name='lastname']": "Murphy",
        "input[type='email']": "crash@gibson.net",
        "select[name='country']": "GB"
      },
      "submitSelector": "button[type='submit']"
    }
    ```
  - Loops through key-value pairs inside the Electron main process, actuating realistic focus, human typing cadence with micro-delays between fields, and optional form submission.

---

### [x] 3. Download Manager & Document Harvester — ✅ *[COMPLETED]*
- **Priority:** P2 (Functional Pipeline)
- **Why:** Headless/automated browsers often drop downloaded files into the OS user folder or hang on download prompts.
- **Implementation:**
  - Intercept Electron's `will-download` session event.
  - Automatically route downloads to a localized workspace directory (`data/downloads/`).
  - Add automatic document post-processing:
    - PDFs: parse text via `pdf-parse` into clean markdown.
    - CSV/TSV: parse into structured markdown tables.
  - Ingest extracted document text straight into **LanceDB Cortex** for immediate semantic recall.
  - MCP Tool: `list_downloads`, `read_download(filename)`.

---

### [ ] 4. `yt-dlp` Stream & Transcript Harvester (`harvest_media`) — ⏸️ *[ON HOLD]*
> [!NOTE]
> **ON HOLD:** Do NOT implement until user explicitly requests it. Awaiting user custom specifications and integration with their parallel video MCP server system.

- **Priority:** P2.5 (Rich Media & Video Understanding)
- **Why:** Pages with rich media (YouTube, Twitter/X video, Reddit clips, Vimeo, TikTok, podcasts) cannot be understood through DOM scraping alone. `yt-dlp` allows the agent to extract full transcripts, subtitles, metadata, or audio for local AI comprehension.
- **Implementation:**
  - Wrap `yt-dlp` via local process bridge.
  - Fast transcript extraction: `--write-auto-sub --sub-lang en --skip-download --dump-json` to extract full spoken text into a clean timestamped markdown construct without downloading heavy video files.
  - Audio extraction: `--extract-audio --audio-format mp3` into `data/media/` for downstream local Whisper speech-to-text processing.
  - Ingest extracted video transcripts directly into **LanceDB Cortex** so the agent can recall spoken facts from videos watched in the browser.
  - MCP Tools:
    - `get_video_transcript(url?)`: fetches subtitles/transcript and video metadata.
    - `download_media(url?, format?)`: downloads media stream to local workspace.

---

## ⚡ Phase 2: Session & Network Intelligence (Intermediate)

### [x] 5. Session & Cookie Jar Vault (`save_session` / `restore_session`) — ✅ *[COMPLETED]*
- **Priority:** P3 (Persistence & Bypass)
- **Why:** Enables agents to resume authenticated sessions (e.g. GitHub, Google, airlines) without triggering 2FA or CAPTCHAs on every run.
- **Implementation:**
  - Extract session cookies, `localStorage`, and `sessionStorage` via `session.cookies.get({})`.
  - Store encrypted session snapshots in `data/sessions/<name>.json`.
  - MCP Tools:
    - `save_session(name?)`: captures active session and cookies.
    - `restore_session(name)`: injects cookies and rehydrates localStorage.
    - `list_sessions()`: lists available credentials and metadata.

---

### [x] 6. Live Network & XHR/Fetch Stream Interceptor (`read_api_traffic`) — ✅ *[COMPLETED]*
- **Priority:** P4 (High Bandwidth / Superpower)
- **Why:** Modern Single-Page Applications (Skyscanner, Twitter, FlightRadar, Reddit) fetch pure JSON via background APIs. Scraping rendered HTML is 10x slower and loses structured data.
- **Implementation:**
  - Attach to Chrome DevTools Protocol (`webContents.debugger.attach('1.3')`).
  - Enable `Network.enable` and monitor `Network.requestWillBeSent`, `Network.responseReceived`, and `Network.loadingFinished`.
  - Capture and buffer completed XHR/Fetch JSON and document response bodies via `Network.getResponseBody`.
  - MCP Tools:
    - `get_network_traffic({ url_pattern?: string, method?: string, resource_type?: string, limit?: number })`
    - `get_api_payload(request_id)`: returns parsed JSON / formatted text directly to the LLM.
    - `clear_network_traffic()`: resets in-memory request ring buffer.

---

## 🎯 Phase 3: Advanced Cognitive Grounding (Most Exciting)

### [x] 7. Set-of-Marks (Numbered Visual Grounding Badges) — ✅ *[COMPLETED]*
- **Priority:** P5 (Peak Agent Ergonomics)
- **Why:** Eliminates hallucinated pixel coordinates and broken CSS selectors by giving the agent a numbered visual overlay.
- **Implementation:**
  - Inject an ephemeral DOM overlay that scans all visible, interactive nodes (`<a>`, `<button>`, `<input>`, `<select>`, `[role='button']`, `[onclick]`).
  - Draws compact high-contrast neon badges (`[1]`, `[2]`, `[3]`, etc.) directly over the top-left corner of each element.
  - Captures an annotated viewport screenshot and returns a lightweight lookup table:
    ```json
    [
      { "id": 1, "tag": "BUTTON", "text": "Search Flights", "bbox": [120, 340, 95, 32] },
      { "id": 2, "tag": "INPUT", "text": "Destination", "bbox": [230, 340, 200, 32] }
    ]
    ```
  - MCP Tools: `take_screenshot(marks:true, detail:"full"|"economy"|"markdown")`, `click_mark(mark_id)`, `type_mark(mark_id, text)`.
  - Guarantees 100% click accuracy with zero ambiguity.

---

### [x] 8. Script Vault & Semantic Macro Engine (`save_script` / `recall_script` / `run_script`) — ✅ *[COMPLETED]*
- **Priority:** P5.5 (Cognitive Automation & Macro Recall)
- **Why:** Allows agents and users to store reusable DOM extraction scripts and page macros, recall them semantically using natural language via LanceDB vector search, and run them with dynamic parameter injection.
- **Implementation:**
  - File persistence in `data/scripts/<name>.json`.
  - Embedded vector indexing into LanceDB `scripts` table for conversational recall.
  - Runtime execution via `runScript(wc, name, args)` with closure isolation.
  - MCP Tools: `save_script`, `recall_script`, `run_script`, `list_scripts`, `delete_script`.

---

### [x] 9. WebSocket & Server-Sent Events (SSE) Stream Interceptor — ✅ *[COMPLETED]*
- **Priority:** P5.8 (Real-Time Duplex Intelligence)
- **Why:** Modern real-time platforms (crypto tickers, chats, live trading, streaming LLMs) transfer data across persistent WebSocket channels (`wss://`) and Server-Sent Events (`text/event-stream`). Normal scrapers miss this completely.
- **Implementation:**
  - Hook into Chrome DevTools Protocol `Network.webSocketFrameSent`, `Network.webSocketFrameReceived`, and `Network.eventSourceMessageReceived`.
  - Maintain an in-memory ring buffer of real-time streams and JSON/text payload frames.
  - MCP Tools: `list_realtime_streams`, `get_stream_messages`, `clear_stream_messages`.

---

### [x] 10. System Tray Integration & Background Minimization — ✅ *[COMPLETED]*
- **Priority:** P5.9 (Desktop Ergonomics)
- **Why:** Allows the cyberdeck browser window to run completely out of the way in the Windows notification tray while the agent operates autonomously in the background, freeing screen real estate.
- **Implementation:**
  - `TrayManager` with high-contrast icon, dynamic context menu, status readouts, and click toggle.
  - Close-to-tray handling (`minimizeToTrayOnClose`).
  - MCP Tools: `set_window_visibility({ visible })`, `configure_system_tray({ close_to_tray })`.

---

### [x] 11. Notification System & Human-In-The-Loop (HIL) Intervention — ✅ *[COMPLETED]*
- **Priority:** P6.0 (Autonomous-Human Synergy)
- **Why:** When agents encounter CAPTCHAs, 2FA, OTP codes, credentials, or security checkpoints, they should halt gracefully, alert the user, summon the browser window, and resume immediately once the human completes the action.
- **Implementation:**
  - `HilManager` with OS native desktop notifications (`Notification`), taskbar amber flashing (`flashFrame(true)`), and auto-window restoration.
  - Interactive floating neon HUD banner injected into the active webpage and cyberdeck renderer with "Resume Agent (Done)" button.
  - MCP Tools: `request_human_intervention`, `resolve_human_intervention`, `get_human_intervention_status`, `send_notification`.

---

## 🧬 Phase 4: Biomechanical Kinematics & Chaos Mathematics (Next-Gen Stealth)

### [x] 12. Bio-Kinematic Chaos & Neuromotor Mouse Engine (`bio_bezier`) — ✅ *[COMPLETED]*
- **Priority:** P6.5 (State-of-the-Art Anti-Bot Immunity)
- **Why:** Sophisticated behavioral anti-bot sensors (Cloudflare Turnstile, Datadome, Akamai, Kasada, PerimeterX) execute Fast Fourier Transforms (FFT), autocorrelation, and jerk derivatives on pointer telemetry. Standard Bézier curves and uniform random noise (`Math.random()`) are mathematically recognizable as synthetic. Real biological motion requires chaos math and neuromuscular physics.
- **Implementation:**
  1. **$1/f$ Pink Noise / Fractional Brownian Motion (fBm):**
     - Replace uncorrelated uniform white noise with an **Ornstein-Uhlenbeck stochastic drift process** (mean-reverting pink noise).
     - Successive tremor offsets correlate with previous steps, perfectly simulating physiological muscle tremors, tendon elasticity, and mousepad micro-friction.
  2. **Asymmetric Log-Normal Velocity & Minimum Jerk Model (Flash & Hogan):**
     - Replace symmetric sine pacing (`sin(t * π)`) with a biologically authentic **asymmetric log-normal velocity profile**.
     - **Ballistic Phase:** Rapid, explosive acceleration covering the first 30–35% of the trajectory.
     - **Sensory Feedback Phase:** Progressive deceleration with fine visual feedback braking over the remaining 65–70%.
  3. **Target Overshoot & Saccadic Micro-Corrections:**
     - Fast pointer sweeps dynamically overshoot the target centroid by 2–8 pixels in the vector of momentum.
     - A 40–90ms saccadic reaction correction loop dampens momentum and pulls the cursor smoothly back into the clickable bounding box before actuating `mouseDown`.
  4. **The Two-Thirds Power Law ($v(t) \propto r(t)^{1/3}$):**
     - Biomechanically couples trajectory curvature to velocity: pointer speed automatically decelerates when traversing tight turns or sharp corners and accelerates along straighter segments.
  5. **Deterministic Chaotic Perturbations (Duffing / Strange Attractor Drift):**
     - Superimposes low-amplitude chaotic attractor equations (or Simplex noise fields) across the Bézier control vectors, producing non-repeating, infinitely organic micro-curvature that defeats machine learning classifiers.

---

## 🧩 Phase 5: Orthogonal Primitive Layer & TIER-1 Harvest Hardening (2026-10-18)

### [x] 13. Orthogonal Primitives (`observe` · `act` · `wait_for` · `expect` · `find` · `extract` · `collect_all`) — ✅ *[COMPLETED]*
- **Priority:** P7 (Reliability & Token Economy)
- **Why:** The flat verb list forced agents into blind sleeps, guessy selectors, and repeated full-page reads. A few orthogonal primitives (one observe model, one action model, one wait model) collapse those into deterministic, context-light calls.
- **Implementation:** `src/main/primitives/primitives.ts` behind a narrow `PrimitivesHost` (implemented by `BrowserChassis`), exposed via `chassis.getPrimitives()` and the `/page-state`, `/wait-for`, `/expect`, `/observe`, `/extract`, `/collect`, `/find`, `/act`, `/diff`, `/network/har`, `/context/*` endpoints. Refs are the existing `data-mark-id` marks. Structured error codes (`STALE_REF`/`TIMEOUT`/`NO_TARGET`/`BAD_REQUEST`/`NOT_SUPPORTED`) map to HTTP 400.
- **Details & recipes:** [`docs/PROPOSED_ABSTRACTIONS.md`](./PROPOSED_ABSTRACTIONS.md), [`kuang_docs/partitions/primitives_and_workflows.md`](../kuang_docs/partitions/primitives_and_workflows.md).

### [x] 14. Focus-Independent CDP Input Delivery — ✅ *[COMPLETED]*
- **Why:** `webContents.sendInputEvent` is dropped by the OS while another window is foreground (silent ~50% flake). Input is now dispatched over the tab's attached CDP debugger (`Input.dispatchMouseEvent`/`dispatchKeyEvent`/`mouseWheel`) with focus emulation enabled; `sendInputEvent` is a fallback only. `bridge_health` reports `input.transport`.

### [x] 15. Occlusion-Proof Background Rendering — ✅ *[COMPLETED]*
- **Why:** An occluded window reports `hidden`, throttles timers to ≥1s, and stops producing frames — so `scroll` events never fire and lazy lists stall. Fixed with `backgroundThrottling: false` + `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` / `--disable-background-timer-throttling`.

### [ ] 16. Deferred Primitive Polish
- **`select` action** on `act` — deliberately excluded because setting a native value is a TIER-3 DOM mutation; the documented marks flow (click trigger → `list_marks` → click option) is the humanlike path.
- **`download` wait condition** — needs a download correlation id.
- **Permission tiers / read-only mode** — needs a policy surface in the MCP client.

### [ ] 17. Live verification backlog — *scheduled 2026-10-25*

Things that are unit-tested or bridge-tested but **not yet verified end-to-end against a real page**:

- **`drive(save_recipe: true)` → replay.** The compiler (`compile.ts`) has 9 offline checks and the
  replay engine has 11 live checks, but the seam between them is unverified: on the fixture,
  `drive` returned `needs_agent` (the guard rejected every option) before reaching `done`, so no
  recipe was produced. Tomorrow: run `drive` on a page where the decision model succeeds, confirm a
  recipe is saved, reload the page, `replay`, and assert the end state.
- **Consent inside a real CMP iframe.** Sourcepoint/Quantcast are covered by a local cross-origin
  fixture; the Guardian now redirects to an ad-lite page, so no live CMP was exercised after
  Phase 3. Pick a site that still ships a same-origin-reachable CMP and confirm `frame: "child"` with
  `delivery: "cdp"`.
- **Human takeover during a real agent action.** Verified with a real OS click *between* actions;
  still unverified *mid-action* (the click arriving while the trajectory is in flight). Expect the
  grace window to swallow it — confirm whether that is acceptable or needs a stricter signal.
- **`recipe` replay across a page change.** Retirement is wired (3 consecutive failures) but only
  exercised once.

### [ ] 18. Clone Lab (proposal — parked)

- **Priority:** parked (2026-10-25) — revisit only if the read paths prove insufficient.
- **Why:** some closed-root components are easier to *understand* when the risky patch can run
  somewhere disposable. A clone is the right place for the sledgehammer, and the wrong place to
  expect clicks.
- **Shape:** a read-only analysis pass in an **ephemeral partition** — load the same URL in a hidden
  webContents with `attachShadow` forced open at document start, same viewport/DPR, no credentials.
  Walk the now-open roots, report roles/names/text/structure. Never actuate; never write to the live
  session; discard on close.
- **Rejected for now:** a truly *offline* flat render. With scripts off, the components never call
  `attachShadow`, so there is nothing to open; with scripts on, it needs the network and becomes a
  second live load. Slot flattening and scoped-CSS rewriting are their own project and lose fidelity.
- **Open questions before building:** ephemeral partition vs cached assets; auth'd pages; whether a
  structural fingerprint from the clone is worth mapping back to live rects (probably not — live CDP
  already has exact geometry).
- **Decision test:** only build it when a real site defeats AX + focus walk *and* the content is
  valuable enough to justify a second load.

Plan and lever design: [`docs/SHADOW_WALK.md`](./SHADOW_WALK.md).

---

## 📎 Phase 6: Host Browser Connector (proposal)

### [ ] 19. Native Browser Connector MCP — attach to the dev's *real* Chrome + Console

- **Priority:** P8 (Scope Expansion) — unstarted, design not reviewed.
- **Why:** Everything above drives **our** Chrome/Electron chassis: a fresh profile, our flags, our
  partitions. That is the wrong tool when a developer wants an agent to look at what *they* are
  looking at — the tab they are already logged into, the extensions they have installed, the SPA
  served from `localhost:3000` behind their own auth cookies, and the DevTools console errors they
  are trying to debug. Today the agent can only reach those pages by re-navigating the chassis
  browser, which loses the session and the extension state.
- **Shape:** a second, separate MCP surface in **Hypagon Gateway** (its own tool namespace, its
  own consent story) that attaches to a browser the user already runs, instead of launching one.
  - **Attach paths** — pick per platform, cheapest first:
    1. `--remote-debugging-port` on a *dedicated* Chrome profile launched by the user (clean CDP,
       needs a relaunch, doesn't touch their daily profile).
    2. A small unpacked extension that speaks Chrome `debugger` API to a loopback WebSocket
       (no relaunch, works on the daily profile, but needs per-tab user opt-in).
  - **Tool ideas:** `list_host_tabs`, `attach_host_tab(tab_id)`, `get_console({ level })`,
    `get_network_for_tab()`, `evaluate_in_page(expr)` (read-only by default), `screenshot_host_tab`,
    plus the existing primitives (`observe`/`act`/`wait_for`) rebound onto the host tab.
  - **Capture console properly:** `Runtime.enable` + `Log.entryAdded` + `Runtime.exceptionThrown`, with
    the existing ring-buffer pattern so `get_console` is cheap and can be filtered by level/url.
- **Non-negotiables:**
  - **Explicit consent per tab.** Nothing attaches until the user names the tab. Show a visible badge
    in the attached tab; detach on window close, tab navigation to a new origin, or a timeout.
  - **No silent writes.** Default tier is read-only; page mutation (`act`, `evaluate` that assigns)
    is an opt-in escalation per session, mirroring the permission-tier item in #16.
  - **Never point the connector at a browser profile we didn't ask for**, and never reuse host
    cookies for chassis navigations or `save_session`.
  - **Do not expose the host bridge over the remote tunnel** unless the auth story is solved to the
    same standard as the existing remote gateway (see the NASA/JPL review rules in `AGENTS.md`).
- **Open questions:** extension vs relaunch-with-port as the primary path; how much of the existing
  `BrowserChassis` can be reused behind a transport-neutral `TabHost` interface vs a fork; whether
  the console stream belongs in Cortex for later recall; what happens when the user closes the tab
  mid-action.
- **Decision test:** build it only if re-navigating the chassis browser is a real blocker for
  localhost dev pages and for reading console errors — otherwise the existing chassis + primitives
  already cover it.

---

## 🧠 Phase 7: Learned Skills (proposal)

### [ ] 20. Agent-Authored Skills — let the controlling LLM absorb what worked

- **Priority:** P9 (Token Economy & Compounding) — proposal, not scheduled.
- **Why:** The skill corpus is currently **hand-written and frozen**: the `mark-eleven://skills/guide`
  manual, `mark-eleven://tools/recommended`, the OKF manifest and its four partition playbooks are
  string literals in `src/mcp/browser-mcp.ts`, and `.agents/plugins/mark-eleven/skills/mark-eleven/SKILL.md`
  is edited by a human. Meanwhile the server *already generates* the raw material for skills —
  verified `drive` steps compiled into recipes (`compile.ts`), replay retirement after three
  consecutive failures, the script vault (`save_script`/`recall_script`), browsing history and
  Cortex. Every one of those is a solved problem on one origin that is thrown away instead of
  becoming transferable guidance. A controlling LLM that starts each session with only the generic
  manual re-derives the same site-specific moves every time.
- **Shape:** a **promotion pipeline**, not a free-text memory dump. Verified runs are distilled into
  named, scoped, reviewable skill entries that are served through MCP resources and surfaced by
  recall — so the model "absorbs" them by reading a resource, not by carrying context.
  - **Sources of truth:** a recipe or script that succeeded N times (N ≥ 2) on distinct sessions;
    a field-notes doc; an explicit `save_skill` call from the agent or the user.
  - **Tools:** `list_skills({ domain?, scope?, tag? })`, `read_skill(name)`,
    `save_skill({ name, domain, body, source })`, `retire_skill(name, reason)`. Reads return compact
    markdown, not raw JSON, matching the rest of the surface.
  - **Resource surface:** mirror the existing convention —
    `mark-eleven://skills/<domain>/<name>` plus an index at `mark-eleven://skills/index`, so any agent
    in any directory can read them via `list_resources`/`read_resource` without a tool call.
  - **Recall path:** embed each skill into a Cortex table (`skills`, alongside the existing `scripts`
    table) so `recall_memory`/`recall_script` can surface the relevant one for an unfamiliar origin.
    Prefer *suggesting* a skill over injecting it: the agent still decides.
- **Guardrails (these are the actual design work):**
  - **Skills are data, never policy.** A learned skill cannot change TIER ordering, the pin, the
    guard threshold, permission tiers, or any safety rule. It is advice about selectors and
    sequences only.
  - **Untrusted provenance is marked.** Anything distilled from page content is page-controlled text
    and therefore a prompt-injection channel. Keep a `source` field (`recipe|script|human|page`),
    render page-derived skills in a clearly delimited block labelled untrusted, and never let a skill
    authorize a TIER-3 action by itself.
  - **Provenance and confidence are visible** on read: origin scope, the run ids that produced it,
    success/failure counts, last verified date. No anonymous skills.
  - **Scope by origin, not by vibe.** A skill learned on `example.com` applies to that origin (or an
    explicit wildcard the user chose); never silently global.
  - **Retirement mirrors recipes:** three consecutive replay failures retires a skill automatically
    and records why. Stale skills are worse than none.
  - **Human-reviewable corpus.** Entries persist as files under a `data/skills/`-style directory so
    they are diffable and can be promoted into the hand-written manual by a person, not by the
    model rewriting its own instructions.
  - **Bounded growth.** Cap per-origin entries and total size, dedupe near-identical bodies, and keep
    each entry short enough that reading it is cheaper than re-deriving the flow.
- **Open questions:** whether promotion runs at session end, on explicit request, or on the N-th
  successful replay; whether the periodic offline distiller is a second model call and who pays for
  it; how the `skills` table interacts with the existing `scripts` embedder/table; whether a skill
  may be *edited* by the agent at all or only created/retired; how learned skills are synchronized
  between the local app and the remote gateway (or explicitly kept local-only like the wrap server).
- **Decision test:** build it once the same origin is driven more than once in practice and the
  per-session re-derivation shows up as measurable token/latency cost — otherwise recipes + scripts
  already capture the win and a skill layer is just a second cache.

---

## 🧱 Phase 8: Platform Decisions (answered, parked)

### [ ] 21. Tauri port — assessed 2026-10-30, parked

- **Priority:** parked. Do not re-litigate without a new trigger.
- **Question:** port the desktop shell from Electron to Tauri (size, RAM, no bundled Chromium,
  Rust safety, mobile path)?
- **Answer:** Windows-only technically possible, but **not a like-for-like port**. The product is a
  CDP client with a window attached: `webContents.debugger`, focus-independent `Input.dispatch*`,
  `capturePage`, partitions/cookies, `will-download` and per-request header rewriting have no Tauri
  equivalent, and WKWebView (macOS) / WebKitGTK (Linux) have **no CDP at all** — a Tauri build means
  three engines and three behaviour profiles, while behavioural consistency *is* the differentiator.
  The bundled Node MCP servers add a Node sidecar (~50–100 MB) or a Rust rewrite of LanceDB, ONNX
  embeddings, Arrow and `jsdom`. Rough Windows-only MVP: **30–50 person-weeks** before macOS/Linux.
- **Cheap alternatives that keep the benefit:** prune the existing package
  (`npm run prune:pack`), review asar contents, lazy/remote embeddings. The only structural win is a
  **browser-less shell driving an externally launched Chromium over CDP** — the same CDP code as #19,
  and only worth a spike after #19 exists.
- **Revisit triggers:** Windows-only product; Chromium size becomes a hard distribution blocker;
  mobile becomes a requirement; WebView2 ships a *supported, stable* CDP surface; Tauri ships a
  first-class embeddable Chromium.
- **Evidence and estimates:** [`docs/TAURI_PORT_ASSESSMENT.md`](./TAURI_PORT_ASSESSMENT.md) —
  measured surface, per-capability table, effort breakdown, and the 2-week spike recipe if the
  question ever reopens.

