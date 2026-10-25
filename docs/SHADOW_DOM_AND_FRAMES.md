# Shadow DOM & iframes — what Kuang can see and click

Two different problems that get confused because both "hide" content:

- **Shadow DOM** is a *same-document* boundary. Open roots are readable and clickable; closed roots
  are not, by design.
- **Iframes** are *separate documents* (often cross-origin). The top frame cannot read them with
  `executeJavaScript`; frames need their own execution context.

| surface | open shadow DOM | closed shadow DOM | iframe (same-site and cross-site) |
|---|---|---|---|
| `observe(markdown)` | ✅ composed DOM | ❌ | ❌ main frame only |
| Set-of-Marks / `find` | ✅ marks inside roots | ❌ | ❌ main frame only |
| `act(mark_id / selector)` | ✅ resolves the inner control | ❌ | ❌ |
| `act(target_text)` | ✅ (composed text) | ❌ | ❌ |
| `act(x, y)` | ✅ | ✅ (pixels are pixels) | ✅ |
| `frames` — text | ✅ controls in frames | ❌ | ✅ **frame as content** |
| `frames` — screenshots | ✅ | ✅ (pixels are pixels) | ✅ |
| `evaluate` | ✅ | ❌ | ❌ |
| `evaluate {frames:true}` | ✅ per frame | ❌ | ✅ |

A control sealed inside a closed root or an iframe is still addressable **by pixels**. The difference
is who hands you the pixels: `frames` computes them and, with `screenshots: true`, also shows you the
frame. Everything else is main-document only, on purpose.

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

### Limits

- **Closed roots are invisible to page JavaScript.** `element.shadowRoot` is `null` for
  `attachShadow({mode:'closed'})`. Only the CDP DOM domain sees inside; marks do not use it.
- Shadow content is **not** flattened into `observe(as:"text")` regions the way it is for markdown.
- A closed-root control can still be clicked if you know its pixels (`act(x,y)`), but nothing will
  name it for you.

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

### Limits

- **Marks, `find`, `extract`, `observe` and `act(mark_id)` are main-frame only.** A control inside an
  iframe gets no mark id — use `frames` and its reported coordinates.
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

## Turning the remaining ❌ into ✅

The two remaining closed cells are not magic, and neither needs a new subsystem:

1. **Frame controls as mark ids.** The `frames` scan already knows each control's absolute rect. The
   missing step is identity: stamp `data-mark-id` inside the frame during the scan (block
   `100 + frame_index * 100`, so it never collides with the 99 main-frame marks), and have
   `getMarkTarget` resolve a frame mark by evaluating in that frame and adding the frame origin.
   After that, `find`/`observe` can merge frame controls and `act(mark_id)` becomes as stable for an
   iframe as it is for the main document. `observe(markdown)` needs the same merge at the markdown
   level, which is why it is a separate step.
2. **Closed shadow roots via CDP.** Page JavaScript is not allowed to see a closed root; the DOM
   domain is. `DOM.getDocument({pierce: true})` returns closed children, `DOM.getBoxModel` gives
   their quads, and `Accessibility.getPartialAXTree` gives their names. This is a deliberate
   escape-hatch, not a default: the payload is the whole DOM tree, so it should run only when a
   heuristic (a sized custom element with no light DOM and no open root) says a closed root exists.

Both are opt-in paths for content that cannot be reached otherwise, and both keep the rule that a
decision which cannot be verified is reported rather than guessed.

The delivery plan, the settings levers, and the risk tiers live in
[`SHADOW_WALK.md`](./SHADOW_WALK.md).

## Tests

`npm run test:dom` (live bridge) covers both:

- a clickable `div` with an inline handler and no role
- occlusion (covered button), disabled control, hidden input
- `act(target_text)` on a semantics-free element, and the ambiguity refusal
- **cross-origin iframe**: consent answered with `frame: "child"`, `delivery: "cdp"`, and the child's
  DOM confirms the click landed
- frame evaluation reads a cross-origin child, reports per-frame errors, skips blank frames
- **frame geometry**: `frames` reports the child's top-level rect, describes its button with offset
  coordinates, and clicking that centre is confirmed by the child document
- **frame screenshot**: a 400×200 frame becomes a 600×300 crop at 1.5× (aspect 2.0), not a whole-page
  image

Shadow-DOM coverage is exercised by the same scanner but **has no fixture of its own yet** — a
web-component fixture is an obvious next test.

## See also

- [CONTROL_LAYER.md](./CONTROL_LAYER.md) — targeting, consent policy, takeover, pacing
- [SHADOW_WALK.md](./SHADOW_WALK.md) — the plan for closed roots and the Shadow Walk settings levers
- [`src/main/input/README.md`](../src/main/input/README.md) — human takeover
- [`src/main/browser/README.md`](../src/main/browser/README.md) — frame evaluation API and bounds
