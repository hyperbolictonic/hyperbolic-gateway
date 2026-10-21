# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Versioning during the 1.4 line:** changes ship as **`1.4.x` patches — including new features** — and the
> minor number is reserved for milestones worth naming. For small increments (documentation, a one-line fix)
> the **git tag and release title take a fourth number** — `v1.4.2.1`, `v1.4.2.2`, … — so a docs-only release
> does not consume a patch number. `package.json` and `APP_VERSION` stay **three-part**, because npm and
> electron-builder require valid semver; a release tagged `v1.4.2.1` therefore reports `1.4.2` in `/health`.
> This is a deliberate, temporary deviation from strict semver; each increment still gets its own
> Added/Fixed/Changed section here.

## [1.4.2.1] - 2026-10-21

Documentation-only increment: the README navigation index, and the versioning rule for four-part tags.

### Changed

- **README index moved to the top.** It now sits directly under the logo/badge block instead of after the
  intro, the release notes and the architecture principles — i.e. where you actually start reading. All 24
  links resolve (explicit `<a id>` anchors, not GitHub heading slugs).
- **Versioning:** small increments take a fourth number in the tag/release (`v1.4.2.1`); `package.json` and
  `APP_VERSION` stay three-part because npm and electron-builder require semver.

## [1.4.2] - 2026-10-21

### Added

- **`drive` — the observe → decide → act loop, in code.** Optional (like `decide`): with a decision model
  configured, `drive({ goal, values })` repeats `observe(as:"components")` → guarded `decide` → verified
  `act` until the goal is reached or it must stop, with **one decision call per step** instead of an agent
  turn per step. Plumbing, not policy: fixed questions, no goal interpretation, and **no text generation** —
  a `type_text` step without a supplied value returns `status:"needs_input"` naming the field. Typed stops:
  `done` · `blocked` (no deterministic gate matched → the agent decides) · `human_required` (age/CAPTCHA,
  hand-off raised) · `needs_agent` (guard rejected everything / contradiction) · `failed` · `max_steps`, with a
  per-step transcript and `dry_run`. Measured on the Skyscanner London→Maldives form: **4 steps in 18 s**
  (destination, autocomplete commit, both dates), then an honest `needs_agent`.
- **`scripts/drive-example.mjs`** — the same loop in ~80 lines against the plain HTTP API, for runners that
  want their own retries, logging or policy. Both paths share the guard, verification and the ledger.
  `npm run drive -- --url … --goal … --values '{…}'` runs it.

- **`decide(include_screenshot: true)` — the model can see the page.** The viewport is captured, scaled into
  TypeSafe's image limits (longest side ≤ 1568, shortest ≥ 280) and attached as an image asset referenced
  from the state, with the `TypeSafe-Danger-Zone-Images` header. Useful where text and the component table
  are not enough: a CAPTCHA, an age gate, or a modal that looks like a form. **The OpenCode gateway does not
  forward headers** (verified with a direct request: identical 400 with and without it), so images are
  **disabled up front** when the configured endpoint is `opencode.ai` — the result says
  `screenshot: "disabled: the OpenCode gateway does not forward TypeSafe headers — images only work against
  api.typesafe.ai"` and no call is wasted. Screenshots work against `api.typesafe.ai` with a TypeSafe key; the
  local ONNX models are text-only and say so. (A 400 mentioning "Images are experimental" from any other
  gateway is still retried once without the image, as a safety net.)
- **`act` warns when a click target sits behind a gate.** It does not refuse — a human may have resolved the
  hand-off and asked for exactly that click — but the result carries `warning` naming the wall, so an agent
  cannot claim it was not told.

### Changed

- **A sensitive gate now raises the human hand-off itself.** `decide` returning `409 HUMAN_REQUIRED` used
  to end with advice ("call `request_human_intervention`") and nothing else — nothing was actually asked.
  Kuang now opens a HIL request for the page (reason + the matched lines) as part of the gate, skipped while
  another request is already open, and **without blocking the 409** (the intervention's promise resolves when
  the human acts, which can take minutes). On `/r/petite` the banner appears with *"Verify your birthday to
  continue"* attached; the decision still spends no model call.
- **An *undetermined* wall goes to the agent, not the human.** If the model answers `blocked` but no gate copy
  matches, the result is a normal decision carrying a hint ("if this is a compliance boundary — age, CAPTCHA,
  payment, identity — call `request_human_intervention`; otherwise choose the next step yourself"). Human
  attention is spent only on a boundary Kuang can name and quote.

### Fixed

- **The HUD could not select text.** The shell's `<html>` carried Tailwind's `select-none`, so nothing could
  be highlighted and right-click Copy had nothing to copy. Removed for the shell (the tab strip keeps it).
  Page content was never affected — the Set-of-Marks overlay and the phosphor cursor canvas are both
  `pointer-events: none`, and agent input goes over CDP.

## [1.4.1] - 2026-10-21

### Fixed

- **`dismiss_consent` never worked.** Its injected scan script contained a TypeScript cast
  (`(el as HTMLInputElement).value`) inside the string that is evaluated **in the page** — a syntax error,
  so every call failed with *"Script failed to execute"* and no consent wall was ever dismissed by the
  dedicated tool. Replaced with plain `el.value`.
- **Consent walls that appear after the page loads were missed.** Navigation armed a single dismissal at
  1.8 s; walls that mount later (hydration, redirect, or post-login — Reddit's cookie dialog arrives after
  sign-in) were never seen. `navigate_to` and `new_tab` now arm a **sweep at 0.9 s / 2.6 s / 6 s**, each
  attempt gated by a consent-only DOM check so an automatic sweep can never close an ordinary dialog.
- **The HIL banner covered the tab strip.** It was anchored top-right, exactly where the panel tabs and
  their COPY buttons live, so clicks and right-clicks there hit the banner. It now sits at the bottom-right,
  above the footer, still clear of the browsing viewport.

### Added

- **Right-click menu on the shell itself.** The context menu was only attached to browsing tabs, so
  copy/paste/select-all/inspect did nothing anywhere in the HUD. The Cyberdeck window now has the same menu
  (copy, paste, cut, select all, inspect element, DevTools), acting on the shell's own renderer.
- **`npm run test:consent`** — local fixture proving a consent wall injected 1.5 s after load is dismissed,
  and that an ordinary "session expiring" dialog is left alone (2 checks).

## [1.4.0] - 2026-10-21

### Added

- **Age verification and CAPTCHA are hard human hand-offs.** Before any model call, `decide` scans the state
  — and, for guarded calls, the **live page text** (`include_page_text`, on by default with
  `guard`/`eliminate`) — for age-gate copy ("verify your age/birthday", "birthday to continue", "18 or
  older", "adult content", "mature content", …) and for CAPTCHA / "verify you are human" copy. It returns
  **HTTP 409 `HUMAN_REQUIRED`** with the `gate` kind and the matched lines — **no model call, no elimination,
  no retry**. A confident answer cannot out-vote it, because the rule is "do not decide at all", and a
  `Date of birth` signup field does not match (tested both ways). New: `src/main/decide/sensitive-gate.ts`.
  The `/r/petite` run is the worked example: the component table exposed only "Not Now" / "Verify", the page
  said *"Verify your birthday to continue. This page may contain mature content."*, and the gate now stops
  there in 1 ms without asking the model — after an earlier run had wavered at `click` 0.44.
- **DECISIONS is the first tab whenever a decision model is active**, and is selected on reveal, so the
  live view of what the model is choosing is the default panel instead of something to hunt for.
- **The HIL banner no longer covers the page.** It was centred across the app with `alert-warning`; it is now
  anchored to the side panel (top-right, max 420 px), so a human being asked to act can still see the
  browser. It is also built with `textContent` instead of `innerHTML` — the reason can quote page copy (the
  sensitive-gate rule puts matched lines in it), and page copy is attacker-controlled.
- **Input-method ladder for typing — fixes the field that ignored keystrokes.** When real keystrokes
  provably reached the page and changed nothing, `act(type)` now retries the same text through **CDP
  `Input.insertText`** (no key events, but `beforeinput`/`input` fire — accepted by components that filter
  `keydown`), then through a **real clipboard paste** (restoring the previous clipboard afterwards), and
  re-verifies each rung. The outcome reports `typing.channel` (`keys` / `insertText` / `paste`) and
  `typing.attempted`; the ledger records them. A field that swallows keydown is now filled (verified in
  `test:act`: `channel=insertText`, value `740106`); a control that rejects every channel still returns
  `TYPE_NO_EFFECT`, but the hint now says *"rejected every input channel — keystrokes, CDP text insertion
  and clipboard paste… call request_human_intervention"* instead of blaming focus.
- **Docs: who writes the typed text, and HIL as a decision.** Jev never generates text — it decides that an
  operation is `type_text` and which field; **the agent** supplies the string. Kuang ships no generation
  model (jev-ultrafast embeds one because it owns the loop; ours is the caller). Human-in-the-loop is
  documented as a pair of questions (`handoff` noul + `handoff_for` choice) that the runner turns into
  `request_human_intervention`, with a roadmap note for an optional small text helper behind the same
  off-by-default config.
- **`decide` guard + elimination — the fallback ladder.** A decision is now checked before it is trusted:
  confidence below `guard.threshold`, a target that was not in the offered `guard.components`, a target whose
  `actions` do not include the operation, or a `done` answer contradicting the operation are all **rejected**.
  With `eliminate:{max_attempts}`, the rejected option is removed from that question and the model is asked
  again with what's left (capped at 5). When everything is eliminated the call returns
  `accepted:false, exhausted:true, fallback:"agent"` with `reasons`, `rejections` and `removed` — **no action
  is taken and the agent decides**. Ladder: model → eliminate + retry → agent. Covered by six new checks in
  `npm run test:decide` (17 total), including "the retry no longer offers the eliminated option".
- **DECISIONS tab in the HUD — shown only when a decision model is configured.** Mirrors every call to the
  decision model as it happens: backend + model, latency, each question with its type, the answers (choice +
  confidence, `noul` as yes/no with probability, score + level) or the typed failure, and a truncated state
  preview. It appears when a backend is saved in Settings and disappears when the backend is set to Off, so
  the panel never advertises something that isn't there. Backed by a ring buffer (last 50 calls) in the main
  process, exposed as `GET /decisions` so an agent can inspect what the model decided without scraping the UI.
- **Native right-click menu in browsing tabs.** A `WebContentsView` has no default context menu, so
  copy/paste/select-all, link and image actions, reload and **inspect element** were unreachable by hand
  even though the API had them. Each right-click now builds a menu from the click's own context: Undo/Redo/
  Cut/Copy/Paste/Paste-as-plain-text/Select-all in editable fields, Copy + "Search the web for …" over a
  selection, Open-in-new-tab / Open-in-system-browser / Copy-link-address over a link, Copy image / Copy
  image address / Save image as… over an image, plus Back/Forward/Reload, Copy page URL, Copy as Markdown
  link, Inspect element (opens DevTools at that pixel) and Open DevTools. Actions are issued against the
  tab's own `webContents`, because Electron menu roles target the focused window — which here is the shell,
  not the tab. Spellcheck suggestions are included when Chromium has them.
- **Settings tab (HUD) for the decision model.** A `⚙️ SETTINGS` button opens a dialog with the
  backend (`off` / `typesafe` / `d1-onnx`), model, endpoint, key, revision and device, a status badge
  showing what the app will actually use, and **Test connection** — which runs a real one-question
  `decide` and shows either the answer with its latency or the typed failure (`NOT_CONFIGURED`,
  `UPSTREAM_ERROR`, `TIMEOUT`). Saving writes `data/decision.json`, the same file the bridge and the
  MCP server read, so there is one source of truth; the key is stored locally and never logged.
  IPC: `settings:get-decision` / `settings:save-decision` / `settings:test-decision`.
- **`decide` — an optional decision-model surface, off unless configured.** One tool (and `POST /decide`
  on the bridge) that forwards `state` + typed `questions` to a decision model and returns the answers
  **verbatim**: no prompt assembly, no rewritten retries, no synthesis, and `UPSTREAM_ERROR`/`TIMEOUT`
  with **no answers** when the upstream fails. When nothing is configured the tool is **not registered**
  at all (`POST /decide` still answers `NOT_CONFIGURED` with setup instructions, and `/health.decision`
  reports the state). The MCP tool list is built when the stdio server starts, so a newly saved backend
  appears after the MCP server reconnects; the bridge picks it up on the next call.
  Two backends, chosen by config rather than code: **hosted Jev** (`protocol:"typesafe"`, e.g.
  `jev-1.13`) and **in-process ONNX** (`protocol:"local-onnx"`, via `open-jev`). Config lives in env vars
  or `data/decision.json` (gitignored). See [`docs/DECISION_MODELS.md`](./docs/DECISION_MODELS.md).
- **`npm run bench:decision`** — measures a local model on four page states (goal + component table,
  targets restricted by `actions`) and prints field accuracy + latency. Measured: `kev-0.6b` **5/12**
  (p50 1,118 ms), `open-jev` **7/12** (p50 750 ms) — both mechanically sound, both out of domain. That
  is why the local path is labelled experimental rather than recommended. (LiquidAI's d1-3B is **not**
  loadable by `open-jev`: its `detectFamily()` only understands `open_jev`/`kev` configs and d1 is
  `lfm2_vl`; the model card's snippet does not work against the published library.)
- **`npm run test:decide`** — offline contract test with a mock upstream (11 checks): unconfigured is
  loud, state/questions reach the model byte-for-byte, the bearer key is sent, answers and latency come
  back untouched, and an upstream 500 surfaces as `UPSTREAM_ERROR` with no fabricated answers.
- **`observe(as:"components")` — a decision-ready component table.** Instead of a flat mark list, each
  component carries its **role**, accessible **name**, current **value**, **state**, **region** (the
  nearest landmark: `form`, `dialog`, `nav`, `main`, …) and the **actions it actually accepts**
  (`click` / `type` / `select`; empty when disabled). Components are grouped by landmark in the text
  rendering, collected through open shadow roots like the rest of Set-of-Marks, and their ids **are
  mark ids**, so a decision ("click [8]") executes through `act(mark_id)` with no translation layer.
  ```
  ## form · Signup
  [7] input    "Email"       {type}
  [8] input    "Password"    {type}
  [9] button   "Create account" {click}
  ```
  The affordance partition is the point: a target head for `click` is only ever offered clickable
  components, so the model cannot pick a textbox for a click. Inspired by the dynamic action space in
  [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — with one difference: their
  element table explicitly excludes shadow roots, ours includes them.

### Fixed

- **The age-gate rule fired on pages that merely *mentioned* a gate.** The patterns included bare
  `captcha`, `18+`, `18 or older`, `adult content` and `mature content`, and guarded calls scan the page
  text — so documentation, forum posts and our own manual (which documents reCAPTCHA) tripped it. The rule
  is now **verb-anchored gate copy only** ("verify your age/birthday", "birthday to continue", "are you 18",
  "must be 18", "adults only", "age-restricted", "18+ only/required/content", "reCAPTCHA/hCaptcha/Turnstile",
  "verify you are human", "I'm not a robot", "human verification"), scans only the **first 1200 characters**,
  and **ignores app-internal pages** (`mark-eleven:`, `about:`, …). Verified: `github.com/login` answers 200
  with no gate; `/r/petite` still stops at 409 in 1 ms.
- **Copying out of the HUD was unreliable.** The right-click Copy used `wc.copy()`, which acts on whatever
  has focus in the tab — and opening a native menu can move focus to the shell, so the clipboard stayed
  empty. It now writes the click's own `selectionText` when there is one, and focuses the tab before
  Cut/Paste/Undo/Redo/Select-all. **MATRIX LOGS** and **DECISIONS** also gained a **COPY** button that writes
  their content through the main process (`app:copy-text`), so copying never depends on selection or focus.

- **Submit inputs were labelled with their `name` attribute instead of their visible label.** GitHub's
  `<input type="submit" name="commit" value="Sign in">` appeared in marks and the component table as
  `"commit"` — a meaningless identifier to any reader, human or model. Accessible-name computation now
  prefers `value` for `submit`/`button`/`reset` inputs before falling back to `name`.

### Changed

- **Decision-model docs corrected: TypeSafe `choice` takes `criteria`, not `options`.** The docs and the
  `decide` parameter example used `options: [...]`, which the OpenCode gateway rejects with
  `422 "Upstream request failed: Endpoint is unavailable."` — an error that reads like an auth failure or an
  outage and cost an afternoon of credential hunting. `criteria` is an option → description map; `noul` and
  `score` are unaffected. open-jev (the local path) still takes `options`.
- **Measured on the four-case page bench** (`npm run bench:decision -- --bridge`), with real criteria
  descriptions and the same information given to each model: **Jev 1.13 10/10 at 376 ms p50**, versus
  `kev-0.6b` 7/10 at 830 ms and `open-jev` 6/10 at 1,252 ms. The descriptions matter — `kev-0.6b` scored
  5/10 with bare option keys, and Jev's only earlier miss (CAPTCHA → `click`) disappeared once the `blocked`
  criterion described a wall. Jev is now the recommended backend; the local ONNX path stays experimental.

## [1.3.0] - 2026-10-20

### Fixed

- **Punctuation was silently swallowed while typing — `.` and `'` especially.** `keyDescriptor()` in
  `input-simulator.ts` used the character's **ASCII code as its Windows virtual-key code**, and ASCII
  collides with real VKs: `'.'` is 46 = `VK_DELETE`, `"'"` is 39 = `VK_RIGHT`. Chromium honours those as
  editing/navigation commands rather than inserting the character, so `act(action:"type")` typed
  `gmail.com` as `gmailcom` and corrupted any password containing `'` — with **no error, no failed
  post-condition and no delta** to give it away (the same silent-no-op shape as the `clear_first` bug
  below). Punctuation now maps to its real US-layout VK (`Period` 190, `Quote` 222, `Semicolon` 186,
  `Digit1`–`Digit0` for the shifted symbols, …). Covered by a new `npm run test:primitives` check that
  types all 32 printable punctuation characters and asserts an exact round-trip (37 checks total).

- **`clear_first` was a dead parameter — typing silently appended.** `act(action:"type")` had no way to
  replace an existing value, and the older `type_mark(clear_first)` flag was advertised but dropped by
  the bridge before it ever reached the chassis. Typing into a pre-filled field (e.g. an origin/airport
  box already reading `Exeter (EXT)`) therefore **appended**, corrupting the value and making the form
  look broken — which in turn masqueraded as "dropped clicks" when the invalid form refused to submit.
  `act` now takes **`clear_first: true`**, wired end-to-end (catalog → bridge → primitives → chassis →
  simulator) and implemented as a trusted **Ctrl+A + Backspace** (so React/Vue controlled inputs still
  update and `isTrusted` stays true — no synthetic `el.value` writes).
- **Guidance for the failure mode.** The `act` description, the OKF guide and `SKILL.md` now state that
  typing appends by default; a new OKF recipe **R6 — pre-filled fields & autocompletes (comboboxes)**
  covers committing an autocomplete by clicking the option mark, and warns against blindly re-clicking:
  a form silently rejected by validation looks exactly like a dropped click, and input is CDP-delivered
  (focus-independent), so a "lost focus" window is rarely the real cause.
- Covered by a new `npm run test:primitives` check: append by default, replace with `clear_first`.

- **`observe(as:"markdown")` was blind to shadow DOM, so web-component pages harvested as empty.** The
  harvester was fed `document.documentElement.outerHTML`, which **stops at the shadow boundary**: a
  `<faceplate-text-input>`-style control serialised as an empty host tag, and a live signup form (the exact
  flow in [`docs/FIELD_NOTES_2026-10-20_SIGNUP.md`](./docs/FIELD_NOTES_2026-10-20_SIGNUP.md)) came back as a
  skip-link, a heading and `chars=460/460` while the page held 331 KB of DOM. Serialisation now walks the
  **composed** tree (`src/main/harvester/dom-serializer.ts`): light children plus every open shadow root,
  recursively, with live form state baked in as attributes (`value`, `checked`, `selected` are properties,
  so `outerHTML` never showed them) and **password values reduced to a length**. Unrendered controls are
  dropped rather than harvested: a hidden CSRF input or a `display:none` recaptcha response textarea used to
  arrive as multi-kilobyte token text — on `reddit.com/register` the construct is 391 characters of real
  content instead of 2,752 characters of which ~2,300 were one Google token. `shadow_roots` in the envelope
  reports what was pierced.
- **The markdown cut at 25,000 characters was unreachable — `budget`/`next_cursor` paging was a dead end.**
  The truncation happened inside the harvester, so the remainder was already gone before `observe` could
  page it. Truncation now happens in `pageText`: the construct is whole, `total` is honest, and paging walks
  to the true end (a 167,000-character fixture pages in 18 calls). Markdown gets a 25,000-character default
  *view*; `budget: 0` returns everything.
- **`<select>` lost its current value, and every control rendered as a stray quoted string.** A `<select>`
  showed no selection (the `selected` attribute was stripped during serialisation and never rebaked), and
  inputs rendered as `<input type="text" "Email">`. Controls now render with stable labels —
  `<input type="text" label="Email" value="a@b.com">`, `<select label="Day" value="2" options="1,2,3">`,
  `<textarea label="Notes">…</textarea>` — read from attributes rather than DOM properties, because Turndown
  parses with **domino**, which does not implement `select.value` or `selectedOptions`. Relative links and
  image sources are resolved to absolute URLs so they can be followed without knowing the page URL.

- **`act` could not reach a control inside a web component — and reported success anyway.** A CSS
  selector cannot cross a shadow boundary, so `act({selector:"faceplate-text-input"})` resolved the
  *host*, clicked its centre (often a label), then applied `el.focus()` to the host — which either did
  nothing or moved focus off the inner `<input>`. The value never changed and the call returned a
  cheerful success (the exact failure in
  [`docs/FIELD_NOTES_2026-10-20_SIGNUP.md`](./docs/FIELD_NOTES_2026-10-20_SIGNUP.md) §2.2). Targeting
  now lives in `src/main/primitives/dom-targeting.ts`: selectors are searched through open shadow roots,
  a custom-element host resolves to **the control a mouse would actually hit** (deepest control at the
  host's centre, else the first control inside), and the focus nudge is applied to *that* control and its
  result reported, not assumed. A selector may also now name an element *inside* a shadow root
  (`#email`), which previously could only be reached by coordinates.
- **Typing is verified — a silent no-op is now a structured failure.** `act(action:"type")` used to
  return `Typed text (N chars) with variable human cadence` whether or not a character landed. It now
  installs a one-shot in-page probe (the control's value plus counters for trusted `keydown` /
  `beforeinput` / `input` events), reads it back after typing, and returns **`ok:false` with
  `error.code: "TYPE_NO_EFFECT"`**, a `typing` evidence object (`beforeLength`, `afterLength`, `changed`,
  `keydowns`, `beforeinputs`, `inputs`, `landed`) and a hint. The counters separate the two causes that
  used to look identical: `keydowns: 0` means the input never arrived (occluded click, unfocused window,
  0×0 viewport), while events-with-an-unchanged-value means the control **rejects** synthetic input —
  one-time-code/OTP fields, which is what happened in §2.3 of the field notes. The hint names
  `request_human_intervention` for that case. Only lengths and counters leave the page, so `secret`
  typing stays secret.
- **Field facts now resolve through shadow roots.** `act`'s `target.field` returned `null` for any
  web-component control (the host is not input-like), so the typed-facts feature was silent exactly
  where forms are most common. It now reports the inner control, its real value length, and
  `inShadowRoot: true`.
- **A 0×0 viewport no longer produces a confident click at the wrong place.** A freshly-created tab can
  report a 0×0 viewport before layout settles; geometry resolved then is meaningless — during testing
  this clicked `(31, 0)` on a fixture whose button sat at `(231, 90)` and still returned success. Both
  `act` and the chassis now refuse to act on a 0×0 viewport and say why (`NO_TARGET` / an explicit
  error), rather than clicking a point derived from nothing.
- **The failure diagnostic reads the deepest focused element.** The `act` triage hint compared
  `document.activeElement` (the host) against the target tag, which false-positived on shadow controls;
  it now descends `shadowRoot.activeElement` chains, so "focus is on <x>, not the target" is true when
  it is said.
- **Set-of-Marks and `find` were blind to shadow DOM.** Candidate collection used
  `document.querySelectorAll(SEMANTIC)`, so a web-component form produced **0 marks** while its buttons were
  plainly visible; even when a shadow control was reached, the occlusion check (`document.elementFromPoint`
  returns the *host* for shadow content) would have discarded it as covered, `closest()` stopped at the
  shadow boundary for popup/visibility classification, and stamped ids were resolved with
  `document.querySelector('[data-mark-id]')`, which cannot see inside a shadow root. Marks now walk **every
  open shadow root**, hit-test the deepest element, use composed containment for occlusion, composed
  ancestor walks for `aria-hidden`/popup/static classification, and resolve marked elements through shadow
  roots — so `find`, `act(mark_id)` and the inline `[#id]` badges in `observe(as:"markdown")` all work on
  shadow controls. On the field-notes signup fixture the mark list went from empty to
  `#1 <INPUT> "Email"` plus the shadow button, and `act(mark_id=#1, type)` lands in the inner input.

### Added

- **`npm run test:act`** — live fixture for the interaction path (19 checks): typing through a
  custom-element host lands in the inner input, a selector inside a shadow root actuates a shadow
  button, a reverting one-time-code field returns `TYPE_NO_EFFECT` with the right hint, the ledger
  records `landed:false`, `clear_first` works inside a shadow control, an identical retype is not
  mistaken for a no-op, Set-of-Marks badges the shadow controls and `find` returns them, `act(mark_id)`
  types through a mark into a shadow input, `observe(as:"markdown")` carries the `[#id]` badge, and an
  unresolvable selector fails loudly.
- **OKF recipes R7 (web components: the host is not the control) and R8 (read it back)** in
  [`kuang_docs/partitions/primitives_and_workflows.md`](./kuang_docs/partitions/primitives_and_workflows.md).
- **`npm run test:markdown`** — live fixture covering the composed-DOM harvest (shadow text, shadow controls,
  value baking, password redaction, select state, absolute links), envelope minimalism, harvest stability
  across two calls, paging to the end of a 167 KB construct, and the text-free-page message (20 checks).
- **Action ledger — a local dataset for a decision layer** (`src/main/telemetry/action-ledger.ts`). Every
  **executed** action now appends one JSON line to `data/transitions.jsonl` (gitignored, local-only): the
  page-state signature before/after (`url`, `revision`, mark count), the resolved target, the delta, the
  `await_conditions` result, the rule-based triage hints, and the duration. **Typed text is recorded as a
  character count only** — never the string, plus the `secret` flag. Writes are queued and non-blocking and
  errors are swallowed, so a ledger failure can never break an action; the file rotates to
  `transitions.1.jsonl` past 5 MB. Rationale and usage: [`docs/DECISION_MODELS.md`](./docs/DECISION_MODELS.md).
- **Typed field facts on `act`.** The `act` result's `target.field` now reports `{ tag, type, role, name,
  valueLength, isEmpty, prefilled, editable, required, disabled }` for the addressed form control — **including
  on `dry_run`**, so a decision layer (or an agent) can pre-flight *"is this field already filled? should I
  pass `clear_first`?"* from data instead of guessing. `act` also returns `durationMs`.
- **`docs/DECISION_MODELS.md`** — where a Jev-style ("System One") decision model fits: Kuang surfaces typed
  facts and evidence; the decision maker belongs in the runner, not inside the browser server.

### Changed

- **The construct envelope is minimal, stable and honest.** The old front-matter spent nine lines on
  constants and vanity: `designation` (a fixed string), `raw_bytes`, `construct_bytes`, `estimated_tokens`
  and a `compression_ratio` computed against raw HTML bytes — which read `0.0%` on exactly the pages where
  markdown was empty, i.e. it was worst where it mattered most — plus a `harvested_at` timestamp that made
  **two harvests of one unchanged page differ**, which quietly broke diffing and paging across calls. It is
  now `url` / `title` / `reader` / `extracted_chars` / `page_chars` / `shadow_roots`. `reader` names the
  extraction path that produced the body (`readability` or `full-body`), and `extracted_chars` is measured on
  the same unit as `page_chars` (characters of page text) so the coverage claim is checkable rather than
  decorative. A partly-visible page now says so — *"the extracted region holds 3,200 of the page's 41,000
  characters…"* — and names the alternates (`observe(as:"text")`, `observe(as:"ax")`) instead of looking
  short; a page with no text explains why instead of returning an empty body. Token counts and byte sizes
  still reach the caller through the response object and the MCP header line, which now reads
  `chars=25034 of 167063 · ~41766 tokens · next_cursor=25034` instead of the ambiguous `chars=460/460`.

- **`mouse_move` telemetry fires once per glide, not once per step.** The humanlike cursor reports
  position/velocity from `moveMouseTo`, which loops over a 38–140-step Bézier trajectory — and it was
  emitting a `mouse_move` telemetry event *per step*, so a single click flooded the Cyberdeck telemetry
  feed with up to 140 rows and inflated the pulse counter. Events are now emitted once per glide (final
  position + velocity); the **in-page** phosphor trail is unaffected, because it is drawn per step by
  `window.__kuangMoveCursor`. (The HUD panel's own fading polyline is correspondingly coarser — a one-line
  revert if that denser look is preferred.) Note this is display-only telemetry: it never reached the
  agent, and it doubles as a signal that `act` (rather than synthetic JS input) was used, since synthetic
  clicks emit no `mouse_move` at all.

## [1.2.0] - 2026-10-19

### Fixed

- **9 MCP tools returned `HTTP 404: Endpoint not found`** because their catalog `endpoint`/`method`
  had drifted from the HTTP bridge's routes: `navigate_history`, `recall_memory`, `get_history`,
  `clear_history`, `list_bookmarks`, `save_session`, `restore_session`, `list_sessions`, and
  `get_console_logs` (wrong HTTP method).
  - `get_history` and `list_bookmarks` now use `GET` with query parameters, and `list_bookmarks`
    sends `q` (the bridge's parameter name) — previously the filter parameters were silently
    dropped, and the tools themselves 404'd.
- **Selector clicks could actuate twice.** `browser-chassis.ts#clickElement` ran a second,
  *untrusted* `el.click()` in page JS after the trusted CDP click, which double-submitted forms and
  double-opened links. The synthetic click was removed; the trusted CDP click alone actuates (the
  `focus()` nudge for non-link/button controls remains).
- **`list_bookmarks` didn't actually filter.** Its `query` parameter ran a vector search with no
  threshold, so with fewer bookmarks than `limit` it returned *every* bookmark (ranked) — identical
  output to no query at all. `query` is now a real filter: a bookmark matches when every query term
  appears (case-insensitively) in its title, notes, URL, or tags, and matches are then ranked by
  embedding similarity. Covered by `npm run test:cortex:bookmarks`.
- **Detached `WebContentsView` reads were flaky.** Off-screen reads (`llm_fetch` per-page alternates,
  `search_web` SERPs, `deep_crawl` page renders) created and destroyed a view per call and trusted
  `did-finish-load` — which the view's *initial about:blank document* also fires — so reads would
  intermittently return an empty DOM (missed search results, missing crawl links). All detached
  operations now share **one reusable off-screen view** (serialized), await the `loadURL()` promise
  for the navigation they started, and poll the live DOM before reading.

### Added

- **`npm run test:mcp:contract`** (`scripts/test-mcp-contract.mjs`) — parses `src/mcp/tools-catalog.ts`
  and `src/main/http-bridge.ts` and fails if any catalog entry maps to a `{method, path}` the bridge
  does not serve. No running Cyberdeck required, so it can run in CI. It caught a ninth broken tool
  (`get_console_logs`) on its first run.
- **`npm run test:mcp:surface`** (`scripts/test-mcp-surface.mjs`) — asserts deprecated names are
  absent from `tools/list` yet still callable, canonical names are present, a deprecated call returns
  its notice, and the merged `take_screenshot` modes behave.
- **`docs/TOOL_CATALOG_REVIEW.md`** — catalog duplication/overlap analysis with a phased
  consolidation plan (correctness → de-duplicate → consolidate → tier).
- **`docs/HIDDEN_ALIAS_REMOVAL_V1.2.md`** — the concrete plan to remove all 23 hidden aliases in
  v1.2 (inventory, removal steps, bridge-route decision, risk).
- **`mark-eleven://tools/recommended`** — a new MCP resource (also `help(category:"recommended")`)
  giving the canonical order for the five common jobs: read → `observe`, find → `find`, act → `act`,
  wait → `wait_for`, harvest → `collect_all`.
- **Pluggable Cortex embedding providers** (`src/main/cortex/embedder.ts`). Embedding now sits behind
  an `EmbeddingProvider` interface (`id` + `dim` + async `embed`). The deterministic `hash-128`
  embedder stays as the zero-dependency default; a real model (e.g. EmbeddingGemma-2 via ONNX) can be
  registered and selected via `KUANG_EMBEDDING_PROVIDER`. CortexDB records the active provider in
  `embedding-provider.json` and warns when it changes, so vectors from different models are never
  silently compared. See `docs/EMBEDDING_PROVIDERS.md`.
- **`npm run test:cortex:bookmarks`** (`scripts/test-bookmarks-search.mjs`) — adds tagged bookmarks,
  asserts `query` filters (exact hit, empty on no match, AND across terms, composition with `tag`),
  and cleans up. SKIPs when the bridge is down.
- **Phase 7 surface checks** in `npm run test:mcp:surface` — the new hidden aliases (`recall_script`,
  `focus_window`, `clear_network_traffic`, `clear_stream_messages`) still execute and return a notice
  pointing at their canonical tool; `list_scripts(query)` searches; `clear_capture` clears; and
  `observe` no longer advertises the structured `list|table|app_data` modes (which now live on
  `extract`).
- **`llm_surface` + `llm_fetch` — LLM-friendly site discovery (Feature 6).** Many sites publish a
  Markdown/Text representation (`/llms.txt`, `/llms-full.txt`, a `<link rel="alternate">`, or content
  negotiation). `llm_surface({ url? })` probes for those; `llm_fetch({ url?, as? })` reads the
  advertised one (~5–10× cheaper than a render). **Gated:** `llm_fetch` refuses (`NO_LLM_SURFACE`)
  unless the site advertises a surface, and never fetches arbitrary URLs or guesses paths.
  Well-known paths (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`) are `net.fetch`ed on Chromium's
  network stack and cached per origin; a page's advertised alternate is loaded via a **real document
  navigation**, not a synthetic fetch. A `text/html` response is never mislabelled as Markdown.
  New: `src/main/llm/llm-surface.ts`, routes `POST /llm/surface` + `POST /llm/fetch`, and
  `npm run test:llm` (local-fixture regression).
- **`search_web` — configurable multi-engine search (Feature 5).** Runs each query in a **detached
  WebContentsView** (real Chromium; the active tab is never hijacked) and falls back across engines
  when one returns a bot-check/consent wall: `google | duckduckgo | bing | brave | startpage |
  custom` (default chain `google → duckduckgo → brave`). The `custom` engine takes a `{query}` URL
  template (e.g. SearXNG, or `KUANG_SEARCH_URL`). Returns ranked `{rank, title, url, snippet}` —
  plain URLs to feed `navigate_to` / `collect_all`. Unwraps Google `/url?q=`, DDG `/l/?uddg=` and
  Bing `/ck/a` redirects. New: `src/main/search/search-engine.ts`, route `POST /search/web`, and
  `npm run test:search`.
- **`deep_crawl` — autonomous multi-page crawl (Feature 1).** Breadth-first crawl from a seed URL,
  bounded by `max_depth` / `max_pages`, same-origin by default and scoped by `match_patterns`
  (glob or `/regex/`). Each page takes the **cheap path first** — content-negotiated Markdown/Text
  when the site advertises it (see `llm_surface`), otherwise a detached render — and is distilled
  to Markdown and **indexed into LanceDB Cortex**. Returns a per-page summary (`depth`, `via`,
  `bytes`, `links`, `indexed`). New: `src/main/crawl/crawler.ts`, route `POST /crawl/deep`, and
  `npm run test:crawl`.
- **`research_topic` — autonomous research mode (Feature 3).** Runs `search_web` → gathers the top
  sources (cheap Markdown path first, else a detached render) → distills them to Markdown → indexes
  them into LanceDB Cortex. Returns **extractive, cited evidence**: every per-source highlight is a
  real paragraph that mentions the query terms, plus the ranked source list. It deliberately does
  **not** synthesize prose (Kuang has no LLM) — the calling agent writes the answer, and can follow up
  with `recall_memory` over the indexed pages. New: `src/main/research/researcher.ts`, route
  `POST /research/topic`, and `npm run test:research`.

### Changed

- **`extract` gained two kinds (Feature 2 — structured data).** `kind:"schema_org"` parses
  `<script type="application/ld+json">` into **typed** items (flattens `@graph`; `type` filters to e.g.
  `"Recipe"` / `"Product"` / `"FAQPage"` / `"HowTo"`), and `kind:"tables"` returns **every** table on the
  page (the existing `table` kind reads only one). The rest of Feature 2 already existed and is unchanged:
  the clean article body is `observe(as:"markdown")` (Mozilla Readability, with an aggregator fallback), and
  `kind:"app_data"` already returned parsed JSON-LD / `__NEXT_DATA__`. No new tool was added.
- **Advertised tool surface trimmed from 74 to 54** with no capability removed. Deprecated names
  are hidden from `tools/list` but still callable by name; calling one returns a
  `⚠ deprecated tool name — use "…"` notice.
  - **Phase 2 (de-duplicate):** `go_to_url` → `navigate_to`; `harvest_markdown` →
    `get_page_markdown`/`observe`; `send_desktop_notification` → `send_notification`;
    `save_session` / `restore_session` / `list_sessions` → `context_save` / `context_open` / `context_list`.
  - **Phase 3 (consolidate):** merged `take_annotated_screenshot` / `take_economy_screenshot` /
    `list_marks` into **one** `take_screenshot({ marks, detail: "full"|"economy"|"markdown" })`; folded
    `get_page_markdown` → `observe(as:"markdown")`, `list_marks` → `observe(as:"som")`,
    `get_api_payload` / `get_stream_messages` → `query_json_data`, `get_page_info` → `bridge_health`.
  - **Phase 5 (unify interaction):** `click_element` / `click_mark` / `type_text` / `type_mark` folded
    into **`act`**, which now accepts `mark_id | selector | x+y`. See below.
  - **Phase 7 (overlap sweep):** `recall_script` → `list_scripts({ query?, tag?, limit? })` (the vault
    list/search were one call); `focus_window` → `set_window_visibility({ visible?, focus? })` (the
    bridge already focused on show); `clear_network_traffic` / `clear_stream_messages` →
    `clear_capture({ scope })`; `observe`'s enum narrowed to `markdown|text|ax|som` with the structured
    `list|table|app_data` reads living on `extract` (the implementation was already a thin wrapper).
- **`take_screenshot` is now the single screenshot tool.** `marks=false` (default) returns a plain
  viewport image; `marks=true` returns Set-of-Marks with `detail:"full"` (PNG), `"economy"` (640px
  JPEG), or `"markdown"` (marks table, no image). It fronts both `/screenshot` and `/marks/screenshot`
  per call via the new `endpointFor` catalog field, and the image-return path is unified.
- **Renamed the ambiguous Cortex history pair:** `get_history` → `browsing_history` and
  `clear_history` → `browsing_history_clear` (old names kept as hidden aliases). `navigate_history`
  keeps its name — it really is page-navigation history.
- **`act` is now the single interaction entry point.** It addresses one target three ways —
  `mark_id` (preferred: a Set-of-Marks badge, re-resolved against the live DOM), `selector`, or
  `x`+`y` viewport coordinates — and performs `action: "click" | "focus" | "hover" | "type" | "press"`
  with the same delta report, `await_conditions`, `dry_run`, and `secret` as before. The four old
  front doors (`click_element`, `click_mark`, `type_text`, `type_mark`) are hidden aliases. `press_key`
  remains a visible tool. The tool name stays generic on purpose (a `click_*` name would lie once it
  also types/hovers); the advertised description leads with the concrete verbs, enumerates the three
  address modes, and says explicitly what it is *not* for (navigation, scrolling).
- The `help` categories and the `mark-eleven://skills/guide` OKF guide now reference canonical names
  only.
- **Descriptions now carry discoverability guidance.** A `TOOL_TIERS` map drives an auto-generated
  prefix on the 13 tools that have a preferred alternative — `[TIER 1 · prefer]` (observe, act,
  wait_for, expect, find, extract, collect_all, page_state, diff), `[TIER 2 · fallback]`
  (take_screenshot, snapshot_rendered_page, press_key), `[TIER 3 · use deliberately]` (evaluate_javascript).
  Hidden aliases show `[DEPRECATED → use "X"]`; tools that are the only way to do their job stay
  unprefixed.

### Removed

- **Dead MCP code.** Deleted `src/mcp/server.ts` — a 45-tool in-process server that
  `src/main/index.ts` imported but never invoked (superseded by `bridge-server.ts`) — and its
  now-unused import. Deleted the orphaned `scripts/mcp-server.cjs` bundle, which `npm run build:mcp`
  no longer produces (it emits `bin/mcp-server.cjs` + `scripts/mcp-server.js`) and which still
  carried pre-Phase-7 tool names.

## [1.1.1] — 2026-10-19

### Fixed

- **MCP stdio server could vanish mid-session ("kuang goes away").** The server wrote ~500 bytes
  of diagnostics to `stderr` on every tool call. A client that pipes stderr but never drains it
  fills the OS pipe buffer (~64 KiB ≈ ~125 calls) and the child stops answering JSON-RPC while the
  Cyberdeck stays healthy — so the whole `kuang` tool namespace disappeared.
  - Per-call diagnostics now go to the file log only (`data/logs/mcp-server.log`), written through
    a bounded asynchronous queue (no `appendFileSync` in the hot path).
  - `stderr` carries a short boot banner by default. Writes are backpressure-aware: if a write
    returns `false` the channel goes quiet until `drain`, lines are **dropped rather than queued**,
    and total stderr is hard-capped at 16 KiB.
  - The verbose `tools/call` dump was moved off `console.error`.
- **A wedged Cyberdeck could hang a tool call forever.** Every `http://127.0.0.1:4111` round-trip
  now has a timeout ceiling (`KUANG_BRIDGE_TIMEOUT_MS`, default `300000` ms — above any legitimate
  HIL / navigation wait) and returns a clear error instead of blocking indefinitely.
- **Orphaned stdio children.** Closing `stdin` (`end` / `close`) now triggers a logged, clean
  `exit(0)` with a synchronous log flush, so the child can no longer linger and compete for the
  single browser session.

### Added

- **Diagnostics controls:** `KUANG_MCP_LOG=0` (disable the file log), `KUANG_MCP_STDERR=0`
  (disable stderr), `KUANG_MCP_STDERR=verbose` (per-call stderr, debugging only).
- **`KUANG_BRIDGE_TIMEOUT_MS`** to tune the per-round-trip bridge ceiling.
- **[docs/HANDOFF_ORCHA_MCP_STDERR.md](./docs/HANDOFF_ORCHA_MCP_STDERR.md)** — full root-cause
  write-up, the live reproduction, and the conformance checklist for MCP clients.

### Changed

- `npm run build:mcp` now emits **both** `bin/mcp-server.cjs` (canonical) and `scripts/mcp-server.js`
  (used by the test harnesses) so the two bundles can no longer drift out of sync.

### Verification

Live Cyberdeck, `bridge_health` driven 600× through the bundled stdio server:

| Scenario | Before | After |
| :--- | :--- | :--- |
| stderr piped, **never read** | 158 responses, 4 timeouts, stall @ call 157 | **601 responses, 0 timeouts** |
| stderr drained (control) | 601 responses, 0 timeouts | 601 responses, 0 timeouts |
| stderr bytes for 25 calls | ~13 000 B | **0 B** |
| boot banner | logged per call | **199 B, 2 lines** |
| `stdin.end()` | unmanaged | **exit code 0 + shutdown log line** |
| `npm run test:mcp:primitives` | — | **ALL CHECKS PASSED (14)** |

`npx tsc --noEmit` clean.

## [1.1.0] — 2026-10-18

### Added

- **Orthogonal primitive layer:** `observe`, `act`, `wait_for`, `expect`, `find`, `extract`,
  `collect_all`, `page_state`/`diff`, `export_har`, and `context_save`/`open`/`list`/`delete`
  (replace blind sleeps and guessy selectors). 16 new tools, 1 new OKF playbook partition.
- **Focus-independent CDP input:** clicks, typing, and wheel scrolling are delivered over the
  tab's attached debugger (`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `mouseWheel`) with
  focus emulation, so input lands even when another application owns the OS foreground.
  `bridge_health` reports `input.transport` (`cdp` | `native`).
- **Background-render hardening:** `backgroundThrottling: false` plus
  `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` /
  `--disable-background-timer-throttling`, so occluded windows still hydrate, scroll, and fire
  `IntersectionObserver` callbacks.

See [docs/PROPOSED_ABSTRACTIONS.md](./docs/PROPOSED_ABSTRACTIONS.md) for the design and status.

[1.4.2]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
