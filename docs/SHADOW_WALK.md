# Shadow Walk — sealed-content plan

**Status:** approved 2026-10-25. Each phase ships on its own tag; nothing here changes a default
behaviour that the page can detect.

Closed shadow roots and iframes are the last two places where the page can keep content from the
agent. Iframes are solved (see [`SHADOW_DOM_AND_FRAMES.md`](./SHADOW_DOM_AND_FRAMES.md#the-frame-as-content)).
This is the plan for what a closed root hides, and for the levers that are allowed to touch it.

---

## Principles

1. **Read-only first.** The accessibility tree and the DOM domain see closed roots without changing
   the page. They are the default path. Anything that mutates page semantics comes last and is opt-in.
2. **Safe by default, loud when not.** Every capability has a tier: `SAFE`, `VISIBLE`, `RISKY`. The
   risky one is red, confirmed, and shows a persistent chrome chip while it is active.
3. **Per-call opt-in.** A lever is permission, not behaviour: nothing runs unless a tool call asks
   for it (`find(sealed:true)`, `focus_walk`, `frames`).
4. **Never guess.** A component fingerprint narrows the search; the accessibility tree verifies it.
   A control is acted on only after its role/name/rect has been read.
5. **Refuse, don't fall back.** A disabled capability returns a structured error with the path to
   enable it. It never silently does something weaker.
6. **One master switch.** `enabled:false` disables every path below it, regardless of sub-levers.
7. **Read the minimum.** Sealed results carry role, name, state and rect — never input values and
   never text bodies. A password field's *name* is a label; its *value* is not ours to collect. The
   accessibility tree exposes values, so this is stripped deliberately, not by accident.

---

## Quiet by default (the activity budget)

**The walk only happens when a call asks for it.** Navigating, `observe`, `find` without
`sealed:true`, `screenshot`, `bridge_health`, tab switching and idle time perform **zero**
accessibility or DOM-domain enumeration. The page cannot see CDP, but a browser that walks every
document still does fingerprint-shaped work: repeated full-tree reads, CPU spikes, and a pattern no
human session produces. "The page can't tell" is not the same as "it looks normal".

### Lifecycle of one sealed read

1. **Ask.** `find(sealed:true)` or `focus_walk`. Nothing runs before this.
2. **One enumeration per document revision.** `Accessibility.enable` → `getFullAXTree` → one
   `DOM.getDocument({depth:-1, pierce:true})` to learn which nodes live under a closed root. The
   result is cached by `(tab, loaderId)` and by the page revision.
3. **Per call, no full walk.** Filter the cached identity set, then `DOM.getBoxModel` only for the
   nodes that actually matched — capped at 40.
4. **Per click, one node.** Re-measure only the clicked control; rects go stale, identities do not.
   Never re-enumerate to click.
5. **Release.** `Accessibility.disable` after ~1.5 s without a sealed call, unless the domain was
   already on (a real screen reader attached) — then leave it alone. The AX domain is the only
   new global state we introduce.

### Cache and budget

| rule | value | why |
|---|---|---|
| full pierce + AX tree | ≤ 1 per document revision | one question, not a sweep |
| cache invalidation | navigation, 5 s TTL, or an action that bumps the revision | a dialog can create a new root; a page load silently changes everything |
| `getBoxModel` | only matched nodes, ≤ 40 per call | geometry is the expensive part |
| repeat `find(sealed)` within 2 s | cached identities, fresh geometry only for the requested subset (`cached:true`) | an agent loop must not become a scanner |
| rate limit | 6 enumerations / minute / tab → `429 SEALED_RATE_LIMITED` with `retry_after` | bounds pathological loops |
| background scans | none — no timers, no observers, no preload scan | the plan's hard rule |

### Timing and shape

`focus_walk` is a keyboard user by construction: one `Tab` every ~120 ms, stop at the limit, restore
focus. It is not a burst of synthetic keys, and it does not start until the call names a host.

The **force-open patch is the one page-load-time activity**, because it must run before the page's
first script. That is exactly why it is `RISKY`, off by default, and shows a chrome chip while
active. Everything else is demand-driven.

### Verification

The invariant is testable, not aspirational — the metrics registry already counts CDP work:

- reset metrics → navigate → `observe` → `find` (no flag) → `screenshot` → assert `cdp.ax === 0` and
  `cdp.pierce === 0`
- two `find(sealed:true)` calls in a row → the second reports `sealed.cacheHit:true` and adds no
  pierce
- navigate → the next sealed call performs exactly one new enumeration
- exceed the rate budget → `429` with `retry_after`, then recovery
- `focus_walk` cadence asserted from the action ledger (median step gap ≥ 80 ms)

---

## Capability map

| surface | open shadow | closed shadow | iframe |
|---|---|---|---|
| `observe(markdown)` / `extract` | ✅ today | ❌ | ❌ |
| `find` | ✅ today | ✅ **P1** (AX, no mark id) | ✅ via `frames` today |
| `act(x, y)` | ✅ today | ✅ **P1** | ✅ today |
| `act(mark_id)` | ✅ today | ❌ (AX results carry coordinates, not ids) | ❌ |
| type / press | ✅ today | ✅ **P1** (coordinate click focuses inside) | ✅ today |
| `focus_walk` (Tab) | — | ✅ **P2** | — |
| component signature | ✅ **P4** | ✅ **P4** (host surface only) | ✅ **P4** |
| `observe` text from closed roots | — | ❌ (AX has names, not bodies) | ❌ |

`act(mark_id)` inside a closed root is deliberately not planned: an id implies a DOM handle we do
not have, and handing out an id that resolves to a cached coordinate would be a lie the first time
the page scrolls.

---

## Settings — `Settings → Shadow Walk`

A top-level Settings tab with a vertical rail on the left:

```
Overview | Shadow DOM | Iframes | Clone Lab
```

**Overview** — master switch, live status for the active tab (sealed controls found, frames present,
patch active), and a **detectability test** button that runs the closed-root probe in the current
page and reports what a fingerprinting script would see.

Each lever shows a tier badge and one line of plain language. Risky levers are red, need a confirm,
and take effect on the **next navigation** (the patch is injected at document start).

### Schema and defaults

```jsonc
{
  "enabled": true,
  "shadow": {
    "deepOpenRoots": true,        // SAFE   — existing deep scan, open roots only
    "axSealed": true,             // SAFE   — closed roots via Accessibility + box model
    "componentSurface": true,     // SAFE   — host part/exportparts/css vars → signature
    "tabWalk": true,              // VISIBLE— trusted Tab stepping; moves focus
    "tabWalkMaxSteps": 8,
    "tabWalkRestoreFocus": true,
    "cdpStyleMatch": false,       // COST   — CSS.getMatchedStylesForNode per sealed control
    "partHighlight": false,       // VISIBLE— injects ::part outlines (page-visible CSS)
    "forceOpen": false            // RISKY  — attachShadow({mode:'open'}) at document start
  },
  "frames": {
    "geometry": true,             // SAFE   — frame tree + rects
    "controls": true,             // SAFE   — in-frame control facts
    "screenshots": true,          // SAFE   — crops on request; costs one capture
    "maxFrames": 6,
    "maxControls": 40,
    "screenshotMaxSide": 1024
  },
  "cloneLab": { "enabled": false } // proposal only; see docs/TODO.md
}
```

Environment kill-switches remain for CI and headless runs: `KUANG_SHADOW_WALK=off`,
`KUANG_FORCE_OPEN_SHADOW=1` (never in a preset).

Settings are written **over IPC only** (no HTTP route). The bridge reads the same store and enforces
it. `bridge_health` reports a compact `shadowWalk` block so an agent can see what is allowed before
it asks.

### Tiers

| tier | meaning | levers |
|---|---|---|
| `SAFE` | read-only; the page cannot tell | `deepOpenRoots`, `axSealed`, `componentSurface`, all `frames.*` |
| `VISIBLE` | the page or the human can see the effect | `tabWalk` (focus ring moves), `partHighlight` (CSSOM) |
| `COST` | safe but expensive enough to be opt-in | `cdpStyleMatch` |
| `RISKY` | changes page semantics and is detectable | `forceOpen` |

---

## Phases

### P1 — `1.4.90` AX sealed discovery

- `src/main/shadow-walk/ax-controls.ts`
  - `Accessibility.enable` + `getFullAXTree`; keep interactive roles (`button`, `link`, `textbox`,
    `searchbox`, `combobox`, `checkbox`, `radio`, `switch`, `tab`, `menuitem`, `slider`,
    `spinbutton`), skip `ignored`.
  - One `DOM.getDocument({depth:-1, pierce:true})` to build the set of `backendNodeId`s under
    `shadowRootType:"closed"` (same call proves the root exists). Bounded by node count; opt-in.
  - `DOM.getBoxModel({backendNodeId})` per candidate → rect in viewport pixels (subtract
    `Page.getLayoutMetrics` page offsets, as `frames.ts` does).
  - Map role → actions; carry `name`, `disabled`, `focused`, `focusable`.
- `find {sealed:true}` adds a `sealed` array (`role`, `name`, `rect`, `actions`, `source:"ax"`),
  separate from `marks` so nothing pretends to have a mark id. Text output prints `@ (x, y)`.
  **`value` is never populated for sealed controls** (AX exposes field values; a password or card
  number is not a fact we are allowed to collect).
- Identity cache keyed by `(tab, loaderId, revision)` with a 5 s TTL, plus the 6/minute rate limit
  above. Metrics: `cdp.ax`, `cdp.pierce`, `sealed.scan`, `sealed.cacheHit`, `sealed.nodes`.
- Clicking is `act(x, y)`; typing is `act(x, y, action:"type")`. Add **Ctrl+A + Delete** (trusted
  keys) for `clear_first` on coordinate targets — it works inside a closed root where DOM
  clearing cannot.
- Tests (`scripts/test-sealed.mjs`, live): closed-root fixture with a button and a text input.
  Assert AX finds both with real rects; a click is recorded by the component; typing changes the
  value; **the page's own `shadowRoot` probe still returns null** (we changed nothing). Plus the
  quiet-by-default assertions: no AX/pierce on navigate/observe/find/screenshot, a cache hit on the
  second sealed call, one new enumeration after navigation, and 429 past the budget.
- Docs: matrix row, `SHADOW_DOM_AND_FRAMES.md` closed-root section.

### P2 — `1.4.91` Tab walk (`focus_walk`)

- `src/main/shadow-walk/tab-walk.ts`: start from a host (mark/selector/point), dispatch trusted
  `Tab` / `Shift+Tab`, read the focused AX node after each step (`focused:true`), stop at the step
  limit or when focus leaves the host's AX subtree.
- Returns `{steps:[{index, role, name, rect}], landed, restored}`. `restore:true` returns focus to
  the start on failure. Human-like by construction: it is a keyboard user, one step every ~120 ms
  (the input profile's cadence), never a burst, and it stops at the call's step budget.
- Tests: step into a `delegatesFocus` closed root, confirm the focused node is the inner button,
  `Enter` activates it; limit, restore and median step gap verified.

### P3 — `1.4.92` Settings surface + enforcement

- `src/main/shadow-walk/settings.ts` (load/save/validate, defaults above) + IPC in `index.ts` /
  `preload`; no HTTP write route.
- Renderer: `SHADOW WALK` tab, vertical sub-tabs, tier badges, confirm flow for `forceOpen`,
  detectability test, chrome chip while a risky lever is active.
- Enforcement in every entry point: `find(sealed)` → `SEALED_DISABLED`; `frames` → `FRAMES_DISABLED`;
  `focus_walk` → `TAB_WALK_DISABLED`; master off → `SHADOW_WALK_DISABLED`.
- `bridge_health.shadowWalk` status.
- Tests: persistence, master kill switch, structured refusals, contract test for new routes.

### P4 — `1.4.93` Component fingerprints + recipe anchors

- `src/main/shadow-walk/component-signature.ts`: `{tag, defined, part[], exportparts, cssVars[]}`
  read from the **host** (page-visible by design) → `signature` string + short hash. Attached to
  `find`/`observe` results.
- Recipes: optional `signature` on a step; compiler records it; replay prefers it over a raw
  position, and retires with **`SIGNATURE_MISMATCH`** (a reason, not a silent miss) when the
  component's surface changes.
- `partHighlight` (off): inject outlines for exported parts before a screenshot; flagged VISIBLE
  because the rule appears in `document.styleSheets`.
- `cdpStyleMatch` (off): `CSS.getMatchedStylesForNode` for sealed controls, reporting `sourceURL`
  and `constructed` when present. Low hit rate on bundled apps; built only behind the lever.
- Tests: signature stable across re-render, changes when `part` names change; recipe replays after a
  re-skin and retires after a structural change.

### P5 — `1.4.94` Force-open patch (RISKY, last)

- `src/main/shadow-walk/force-open.ts`: when enabled, inject at document start in the **main world**
  (`Page.addScriptToEvaluateOnNewDocument`) on the tab's navigation; remove when disabled; applies
  on the next load.
- The patch is intentionally plain (no `toString` forgery): it is honest about being detectable.
  The structural probe (`attachShadow({mode:'closed'}).shadowRoot === null`) catches it no matter
  what, and pretending otherwise only adds breakage.
- HUD: red `SHADOW PATCH` chip for the tab; Settings shows the warning inline; the detectability
  test reports `patch detectable: yes`.
- Tests: after reload, marks/find/observe see closed content; page probe says detectable; disabling
  + reload restores `shadowRoot === null`.
- Docs: what it breaks, why it is last, when to use it instead of P1.

### P6 — Clone Lab

Proposal only, tracked in [`docs/TODO.md`](./TODO.md) item 18. Read-only analysis in an ephemeral
partition; not an actuation path.

---

## Architecture

```
src/main/shadow-walk/
  settings.ts            defaults, validation, IPC-backed store
  ax-controls.ts         AX tree → control facts + live rects (P1)
  tab-walk.ts            trusted Tab stepping + AX focus confirmation (P2)
  component-signature.ts host exported surface → stable signature (P4)
  force-open.ts          document-start patch, per-tab (P5)
  README.md              subsystem reference
```

All of it composes with what exists: `control-facts.ts` (description shape), `frames.ts` (viewport
rects, DPR-aware cropping), `primitives.ts` (`find`/`act`), `recipes` (signature anchors),
`metrics.ts` (`cdp.ax`, `cdp.pierce`, `sealed.scan`, `sealed.cacheHit`, `tabwalk.steps`).

---

## Detection model (what the page sees)

| lever | page-visible evidence |
|---|---|
| AX tree / DOM pierce | none — passive CDP, no JS API exposed |
| `find(sealed)` coordinate click | a normal trusted pointer event |
| `focus_walk` | trusted focus/key events, i.e. a keyboard user |
| `partHighlight` | a new rule in `document.styleSheets`, `getComputedStyle` outlines |
| `forceOpen` | `shadowRoot !== null` on a closed root; patched `attachShadow` descriptor |
| Clone Lab | a second navigation, cookies/timing — which is why it uses an ephemeral partition |

---

## Rollout

Each phase: `npx tsc --noEmit`, `npm run test:mcp:contract`, `npm run check:no-local-paths`, its own
live suite, changelog entry, tag. The settings tab ships in P3, after both read paths exist, so no
lever is a dead switch for a release.

---

## Open questions (resolved during P1's probe)

- Does `getFullAXTree` include same-process iframe content, or only the current document?
- Does `DOM.getBoxModel` accept a `backendNodeId` inside a closed root without `resolveNode`?
- Nested closed roots: does the AX parent chain let `focus_walk` detect "left the component"?
- How does the AX tree report shadow content that is visually hidden (`display:none` in the root)?
