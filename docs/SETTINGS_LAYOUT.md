# Settings layout primitives

The Settings modal is plain HTML (`index.html`) plus a small set of CSS primitives
(`src/renderer/index.css`). New tabs should reuse those primitives instead of
inventing a width, grid or card per feature.

## Panes

| Class | Width | Use |
| --- | --- | --- |
| `settings-pane` | `56rem` | Every form-shaped tab: Decision, Input, Shadow, Recording, Research, Clients, Remote, Experimental. |
| `settings-pane-wide` | `72rem` | Data-table surfaces only: Tools, Wrappers. |

Apply the pane class to the `<section data-settings-panel="…">` element. The modal
wrapper already supplies a `72rem` outer column, padding and a stable scrollbar
gutter, so every pane starts on the same left edge.

```html
<section data-settings-panel="research" class="hidden settings-pane">
  …
</section>
```

## Field rows

| Class | Columns |
| --- | --- |
| `settings-grid` | 1 column, the base field row |
| `settings-grid settings-grid-2` | 2 columns from `640px` |
| `settings-grid settings-grid-3` | 3 columns from `640px` |
| `settings-grid settings-grid-4` | 2 columns from `640px`, 4 from `1024px` |

Use one grid per logical row of fields inside a `<fieldset>`.

```html
<div class="settings-grid settings-grid-2">
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Endpoint</legend>
    <input id="settings-endpoint" class="input input-sm w-full" />
    <p class="label font-mono text-[10px]">Base host or the full /v1/systemone URL.</p>
  </fieldset>
  …
</div>
```

## Cards

`settings-card` is the bordered feature block. `settings-card-info` adds the blue
JEV accent; `settings-card-warning` adds the experimental accent.

```html
<div class="mt-6 settings-card settings-card-info">…</div>
```

## Helper text

daisyUI's `.label` defaults to `white-space: nowrap`, which made long help text
overflow its fieldset. The modal sets `white-space: normal` for `p.label`, so
helper paragraphs wrap to the field width without extra classes.

## Checklist for a new tab

1. Use `settings-pane` (or `settings-pane-wide` only for a table).
2. Group fields in `settings-grid` rows; do not add `max-w-*` per tab.
3. Put explanatory blocks in `settings-card`.
4. Keep labels and help text inside the same `<fieldset>` so they share a column.
