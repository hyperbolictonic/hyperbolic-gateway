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
| **Typed field facts** | `act` result → `target.field` (`prefilled`, `valueLength`, `editable`, `disabled`, `required`, `name`, `type`) — **also on `dry_run`** | Decide `clear_first` from data instead of guessing; pre-flight without acting |
| Outcome delta | `act` result → `delta` (`urlChanged`, `revisionBefore/After`, `marksBefore/After`) + `durationMs` | Learn/predict "will this action change anything?" |
| Post-condition result | `act` result → `awaited.ok` (+ `hint`) | Distinguish *acted-but-nothing-happened* from *not-ready-yet* |
| Triage hints | `awaited.hint` (viewport 0×0, unfocused window, wrong `activeElement`) | Classify a no-op click without another round trip |
| Typed errors | `STALE_REF`, `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED` | Deterministic classes to route on |
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
 "durationMs":812,"typed":{"chars":6,"secret":false},"clearFirst":true}
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
