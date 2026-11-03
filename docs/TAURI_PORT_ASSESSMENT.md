# Tauri Port Assessment — 2026-10-30

**Question:** could Hypagon Gateway be ported from Electron to Tauri, and would it be worth it?

**Verdict:** technically possible on Windows, **not viable as a like-for-like port**, and the concrete
benefits do not apply to the parts that cost us engineering time. Recommendation: **stay on Electron**.
Revisit only under the triggers in [§7](#7-when-to-revisit).

The short reason: this product is not a desktop app that happens to render web pages. It is a **CDP
client with a window attached**. Tauri's central value proposition is *not shipping a browser*, and
the browser is the product.

---

## 1. Measured surface

Numbers taken from the tree on the date above, not estimated.

| Fact | Value |
| --- | --- |
| TypeScript files under `src/` | 96 |
| Lines under `src/` | ~30,400 |
| Files importing from `electron` | 31 |
| Largest core file | `src/main/browser-chassis.ts` — 2,520 lines |
| Primitives layer | `src/main/primitives/primitives.ts` — 1,615 lines |
| HTTP bridge | `src/main/http-bridge.ts` — 1,505 lines |
| CDP commands used | 19 across `Page`, `DOM`, `Runtime`, `Network`, `Accessibility`, `Emulation`, `Target` |
| Shipping native/heavy Node deps | `@lancedb/lancedb`, `@huggingface/transformers` (onnxruntime), `apache-arrow`, `jsdom`, `turndown` |
| MCP entry points | `bin/mcp-server.cjs`, `bin/wrap-server.cjs`, `bin/remote-server.cjs`, `bin/devlogs-server.cjs` (bundled Node CJS) |
| Release matrix | win (NSIS + portable), linux (AppImage + deb), mac (dmg + zip, x64 + arm64) |

---

## 2. Feature-by-feature reality check

| Capability | Electron (today) | Tauri / WebView2 (Windows) | WKWebView (macOS) · WebKitGTK (Linux) |
| --- | --- | --- | --- |
| `webContents.debugger.attach('1.3')` | first-class API, per-`webContents` | no API. Only `--remote-debugging-port` through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` or a registry policy, then a hand-written WebSocket client. Undocumented-ish, and regressions exist (port unreachable when the app runs elevated on recent runtimes) | **no CDP at all** |
| Focus-independent input (`Input.dispatchMouseEvent`) | the basis of the occlusion-proof input story | CDP only, via the above | unavailable; WebDriver only |
| `capturePage` (Set-of-Marks, recording, HIL) | built in | `Page.captureScreenshot` via the CDP path | **no equivalent** |
| `session.fromPartition` + cookie enumeration (`save_session`, `context_*`) | built in | user-data directories only; cookies need CDP `Storage` | no |
| `will-download` interception | built in | WebView2 COM (`ICoreWebView2DownloadStarting`) reached through `with_webview` | no |
| Per-request UA / header rewrite (`webRequest`) | built in | WebView2 COM or CDP `Fetch` | no |
| `Page.addScriptToEvaluateOnNewDocument` | built in | CDP path; `initialization_script` is a partial substitute | init scripts exist |
| Background throttling switches | `app.commandLine.appendSwitch` | partially, via browser arguments | completely different model |
| Tray, taskbar flash, notifications, auto-update | built in | fine (`request_user_attention`, plugins) | fine |

The macOS and Linux columns are the dealbreaker. WebView2 is Edge-only, so a Tauri build means
**three different engines with three behaviour profiles**, while the product's differentiator is
behavioural consistency and stealth. An automation/fingerprint profile tuned on WebView2 says
nothing about WKWebView, and WKWebView cannot be driven by any of the primitives.

The Node surface is the second problem. The MCP servers are bundled Node CJS processes talking to
the loopback HTTP bridge. Tauri has no Node runtime, so each one is either a shipped Node **sidecar**
(≈50–100 MB, evaporating much of the size win) or a Rust rewrite with real blast radius — including
LanceDB (`@lancedb/lancedb`), ONNX embeddings (`@huggingface/transformers`), Arrow, and `jsdom`.

---

## 3. Effort estimate

Windows-only MVP, before macOS or Linux exist:

| Workstream | Estimate |
| --- | --- |
| Rust CDP client: framing, target sessions, event dispatch, reconnect, per-tab attach/detach | 3–5 person-weeks |
| Chassis / tabs / partitions / views behind a new `TabHost` interface | 6–10 |
| Primitives port (injected JS bodies carry over nearly verbatim — the best news here) | 4–6 |
| Set-of-Marks, screenshots, recording | 2–3 |
| Network, WebSocket and SSE interceptors | 2–3 |
| Input simulator + focus independence | 2–3 |
| Sessions, downloads, tray, HIL, context menus, updater | 4–6 |
| Cortex + MCP surface | 1–2 with a Node sidecar · 8–12 rewritten in Rust |
| Re-baselining the ~40 live test scripts against a new engine | 3–5 |
| **Total** | **≈30–50 person-weeks**, Windows only |

Estimates assume one experienced engineer; they are planning ranges, not commitments.

---

## 4. Benefits, honestly weighed

Real:

- installer ~150–250 MB → ~20–40 MB plus sidecar
- faster cold start, lower idle RAM (~200 MB less)
- no bundled Chromium to track for CVEs
- Rust memory safety in the shell and IPC layer
- a genuine path to mobile/Android, if that ever matters

They do not pay for themselves here, because the recurring costs are not Electron's fault: CDP
semantics, anti-bot cat-and-mouse, selector fragility, live-test flakiness. A port **increases** all
four while deleting the moat.

---

## 5. Options considered

**A. Stay on Electron (recommended).** Shave size where it is cheap: keep the `prune:pack` step,
review asar contents, and drop `@huggingface/transformers` from the shipping bundle if embedding can
be lazy or remote. Cost: days. Risk: low.

**B. Browser-less shell + user-supplied Chromium over CDP.** A small Tauri (or slim Electron) window
that drives an externally launched Chromium rather than embedding one. This is the only variant with
a real structural win, and it composes with the host browser connector proposal in
[`docs/TODO.md`](./TODO.md) #19 — it is the *same* CDP code. Costs: lose partition control,
`capturePage`, and download interception; inherit browser version drift and therefore stealth risk.
Worth a spike only **after** #19 exists.

**C. Full Tauri port.** Rejected for the reasons above.

**D. Tauri for the shell only, Chromium for the browser.** Worst of both: two runtimes, two
languages, two IPC layers, unchanged distribution size. Rejected.

---

## 6. The cheap experiment, if it is ever wanted

Two weeks, Windows only, no product code touched:

1. Tauri v2 + WebView2 with `--remote-debugging-port` passed as an additional browser argument.
2. Prove exactly three things on one live tab: `observe(as:"markdown")`, `act(mark_id)`, and
   `take_screenshot(marks:true, detail:"economy")`.
3. Record whether the CDP endpoint survives a normal (non-elevated) launch, a tab navigation, and a
   runtime update.

If those three do not work smoothly, nothing downstream will. Do not start the port on the strength
of this document alone.

---

## 7. When to revisit

Reopen this assessment if, and only if, one of these becomes true:

- the product is declared **Windows-only**, and cross-engine parity stops mattering;
- Chromium's bundled size becomes a distribution blocker (store limits, enterprise policy, installer
  budget) that pruning cannot solve;
- a mobile or Android target becomes a product requirement;
- WebView2 exposes a **supported, documented** CDP surface that is stable across runtime updates;
- Tauri ships a first-class way to embed a controllable Chromium rather than a system webview.

Until then the answer is no, and this document is the reason it will not be re-litigated from
scratch.
