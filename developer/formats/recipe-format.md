---
type: Schema Reference
title: Recipe format
description: The data-only JSON-to-Markdown projection used by Hyperbolic Rest, including paths, templates, limits, pagination, and indexing.
tags: [format, recipe, json, markdown, pagination]
status: stable
---

# Recipe format

A recipe describes how to turn a JSON response into Markdown and structured
records. It is data, not code: there is no `eval`, network, filesystem, or
clock in the renderer.

```json
{
  "schemaVersion": 1,
  "name": "Product search",
  "select": "$.products[*]",
  "mode": "table",
  "fields": {
    "Name": "title",
    "Price": { "path": "price", "format": "number", "suffix": " USD" },
    "Link": { "path": "thumbnail", "format": "image" }
  },
  "record": {
    "id": "id",
    "title": "title",
    "price": "price"
  },
  "limits": {
    "maxItems": 20,
    "maxChars": 20000,
    "maxFieldChars": 300
  },
  "pagination": {
    "type": "cursor",
    "next": "$.next",
    "cursorParam": "cursor",
    "hasMore": "$.has_more"
  },
  "index": "none"
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Must be `1`. |
| `id` | Optional stable recipe id. |
| `name` | Heading shown above tables and documents. |
| `description` | Optional description. |
| `select` | JSON path to the array or object to render. Default `$`. |
| `mode` | `table`, `document`, or `documents`. Inferred when omitted. |
| `fields` | Ordered labels to paths. Object order is preserved; an array allows per-field specs. |
| `record` | Structured projection: stable keys to paths, original JSON types. |
| `template` | Markdown template for document and documents modes. |
| `title` | Per-item heading template for documents mode. |
| `limits` | `maxItems`, `maxChars`, `maxFieldChars`. |
| `pagination` | How the executor follows pages. |
| `index` | `none` or `cortex`; opt-in post-render indexing. |
| `notes` | Human/agent notes; never rendered. |

## Modes

| Mode | Input shape | Output |
| --- | --- | --- |
| `table` | Array or array selection. | One Markdown table plus records. |
| `document` | Object or one selected object. | One Markdown document. |
| `documents` | Array selection. | One document per item, joined by rules. |

If `mode` is omitted, an array selection renders as a table and an object
selection renders as a document.

## Paths

Paths are relative to the selected item unless they start at the response root.
Examples:

```text
$.products[*]              select every product
$.current                  select one object
location.name              nested field
items[0].price             indexed field
```

`select` is resolved before rendering. `fields` and `record` paths are
resolved against each selected item. Use `.` for the item itself.

## Field specs

A field can be a string path or an object:

```json
{
  "path": "price",
  "label": "Price",
  "format": "number",
  "fallback": "n/a",
  "prefix": "$",
  "suffix": " USD",
  "maxChars": 40
}
```

Formats: `text`, `number`, `integer`, `boolean`, `date`, `url`, `image`,
`json`, `code`.

## Templates

`template` and `title` support a small Mustache-like syntax:

- `{{path}}`
- `{{#if path}}...{{else}}...{{/if}}`
- `{{#unless path}}...{{/unless}}`
- `{{#each path}}...{{/each}}`
- `{{.}}`, `{{@index}}`, `{{@number}}`, `{{@count}}`, `{{@key}}`

There is no general expression language. HTML is escaped unless the renderer
emits a Markdown construct such as a link or image.

## Limits and truncation

Defaults:

- `maxItems`: 50
- `maxChars`: 100000
- `maxFieldChars`: 500

`meta.truncated` is true when items or characters were dropped. The renderer
reports the selected and rendered counts so a caller can distinguish a short
API response from a capped one.

## Pagination

The executor follows pages only when `select` resolves to an array.

| `type` | Next page | Stops when |
| --- | --- | --- |
| `offset` | `offsetParam` + `limitParam`, advanced by `pageSize` | short page, `hasMore` false/0, or a cap |
| `cursor` | `next` path, sent as `cursorParam` | next is missing, null, or empty |
| `link` | `nextUrl` path | missing, or a different origin |
| `none` | none | single request |

`maxPages` defaults to 10 (hard maximum 25). `wrap_run { max_pages }`
overrides it per call. The item cap also stops paging. Each page is audited
separately; lists are merged and rendered once.

A `link` page must stay on the first request's origin. Every page URL is
re-checked by the outbound policy.

## Cortex indexing

Set `index: "cortex"` to store the rendered output in local Cortex after a
successful live run. In documents mode, one page is indexed per document;
otherwise one page is indexed for the whole render. Indexing is best-effort:
a Cortex failure does not fail the wrapper call.

## Deriving a recipe

`wrap_derive` inspects a JSON sample or a policy-checked URL and returns a
first-draft recipe. It picks a likely array (`items`, `results`, `data`,
`records`, or a top-level array), takes primitive fields, and chooses a table
or document. Treat the result as a starting point, not a finished schema.

## Related

- [Wrapper format](wrapper-format.md)
- [Recipe JSON Schema](../../packages/recipe/schema/recipe.schema.json)
- [Recipe package](../../packages/recipe/README.md)
