# Orthogonal Primitives (Observe · Act · Wait · Expect)

The **Primitives** layer (`src/main/primitives/primitives.ts`) is the reliability and
token-economy backbone of Mark Eleven. Instead of dozens of flat procedural verbs that
push agents toward blind sleeps, guessy selectors and repeated full-page reads, it exposes
**a few orthogonal verbs** — one observation model, one action model, one wait model — with
the older tools becoming projections.

Everything here runs on the **TIER-1 humanlike path**: real input events over CDP, no page
DOM mutation beyond Mark Eleven's own `data-mark-id` stamp.

## Architecture

```
BrowserChassis  ──implements──▶  PrimitivesHost (narrow interface)
      │                                  ▲
      │ getPrimitives()                  │ injected probes
      ▼                                  │
  Primitives ────────── evaluateQuiet ───┘
      │
      └── HTTP bridge endpoints (/wait-for, /observe, /act, …) ──▶ MCP tools
```

`BrowserChassis` implements `PrimitivesHost` via an inline adapter (webContents access,
mark injection, click/type, page info, revision, network traffic). `Primitives` owns the
probe scripts, condition evaluation, the revision→state cache, and the delta/diff logic.
`getRevision()` / `bumpRevision()` provide the monotonic page-revision counter.

## Primitives

| Primitive | Job | Endpoint |
| :--- | :--- | :--- |
| `pageState()` | Cheap monotonic state signature (`revision`, `url`, `marks`, `nodeCount`, `height`, `scrollY`, `textLen`, `textHash`) | `POST /page-state` |
| `diff(since)` | Field-by-field diff against a previously observed revision | `POST /diff` |
| `waitFor(conditions, require, timeoutMs, pollMs)` | Declarative readiness gate — the primitive that replaces sleeps | `POST /wait-for` |
| `expect(conditions)` | Immediate assertion (no polling) with per-condition evidence | `POST /expect` |
| `observe(as, region, budget, cursor)` | One budgeted, cursor-paged observation model (`markdown`/`text`/`ax`/`som`/`list`/`table`/`app_data`) | `POST /observe` |
| `extract(kind, ref, selector)` | Structured reads: repeating `list` rows, `table` records, embedded `app_data` | `POST /extract` |
| `collectAll(opts)` | Scroll a lazy/virtualized list to the end and dedupe rows (by text+href) | `POST /collect` |
| `find(opts)` | Semantic element search → mark refs | `POST /find` |
| `act(opts)` | Unified click/focus/hover/type/press + post-conditions + delta report | `POST /act` |
| `trafficSince(since)` / `exportHar(opts)` | Action/revision-correlated network capture + HAR 1.2 export | `/network/traffic`, `/network/har` |

**Refs are marks.** A ref *is* a `data-mark-id` badge id — `find` returns rows carrying the
`mark`, and `act(markId=…)` re-resolves the element's live centre each time.

## Targeting

Three ways to name a target, in order of preference:

1. **`mark_id`** — a Set-of-Marks badge; re-resolved against the live DOM on every act.
2. **`selector`** — CSS, shadow-piercing, resolves a custom-element host to the control a mouse hits.
3. **`target_text`** — the deepest visible element whose own text matches. For controls with no
   semantics at all (React cards: a `<div>` with a handler three levels up, no role/href/onclick).
   Ambiguous matches are refused with `AMBIGUOUS` + candidates rather than clicking blind.

`control-facts.ts` is the shared description behind marks, `find`, the guard and recipes: role,
accessible name, value, state, accepted actions, visibility, **occlusion** (hit-test at the centre of
the *visible* portion), disabled, landmark region and rect. Exposed at `POST /dom/facts`.

`text-target.ts` builds the text resolver; `dom-targeting.ts` owns `kqSafePoint`, which clicks the
visible portion of large cards instead of a geometric centre that may be off-screen.

Reference: [docs/CONTROL_LAYER.md](../../../docs/CONTROL_LAYER.md).

## Wait Condition Vocabulary

`wait_for` and the implicit `act(await_conditions=[…])` share one vocabulary:
`selector` · `gone` · `text`/`regex` · `url` · `role_name` · `count(min/equals/max)` ·
`network_idle` · `stable(marks|height|text|nodes)` · `revision`.

## Structured Errors

New endpoints throw `PrimitiveError` with a stable `code` (mapped to HTTP 400):
`STALE_REF` (re-scan and re-issue), `TIMEOUT`, `NO_TARGET`, `AMBIGUOUS` (text matched more than one
element), `BAD_REQUEST`, `NOT_SUPPORTED`, `HUMAN_IN_PROGRESS` (a person is using the browser;
synthetic input is paused — poll `/human/status`, then re-observe).

## Input Delivery

The action path prefers **CDP** (`Input.dispatchMouseEvent` / `dispatchKeyEvent` /
`mouseWheel`) with `Emulation.setFocusEmulationEnabled`, so it is **focus-independent**.
`webContents.sendInputEvent` is a fallback only. See
[`../telemetry/README.md`](../telemetry/README.md).

## See Also

- [`docs/PROPOSED_ABSTRACTIONS.md`](../../../docs/PROPOSED_ABSTRACTIONS.md) — design + status.
- [`kuang_docs/partitions/primitives_and_workflows.md`](../../../kuang_docs/partitions/primitives_and_workflows.md) — recipes R1–R5.
- `npm run test:primitives` / `npm run test:mcp:primitives` / `npm run test:focus`.
