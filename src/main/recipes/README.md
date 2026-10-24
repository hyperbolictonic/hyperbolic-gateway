# 🗺️ Navigation Recipes

A page path compiled into replayable steps. The expensive part of a browser task is **deciding**;
once a path has been walked successfully, that decision can be stored and replayed with **zero model
calls**. Same lifecycle as `wrap_create` → `wrap_run`, applied to UI.

Reference: [docs/CONTROL_LAYER.md](../../../docs/CONTROL_LAYER.md).

---

## Shape

```jsonc
{
  "action": "save",
  "url": "https://example.com/settings",
  "name": "Fill the settings form",
  "steps": [
    { "action": "click", "target": "Open settings" },
    { "action": "type",  "target": "Your name", "value": "Kuang" },
    { "action": "click", "target": "Save", "expect": [{ "type": "text", "text": "Saved for Kuang" }] }
  ]
}
```

A step names a control by **what a person would see**, never a mark id or a CSS selector:

- `target` — visible text, or a form field's `aria-label` / `placeholder` / `name`
- `value` — required for `type`
- `expect` — `wait_for` conditions asserted after the step

## Replay

```jsonc
{ "action": "replay", "id": "rcp_…" }
{ "action": "replay", "url": "https://example.com/settings" }   // best match for the page
```

Each step: resolve by text → act → assert `expect`. A failure stops the replay at that step and
reports the index; a half-applied recipe is worse than a refusal.

Measured on the fixture (click → type → click + expectation): **3 steps in ~2 s, 0 model calls.**

## Learning a recipe

`drive` can compile its own verified run: `save_recipe: true` (plus an optional `recipe_name`) stores
the successful steps when the run ends `done`.

Only **verified** steps are compiled:

- steps with `ok: false` are dropped
- dry-run plans are never compiled
- `scroll` / `wait` / `done` are not replayable actions
- a `type_text` step becomes a `type` step **only if its value can be recovered** from the `values`
  you passed to `drive` (by field name or component id) — an untyped-into field cannot be replayed
- a step with no target name is skipped rather than guessed

The compiler is a pure function (`compile.ts`) with an offline test suite:
`npm run test:recipe:compile` (9 checks).

## Outstanding verification

The seam between learning and replay is currently unit-tested only: on the fixture, `drive` returned
`needs_agent` before reaching `done`, so `save_recipe` never produced anything. See
[docs/TODO.md](../../../docs/TODO.md) item 17 (scheduled 2026-10-25) for the live check: run `drive`
somewhere the decision model succeeds, confirm the recipe is stored, reload, replay, assert the end
state.

## Lifecycle

- storage: `data/recipes.json` (gitignored, local only)
- scope: `origin` + `path`; a trailing `*` makes the path a prefix (`/search/*`)
- metrics: `attempts`, `successes`, `consecutiveFailures`, `lastVerified`
- **retirement:** after 3 consecutive failed replays a recipe stops matching, so a stale path is not
  retried forever
- `delete` by id

## When to use it

Use a recipe once a path is **known and stable** (a settings page, a checkout step, a search form).
Use `drive`/`decide` while the path is still being discovered — the decision model is what produces
the recipe in the first place.

## Why descriptors and not selectors

Selectors break on markup changes and mean nothing to a reviewer. Text descriptors are readable,
survive redesigns that keep the copy, and work on semantics-free controls (React cards) through the
same text resolver as `act(target_text)`.
