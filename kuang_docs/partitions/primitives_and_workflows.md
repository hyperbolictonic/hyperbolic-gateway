# Kuang Grade Mark Eleven: Orthogonal Primitives & Workflow Recipes

This partition documents the **primitive layer**: a small set of orthogonal verbs
(*observe · act · wait · expect · find · extract · collect · state · network · context*)
that the older flat tool list is being consolidated onto. Prefer these for any
non-trivial page: they remove blind `sleep`, remove guessy selectors, and return
compact deltas instead of dumping the DOM.

All primitives run on the **TIER-1 humanlike path** (real input events; no page DOM
mutation beyond Mark Eleven's own `data-mark-id` stamp), so they do **not** trip
`isTrusted: false` bot sensors.

## 1. The Primitive Map

| Primitive | Job | Returns | Replaces |
| :--- | :--- | :--- | :--- |
| `observe(as, region, budget, cursor, include_offscreen)` | One observation model with projections | `{text, total, offset, next_cursor, truncated}` or structured rows | `get_page_markdown` + `snapshot_rendered_page` + `list_marks` |
| `act(mark_id \| selector \| x+y, action, text, secret, await_conditions, timeout_ms, dry_run)` | Unified humanlike action on a mark ref, CSS selector, or coordinates (+ optional post-conditions) | Delta report | `click_mark` / `type_mark` / `click_element` / `type_text` / `hover` + a following `wait_for` |
| `wait_for(conditions[], require, timeout_ms, poll_ms)` | Declarative readiness gate | `{ok, waitedMs, attempts, results[]}` | every `sleep` / "did it load?" guess |
| `expect(conditions[])` | Immediate assertion (no polling) | `{ok, results[]}` with per-condition evidence | agent-side guessing before proceeding |
| `find(role, name, contains, regex, tag, selector, limit)` | Semantic element search → **refs** | rows carrying `mark` ids | hand-written CSS/XPath |
| `extract(kind, ref, selector, limit)` | Structured read: `list` \| `table` \| `app_data` | `{rows}` / `{headers, rows, records}` / embedded JSON | regex over HTML |
| `collect_all(selector, ref, scroll, max_scrolls, max)` | Scroll a lazy/virtualized list to the end, dedupe rows | rows + scroll diagnostics | a manual scroll-and-harvest sweep |
| `page_state()` / `diff(since)` | Cheap monotonic change signature | state / field-by-field diff | re-reading the whole page |
| `bridge_health()` | Liveness + capability + revision + input transport | `{version, revision, capabilities[], input, window}` | assuming the bridge is up |
| `export_har(pattern, limit, save)` | HAR 1.2 export of captured traffic | HAR JSON or file path | ad-hoc curl replay |

### Observation projections (`observe.as`)
`markdown` (TIER-1 harvest with inline `[#id]` marks) · `text` (innerText, region-scoped) ·
`ax` (accessibility tree) · `som` (numbered marks table) · `list` · `table` ·
`app_data` (embedded `__NEXT_DATA__` / JSON-LD / inline state blobs).

Use **`budget`** + the returned **`next_cursor`** to page a very large page instead of
truncating it — never let a single read exceed the contraction cap.

## 2. Refs = Marks

There is no second element-addressing scheme to learn: a **ref** *is* a mark id
(`[#7]` in `observe as=markdown`, the number in `observe(as:"som")`, the `mark` field from
`find`/`extract`). Marks remain the on-the-wire format, so `act(mark_id=…)` / `find → act`
are drop-in. When you have no mark (e.g. an off-list pseudo-element), the **same** `act`
accepts `selector="…"` or `x=`/`y=` coordinates — you never need a separate `click_*` tool.
`act` re-resolves the element's **live** centre from the DOM each time, so a mark stays usable
across layout shifts. Mark ids are re-assigned on every scan — re-scan after the page changes.

## 3. Wait Condition Vocabulary

`wait_for` and the implicit `act(await_conditions=[...])` share one vocabulary:

| Condition | Meaning |
| :--- | :--- |
| `{"type":"selector","selector":".card","visible":true}` | element present (and visible) |
| `{"type":"gone","selector":".spinner"}` | element removed |
| `{"type":"text","text":"Results"}` or `{"regex":"£\\d+"}` | body text contains (regex) |
| `{"type":"url","pattern":"/flights/"}` | URL matches |
| `{"type":"role_name","role":"button","name":"Search"}` | accessible role + name present |
| `{"type":"count","selector":".card","min":5,"equals":10,"max":12}` | element count bound |
| `{"type":"network_idle","quietMs":800}` | no in-flight requests for a quiet window |
| `{"type":"stable","target":"marks\|height\|text\|nodes","holdMs":400}` | lazily-rendered content stopped growing |
| `{"type":"revision","version":N}` | page revision reached (see §5) |

`require:"any"` (default) or `"all"`. **Warning:** skeleton placeholders can satisfy a
naive `selector`/`count` early (e.g. Skyscanner stamps `[data-testid="ticket"]` on
skeletons). Use `stable` (or `count`+`min`) — a single-poll `wait_for` is a common false
positive.

## 4. Structured Errors

New endpoints return a stable machine code (HTTP 400) alongside the message:

| Code | Meaning | Recovery |
| :--- | :--- | :--- |
| `STALE_REF` | the mark/ref no longer resolves | re-scan (`observe`) and re-issue |
| `TIMEOUT` | `wait_for` exhausted its budget | widen `timeout_ms`, loosen conditions, check the diagnostics |
| `NO_TARGET` | nothing matched the selector/ref | verify with `find`, or `observe(region=…)` |
| `BAD_REQUEST` | malformed arguments | fix the call |
| `NOT_SUPPORTED` | capability not negotiated | check `bridge_health().capabilities` |

## 5. Workflow Recipes

### R1 — Harvest a lazy / infinite list (the one that used to stall)
```
collect_all(selector=".result", scroll="container"|"window", max_scrolls=25, max=500)
```
`collect_all` auto-detects the repeating item container, scrolls until three consecutive
scrolls add nothing, and dedupes by **text+href**. It returns scroll diagnostics
(`scrollTop` / `scrollHeight` / `clientHeight` / `visibility`) so a stall explains itself.
For whole-page infinite scroll pass `scroll:"window"`.
Sanity-check with `wait_for([{"type":"stable","target":"marks","holdMs":400}])` first.

### R2 — Act and wait in one round trip
```
act(mark_id=12, action="click",
    await_conditions=[{"type":"url","pattern":"/results"}],
    timeout_ms=15000)
```
Returns what changed (`urlChanged`, marks/revision before/after) so you usually need no
follow-up read. Add `dry_run:true` to resolve the target without acting, and
`secret:true` when typing credentials so the value is `[redacted]` in every log.

### R3 — Authenticated context switch (profiles)
```
context_save(name="airline")     # snapshot cookies + storage now
context_open(name="airline")     # later: restore it (also on another tab)
context_list() / context_delete(name)
```
`context_*` are the profile verbs; the legacy `save_session` / `restore_session` are hidden aliases.

### R4 — Change-detection loop (no full re-reads)
```
s = page_state()                              # {revision, url, marks, nodeCount, height, scrollY, textLen, textHash}
... do something ...
diff(since = s.revision)                      # field-by-field {from,to} for exactly what moved
```

### R5 — Action-correlated network capture
```
get_network_traffic(since="last_action")      # only requests fired by the last mutating action
export_har(pattern="graphql", save=true)      # HAR 1.2 → data/har/har_<ts>.har
```
`since` accepts an epoch-ms timestamp, a **revision**, or `'last_action'`. `get_network_traffic`
also accepts `revision:` for revision-correlated windows.

## 6. Input Delivery & Background Rendering (operational guarantees)

- **Focus-independent input.** Mouse / keys / wheel are dispatched over the tab's
  already-attached CDP debugger (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` /
  `mouseWheel`) and focus *emulation* is enabled, so interactions land **even when another
  application owns the OS foreground**. The legacy `webContents.sendInputEvent` path is a
  fallback only (and only it needs the window focused). Check
  `bridge_health().input.transport` → `"cdp"` (good) or `"native"` (fallback).
- **No background throttling.** Browsing tabs run with `backgroundThrottling:false` plus the
  Chromium switches `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, so an
  occluded window still renders and fires `scroll` events. This is what makes
  lazy-loading harvests work while the Cyberdeck sits behind your editor.
- **Viewport gating.** Real input needs a non-zero viewport. If a fresh/hidden tab reports
  `0x0`, call `set_window_visibility({visible:true})` (and wait for a non-zero viewport)
  before acting. Showing the window is otherwise only needed to make it visible to a human (HIL).

## 7. Discovery

Call `bridge_health()` once per session:
`{status, app, version, revision, capabilities[], window:{visible,focused}, input:{transport}, lastActionAt}`.
`capabilities` advertises which primitives this build negotiated
(`observe:v2, wait_for, extract:list,table,app_data, collect_all, find, expect, act, page_state, diff, network_since, export_har, contexts, marks_offscreen`).

## 8. Known Limits

- `collect_all` dedupes by **text+href**, so a whole-window collect can *undercount* rows
  that share both (scope it with `selector`/`ref` instead).
- A full-body aggregator fallback can exceed the ~25 000-char clamp; fares/rows are still
  present — narrow with `region`/`budget` for a tight read.
- `isLoading` can stay `true` on ad-heavy SPAs — prefer `stable`/`network_idle` over load flags.
- `select` is deliberately **not** an `act` action (setting a native value is a TIER-3 DOM
  mutation). Use the marks flow instead: click the trigger → `observe(as:"som")` → click the option
  (`role=option`/`menuitem`) → re-scan to confirm.
