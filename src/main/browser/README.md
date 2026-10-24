# 🪟 Frame Evaluation

`webContents.executeJavaScript` only sees the top document. Consent walls (Sourcepoint), embedded
checkouts and some widget forms live in cross-origin child frames, so the main-frame DOM scan cannot
reach them.

`evaluateInFrames()` walks the CDP frame tree and evaluates an expression in **each frame's own
isolated world**.

Reference: [docs/CONTROL_LAYER.md](../../../docs/CONTROL_LAYER.md#frame-scoped-evaluation).

---

## API

```ts
evaluateInFrames(wc, expression, { maxFrames?, timeoutMs?, includeBlank? })
  -> Array<{ frameId, url, name, ok, value?, error? }>
```

```jsonc
// POST /evaluate
{ "frames": true, "max_frames": 6, "script": "document.title" }
```

## Bounds (why it is safe to call)

| knob | default | reason |
|---|---|---|
| `maxFrames` | 8 (max 32) | two CDP commands per frame; a page can embed dozens |
| `timeoutMs` | 1500 per command | a frame can be detached or wedged |
| isolated world | one per frame, cached | `Page.createIsolatedWorld` is not free; contexts survive until the document is replaced |
| invalidation | `did-start-loading` | a new document means new contexts |
| blank frames | skipped | `about:blank` / `about:srcdoc` carry nothing useful |
| failures | reported per frame | never thrown; a dead frame must not fail the whole call |

Measured: **28 ms** for a main document plus one cross-origin child (~20 ms of it frame traversal).

## Semantics you must know

**Isolated worlds share the DOM but not page globals.** `window.__anything` set by the page is
invisible inside the isolated world; attributes, text and computed styles are readable. Tests and
features must assert on DOM state, not on page variables.

`el.click()` inside a frame produces an untrusted event. Prefer coordinate clicks in the parent (the
consent subsystem computes iframe rect + local centre) and keep in-frame activation as a labelled
fallback.

## Reuse

Currently used by: consent scanning (`src/main/shield`). Intended for marks/extract of iframe content
and for recipe replay across embedded forms.
