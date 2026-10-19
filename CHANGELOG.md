# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] — 2026-10-19

### Fixed

- **MCP stdio server could vanish mid-session ("kuang goes away").** The server wrote ~500 bytes
  of diagnostics to `stderr` on every tool call. A client that pipes stderr but never drains it
  fills the OS pipe buffer (~64 KiB ≈ ~125 calls) and the child stops answering JSON-RPC while the
  Cyberdeck stays healthy — so the whole `kuang` tool namespace disappeared.
  - Per-call diagnostics now go to the file log only (`data/logs/mcp-server.log`), written through
    a bounded asynchronous queue (no `appendFileSync` in the hot path).
  - `stderr` carries a short boot banner by default. Writes are backpressure-aware: if a write
    returns `false` the channel goes quiet until `drain`, lines are **dropped rather than queued**,
    and total stderr is hard-capped at 16 KiB.
  - The verbose `tools/call` dump was moved off `console.error`.
- **A wedged Cyberdeck could hang a tool call forever.** Every `http://127.0.0.1:4111` round-trip
  now has a timeout ceiling (`KUANG_BRIDGE_TIMEOUT_MS`, default `300000` ms — above any legitimate
  HIL / navigation wait) and returns a clear error instead of blocking indefinitely.
- **Orphaned stdio children.** Closing `stdin` (`end` / `close`) now triggers a logged, clean
  `exit(0)` with a synchronous log flush, so the child can no longer linger and compete for the
  single browser session.

### Added

- **Diagnostics controls:** `KUANG_MCP_LOG=0` (disable the file log), `KUANG_MCP_STDERR=0`
  (disable stderr), `KUANG_MCP_STDERR=verbose` (per-call stderr, debugging only).
- **`KUANG_BRIDGE_TIMEOUT_MS`** to tune the per-round-trip bridge ceiling.
- **[docs/HANDOFF_ORCHA_MCP_STDERR.md](./docs/HANDOFF_ORCHA_MCP_STDERR.md)** — full root-cause
  write-up, the live reproduction, and the conformance checklist for MCP clients.

### Changed

- `npm run build:mcp` now emits **both** `bin/mcp-server.cjs` (canonical) and `scripts/mcp-server.js`
  (used by the test harnesses) so the two bundles can no longer drift out of sync.

### Verification

Live Cyberdeck, `bridge_health` driven 600× through the bundled stdio server:

| Scenario | Before | After |
| :--- | :--- | :--- |
| stderr piped, **never read** | 158 responses, 4 timeouts, stall @ call 157 | **601 responses, 0 timeouts** |
| stderr drained (control) | 601 responses, 0 timeouts | 601 responses, 0 timeouts |
| stderr bytes for 25 calls | ~13 000 B | **0 B** |
| boot banner | logged per call | **199 B, 2 lines** |
| `stdin.end()` | unmanaged | **exit code 0 + shutdown log line** |
| `npm run test:mcp:primitives` | — | **ALL CHECKS PASSED (14)** |

`npx tsc --noEmit` clean.

## [1.1.0] — 2026-10-18

### Added

- **Orthogonal primitive layer:** `observe`, `act`, `wait_for`, `expect`, `find`, `extract`,
  `collect_all`, `page_state`/`diff`, `export_har`, and `context_save`/`open`/`list`/`delete`
  (replace blind sleeps and guessy selectors). 16 new tools, 1 new OKF playbook partition.
- **Focus-independent CDP input:** clicks, typing, and wheel scrolling are delivered over the
  tab's attached debugger (`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `mouseWheel`) with
  focus emulation, so input lands even when another application owns the OS foreground.
  `bridge_health` reports `input.transport` (`cdp` | `native`).
- **Background-render hardening:** `backgroundThrottling: false` plus
  `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` /
  `--disable-background-timer-throttling`, so occluded windows still hydrate, scroll, and fire
  `IntersectionObserver` callbacks.

See [docs/PROPOSED_ABSTRACTIONS.md](./docs/PROPOSED_ABSTRACTIONS.md) for the design and status.

[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
