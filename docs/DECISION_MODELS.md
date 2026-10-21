# Decision Models & Kuang — where a "Jev-style" head fits

**Status:** positioning note + substrate (2026-10-20) · **Related:** [`../TODO_RESEARCH_CRAWL.md`](../TODO_RESEARCH_CRAWL.md), [`PROPOSED_ABSTRACTIONS.md`](./PROPOSED_ABSTRACTIONS.md)

## What "Jev" is

Jev (TypeSafe AI, Sept 2026) is a **decision model**, not a language model. You send it program state plus a
**fixed list of typed options** and it returns a **categorical probability distribution with confidence
scores** — no free-form text, typically 70–500 ms, orders of magnitude cheaper than an LLM. It is
*discriminative*: the answer is always one of the options you supplied, and it cannot handle an option set
it wasn't asked about. Related work: *LLM-as-Jev* (arXiv 2610.02076) and *An Empirical Study of Jev in Agent
Workflows* (arXiv 2610.13092).

The natural reading of that literature: **agents do not need an LLM for every decision.** Constrained
decisions (classify, route, score, verify) are better served by a fast typed head, with the LLM reserved for
open-ended reasoning and generation.

## The rule

> **Kuang surfaces typed facts and evidence. The decision maker lives above it.**

Kuang is an MCP **tool surface**, not an agent framework. A runner-side decision model wins precisely where
it replaces an LLM *turn*; a model buried inside the browser server would only move the choice, because the
agent still had to spend a turn to ask for it. So:

- **In the runner** (e.g. Eve / agent-orcha): *epistemic* decisions — what is the goal, which tool family,
  is the task done, which of N candidate actions next, when to hand over to a human. This is where a Jev-style
  head belongs, and where gains in latency and cost actually materialise.
- **In Kuang**: *perception and mechanics* — did the click land, is the target stale, is this field already
  filled, which wait condition fits. These must run inside a tool call at sub-100 ms, are invisible to the
  agent, and are already implemented as deterministic heuristics (e.g. `typeMark` re-resolves and re-clicks
  once if the target didn't take focus; `act` emits triage hints on a failed `await_conditions`).

Kuang therefore does **not** ship a policy model, and should not: it would add a heavyweight, network-bound
dependency to a local-first tool, hard-code today's decision taxonomy, and hide decisions from the agent.

## What Kuang provides for a decision layer

Everything below is already emitted, typed, and observable from the tool result:

| Signal | Where | Use for a decision head |
| :--- | :--- | :--- |
| Enumerated option sets | `act.action`, `take_screenshot.detail`, `observe.as`, `extract.kind`, the `wait_for` condition vocabulary, `clear_capture.scope`, `llm_fetch.as` | The options are already a fixed list — exactly Jev's input shape |
| Typed field facts | `act` result → `target.field` (`prefilled`, `valueLength`, `editable`, `disabled`, `required`, `name`, `type`, `inShadowRoot`) — **also on `dry_run`** | Decide `clear_first` from data instead of guessing; pre-flight without acting |
| Outcome delta | `act` result → `delta` (`urlChanged`, `revisionBefore/After`, `marksBefore/After`) + `durationMs` | Learn/predict "will this action change anything?" |
| **Typing verdict** | `act` result → `typing` (`landed`, `changed`, `beforeLength`, `afterLength`, `keydowns`, `beforeinputs`, `inputs`) and `ok:false` + `error.code: "TYPE_NO_EFFECT"` on a provable no-op | Label a no-op *without* a second round trip, and separate "input never arrived" (0 key events) from "the control refused it" (events, value unchanged) — the two need different remedies |
| Post-condition result | `act` result → `awaited.ok` (+ `hint`) | Distinguish *acted-but-nothing-happened* from *not-ready-yet* |
| Triage hints | `awaited.hint`, `error.hint` (viewport 0×0, unfocused window, wrong deepest `activeElement`, control rejects input) | Classify a no-op click *or* a no-op type without another round trip |
| Typed errors | `STALE_REF`, `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED`, `TYPE_NO_EFFECT` | Deterministic classes to route on |
| Advisory recommendations | `llm_surface.recommended` (`llms_txt`/`llms_full`/`markdown`/`text`/`rendered`) | Precedent for "recommend, don't silently switch" |
| **Action ledger** | `data/transitions.jsonl` (local, gitignored) | A labelled `(state, action) → outcome` dataset |

## The dataset: `data/transitions.jsonl`

One JSON object per executed action (never plaintext — typed text is a character count):

```json
{"ts":1750000000000,"action":"type","addressMode":"selector","address":"#origin",
 "target":{"selector":"#origin","tag":"input","field":{"tag":"input","name":"Origin","valueLength":11,"isEmpty":false,"prefilled":true,"editable":true}},
 "url":"https://example.com/search","revisionBefore":42,"revisionAfter":42,"marksBefore":18,"marksAfter":18,
 "urlChanged":false,"marksChanged":false,"ok":true,"awaitOk":false,
 "hints":"focus is on \"#origin\", not the target <INPUT> — the click may have been occluded",
 "durationMs":812,"typed":{"chars":6,"secret":false,"landed":true},
 "typing":{"beforeLength":11,"afterLength":17,"changed":true,"keydowns":6,"beforeinputs":6,"inputs":6,"landed":true},
 "clearFirst":false}
```

That single line is a complete supervised example: the state signature, the action and its addressing, the
field's prior contents, the outcome, and the triage hint. Filtered by `urlChanged`/`marksChanged`/`awaitOk`,
it separates *did something* from *did nothing* — the exact distinction a triage head needs.

## What a runner-side head could do with it

1. **Outcome triage** (highest value): classify a failed action into `{stale-ref, occluded-click,
   validation-blocked, genuine-no-op, success}` — the failure mode that made an earlier agent re-click a
   Search button forever while a corrupted field silently blocked the form.
2. **`clear_first`** and general form handling: decide replace-vs-append from `target.field.prefilled`.
3. **`wait_for` condition choice**: pick from the condition vocabulary instead of the LLM hand-writing one.
4. **Screenshot economy**: choose `detail` ∈ `{full, economy, markdown}` before burning image tokens.
5. **Challenge routing**: `{dismiss-consent, text-captcha, human-intervention, ignore}` on a blocked page.
6. **Tool routing** (runner-only): pick the next tool family without an LLM turn.

## Guardrails

- **Advisory, not silent.** Return the decision *and its confidence*, keep the deterministic path as the
  fallback for low confidence, and never let Kuang mutate on a model's say-so. This is the same call already
  made twice: `llm_surface` recommends a surface rather than fetching it, and `act` returns a delta rather
  than retrying behind the agent's back.
- **Discriminative limits.** It can only choose from the options given, cannot explain itself, and degrades
  on out-of-distribution pages. Keep the LLM path for novelty, planning and prose.
- **Local-first.** If it must call a hosted decision API, that is a deliberate, documented exception — the
  ledger and the field facts stay on the machine either way.

## The optional `decide` surface

`decide` ships **off**. With no backend configured it is not advertised at all, and calling it returns
`NOT_CONFIGURED` with setup instructions. When it is configured it does exactly one thing: forwards
`state` + typed `questions` to the configured model and returns the answers **verbatim** — no prompt
assembly, no retries that rewrite the question, no synthesis, and no fabricated answer if the upstream
fails (`UPSTREAM_ERROR` / `TIMEOUT`, with `answers` absent).

Configure with environment variables (authoritative) or `data/decision.json` (gitignored):

```json
{ "protocol": "typesafe", "url": "https://api.typesafe.ai", "model": "jev-1.13", "key": "…" }
```

```json
{ "protocol": "local-onnx", "model": "kev-0.6b", "device": "cpu" }
```

| Key | Env | Meaning |
| :--- | :--- | :--- |
| `protocol` | `KUANG_DECISION_PROTOCOL` | `typesafe` (hosted Jev) or `local-onnx` (in-process, open-jev) |
| `url` | `KUANG_DECISION_URL` | Base URL for `typesafe` (`…/v1/systemone` or just the host) |
| `model` | `KUANG_DECISION_MODEL` | `jev-1.13` (default, hosted) or `kev-0.6b` (default, local) |
| `key` | `KUANG_DECISION_KEY` | Bearer token for the hosted API (never sent to a local model) |
| `device` | `KUANG_DECISION_DEVICE` | `cpu` (default) or `webgpu` for the local model |
| `timeoutMs` | `KUANG_DECISION_TIMEOUT_MS` | Upstream deadline (default 30 s) |

**Two backends, deliberately.** Hosted Jev answers in 70–500 ms at ~$0.042/Mtok input (output is free)
and is the reference implementation. The local path runs `open-jev` (Transformers.js / ONNX) in-process
with **no model bundled**: `kev-0.6b` (Qwen3-0.6B, 0.34 GB) by default, or `open-jev` (DeBERTa-v3-large,
0.35 GB). Install once with `pnpm add open-jev @huggingface/transformers`; weights download on first use.

### Local model status — measured, not assumed

`scripts/bench-decision-model.mjs` runs four realistic page states (empty password + a dead submit, an
already-signed-in page, a cookie banner, a CAPTCHA) using the exact payload Kuang sends — a goal plus the
component list, with target options restricted by each component's `actions`. Run it against the configured
backend (`--bridge`) or a local model (`kev-0.6b cpu`):

| Backend | Field answers correct | p50 latency |
| :--- | :--- | :--- |
| **Jev 1.13** (OpenCode Console) | **10 / 10** | **376 ms** |
| `kev-0.6b` (local, Qwen3-0.6B) | 7 / 10 | 830 ms |
| `open-jev` (local, DeBERTa-v3-large) | 6 / 10 | 1,252 ms |

All three were given the same information: each option carries a one-line description (`criteria` for
TypeSafe, `descriptions` for open-jev). That matters — with bare option keys `kev-0.6b` scored 5/10, and
with descriptions 7/10; Jev's CAPTCHA miss (`click` instead of `blocked`) disappeared entirely once the
`blocked` criterion actually described a wall. **Write real criteria, not `"Choose \"click\""`.**

Jev answers every scenario exactly right, including `blocked` at 0.96 and `done` at 0.96. The local models
never once chose `blocked`, which is the single most important decision on a hostile page. **Use Jev for page
decisions; treat the local path as experimental.**

### Question shape: `choice` takes `criteria`, not `options`

TypeSafe's `choice` question expects a **map of option → description** in `criteria`:

```json
{ "type": "choice",
  "instructions": "What is the next operation?",
  "criteria": { "click": "Click a control", "type_text": "Type into a field", "done": "The goal is met" } }
```

Sending `options: [...]` instead does **not** return a validation error — the OpenCode gateway answers
`422 {"message":"Upstream request failed: Endpoint is unavailable."}`, which reads like an auth failure or
an outage and sent us chasing the key for a while. `noul` and `score` are unaffected (`score` takes an
array of level criteria). open-jev, by contrast, takes `options`.

**d1-3B is not supported by `open-jev`.** Its `detectFamily()` only accepts configs with an `open_jev` or
`kev` section, and LiquidAI's d1-3B is `lfm2_vl` — the snippet on its model card does not work against the
published library. Running d1 means implementing its prompt + readout directly against
`@huggingface/transformers` (pinning e.g. `294fdcd…`), feeding the VLM graph including images, and running
it where WebGPU exists (the Electron renderer, not the Node main process). That is a separate piece of
work, and on CPU it would be seconds per decision.

### The loop it is designed for

1. `observe(as:"components")` → the component table (role, name, value, region, **actions**; ids are mark ids).
2. One `decide` call with all the questions at once — the TypeSafe "speculative fan-out" shape, where every
   target head only contains components whose `actions` include that operation:

```json
{
  "operation":  { "type": "choice", "instructions": "What is the next operation?", "criteria": { "click": "Click a control", "type_text": "Type into a field", "done": "The goal is met", "blocked": "A wall: CAPTCHA, consent, login" } },
  "click_target": { "type": "choice", "instructions": "Which component to click?", "criteria": { "7": "Email field", "9": "Sign in button", "12": "Dismiss banner" } },
  "type_target":  { "type": "choice", "instructions": "Which component to type into?", "criteria": { "1": "Email field", "2": "Password field" } },
  "is_done":      { "type": "noul", "instructions": "Does the visible state satisfy the goal?" }
}
```

`choice` takes **`criteria`** (option → description), not `options` — see the note above.

### Who writes the text? (the answer is: the agent)

Jev is decision-only. It answers `choice` / `score` / `noul` over a state and **never generates text** —
there is no prose path in it at all. So the split is:

```
Jev (decide)      → operation = "type_text", target = "8"     a decision
the agent (LLM)   → the string to type                        generation, over MCP
Kuang (act)       → focus, keys, verify (typing.landed)        execution + proof
```

This is deliberate: Kuang ships **no text-generation model**. jev-ultrafast embeds a small LLM
(`mercury-2.5` in its example) because it owns the whole loop; here the loop lives in the agent, which
already has a model. That keeps Kuang local-first and key-free, and keeps the words under the agent's
control. In practice: `decide` says *which* field and *that* typing is next; the agent supplies the text
via `act(mark_id, action:"type", text:"…")`.

**Roadmap:** an *optional* text helper — the equivalent of jev-ultrafast's small model — for runners that
have no LLM of their own. It would sit behind the same off-by-default config as `decide` (an
OpenAI-compatible endpoint or `open-jev`-style local model), be called **only** for `TYPE_TEXT`, and would
still hand its output to `act`, which verifies it. Not built; the agent is the text model today.

### Handing over to a human (HIL) — a question, not a tool

Yes: the decision model is the right place to *decide* that a human is needed, because that is an
epistemic judgement over the page, not an action. Keep it as a question and let the agent execute it:

```json
{ "operation": { "type": "choice", "instructions": "What is the next operation?", "criteria": { "click": "…", "type_text": "…", "done": "…", "blocked": "…" } },
  "handoff":   { "type": "noul",   "instructions": "Does this situation require a HUMAN — a CAPTCHA, a 2FA/one-time code, a payment confirmation, an identity check, or anything the agent must not do itself?" },
  "handoff_for": { "type": "choice", "instructions": "What should the human do?", "criteria": { "captcha": "Solve the CAPTCHA", "otp": "Read and enter the code sent to the account", "consent": "Decide on the consent prompt", "payment": "Approve or complete payment", "identity": "Complete an identity check" } } }
```

Then the runner branches on the probability, not on the model's prose:

```
const d = decide(state, questions, guard, { max_attempts: 3 })
if (d.answers?.handoff?.noul >= 0.6) request_human_intervention({ reason: d.answers.handoff_for.choice })
else if (d.accepted) act(mark_id = d.answers.target.choice, action = d.answers.operation.choice)
else /* fallback: agent decides */
```

Two guardrails worth keeping: the model **never calls HIL itself** (it returns a probability; the agent
acts), and the existing mechanical signals — `TYPE_NO_EFFECT` after the input ladder, `blocked`, an
unchanged delta — remain valid reasons to hand over even when the model says otherwise. The human is the
last rung of the same ladder: **model → eliminate + retry → deterministic checks → agent → human**.

### Who decides that a human is needed

| signal | who decides | why |
| :--- | :--- | :--- |
| **Deterministic gate** — age-verification or CAPTCHA copy is present | **Kuang → human** (hard stop, auto HIL) | A compliance boundary is not a judgement call. Kuang raises the hand-off itself and returns 409. |
| Model answers `blocked`, but no gate copy matches | **the agent** | "Blocked" may be a login wall, a paywall, a dead end, or a badly-classified normal page. The agent can see the goal and the site; it decides, and may call `request_human_intervention` itself. The result carries a hint saying exactly that. |
| Anything else | **the agent** | Normal loop. |

So the rule is: **if it cannot be *determined* that a human is required, it goes to the agent, not the human.**
Kuang only spends a human's attention on a boundary it can name and quote.

### Sensitive gates — age verification and CAPTCHA are never the model's call

Some walls are not obstacles to route around. Confirming an age, solving a CAPTCHA, or asserting "I am
human" is a statement **only a person can make**, so Kuang checks for them *before* any model is asked:

```
state contains age-gate copy ("verify your age/birthday", "birthday to continue",
   "18 or older", "adult content", "mature content", …)
   → HTTP 409 { code: "HUMAN_REQUIRED", gate: "age_verification", error, hint: matched lines }
   → no model call, no elimination, no retry — call request_human_intervention
```

The same applies to CAPTCHA / "verify you are human" copy. Three properties matter:

- **It sees the real page.** Guarded calls append the live page text to the state before asking
  (`include_page_text`, on by default for `guard`/`eliminate`, off for a raw `decide`), because a wall
  announces itself in copy that the component table does not carry — `/r/petite` shows only two buttons,
  "Not Now" and "Verify", while the page says *"Verify your birthday to continue. This page may contain
  mature content."* — the exact case that must not be clicked.

- **It runs first**, so a confident model cannot out-vote it — a 0.98 "blocked" is still a decision, and
  the rule here is *do not decide at all*. The gate spends zero model calls (asserted in `test:decide`).
- **It is narrow.** A `Date of birth` field in a signup form is ordinary data entry and does **not** match;
  only gate copy does. That false-positive case is a test too.

When a decision loop sees `HUMAN_REQUIRED`, it must stop and notify a human. Kuang now does the notifying
itself: the gate opens a HIL request for the page (reason + matched lines), throttled to one per URL per
five minutes and skipped while another request is open. In the HUD that is the `alert-warning` banner,
anchored bottom-right so it never covers the page the human must act on.

### Seeing the page: `include_screenshot`

Text and the component table miss things a picture makes obvious — a CAPTCHA, an age gate, a modal that
looks like a form but is an ad. `decide(include_screenshot: true)` captures the viewport, scales it into
TypeSafe's image limits (longest side ≤ 1568, shortest ≥ 280), and attaches it as an asset referenced from
the state, with the `TypeSafe-Danger-Zone-Images: true` header.

**Known limitation (2026-10): the OpenCode gateway does not forward headers.** TypeSafe needs
`TypeSafe-Danger-Zone-Images: true`; `opencode.ai/inference/...` drops it (verified with a direct request:
the same 400 with and without the header). Kuang therefore **disables the attachment when the configured
endpoint is `opencode.ai`** and reports
`screenshot: "disabled: the OpenCode gateway does not forward TypeSafe headers — images only work against
api.typesafe.ai"`. Screenshots work today only when `url` points at `api.typesafe.ai` with a TypeSafe key.
The local ONNX models are text-only and say so. (As a safety net for other gateways, a 400 mentioning
"Images are experimental" is retried once without the image rather than failing the decision.)

### Clicking near a gate: a warning, not a refusal

`act(action:"click")` adds `warning` to its result when the target's label looks gate-like **and** the page
copy matches a gate. It does not refuse: the human may have resolved the hand-off and asked for exactly that
click. The warning exists so an agent cannot claim it was not told.

```json
{ "ok": true, "address": "#2",
  "warning": "\"Verify\" sits behind an age-verification wall. If a human has not resolved the hand-off, stop and call request_human_intervention." }
```

### Guard + elimination — what happens when the model is wrong

A decision is only acted on if it passes deterministic checks Kuang can make without judgement:

| check | rejects when |
| :--- | :--- |
| confidence gate | the chosen option's confidence is below `guard.threshold` |
| target membership | the chosen id was not in the `guard.components` list that was offered |
| affordance match | the component's `actions` do not include the chosen operation (a textbox cannot be clicked) |
| contradiction | the `done` question is true while the operation is something else |

With `eliminate` set, a rejected option is **removed from that question** and the model is asked again
with what's left — one call per attempt, capped at `max_attempts` (default 3, max 5):

```json
{ "guard": { "threshold": 0.55, "components": [ {"id": 7, "actions": ["type"]}, {"id": 9, "actions": ["click"]} ] },
  "eliminate": { "max_attempts": 3 } }
```

When every candidate is eliminated the result is **`accepted:false, exhausted:true, fallback:"agent"`**
with `reasons`, `rejections` and the `removed` map — no action is taken, and the agent decides. That is the
ladder: **model → remove the rejected option and retry → (if exhausted) deterministic checks and the agent**.
A failed `act` afterwards is the last signal: `typing.landed:false` or an unchanged delta means the chosen
step did not work, so re-observe and try the next candidate, then hand over to a human.

3. Execute the head matching the chosen operation: `act(mark_id=…)`.
4. **Verify** — the existing guarantees do the work: `typing.landed`, the delta, occlusion, the 0×0 guard.
5. The ledger records what the policy chose *and* whether it worked, which is the data to evaluate it with.

Nothing the model returns is ever turned into a selector, a coordinate or a script: it picks a component
id, and Kuang addresses, executes and verifies it.
