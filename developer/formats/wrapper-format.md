---
type: Schema Reference
title: Wrapper format
description: The saved request, typed input schema, credential reference, and validation rules used by Hyperbolic Rest.
tags: [format, wrapper, rest, schema]
status: stable
---

# Wrapper format

A wrapper is a JSON document that names one HTTP request and describes how to
turn its response into readable output. The saved file never contains an API
credential.

```json
{
  "schemaVersion": 1,
  "id": "dummyjson.products.search",
  "name": "Product search",
  "description": "Search the DummyJSON product catalogue.",
  "request": {
    "method": "GET",
    "url": "https://dummyjson.com/products/search",
    "query": { "q": "{{query}}", "limit": "{{limit}}" },
    "headers": { "Accept": "application/json" },
    "timeoutMs": 15000
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "minLength": 1 },
      "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
    },
    "required": ["query"],
    "additionalProperties": false
  },
  "response": {
    "schemaVersion": 1,
    "select": "$.products[*]",
    "mode": "table",
    "fields": {
      "Name": "title",
      "Price": { "path": "price", "format": "number" },
      "Rating": { "path": "rating", "format": "number" }
    },
    "record": { "id": "id", "title": "title", "price": "price" },
    "limits": { "maxItems": 20 }
  },
  "exposeAsTool": false,
  "mutating": false
}
```

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | recommended | Must be `1` when present. |
| `id` | yes | Lowercase identifier: starts with a letter; letters, numbers, `.`, `_`, `-`. |
| `name` | yes | Display name, up to 120 characters. |
| `description` | no | One-line purpose. |
| `request` | yes | The request template. |
| `inputSchema` | no | JSON Schema subset for agent arguments. |
| `response` | no | A [recipe](recipe-format.md). |
| `exposeAsTool` | no | Register `wrap_<id>` as an MCP tool. Default false. |
| `mutating` | no | Metadata; defaults to true for write methods. No approval gate is implemented. |
| `lastVerified` | no | Written after a successful live run. |
| `notes` | no | Human notes; never rendered. |

Unknown top-level fields are dropped by validation. Add a field to the
validator before relying on it.

## Request object

| Field | Meaning |
| --- | --- |
| `method` | Default HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, or `HEAD`. |
| `methods` | Optional list of allowed methods. A generated `method` argument chooses among them. |
| `url` | Absolute request URL. Supports `{{argument}}` placeholders. |
| `query` | Object of query templates. Values may be strings, numbers, booleans, or arrays. |
| `headers` | Object of header templates. Credential-shaped headers are forbidden. |
| `body` | JSON-shaped template tree, or a string for `bodyFormat: "text"`. |
| `bodyFormat` | `json` (default), `form`, or `text`. |
| `auth` | A secret **name**, never a value. |
| `timeoutMs` | Per-request timeout. Default 15000; capped at 60000. |

A body is not allowed when every allowed method is `GET` or `HEAD`.
`POST`, `PUT`, `PATCH`, and `DELETE` default to `mutating: true`.

## Input schema

The supported JSON Schema subset is intentionally small:

- `type`: object, array, string, number, integer, boolean, null.
- `properties`, `required`, `items`, `default`.
- `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`,
  `maxItems`, `pattern`.
- `additionalProperties: false` to reject unknown arguments.

No coercion happens during validation. A stringified number is rejected when
the schema says `integer` or `number`. Defaults are applied before validation.

## Interpolation

Placeholders in `url`, `query`, headers, and body are limited to validated
input properties. There is no expression language.

- `{{name}}` inserts one URL-encoded segment when used in the URL.
- `{{name}}` in a whole-string body value preserves the argument's JSON type.
- `{{name|raw}}` is URL-only and preserves slash-separated path segments,
  rejecting `.`, `..`, empty segments, backslashes, and control characters.
- Missing optional values are omitted; they are not sent as `"undefined"`.

Credential-shaped query keys (`api_key`, `token`, `password`, etc.) and
credential-shaped headers (`Authorization`, `Cookie`, `X-Api-Key`, etc.) are
rejected. Use `request.auth` instead.

## Authentication

`request.auth` names a secret created by a human in Settings -> Wrappers. The
main process attaches it only when the request host matches the secret's
`allowedHosts`. A static secret or an OAuth2 client-credentials secret can be
used. The MCP server and the wrapper file never see the value.

## Validation and storage

Wrappers are validated before they reach disk. Errors name the exact field.
A saved wrapper lives at:

```text
<userData>/wrap/wrappers/<id>.json
```

Writes are atomic (temporary file + rename). A malformed file is skipped when
listing rather than crashing the bridge.

## Generated tools

Set `exposeAsTool: true` to expose the wrapper as `wrap_<id>`. The generated
name replaces characters outside `[A-Za-z0-9_-]` with `_`. Generated tools are
capped by `HB_WRAP_MAX_TOOLS` (default 40); the rest remain callable through
`wrap_run`.

## Safety limits

- HTTPS only by default; plain HTTP is opt-in.
- Loopback and private addresses are blocked unless explicitly allowed.
- At most five redirects; auth is dropped on a cross-origin redirect.
- 5 MB response cap; default 15-second timeout.
- Mutating calls have no human-approval gate. Treat `mutating` as metadata,
  not enforcement.

See [Recipe format](recipe-format.md) and
[Hyperbolic Rest man page](../../docs/HYPERBOLIC_REST.md).
