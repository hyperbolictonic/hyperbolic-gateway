# Control layer — targeting, consent, human takeover

How Kuang decides **what** to click, **how** to answer a consent wall, and **when to stop** because a
person took over. These pieces share one principle: describe the page once, then act on the
description — never guess from a selector that happens to exist.

- [Control facts](#control-facts)
- [Text targeting](#text-targeting)
- [Frame-scoped evaluation](#frame-scoped-evaluation)
- [Consent policy](#consent-policy)
- [Human takeover](#human-takeover)
- [Input pacing](#input-pacing)
- [Tests](#tests)

---

## Control facts

One injected expression describes an element the same way for marks, `find`, the decision guard and
recipes:

| field | meaning |
|---|---|
| `role`, `name`, `value` | accessible identity |
| `actions` | what the control accepts (`click`, `type`, `hover`, `select`, `press`) |
| `visible` | laid out, not `display:none` / `visibility:hidden` / `opacity:0` / `aria-hidden` |
| `occluded` | a hit-test at the **visible-portion centre** lands on something else |
| `disabled` | `disabled` or `aria-disabled="true"` |
| `region`, `regionName` | nearest landmark (`main`, `nav`, `dialog`, `form`, …) |
| `rect` | viewport geometry |

```bash
curl -s localhost:4111/dom/facts -X POST -H 'content-type: application/json' \
  -d '{"limit":20,"skip_hit_test":false}'
```

**Why the visible-portion centre matters.** A card taller than the viewport has its geometric
centre off-screen. Clamping that point to the viewport edge lands on a sticky header/footer and the
element is wrongly reported as covered — that is why full-width result cards used to get no mark at
all.

Disabled controls are described (`actions: []`, `disabled: true`), not dropped. A guard that cannot
see a disabled control cannot reject it.

---

## Text targeting

Some of the most-clickable things on the web have no semantics: a React card is a `<div>` with a
handler three levels up, no `role`, no `href`, no `onclick` attribute. Guessing a "card-like"
selector produces either nothing or a giant wrapper whose centre is a different widget.

`act(target_text: "…")` resolves the **deepest visible element whose own text matches**, clicks the
centre of its visible box, and lets the event bubble to whatever handler the framework attached.

```jsonc
{ "target_text": "Harp Crossbow Ranged Build", "action": "click" }
```

- more than one match → `AMBIGUOUS` with the candidate list; nothing is clicked
- the match must be visible and inside the viewport
- text is normalised (whitespace collapsed), matching is case-insensitive substrings unless
  `target_exact` is set

Use a mark id when you have one; use `target_text` when the page refuses to describe itself.

---

## Frame-scoped evaluation

`webContents.executeJavaScript` only sees the top document. Consent walls (Sourcepoint), embedded
checkouts and some widget forms live in cross-origin child frames.

```jsonc
// POST /evaluate
{ "frames": true, "max_frames": 6, "script": "document.title" }
// -> { frames: [{ frameId, url, ok, value, error }, …] }
```

- CDP isolated world per frame, so cross-origin content is readable
- bounded: 8 frames by default (max 32), 1500 ms per command, context ids cached and invalidated on
  `did-start-loading`
- blank frames skipped unless `include_blank`
- a frame that fails is reported, never thrown

**Isolated worlds share the DOM but not page globals.** `window.__x` set by the page is invisible to
frame evaluation; attributes and DOM state are readable. Assert on DOM, not on page variables.

---

## Consent policy

A consent wall is a decision, so it is answered like one: pick the least-invasive real control, click
it once with the visible cursor, and stop.

1. top-document scan (one evaluate)
2. if nothing matched **and** the page embeds an `<iframe>`, the same scan runs in each frame
3. the match is clicked at its top-level coordinates (iframe rect + local centre) — a trusted CDP
   click, not a synthetic `element.click()`
4. if the offset cannot be derived, the control is activated in-frame and the result says so
   (`delivery: "in-frame"`)

```
KUANG_CONSENT_POLICY = essential | accept | reject     # default: essential
```

`essential` prefers "Reject all" / "Only necessary", then accepts as a fallback. One attempt per
origin per session: after a wall is answered — or deliberately left — the origin is remembered, so a
re-rendering CMP is never clicked twice (that was the on/off flicker).

A wall with no matchable control is **left for a human**: `blocked: true`, no DOM stripping.
`dismiss_consent(force_remove: true)` is the only path that hides an overlay without answering it.

---

## Human takeover

The agent must never fight the person at the keyboard.

- the page reports **trusted** pointer/key/wheel/touch activity over a console channel
- every synthetic dispatch is stamped, so input inside the **180 ms grace window** is treated as the
  agent's own
- any trusted event outside it starts a **2 s quiet window**: synthetic input throws
  `HUMAN_IN_PROGRESS` until it lapses
- each new human event extends the window

```
GET  /human/status   -> { active, activeForMs, last: { kind, at, url, target } }
POST /human/resume   -> hands control back immediately
```

`bridge_health` reports `human.paused`. The HUD shows `HUMAN_INPUT` with the takeover description.

**Why timing and not identity:** CDP and human input are both *trusted* in the DOM. A human event
arriving inside the grace window is indistinguishable and is attributed to the agent; the
alternative — blocking our own clicks — is worse.

---

## Input pacing

Settings → **INPUT** (persisted to `data/input-profile.json`, applied live):

| knob | default | effect |
|---|---|---|
| pointer speed | 1400 px/s | glide time = distance ÷ speed, clamped 70–800 ms |
| typing | 220 wpm | `12000 / wpm` ms per keystroke, extra beat on spaces/punctuation |
| click dwell | 55 ms | pre-press hesitation + button hold |

Environment overrides (win over the file, and the file wins over defaults):

```
KUANG_MOUSE_SPEED_PX_S   KUANG_TYPING_WPM   KUANG_CLICK_DWELL_MS   KUANG_CURSOR_BUDGET_MS
```

`KUANG_CURSOR_BUDGET_MS` is an absolute override (0 = no artificial dwell). The glide is sampled at
most 12 points and the in-page trail is drawn every third sample — one `executeJavaScript` per
sample queues work ahead of the awaited CDP moves and used to cost more than the glide itself.

---

## Tests

```bash
npm run test:dom      # control facts, text targeting, frames, consent-in-frame, human negatives
npm run test:human    # takeover predicate (offline, no app needed)
```

`test:dom` needs the app running (bridge on `127.0.0.1:4111`); it prints `SKIP` and exits 0 when the
bridge is down.
