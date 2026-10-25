# Shadow DOM & iframes — what Kuang can see and click

Two different problems that get confused because both "hide" content:

- **Shadow DOM** is a *same-document* boundary. Open roots are readable and clickable; closed roots
  are not, by design.
- **Iframes** are *separate documents* (often cross-origin). The top frame cannot read them with
  `executeJavaScript`; frames need their own execution context.

| surface | open shadow DOM | closed shadow DOM | iframe (same-site and cross-site) |
|---|---|---|---|
| `observe(markdown)` | ✅ composed DOM | ❌ | ❌ main frame only |
| Set-of-Marks / `find` | ✅ marks inside roots | ✅ `find(sealed:true)` (coordinates, no mark id) | ✅ `find(sealed:true)` + `frames` |
| `act(mark_id / selector)` | ✅ resolves the inner control | ❌ (sealed results carry coordinates) | ✅ 100+ frame mark ids (`find(include_frames:true)`) |
| `act(target_text)` | ✅ (composed text) | ❌ | ❌ |
| `act(x, y)` | ✅ | ✅ (pixels are pixels) | ✅ |
| `frames` — text | ✅ controls in frames | ✅ via `find(sealed:true)` | ✅ **frame as content** |
| `frames` — screenshots | ✅ | ✅ (pixels are pixels) | ✅ |
| `focus_walk` (Tab) | — | ✅ trusted entry + AX confirmation | — |
| component signature | ✅ find/observe (host surface) | ❌ sealed results | ❌ frame results |
| `evaluate` | ✅ | ❌ | ❌ |
| `evaluate {frames:true}` | ✅ per frame | ✅ when the demonstrated effect is inside the root | ✅ |

A control sealed inside a closed root or an iframe is still addressable **by pixels**. `frames`
computes iframe pixels; `find(sealed:true)` computes closed-root pixels through the accessibility
tree. Everything else is main-document only, on purpose.

---

## Shadow DOM

### Discovery

The marks scanner does not use `document.querySelectorAll` on its own. It collects **roots** first:

```ts
const collectRoots = (root) => {
  roots.push(root);
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) collectRoots(el.shadowRoot);   // open roots only
  }
};
```

Every interactive selector then runs in **each** root, so a `<button>` inside a web component is a
first-class candidate with its own mark id (`src/main/marks/marks-overlay.ts`).

### Resolution

`kqDeep(selector)` searches the document and every open root. When a selector matches a
custom-element **host**, `targetBoxScript` resolves it to the control a mouse would actually hit —
the inner `<input>`, not the wrapper.

This matters for typing: focusing a host either moves focus off the inner input or does nothing, and
the keystrokes then go nowhere. That failure is documented in
[`FIELD_NOTES_2026-10-20_SIGNUP.md`](./FIELD_NOTES_2026-10-20_SIGNUP.md); `act` now focuses the
*resolved control* and reports what actually received focus.

### Hit-testing

`document.elementFromPoint()` returns the shadow **host**, never the inner element. A naive occlusion
check therefore marks every shadow control as "covered" and drops it. `kqAtPoint()` walks down through
open roots to the deepest hit, and containment checks use `kqContainsComposed()` — because
`el.contains()` does not cross a shadow boundary.

### Reading

`observe(as:"markdown")` renders the **composed** DOM: open roots, live form values, passwords as a
length only. The envelope reports `shadow_roots` so you can tell how much of the page came from
components.

`POST /dom/facts {deep: true}` (and the `frames` tool) use the same root walk, so a web component's
inner control appears in control facts and not just in marks. Deep mode also fixes the two things
that break inside a root: hit-testing descends via `shadowRoot.elementFromPoint`, and containment
uses a composed walk instead of `el.contains()`.

### Closed roots (1.4.91)

`find {sealed:true}` adds a `sealed` array to the normal result. It contains closed-root controls
with a **role, name, rect and actions** — no mark id and no input value:

```jsonc
// POST /find {"sealed": true, "contains": "Pay"}
{
  "marks": [ /* open/light DOM refs as before */ ],
  "sealed": [{
    "role": "button",
    "name": "Sealed Pay",
    "rect": { "x": 18, "y": 8, "width": 89, "height": 21 },
    "actions": ["click"],
    "source": "ax",
    "frameId": "…",
    "frameUrl": "https://pay.example/checkout",
    "inViewport": true
  }],
  "sealedTotal": 1,
  "sealedCached": false
}
```

How it stays honest:

- **Discovery is not page JavaScript.** `Accessibility.getFullAXTree` names the controls;
  `DOM.getDocument({pierce:true})` (and `DOM.describeNode` on each frame owner) proves they live
  under a `shadowRootType:"closed"` root; `DOM.getBoxModel` measures them. The page's own
  `shadowRoot` probe still returns `null`.
- **Per frame.** Same-process children use `getFullAXTree({frameId})`; cross-site children use
  their own target session, and the target root's top-level rect composes the coordinates.
- **Hidden semantics come from AX for free.** `display:none`, `visibility:hidden` and
  `aria-hidden` controls are absent. Zero-size controls are dropped; offscreen ones are returned
  with `inViewport:false` and a short-lived `token` (`st_…`) accepted by `act(sealed_token)`,
  which scrolls the real node into view and re-measures it before clicking.
- **Quiet by default.** Nothing scans on navigation, observe, plain `find`, screenshot or idle.
  The first call costs one AX tree + one pierce per frame set; identities are cached by document
  revision for 5 seconds, and a repeat call only re-measures the matches. Six full scans per
  minute per tab is the ceiling (`429 SEALED_RATE_LIMITED` with `retry_after`). The AX domain is
  enabled for the scan and disabled again immediately.
- **Values never leave.** AX exposes field values (`value:"hunter2"` was observed in the probe);
  the result deliberately omits them.
- **Acting is coordinate-based.** `act(x, y)` clicks, `act(x, y, action:"type")` focuses and types,
  and `clear_first` uses trusted Ctrl+A + Delete — which works inside a closed root where page JS
  cannot clear the field. The typing verdict reports `unobservable` rather than falsely claiming
  the value did not change.

### Entering a closed root (focus_walk)

`focus_walk` presses real `Tab`/`Shift+Tab` keys from a light-DOM host and reads the accessibility
tree after each step to see which inner node actually has focus:

```jsonc
// POST /focus_walk {"selector": "#checkout-host", "max_steps": 6}
{
  "started": true,
  "landed": true,
  "reason": "left-host",
  "steps": [
    { "index": 1, "role": "button", "name": "Pay now", "rect": { "x": 18, "y": 8, "width": 89, "height": 21 }, "gapMs": 213 },
    { "index": 2, "role": "textbox", "name": "Card number", "rect": { … }, "gapMs": 198 }
  ],
  "medianStepGapMs": 205,
  "restored": false
}
```

- `document.activeElement` retargets to the host for a closed root, so AX is the only honest focus
  oracle. `RootWebArea` also reports `focused:true`; it is filtered out.
- Starting focus uses `DOM.focus` with a page-side `focus()` fallback (needed by some
  `delegatesFocus` hosts).
- A `delegatesFocus` host is already on its inner control when focused; that appears as `index: 0`.
- Stops on `left-host`, `max-steps`, `no-focus`, or `not-focusable`.
- Human cadence: one key event per step, a 90-140 ms dwell, median reported as `medianStepGapMs`.
- On failure, focus returns to the host (`restored:true`).
- To activate the landed control, call `act(action:"press", text:"Enter")`.

### Component signatures (1.4.94)

A mark from `find`/`observe(as:"components")` carries the nearest custom-element host's exported
surface. The same surface is attached to sealed controls (read from the light-DOM host through CDP)
and to `frames`/frame-mark controls (read in the frame):

```jsonc
{
  "tag": "pay-widget",
  "defined": true,
  "part": ["card"],
  "exportparts": ["button:pay-button", "label:pay-label"],
  "cssVars": ["--brand", "--radius"],
  "signature": "pay-widget:3640e0c6"
}
```

`part`, `exportparts` and the custom-property names are sorted and normalised before the hash, so
attribute order and re-renders do not change the signature. A renamed part or a different exported
surface does.

Recipes store the signature on a step. Replay verifies it **before** acting:

- unchanged surface → the step proceeds
- changed surface → `409 SIGNATURE_MISMATCH`, and the recipe is retired immediately instead of
  burning three attempts
- `componentSurface` off in Settings → `409 SIGNATURE_UNAVAILABLE` (not a silent click)

Limits: signatures are read from the **host**, so they cover page-visible hosts. Sealed and iframe
controls carry the same surface. `partHighlight` and `cdpStyleMatch` are described below.

### Limits

- **Closed roots are invisible to page JavaScript.** `element.shadowRoot` is `null` for
  `attachShadow({mode:'closed'})`. Discovery is CDP-only, and `observe`/`evaluate` still cannot
  read the root's text or values.
- Shadow content is **not** flattened into `observe(as:"text")` regions the way it is for markdown.
- `find(sealed:true)` returns coordinates, not mark ids: an id would imply a DOM handle that does
  not exist. Re-run `find` after a layout change; offscreen controls get a short-lived token that
  `act(sealed_token)` can scroll and re-measure.
- CSS `selector` filtering is not available for sealed controls (there is no page-side selector
  engine that can see them); use `name`, `role`, `tag` or `contains`.

---

## Iframes

### The boundary

`webContents.executeJavaScript` runs in the **top frame only**. An iframe is a separate document with
its own globals; a cross-origin one cannot be reached from the parent at all.

### `evaluateInFrames`

```ts
evaluateInFrames(wc, expression, { maxFrames?, timeoutMs?, includeBlank? })
  -> Array<{ frameId, url, name, ok, value?, error? }>
```

Walks the CDP frame tree and evaluates the expression in **each frame's own isolated world**
(`src/main/browser/frame-eval.ts`). Bounds: 8 frames by default (max 32), 1500 ms per command,
isolated-world contexts cached and invalidated on `did-start-loading`, blank frames skipped, failures
reported per frame instead of thrown.

Measured: ~20 ms of frame traversal for a page with one child.

### The frame as content

Knowing that an iframe exists is not the same as being able to do anything with it. `POST /frames`
(MCP `frames`) answers the three questions a blank box cannot:

1. **Where is it?** — content-box rect in top-level viewport pixels.
2. **What is inside it?** — its controls, described by the same control-facts expression as marks,
   with their rects already offset into the page.
3. **What does it look like?** — optionally, a cropped screenshot per visible frame.

```jsonc
// POST /frames {"include_controls": true, "screenshots": true}
{
  "viewport": { "width": 1280, "height": 601 },
  "frames": [
    { "depth": 0, "url": "https://shop.example/checkout", "rect": { "x": 0, "y": 0, "width": 1280, "height": 601 } },
    {
      "depth": 1,
      "url": "https://pay.example/frame",
      "crossOrigin": true,
      "rect": { "x": 323, "y": 142, "width": 400, "height": 200 },
      "controls": [
        { "tag": "button", "name": "Pay now", "actions": ["click", "hover"],
          "rect": { "x": 331, "y": 222, "width": 89, "height": 21 }, "visible": true, "occluded": false }
      ]
    }
  ],
  "images": [{ "url": "https://pay.example/frame", "width": 600, "height": 300, "mimeType": "image/jpeg" }]
}
```

The control's `rect` is a **page coordinate**, not a frame coordinate: `act(x: 376, y: 233)` clicks it,
and that is verified in the live test — the child document records the click.

**How the geometry is derived.** CDP gives the frame tree and each frame's owner element
(`DOM.getFrameOwner`). The owner is resolved in its *parent's* document and measured with
`getBoundingClientRect()`; the parent's own origin is added. That is why it works cross-origin: the
iframe is unreachable, but the `<iframe>` element belongs to the parent, which is not. Because
parents come before children in the tree, nested frames compose instead of falling back to
"in-frame activation".

**Cross-site frames (1.4.90).** Chromium omits an out-of-process iframe (a different *site*, not
merely a different origin) from the parent's `Page.getFrameTree`; it appears only as an `iframe`
target. `src/main/browser/frame-tree.ts` attaches those targets
(`Target.attachToTarget({flatten:true})`), reads each target's own frame tree, keeps only targets
whose parent is a frame in this tab, and detaches the sessions in `finally`. `FrameInfo.oopif`
marks the frame and `targetId` names the target; evaluation creates its isolated world on that
session. Geometry is still measured through the parent's owner element, so the top-level rect is
identical to a same-site frame. The live suite serves the child from `127.0.0.2` while the page
stays on `127.0.0.1`, keeping the OOPIF path covered.

**How the screenshots are made.** One viewport capture, then `nativeImage.crop()` per visible frame
(clamped to the viewport). The device-pixel ratio is derived from the captured image rather than
assumed, so a 1.5× display yields a 600×300 crop of a 400×200 frame. One capture for N frames is
cheaper than N CDP clips, and it avoids the page-vs-viewport coordinate ambiguity in
`Page.captureScreenshot`.

**Cost.** Opt-in, four CDP commands per frame plus one evaluate. `screenshots` adds one capture and
one crop per visible frame. Both are bounded: 6 frames by default, 16 max.

### What uses it

**Consent** is the first consumer, in stages:

1. top-document scan (one evaluate — the common case)
2. only if that finds nothing *and* the page embeds an `<iframe>`, the same scan runs in each frame
3. the match is clicked at **top-level coordinates** (iframe rect + local centre), so it remains a
   trusted CDP click
4. if the offset cannot be derived (nested frame, dynamic `src`), the control is activated in-frame
   and the result says `delivery: "in-frame"` rather than pretending

### The isolated-world gotcha

An isolated world **shares the DOM but not page globals**. `window.__anything` set by the page is
invisible inside it; attributes, text and computed styles are readable. Tests and features must
assert on DOM state, not on page variables — this cost a debugging round during Phase 3.

### Frame control marks (1.4.97)

`find {include_frames:true}` stamps and returns child-frame controls with **100+ mark ids**
(`100 + child_index * 100`, 99 ids per frame). `act(mark_id)` and `type_mark` resolve them live:
the element is found by `data-mark-id` inside its frame, scrolled into view, measured, and the
frame's top-level rect is added before the humanized click.

- Same-site and cross-site (OOPIF) frames both use `evaluateInFrames`.
- `frames` exposes the same `id` on each control.
- `observe(as:"som"|"components", include_frames:true)` merges the same marks/components; the
  decision loop can now see iframe affordances alongside page ones.
- Main-frame marks remain 1–99; the blocks never collide.
- `find` without `include_frames` is unchanged (main-frame only). `extract` remains main-frame only.

### Visual / style provenance (1.4.101)

- **`partHighlight`** (VISIBLE, off) collects `part`/`exportparts` from open shadow hosts, injects
  `tag::part(name){outline:…}` only for the duration of one screenshot, then removes the style.
  Closed roots are not enumerable by page JS; force-open or sealed discovery is the separate path.
- **`cdpStyleMatch`** (COST, off) captures `CSS.styleSheetAdded` headers and runs
  `CSS.getMatchedStylesForNode` for sealed controls. Each result may carry
  `style: {sourceUrl, constructed}`; bundled apps often report no URL, so the fields are optional.

### Limits

- **`observe`/`extract` are main-frame only.** `find` is main-frame by default; pass
  `include_frames:true` for 100+ mark ids, and `act(mark_id)` resolves those frame ids live.
- An iframe inside a **closed shadow root** has no reachable owner element, so it gets no geometry and
  no separate crop. It still appears in a full-page screenshot as pixels.
- Geometry is origin + offset. A **CSS transform on the iframe** (scale, rotate, 3D) invalidates that
  assumption; the reported rect is the axis-aligned box, and clicks land on the un-transformed offset.
- `clear_first` on a coordinate type cannot see inside the frame (the active element is read from the
  top document), so it is a no-op there. Select-all + delete with `press` is the workaround.

### What to do today

| need | approach |
|---|---|
| read text inside an iframe | `POST /evaluate {frames:true}` |
| see what an iframe looks like | `frames {screenshots:true}` — one image per frame |
| list and click a control inside an iframe | `frames` → `act(x, y)` at the reported control centre |
| type into an iframe control | `act(x, y, action:"type", text:…)` — the click focuses the frame's field, then keys go there |
| answer a consent wall in an iframe | `dismiss_consent` — it does the offset math |
| automate a whole flow inside an iframe | `frames` + coordinate acts; marks are main-frame only |

---

## What remains

Closed roots, frames, Tab entry, signatures, frame mark ids and force-open are shipped. Remaining
work is polish/optimization:

1. **Clone Lab** is still a proposal ([`TODO.md`](./TODO.md) item 18).
2. `extract` is still main-frame only; `observe(as:"som"|"components")`, `find(include_frames)` and
   frame mark ids cover the observation/targeting paths.

Force-open is the one detectably risky path: off by default, opt-in per run, confirmed in Settings,
and called out by a red chip. See [`SHADOW_WALK.md`](./SHADOW_WALK.md).

Coordinates stay the contract for sealed content: an id would imply a DOM handle that does not exist.
The delivery plan, the settings levers, and the risk tiers live in
[`SHADOW_WALK.md`](./SHADOW_WALK.md).

## Tests

`npm run test:tabwalk` is the keyboard fixture:

- a closed root with two buttons and an input; trusted Tab enters it and AX confirms each inner
  control
- stops when focus leaves the host (`left-host`) or at `max_steps`
- Enter activates the landed button
- Shift+Tab goes backward; a failed walk restores focus to the host
- a `delegatesFocus` host reports the inner control as the initial step
- median step gap ≥ 80ms (a keyboard user, not a burst)

`npm run test:shadow` (live) and `npm run test:shadow:unit` cover the settings gate: defaults,
clamping, corrupt-file fallback, the `KUANG_SHADOW_WALK=off` kill switch, every structured refusal,
the master switch, output suppression and cap enforcement.

`npm run test:dom` covers the general control/frame surface:

- a clickable `div` with an inline handler and no role
- occlusion (covered button), disabled control, hidden input
- `act(target_text)` on a semantics-free element, and the ambiguity refusal
- **cross-site iframe**: consent answered with `frame: "child"`, `delivery: "cdp"`, and the child's
  DOM confirms the click landed
- frame evaluation reads a cross-site (OOPIF) child, reports per-frame errors, skips blank frames
- **frame geometry**: `frames` reports the child's top-level rect, describes its button with offset
  coordinates, and clicking that centre is confirmed by the child document
- **frame screenshot**: a 400×200 frame becomes a 600×300 crop at 1.5× (aspect 2.0), not a whole-page
  image

`npm run test:sealed` is the closed-root fixture:

- closed root with a button, text input, and a nested closed root
- `display:none` and `aria-hidden` controls are absent from AX
- page JS still reports `shadowRoot === null`
- clicking by the returned coordinate actuates the component; typing with `clear_first` replaces the
  value; the result never contains it
- a same-site closed frame and a cross-site (OOPIF) closed frame are both found and clicked
- quiet-by-default assertion (`cdp.ax === 0` until asked), identity-cache hit, and a real `429` after
  the per-tab scan budget

## Settings gate

The Shadow Walk levers are enforced before work starts, not after:

| surface | disabled result |
|---|---|
| `find {sealed:true}` | `400 SEALED_DISABLED` (or `SHADOW_WALK_DISABLED` when the master is off) |
| `focus_walk` | `400 TAB_WALK_DISABLED` |
| `/frames`, frame geometry | `400 FRAMES_DISABLED` |
| `/dom/facts {deep:true}` | `400 DEEP_OPEN_ROOTS_DISABLED` |
| marks / `find` / `observe` | `deepOpenRoots:false` keeps them in the light DOM (no error) |

The panel lives in `Settings → SHADOW WALK`; writes go over IPC to
`data/shadow-walk.json`. `/health` returns a `shadowWalk` block with the active policy, so an agent
can check before asking. Turning frame controls or screenshots off returns frames without those
fields and a `notes` line, rather than silently ignoring the request.

## See also

- [CONTROL_LAYER.md](./CONTROL_LAYER.md) — targeting, consent policy, takeover, pacing
- [SHADOW_WALK.md](./SHADOW_WALK.md) — the plan for closed roots and the Shadow Walk settings levers
- [`src/main/input/README.md`](../src/main/input/README.md) — human takeover
- [`src/main/browser/README.md`](../src/main/browser/README.md) — frame evaluation API and bounds
