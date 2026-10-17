# 📋 Kuang Grade Mark Eleven — Agent Roadmap & TODO

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
  - MCP Tools: `take_annotated_screenshot()`, `take_economy_screenshot()`, `list_marks()`, `click_mark(mark_id)`, `type_mark(mark_id, text)`.
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
