---
type: API Reference
title: REST MCP API
description: The hb-rest server, its ten meta-tools, generated wrapper tools, token configuration, and result shapes.
tags: [api, mcp, hb-rest, wrappers, rest]
status: stable
---

# REST MCP API

`hb-rest` turns a saved HTTP request into a typed MCP tool. The server is
separate from `hb-browser`: it has its own binary, configuration, token, and
tool namespace.

- Binary: `bin/wrap-server.cjs`
- Transport: stdio JSON-RPC
- Bridge: `/wrap/*` on `http://127.0.0.1:4111`
- Required environment: `HB_WRAP_TOKEN_FILE`
- Legacy server label: `kuang-wrap`
- Legacy environment prefix: `KUANG_WRAP_*`

## Configuration

```json
{
  "mcpServers": {
    "hb-rest": {
      "command": "node",
      "args": ["<repo>/bin/wrap-server.cjs"],
      "env": {
        "HB_WRAP_TOKEN_FILE": "<userData>/wrap/token"
      }
    }
  }
}
```

The app must be running. The token file rotates on every app start; the server
reads it per call, so the MCP process does not need the token value.

## Meta-tools

| Tool | Purpose |
| --- | --- |
| `wrap_list` | List wrappers as id, name, method/host, required arguments, secret name. |
| `wrap_get` | Return one wrapper definition, including input schema and recipe. |
| `wrap_secret_list` | List credential names, headers, and allowed hosts. Never values. |
| `wrap_derive` | Infer a first-draft recipe from a JSON sample or a policy-checked URL. |
| `wrap_create` | Validate and save a new wrapper. |
| `wrap_update` | Replace an existing wrapper. |
| `wrap_delete` | Delete a wrapper by id. |
| `wrap_run` | Execute by id with flat arguments; Markdown, JSON, or both. |
| `wrap_test` | Dry-run a request, or render a sample response without a live call. |
| `wrap_reload` | Re-read the manifest and reconcile generated tools. |

## Generated tools

A wrapper with `exposeAsTool: true` is registered as its own MCP tool:

```text
dummyjson.auth.me  ->  wrap_dummyjson_auth_me
```

Every character outside `[A-Za-z0-9_-]` becomes `_`. The generated tool
accepts the wrapper's declared input schema as a typed argument set and is a
shortcut for `wrap_run` with `format: "markdown"`.

Generated tools are capped by `HB_WRAP_MAX_TOOLS` (default 40, maximum 200).
`0` disables them; the wrappers remain callable with `wrap_run`. Create,
update, delete, and reload reconcile the set and emit
`notifications/tools/list_changed`.

The browser server's tool list is untouched by `hb-rest`.

## Discovery loop

```text
wrap_list
  -> wrap_get(id)
  -> wrap_test(id, args, dryRun:true)
  -> wrap_run(id, args)
```

For a new wrapper:

```text
wrap_derive(sample or url)
  -> wrap_create(wrapper)
  -> wrap_test(id, args, dryRun:true)
  -> wrap_run(id, args)
```

## Run arguments

`wrap_run` takes:

| Argument | Meaning |
| --- | --- |
| `id` | Saved wrapper id. |
| `args` | Flat arguments matching the wrapper input schema. |
| `format` | `markdown` (default), `json`, or `both`. |
| `max_pages` | Page cap for a paginated recipe. Default 10, hard maximum 25. |

`wrap_test` takes `id` or an inline `wrapper`, optional `args`, optional
`sample`, and `dryRun` (defaults true). A sample tests recipe rendering without
sending a request.

## Result shape

A successful `wrap_run` includes:

```json
{
  "ok": true,
  "status": 200,
  "durationMs": 42,
  "wrapper": { "id": "dummyjson.products.search", "name": "Product search" },
  "markdown": "## Product search\n\n| Name | Price |\n| --- | --- |\n...",
  "records": [{ "title": "Phone", "price": 499 }],
  "meta": { "mode": "table", "selected": 10, "rendered": 10, "truncated": false },
  "request": { "method": "GET", "url": "https://dummyjson.com/products/search?q=phone", "headers": {} }
}
```

`format: "json"` returns the records without requiring the caller to parse
Markdown. `format: "both"` returns both. `paging` is present when pagination
was followed; `indexed` is present when the recipe opted into Cortex indexing.

An upstream failure still returns a bridge response, but with `ok: false` and
an error code. The MCP layer marks it as a tool error.

## Token and errors

Missing or stale tokens return `401` with `UNAUTHORIZED`. The server reports
the token problem without touching a wrapper or making an outbound request.
A rejected upstream credential returns `AUTH_REQUIRED` with a human-action
hint; the wrapper server does not raise a human-intervention request itself.

See [Wrapper format](../formats/wrapper-format.md),
[Recipe format](../formats/recipe-format.md), and
[Error catalogue](../formats/errors.md).
