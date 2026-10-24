# 🛡️ Consent & Overlay Subsystem

Answers cookie/GDPR walls the way a person would: choose the *least invasive* real control, click it
once with the visible cursor, and stop. (Full policy reference: [docs/CONTROL_LAYER.md](../../../docs/CONTROL_LAYER.md).)

---

## Policy

```
KUANG_CONSENT_POLICY = essential | accept | reject      # default: essential
```

- **essential** — prefer "Reject all" / "Only necessary", fall back to accepting
- **accept** — prefer "Accept all", fall back to rejecting
- **reject** — reject only

Auto-removal (`force_remove`) is **not** part of the automatic path. It is reachable only through an
explicit `dismiss_consent(force_remove: true)` call, because hiding a consent wall is not the same as
answering it.

## How a wall is answered

1. **Top-document scan** — one injected expression; vendor selectors first (OneTrust, Cookiebot,
   Google, TrustArc, Civic, Didomi, Quantcast, generic id/class patterns), then text patterns scoped
   to dialog-like containers so an unrelated "OK" elsewhere is never clicked.
2. **Child frames** — only when the top document found nothing *and* the page embeds an `<iframe>`.
   The same scan runs in each frame's isolated world (Sourcepoint renders the whole banner in a
   cross-origin iframe).
3. **Click** — the chosen control is clicked at its top-level coordinates: iframe rect + local
   centre. That is a trusted CDP click, not a synthetic `element.click()`.
4. **Fallback** — if the offset cannot be derived (nested frame, dynamic `src`), the marked control
   is activated in-frame and the result reports `delivery: "in-frame"` rather than pretending.

## One answer per origin

A session-scoped set of origins is remembered after a wall is answered **or** deliberately left. That
is what stopped the banner flickering on and off: the old sweep ran three timed attempts and would
re-click a CMP that re-rendered, sometimes landing on whatever replaced it.

## Results

```jsonc
{
  "dismissed": true,
  "framework": "OneTrust",
  "intent": "reject",          // reject | accept
  "frame": "child",            // main | child
  "delivery": "cdp",           // cdp | in-frame
  "targetText": "Reject all",
  "coordinates": { "x": 120, "y": 340 },
  "message": "Answered OneTrust wall with \"Reject all\" (reject) at (120, 340)"
}
```

A wall with no matchable control returns `dismissed: false, blocked: true` and is **left for a
human** — no DOM stripping, no blind click.

## Tests

- `npm run test:dom` — includes a cross-origin consent iframe answered with `reject` / `frame=child` /
  `delivery=cdp`, and confirms the click landed by reading the child's DOM.
- Isolated worlds share the DOM but not page globals: assert on attributes, not `window.*`.
