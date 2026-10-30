---
name: hb-wrap
description: Use Hyperbolic Rest wrappers as deterministic, authenticated REST tools without rebuilding URLs or handling credentials.
---

# Hyperbolic Rest

Use this skill when an MCP client has the `hb-wrap` server available.

Install:

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hyperbolic-gateway/main/skills/hb-wrap/SKILL.md
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-wrap
```

The app must be running. The wrapper service talks to the local bridge at
`http://127.0.0.1:4111` and requires the generated wrapper token.

## Tool surface

- `wrap_list` — list saved wrappers
- `wrap_get` — inspect one wrapper and its input schema
- `wrap_run` — execute a wrapper with flat semantic arguments
- `wrap_derive` — infer a first-draft response recipe from JSON or a URL
- `wrap_create` — save a wrapper
- `wrap_update` — replace a wrapper
- `wrap_delete` — delete a wrapper
- `wrap_secret_list` — list credential names; values are never available
- `wrap_reload` — reload the manifest
- generated `wrap_<id>` tools — exposed wrappers with their own schemas

## Recipes

### Discover and call a wrapper

```json
{"name":"wrap_list","arguments":{}}
```

Inspect the chosen wrapper:

```json
{"name":"wrap_get","arguments":{"id":"orders.create"}}
```

Call it with only the declared flat arguments:

```json
{"name":"wrap_run","arguments":{"id":"orders.create","args":{"customer_id":"cus_123","quantity":2}}}
```

If the wrapper is exposed as a generated tool, call `wrap_orders_create` with
the same flat arguments.

### Inspect before writing

Always run `wrap_get` before `wrap_run`. Do not guess argument names or assemble
a URL yourself. The wrapper owns the URL, method, query, headers and body
templates.

### Derive a recipe from a sample

```json
{"name":"wrap_derive","arguments":{"sample":{"items":[{"id":1,"name":"A"}]},"name":"items"}}
```

Use the returned recipe as the `response` field of `wrap_create` or
`wrap_update`, then run `wrap_run` against a real request.

### Credentials

List credential names:

```json
{"name":"wrap_secret_list","arguments":{}}
```

A wrapper references a credential by name in `request.auth`. Never request or
print the credential value. A human must bind the value in Settings → Wrappers.
If the secret is missing or rejected, ask the human to refresh it.

### Create a wrapper

`wrap_create` takes one complete object:

```json
{
  "wrapper": {
    "schemaVersion": 1,
    "id": "example.items",
    "name": "Example items",
    "description": "List items from the example API.",
    "request": {
      "method": "GET",
      "url": "https://api.example.com/items",
      "auth": "example-key"
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
      },
      "additionalProperties": false
    },
    "response": {
      "schemaVersion": 1,
      "select": "$.items[*]",
      "mode": "table",
      "fields": {
        "Name": "name",
        "ID": "id"
      },
      "record": { "id": "id", "name": "name" },
      "limits": { "maxItems": 20 }
    },
    "exposeAsTool": false,
    "mutating": false
  }
}
```

Then inspect the result and test the actual call before relying on it.
