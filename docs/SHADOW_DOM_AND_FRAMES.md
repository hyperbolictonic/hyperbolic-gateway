# Shadow DOM & iframes — what Kuang can see and click

Two different problems that get confused because both "hide" content:

- **Shadow DOM** is a *same-document* boundary. Open roots are readable and clickable; closed roots
  are not, by design.
- **Iframes** are *separate documents* (often cross-origin). The top frame cannot read them with
  `executeJavaScript`; frames need their own execution context.

| surface | open shadow DOM | closed shadow DOM | same-origin iframe | cross-origin iframe |
|---|---|---|---|---|
| `observe(markdown)` | ✅ composed DOM | ❌ | ❌ main frame only | ❌ |
| Set-of-Marks / `find` | ✅ marks inside roots | ❌ | ❌ | ❌ |
| `act(mark_id / selector)` | ✅ resolves the inner control | ❌ | ❌ | ❌ |
| `act(target_text)` | ✅ (composed text) | ❌ | ❌ | ❌ |
| `act(x, y)` | ✅ | ✅ (pixels are pixels) | ✅ | ✅ |
| `evaluate` | ✅ | ❌ | ❌ | ❌ |
| `evaluate {frames:true}` | ✅ per frame | ❌ | ✅ | ✅ |

If a control is sealed inside a closed root or an iframe, **click it by coordinates** or read the
frame explicitly. Everything else is main-document only, on purpose.

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
  iframe gets no mark id.
- Offset resolution is one level deep; deeper nesting falls back to in-frame activation.
- Iframes inside **closed shadow roots** are unreachable by either path.

### What to do today

| need | approach |
|---|---|
| read text inside an iframe | `POST /evaluate {frames:true}` |
| click a known control inside an iframe | compute coords from the iframe rect + local centre, then `act(x,y)` |
| answer a consent wall in an iframe | `dismiss_consent` — it does the offset math |
| automate a whole flow inside an iframe | not supported as marks; script it with frame evaluation + coordinate clicks |

---

## Tests

`npm run test:dom` (live bridge) covers both:

- a clickable `div` with an inline handler and no role
- occlusion (covered button), disabled control, hidden input
- `act(target_text)` on a semantics-free element, and the ambiguity refusal
- **cross-origin iframe**: consent answered with `frame: "child"`, `delivery: "cdp"`, and the child's
  DOM confirms the click landed
- frame evaluation reads a cross-origin child, reports per-frame errors, skips blank frames

Shadow-DOM coverage is exercised by the same scanner but **has no fixture of its own yet** — a
web-component fixture is an obvious next test.

## See also

- [CONTROL_LAYER.md](./CONTROL_LAYER.md) — targeting, consent policy, takeover, pacing
- [SHADOW_DOM_AND_FRAMES.md](./SHADOW_DOM_AND_FRAMES.md) — what Kuang can see and click through shadow roots and iframes
- [`src/main/input/README.md`](../src/main/input/README.md) — human takeover
- [`src/main/browser/README.md`](../src/main/browser/README.md) — frame evaluation API and bounds
