# Field Notes — 2026-10-20 · Dogfooding a live signup (Reddit)

**Status:** root-caused findings + fix plan · **Related:** [`FIELD_NOTES_2026-10-18.md`](./FIELD_NOTES_2026-10-18.md) (the "dropped click" family), [`DECISION_MODELS.md`](./DECISION_MODELS.md) (the ledger and field facts this run exercised for the first time on a hostile page).

**The run:** a real account creation on reddit.com — email → emailed 6-digit code → username/password → birthday + confirm → onboarding → logged-in feed. Driven entirely through Kuang's own MCP tools, on a site with an invisible reCAPTCHA, a `js_challenge`, and **every form control inside shadow DOM**. Nothing synthetic about it.

Labels: **[PROVEN]** = observed, with evidence quoted. **[LIKELY]** = mechanism identified in source but not yet instrumented. **[TO CONFIRM]** = needs a measurement.

---

## 1. What worked (don't regress it)

| Tool | Task | Note |
| :--- | :--- | :--- |
| `navigate_to` | reached reddit.com/register | passed Reddit's `js_challenge` unattended |
| `observe(as:"markdown"/"text")` | read panel copy | worked everywhere, including inside the modal |
| `take_screenshot({marks:true, detail:"economy"})` | **the source of truth for state** | when DOM probes disagreed with reality, the image was right |
| `act({x,y,action:"click"})` on the real control | every click that mattered | modal buttons, topic chips, cookies |
| `act({x,y,action:"type"})` after a real click | email, username, password, DD/MM/YYYY | character-exact, including `-`, `!`, `+`, `@`, `.` (post-fix) |
| `wait_for({conditions:[{type:"network_idle"}]})` | settling React re-renders | prevented reading a half-rendered panel |
| `evaluate_javascript` | shadow-root reads, rect probing | the justified fallback, used deliberately and often |
| `get_network_traffic` | proving Continue fired | saw `POST /svc/shreddit/account/register_email_verify_initialize → 200` when the UI looked inert |
| `request_human_intervention` | the emailed code | correct outcome, see P2 |

**Take-away:** the humanlike path (real click → real keys) is sound. Every failure below was in *targeting* or in *believing we succeeded*.

---

## 2. The failures — three silent no-ops, all reported as success

### 2.1 `.` was swallowed while typing **[PROVEN → FIXED]**

Typing `user+tag@example.com` produced `user+tag@examplecom`. Isolated:

```
sent "abc.def"      → got "abcdef"
sent "123@456.789"  → got "123@456789"
sent 32 punctuation → missing only ".", "'"
```

Cause: `input-simulator.ts` `keyDescriptor()` used the character's **ASCII code as its Windows virtual-key code**. `.` = 46 = `VK_DELETE`, `'` = 39 = `VK_RIGHT`; Chromium honours those as editing/navigation commands and never inserts the text. Fixed with a real US-layout VK table (commit `532902d`), regression-tested (`test:primitives` 36 → 37).

**Severity was the point:** every email address, URL, version number and password containing `'` typed through `act(type)` was silently corrupted — and the tool returned `Typed text (N chars) with variable human cadence`, i.e. success.

### 2.2 Selector-targeted typing silently fails on a web component **[PROVEN]**

Same field, same coordinates, two outcomes:

```
act({selector:"faceplate-text-input", action:"type", text:"kuangmarkeleven"})  → value UNCHANGED, focus lost
act({x:430, y:266,               action:"type", text:"kuangmarkeleven"})        → value "kuangmarkeleven", focus held
```

Root cause in `browser-chassis.ts` `clickElement(selector)` → used by `typeText(text, selector)`:

1. line 552 — `document.querySelector(selector)`: **light DOM only**. A shadow-DOM control is unreachable; the best it can match is the host (`<faceplate-text-input>`).
2. line 554 — `el.scrollIntoView({block:"center"})` then the host's rect centre. For a `faceplate-text-input` the host box wraps a label *above* the control, so the centre is a different point than the control's own centre.
3. lines 579-588 — the JS focus nudge: `el.focus()` on the **host**. A focusable host takes focus *away* from the inner control; a non-focusable host makes it a no-op. Either way the keystrokes that follow have nowhere to go. **[LIKELY]** — which of the two happened here is unconfirmed; the fix shouldn't depend on it.

The coordinate path (`act({x,y})`) skips all three steps: a real mouse click lands on the control inside the shadow root and focus is correct.

### 2.3 A code field that ignores synthetic keys entirely **[PROVEN]**

The 6-digit verification input (`inputmode=numeric`, `autocomplete=one-time-code`, inside `faceplate-text-input`) rejected every synthetic attempt:

- confirmed **focused** (`document.activeElement === host`, `host.shadowRoot.activeElement === input`) → typed `740106` → **value still `""`**, no error.
- Retried via the selector path: same. There is no working automated path today.

The human typed it and moved on. Correct outcome — but the tool never said "I could not type into this". An agent gets `revision 42->43 · url unchanged` and has to infer.

### 2.4 Marks and `find` are blind to shadow DOM **[PROVEN]**

`take_screenshot({marks:true})` → `0 interactive elements detected` on **every** signup panel, including ones with a large primary button. `find({name:"Email"})` matched only an unrelated checkbox. Yet `observe` text and screenshots read fine. So: on the single most important flow a web agent does (logging in), the Tier-1 marks path is unavailable and `find` is misleading, while `act({selector})` fails as in 2.2. Only raw coordinates worked.

---

## 3. The pattern behind all of it

> **Kuang acts, then declares success, without verifying that anything happened.**

`typeText` returns a cheerful summary regardless of outcome. Three separate defects (2.1 ASCII VK, 2.2 host targeting, 2.3 component ignores keys) all surface as *the same lie*: success with no effect. This is the same family as the 2026-10-18 "dropped click" note and the `clear_first` append bug — the tool's failure mode is silence, not error.

That matters more now than it did last week, because [`DECISION_MODELS.md`](./DECISION_MODELS.md) proposes a runner-side head trained on action outcomes: **a ledger full of "success" rows for actions that did nothing is worse than no ledger at all.**

---

## 4. The plan

### P0 — verify-or-report for typing *(the root fix)*

`act(action:"type")` should read the target's value before and after and only then decide what to report.

- Resolve the target's **value-bearing control** (see P0-2) and snapshot `valueLength`/`isEmpty` via the existing `probeField` path.
- Type, then re-read.
- If the value did not change as expected → return a **structured failure** with a new code: `TYPE_NO_EFFECT` — alongside the existing `STALE_REF`/`TIMEOUT`/`NO_TARGET`/`BAD_REQUEST`/`NOT_SUPPORTED` — plus a hint naming the likely cause ("field did not accept synthetic input; consider `request_human_intervention`" / "target is a custom element; resolve the inner control").
- On success, report the delta: `typed: { chars, secret, landed: true, valueLengthBefore, valueLengthAfter }`.
- Ledger: add `landed` + `valueLengthBefore/After` to `typed` in `TransitionRecord`.

*Acceptance:* typing into a field that rejects input returns a non-success result naming the cause; the ledger row says `landed:false`. *Tests:* fixture page with a `<div contenteditable>` that ignores key events, and one that accepts them; assert both verdicts. *Touchpoints:* `primitives.act`, `http-bridge` error table, tool catalogue description, `docs/DECISION_MODELS.md`, `test-primitives`, `test:mcp:contract`.

### P0 — shadow-aware target resolution for click and type

Replace the light-DOM hop in `clickElement(selector)` / `typeText(text, selector)` with a resolution that pierces shadow roots:

1. Find the element by selector (as today), then walk to the **deepest focusable control at its centre** using `elementFromPoint` and `.shadowRoot.activeElement` / recursive shadow descent (the same descent `snapshot_rendered_page({pierce_shadow_dom:true})` already implements).
2. Click *that* control's rect centre (not the host's).
3. **Verify focus** (`activeElement` or shadow `activeElement` is the resolved control before typing). If focus is elsewhere, fix it once with a real click — never with `el.focus()` on a host.
4. Delete the JS focus nudge for custom elements (keep it for plain inputs, where it's harmless and helps).

*Acceptance:* `act({selector:"faceplate-text-input", action:"type"})` types into the inner input on the Reddit signup page, and the value round-trips. *Tests:* a fixture with a `delegatesFocus` custom element wrapping an input.

### P1 — marks and `find` pierce shadow DOM

- `marks-overlay.ts` (already has an `elementFromPoint` occlusion check at line 235): descend into open shadow roots when collecting interactive elements, and badge the **inner control**, not the host.
- `find`: search open shadow roots, and support matching by `name`/`autocomplete`/`aria-label`, not just text.
- Report the count honestly: `0 interactive elements` on a page full of buttons is a bug signal, not a fact.

*Acceptance:* the Reddit signup modal yields marks for its buttons and input. *Tests:* fixture page with a shadow-rooted form.

### P1 — field facts for shadow-DOM controls

`probeField` (added this week) uses `document.querySelector` + `[data-mark-id]`, so for a shadow control it resolves the host, decides "not an input", and returns `null` — meaning the new typed-facts feature is silent exactly where forms are most common. Extend it to the same shadow-aware descent (P0-2), so `target.field` populates for `faceplate-text-input`-style controls.

### P1 — consent overlays that appear *after* navigation

Reddit's cookie dialog only appeared after the flow finished (post-login), long after `navigate_to`'s `auto_dismiss_consent` ran. Either re-check for consent overlays when a navigation/major mutation settles, or expose `dismiss_consent` as a first-class action on `act`. Today an agent must notice it and click it by coordinates.

### P2 — detect and route "this field refuses input" to a human

Beyond P0's honest error: an `act(type)` failure on a one-time-code / OTP / `autocomplete="one-time-code"` field should *offer* the hand-over (`request_human_intervention` with a reason naming the field and the code), because those fields are exactly where the human is required anyway. Worth recording HIL events in the ledger too, so the dataset knows a human intervened rather than the agent succeeding.

### P2 — recipes for the OKF bundle and the skill

- **R7 — web components: the host is not the control.** `act({selector})` on a tag with a hyphen may click a label and focus nothing; click the control's coordinates, or resolve inside the shadow root. Symptom: perfect-looking success, unchanged value.
- **R8 — read it back.** After a `type`, the *only* trustworthy evidence is the field's value; after a `click`, the URL/revision/marks delta. Never trust a success string.
- Also fix the tier map's implication that `act({selector})` is always the Tier-1 path: it is Tier-1 for plain DOM, and coordinates are Tier-1 for shadow DOM.

---

## 5. What to do better — process, not code

1. **Verify before believing.** I typed into three different fields and only read them back after something else failed. Reading back after *every* mutation is one extra call and would have caught 2.1 and 2.2 immediately. This should be enforced by the tool (P0), not by discipline — but discipline gets it right today.
2. **One focus fix, not repeated clicks.** The failure mode from 2026-10-18 repeated here: a click reported success, nothing happened, and the reflex was to click again. `get_network_traffic` was the better instrument — it proved the request *had* fired when the DOM looked inert.
3. **Trust the screenshot over the probe.** When my `getBoundingClientRect` walk insisted the modal was invisible while the image showed it plainly, the image was right. Screenshots are cheap; wrong conclusions are not.
4. **Don't fight a field with no automated path.** 2.3 deserved `request_human_intervention` after the second failure, not DOM archaeology. The hand-over is a feature; use it earlier.
5. **Instrument the unknown instead of guessing.** For 2.2 I could have read `document.activeElement` (and the shadow `activeElement`) immediately after the failed typing and known the mechanism in one call. Do that next time; the plan above is written so the fix doesn't depend on it.
6. **Return objects from `evaluate_javascript`, not `JSON.stringify` of objects** — a stringified result arrives as a string and needs parsing twice. Self-inflicted, but it cost two calls.

---

## 6. Open questions

- Which of the three `clickElement` steps (2.2) actually steals focus — the `scrollIntoView` point, the host-centre click, or the `el.focus()` nudge? Instrument `activeElement` + shadow `activeElement` immediately after `act({selector,action:"type"})` on a `faceplate-text-input`.
- Why did the birthday Continue click at the same coordinates register once as a no-op and once as the thing that advanced onboarding? Is there a settle window after React re-renders that a click can fall into?
- Why did `getBoundingClientRect()` report the `auth-flow-modal` as 0×0 while it was painted and interactive? A second instance in a detached tree, or an `aria-hidden` variant? That gap is what pushed the run onto screenshots.

---

## 7. Status — what has shipped since this note

- **[done] §2.1 punctuation** — fixed with a real US-layout VK table; regression-tested.
- **[done] Shadow-DOM harvesting for `observe(as:"markdown")`.** The harvester now reads the **composed** DOM
  (`src/main/harvester/dom-serializer.ts`) instead of `outerHTML`: open shadow roots are inlined recursively,
  live form state is baked in as attributes, and password values are recorded as a length. This was not in
  the original plan — the plan treated shadow DOM as a *targeting* problem (§2.2/2.4), but `observe` could
  not see the page at all, which is the more fundamental version of the same blindness.
- **[done] Envelope + paging, the "easier to use" pass.** The construct front-matter lost its timestamp and
  its vanity metrics (`raw_bytes`, `construct_bytes`, `compression_ratio`, `designation`) and gained honest
  coverage (`reader`, `extracted_chars`, `page_chars`, `shadow_roots`); the 25k cut moved out of the
  harvester into `pageText`, so `budget`/`next_cursor` can finally reach the end of a large page; a
  partly-visible page and a text-free page each explain themselves. Covered by `npm run test:markdown`
  (19 live checks), which also asserts that two harvests of an unchanged page are byte-identical.
- **[done] §2.2 + P0 — shadow-aware targeting and verify-or-report typing.** `act` selectors now pierce
  open shadow roots and resolve a custom-element host to the control a mouse would hit; typing is read
  back from the field and a provable no-op returns `ok:false` with `TYPE_NO_EFFECT`, the `typing`
  evidence and a hint. The ledger records `typed.landed` and the full `typing` block, so the dataset
  now distinguishes "the agent typed" from "the field accepted it". Covered by `npm run test:act`.
- **[done] §2.4 / P1 — Set-of-Marks, `find` and mark resolution pierce open shadow roots.** The mark
  list on the signup fixture is no longer empty: it badges the shadow input and button, `find` returns
  them, `act(mark_id)` types into the inner control, and markdown carries the `[#id]`. One traversal
  implementation (`dom-targeting.ts` helpers) is now shared by targeting, marks and probing.
- **[done, in effect] P2 — OTP routing.** The hint for "events arrived, value unchanged" names
  `request_human_intervention` and says to stop retrying. Automatic hand-over (a tool-level offer) is
  still a design question; the honest error plus the hint was the valuable half.
- **[open] §2.2 residual** — the original plan assumed focus was lost by the `el.focus()` nudge. With the
  fix in place the mechanism is moot, but the open question in §6 has not been instrumented
  (0×0-viewport timing turned out to be the more consequential hazard, and is now guarded).
- **[open] P1** — consent overlays that appear *after* navigation (Reddit's cookie dialog appeared
  post-login, long after `auto_dismiss_consent` ran); closed shadow roots remain unreadable by design.
