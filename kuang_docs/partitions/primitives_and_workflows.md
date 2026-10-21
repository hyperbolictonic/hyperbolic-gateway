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

**Tier map** (mirrors the `[TIER n]` prefixes on the advertised descriptions): **TIER 1 · prefer** — this whole map (`observe`, `act`, `wait_for`, `expect`, `find`, `extract`, `collect_all`, `page_state`, `diff`); **TIER 2 · fallback** — `take_screenshot`, `snapshot_rendered_page`, `press_key`; **TIER 3 · use deliberately** — `evaluate_javascript` (powerful, just not the default). Every other tool is unprefixed (the only tool for the job).

| Primitive | Job | Returns | Replaces |
| :--- | :--- | :--- | :--- |
| `observe(as, region, budget, cursor, include_offscreen)` | One observation model with projections | `{text, total, offset, next_cursor, truncated}` or structured rows | `get_page_markdown` + `snapshot_rendered_page` + `list_marks` |
| `act(mark_id \| selector \| x+y, action, text, secret, clear_first, await_conditions, timeout_ms, dry_run)` | Unified humanlike action on a mark ref, CSS selector, or coordinates (+ optional post-conditions). `clear_first` replaces a pre-filled value instead of appending | Delta report | `click_mark` / `type_mark` / `click_element` / `type_text` / `hover` + a following `wait_for` |
| `wait_for(conditions[], require, timeout_ms, poll_ms)` | Declarative readiness gate | `{ok, waitedMs, attempts, results[]}` | every `sleep` / "did it load?" guess |
| `expect(conditions[])` | Immediate assertion (no polling) | `{ok, results[]}` with per-condition evidence | agent-side guessing before proceeding |
| `find(role, name, contains, regex, tag, selector, limit)` | Semantic element search → **refs** | rows carrying `mark` ids | hand-written CSS/XPath |
| `extract(kind, ref, selector, limit)` | Structured read: `list` \| `table` \| `tables` \| `app_data` \| `schema_org` (`type` filters JSON-LD by @type) | `{rows}` / `{headers, rows, records}` / embedded JSON / typed JSON-LD items | regex over HTML |
| `collect_all(selector, ref, scroll, max_scrolls, max)` | Scroll a lazy/virtualized list to the end, dedupe rows | rows + scroll diagnostics | a manual scroll-and-harvest sweep |
| `llm_surface(url)` / `llm_fetch(url, as)` | Read a site's *own* Markdown/Text (`/llms.txt`, `<link rel=alternate>`, or negotiation) — **GATED** on an advertised surface | surface report / `{as, url, contentType, bytes, content, via}` | rendering a docs page just to read its text |
| `search_web(query, engine?, engines?, url_template?, max_results?)` | Multi-engine web search in a detached view with automatic fallback | ranked `{rank, title, url, snippet}` | manual SERP navigation |
| `deep_crawl(url, max_depth?, max_pages?, match_patterns?, …)` | Autonomous BFS crawl; distill + index each page to Cortex (cheap `llm` path first) | per-page summary + `cortexIndexed` | turn-by-turn navigate-and-harvest |
| `research_topic(query, max_sources?, …)` | Search → gather top sources → distill → index; **extractive** cited highlights | sources + highlights + `cortexIndexed` | manual search-and-read across tabs |
| `page_state()` / `diff(since)` | Cheap monotonic change signature | state / field-by-field diff | re-reading the whole page |
| `bridge_health()` | Liveness + capability + revision + input transport | `{version, revision, capabilities[], input, window}` | assuming the bridge is up |
| `export_har(pattern, limit, save)` | HAR 1.2 export of captured traffic | HAR JSON or file path | ad-hoc curl replay |

### Observation projections (`observe.as`)
`markdown` (TIER-1 harvest with inline `[#id]` marks) · `text` (innerText, region-scoped) ·
`ax` (accessibility tree) · `som` (numbered marks table) · `list` · `table` ·
`app_data` (embedded `__NEXT_DATA__` / JSON-LD / inline state blobs).

`components` is the decision-ready projection: one line per component with its role, name, value,
state, region (nearest landmark) and the **actions it accepts** — `{click}`, `{type}`, `{select}`,
empty when disabled — grouped under the landmark it belongs to. Ids are mark ids, so a decision
is executed with `act(mark_id=…)` and verified like any other action. A target list for `click`
therefore only ever contains clickable components.

`markdown` reads the **composed** DOM — open shadow roots included, with live form values baked in and
password values reduced to a length — so a web-component form reads as a form, not as empty host tags.
Its envelope states how complete the read is: `reader` (which extraction path produced the body),
`extracted_chars` / `page_chars` (characters of page text, so the ratio means something) and
`shadow_roots`. A partly-visible page says so and points at `text` or `ax`; a page with no text says why.

Use **`budget`** + the returned **`next_cursor`** to page a very large page instead of
truncating it — never let a single read exceed the contraction cap. `markdown` returns a
25,000-character default view (`budget: 0` for the whole construct); `text`/`ax` return everything
unless budgeted. Paging is exact because the construct carries no timestamp — two reads of an
unchanged page are byte-identical.

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

### R6 — Type into a pre-filled field or autocomplete (combobox)
Typing **appends** by default. `clear_first` does a trusted Ctrl+A + Backspace first, so the value is
**replaced** — no synthetic `el.value` write, so React/Vue controlled inputs still update.
```
act(mark_id = origin, action = "type", text = "London", clear_first = true)
```

Autocompletes (React selects that only *commit* on option choice):
```
act(mark_id = origin, action = "type", text = "Lon", clear_first = true)
wait_for(conditions = [{type: "selector", selector = "[role=option]"}, {type: "stable", target = "text"}])
observe(as = "som", region = "<the list>")        # read the option marks
act(mark_id = <option mark>, action = "click")    # COMMIT by clicking the option — free text is often ignored
```

**If a click appears to do nothing, do not just re-click it.** Cheap checks first:
```
diff(since = <revision>)      # did anything move at all?
observe(as = "markdown")      # read the form/validation state — an invalid field blocks submit
expect(conditions = [{type: "selector", selector = "#result"}])
```
A form silently rejected by validation (e.g. a corrupted combobox value) looks exactly like a
dropped click, and re-clicking it forever never helps. Note the transport is usually **CDP**
(focus-independent), so a "lost focus" window is rarely the real cause — check
`bridge_health().input.transport` before blaming focus.

### R7 — Web components: the host is not the control
A custom element (`<faceplate-text-input>`, `<my-text-field>`) is a *wrapper*; the `<input>`
that takes focus and text lives in its shadow root. Selectors now resolve to the control a
mouse would hit, including **through** open shadow roots, so:
```
act(selector = "#email", action = "type", text = "a@b.com", clear_first = true)
act(selector = "my-text-input", action = "type", text = "a@b.com")   # resolves to the inner input
```
Both address the real input. Watch the returned `target.field.tag` — if it is a hyphenated tag
instead of `input`, the selector landed on a host with no control inside (wrong element, or a
closed shadow root) and you should switch to coordinates from a screenshot.
Marks work here too: Set-of-Marks, `find` and `act(mark_id=…)` all traverse open shadow roots, and
`observe(as:"markdown")` badges shadow controls with `[#id]` like any other element.

### R8 — Read it back; a success string is not evidence
`action="type"` is now **verified**: the control's value is read before and after, so a no-op
comes back as `ok:false` with `error.code = "TYPE_NO_EFFECT"`. The `typing` evidence tells you
which failure you have:
- `keydowns = 0` → the input never arrived: the click was occluded or the tab had no layout
  (0×0 viewport). Re-target; don't retype blindly.
- `keydowns > 0` but the value is unchanged → the control **rejects synthetic input**
  (one-time-code/OTP fields and some framework-controlled inputs). Stop retrying and call
  `request_human_intervention`.
For clicks, the equivalent evidence is the returned delta (`urlChanged`, revision, marks) —
never assume a click worked because `ok` is true.

### R9 — the decision loop (optional; only when `decide` is configured)
A decision model picks **which component**; Kuang executes and proves it. One round trip per step:

```
1  observe(as = "components")                      # role, name, value, state, region, actions; ids are mark ids
2  decide(state = <goal + that table>, questions)   # ONE call: operation + targets + is_done, in parallel
3  act(mark_id = <chosen id>, action = <operation>) # verified: box, focus, typing.landed
4  check the delta / typing verdict, then repeat from 1
```

Question set (keep every head narrow — a target list for `click` must only contain clickable components):

```json
{ "operation":   { "type": "choice", "instructions": "What is the next operation?",
                   "criteria": { "click": "Actuate a control…", "type_text": "Type into a field…",
                                 "done": "The goal is already satisfied…", "blocked": "A CAPTCHA, consent or login wall…" } },
  "click_target": { "type": "choice", "instructions": "Which component to click?",
                    "criteria": { "9": "Sign in button", "12": "Reject optional cookies" } },
  "is_done":      { "type": "noul", "instructions": "Does the visible state satisfy the goal?" } }
```

Three rules that matter more than the plumbing:

1. **`choice` takes `criteria`, not `options`.** TypeSafe reports a wrong shape as
   `422 "Upstream request failed: Endpoint is unavailable."` — which looks like an auth failure. It isn't.
2. **Every option needs a real description.** Bare option keys cost accuracy: a local model went 5/10 → 7/10
   with descriptions, and a `blocked` option described as "a wall" stopped being answered as `click`.
3. **Execute the head that matches the chosen operation**, and only when it exists. `done`/`blocked` need no
   target. Never turn an answer into a selector, coordinate or script — it is a component id, nothing more.

`decide` is absent unless a backend is configured. `GET /decisions` returns the last 50 calls (backend,
latency, questions, answers, or the typed failure) so a loop can be inspected after the fact.

**Never trust an answer blindly — guard it, then eliminate.**
```
decide(state, questions, guard = {threshold: 0.55, components}, eliminate = {max_attempts: 3})
  accepted:true   → act(mark_id = target) → verify (delta / typing.landed)
  accepted:false  → exhausted:true, fallback:"agent", reasons[] → YOU decide; no action was taken
```
The guard rejects: confidence below the threshold, a target that was not in the offered list, a target whose
`actions` do not include the operation, and a `done` answer that contradicts the operation. Each rejection
removes that option and re-asks, so the model cannot repeat the same mistake; when the options run out the
call returns `fallback:"agent"`. The ladder is **model → eliminate + retry → agent**. If an `act` afterwards
fails (`TYPE_NO_EFFECT`, no delta), treat the chosen step as wrong: re-observe, pick the next candidate, and
hand over to a human if the page is a wall.

**Who writes the typed text?** Not Jev — it only decides. The **agent** supplies the string (`act(mark_id,
action:"type", text:"…")`), because Kuang ships no generation model. jev-ultrafast embeds a small LLM for
this; ours is the calling agent.

**Human-in-the-loop is a question, not an action.** Ask the model whether a human is required, and let the
runner act on the probability:
```json
{ "handoff":     { "type": "noul",   "instructions": "Does this require a HUMAN — CAPTCHA, 2FA/one-time code, payment, identity check?" },
  "handoff_for": { "type": "choice", "instructions": "What should the human do?",
                   "criteria": { "captcha": "Solve the CAPTCHA", "otp": "Enter the emailed code",
                                 "consent": "Decide the consent prompt", "payment": "Complete payment" } } }
```
```
handoff.noul >= 0.6 → request_human_intervention(reason = handoff_for.choice)
```
The model never calls HIL itself, and the mechanical signals (`TYPE_NO_EFFECT` after the input ladder,
`blocked`, an unchanged delta) stay valid reasons to hand over even when the model disagrees.

**Sensitive gates outrank the model.** Before any model call, Kuang scans the state — and, for guarded
calls, the live page text (`include_page_text`, on by default with `guard`/`eliminate`) — for age-verification
copy ("verify your age/birthday", "birthday to continue", "18 or older", "adult content", "mature content")
and for CAPTCHA / "verify you are human" copy. If found, `decide` returns **HTTP 409 `HUMAN_REQUIRED`** (with
`gate` and the matched lines), spends **no** model call, does not eliminate or retry, and **raises the HIL
request itself**, so the human is actually asked rather than merely advised. A `Date of birth` field in an
ordinary signup form is *not* a gate and does not trigger it.

**If it cannot be determined, the agent decides.** A model answer of `blocked` with no matching gate copy is a
normal decision (with a hint): the agent may call `request_human_intervention` itself, or choose another step.
Human attention is spent only on a boundary Kuang can name and quote.

**Seeing the page.** `decide(include_screenshot: true)` attaches a viewport JPEG as a TypeSafe image asset(resized into its 280–1568 px limits). Caveat: the OpenCode gateway strips the `TypeSafe-Danger-Zone-Images`
header, so images only work when the endpoint is `api.typesafe.ai`; otherwise Kuang retries without the image
and reports that it did. `act` also returns a `warning` when a click target sits behind a gate — a warning,
not a refusal, because a human may have asked for that click.

**Driving a UI.** `drive({goal, values})` runs observe → decide → act in code, one decision call per step,
and stops with a typed status: `done`, `blocked`, `human_required`, `needs_agent`, `failed`, `max_steps`.
`needs_input` asks you for a field's text (Jev never writes it) — supply it in `values` and call again.
`dry_run` plans the first step. The same loop as a runner script: `scripts/drive-example.mjs`. The guarded-call page scan is why this works on `/r/petite`: the component table only shows
"Not Now" / "Verify", while the page says "Verify your birthday to continue".

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
(`observe:v2, wait_for, extract:list,table,app_data, collect_all, find, expect, act, page_state, diff, network_since, export_har, contexts, marks_offscreen, llm_surface, llm_fetch`).

## 8. Known Limits

- `collect_all` dedupes by **text+href**, so a whole-window collect can *undercount* rows
  that share both (scope it with `selector`/`ref` instead).
- A full-body aggregator fallback can produce a very long construct; `observe(as:"markdown")`
  shows the first 25 000 characters and pages the rest with `budget` + `next_cursor`
  (`budget:0` for everything). Nothing is discarded, so fares/rows beyond the default view are
  reachable.
- **Closed shadow roots are unreadable.** Marks, `observe` and `act` all traverse *open* shadow roots; a
  `mode: "closed"` component shows only its host. Use coordinates from a screenshot for those.
- `isLoading` can stay `true` on ad-heavy SPAs — prefer `stable`/`network_idle` over load flags.
- `select` is deliberately **not** an `act` action (setting a native value is a TIER-3 DOM
  mutation). Use the marks flow instead: click the trigger → `observe(as:"som")` → click the option
  (`role=option`/`menuitem`) → re-scan to confirm.
