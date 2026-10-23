# @kuang/recipe

Pure JSON-to-Markdown recipes. No network, no file system, no Electron, no
MCP, no `eval`. Given a response and a recipe, it returns Markdown and (for
document recipes) a list of documents.

This is the translation layer behind **Kuang Wrap**. It lives in its own
package so it can be tested without a browser, reused by other tools, and
eventually published on its own.

## Status

`0.1.0`, private. The format is versioned (`schemaVersion: 1`); the package
will be published once the format has survived a few real APIs unchanged.

## Quick start

```ts
import { deriveRecipe, renderRecipe } from './src/index.ts';

const body = {
  results: [
    { name: 'Alpha', score: 12, url: 'https://example.test/a' },
    { name: 'Beta', score: 7, url: 'https://example.test/b' },
  ],
};

// Start from the response: picks `results`, a table, and the primitive fields.
const recipe = deriveRecipe(body, undefined, { name: 'Search results' });

const { markdown, documents, meta } = renderRecipe(body, recipe);
```

```md
## Search results

| Name | Score | Url |
| --- | --- | --- |
| Alpha | 12 | <https://example.test/a> |
| Beta | 7 | <https://example.test/b> |
```

## Recipe

```json
{
  "schemaVersion": 1,
  "name": "Search results",
  "select": "$.results[*]",
  "mode": "table",
  "fields": {
    "Name": "name",
    "Score": { "path": "score", "format": "number" },
    "Link": { "path": "url", "format": "url" }
  },
  "limits": { "maxItems": 25, "maxChars": 20000 },
  "pagination": {
    "type": "cursor",
    "next": "$.next",
    "cursorParam": "cursor",
    "hasMore": "$.has_more"
  }
}
```

| Field | Meaning |
| --- | --- |
| `select` | Path to the array or object to render. Default `$`. |
| `mode` | `table`, `document`, or `documents` (one document per item). Inferred when omitted. |
| `fields` | Ordered labels to paths. An object preserves insertion order; an array allows per-field formats. |
| `template` | Markdown template for `document`/`documents`. |
| `title` | Per-item heading template for `documents`. |
| `limits` | `maxItems` (50), `maxChars` (100000), `maxFieldChars` (500). |
| `pagination` | Metadata only; the executor uses it to fetch the next page. |

Field formats: `text`, `number`, `integer`, `boolean`, `date`, `url`, `image`,
`json`, `code`. A field can also set `fallback`, `prefix`, `suffix`, and
`maxChars`.

## Paths

The resolver supports the subset agents already use in Kuang:

```
$.items[*].name        results[0].title        items[0..9]
items[?score>10].name  data['odd.key']         *
```

Filters compare one key against a literal (`>`, `>=`, `<`, `<=`, `=`, `!=`).
There is no expression language. A path that starts with `$` in a field or
template resolves against the response root; anything else resolves against
the current item.

## Templates

```
{{name}}                                  value
{{#if meta.live}}…{{else}}…{{/if}}        conditional
{{#unless hidden}}…{{/unless}}            inverse
{{#each tags}}…{{/each}}                  array or object
{{.}} {{@index}} {{@number}}              current value, 0-based index, 1-based number
{{@count}} {{@key}}                       total items, object key
```

Templates are data, not code. Unknown tags are left visible as literal text.

## Guarantees

- Missing values render as empty strings, never as `undefined`.
- Pipes and newlines in table cells are escaped.
- Every cap is reported: `meta.truncated` and a visible note in the Markdown.
- Output is deterministic for the same input and recipe.

## Tests

```
npm run test:recipe
npm run typecheck:recipe
```

The tests use Node's built-in runner and type stripping (Node 22.18+), so
there is no build step and no test framework dependency.

## License

MIT, same as Kuang Grade Mark Eleven.
