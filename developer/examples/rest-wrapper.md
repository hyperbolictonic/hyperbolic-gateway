---
type: Example
title: REST wrapper example
description: Derive a recipe, create a saved wrapper, dry-run it, and call it through hb-rest.
tags: [example, rest, wrapper, recipe]
status: stable
---

# REST wrapper example

Goal: turn the public DummyJSON product search into a typed tool.

The API returns:

```json
{
  "products": [
    { "id": 1, "title": "Phone", "price": 499, "rating": 4.8 }
  ],
  "total": 1,
  "skip": 0,
  "limit": 10
}
```

## 1. Derive a starting recipe

```json
{
  "name": "wrap_derive",
  "arguments": {
    "sample": {
      "products": [
        { "id": 1, "title": "Phone", "price": 499, "rating": 4.8 }
      ],
      "total": 1
    },
    "name": "Product search"
  }
}
```

`wrap_derive` returns a recipe. Edit it if the inferred fields are too broad.

## 2. Create the wrapper

```json
{
  "name": "wrap_create",
  "arguments": {
    "wrapper": {
      "schemaVersion": 1,
      "id": "dummyjson.products.search",
      "name": "Product search",
      "description": "Search the DummyJSON product catalogue.",
      "request": {
        "method": "GET",
        "url": "https://dummyjson.com/products/search",
        "query": { "q": "{{query}}", "limit": "{{limit}}" },
        "headers": { "Accept": "application/json" }
      },
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "minLength": 1 },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 50,
            "default": 10
          }
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
        "record": {
          "id": "id",
          "title": "title",
          "price": "price",
          "rating": "rating"
        },
        "limits": { "maxItems": 20 }
      },
      "exposeAsTool": true,
      "mutating": false
    }
  }
}
```

The `auth` field is intentionally absent: this is a public endpoint with no
credential.

## 3. Dry-run the request

```json
{
  "name": "wrap_test",
  "arguments": {
    "id": "dummyjson.products.search",
    "args": { "query": "phone", "limit": 5 },
    "dryRun": true
  }
}
```

The preview shows the exact method, URL, headers, and body. Nothing is sent.

## 4. Call it live

```json
{
  "name": "wrap_run",
  "arguments": {
    "id": "dummyjson.products.search",
    "args": { "query": "phone", "limit": 5 }
  }
}
```

The result contains Markdown and a `records` array. Add
`"format": "json"` when the caller wants records only.

## 5. Call the generated tool

Because `exposeAsTool` is true, the server also registers:

```text
wrap_dummyjson_products_search
```

It takes the wrapper's input schema directly:

```json
{
  "name": "wrap_dummyjson_products_search",
  "arguments": { "query": "phone", "limit": 5 }
}
```

Generated tools are capped by `HB_WRAP_MAX_TOOLS` (default 40). The wrapper
remains callable through `wrap_run` when the cap is full or generated tools are
disabled.

## 6. Add a credential later

For an authenticated API, a human adds a credential in Settings -> Wrappers
and binds it to the API host. The wrapper adds only:

```json
"request": {
  "auth": "my-api-key"
}
```

Never put the value in the wrapper, the MCP configuration, a query string, or
a header template. `wrap_secret_list` shows the available names and hosts, not
the values.

## Common failures

| Result | Fix |
| --- | --- |
| `INVALID_ARGS` | Check the input schema and required fields. |
| `BLOCKED_HOST` / `BLOCKED_ADDRESS` | The host is private; use a public API or opt in locally. |
| `AUTH_REQUIRED` | The upstream rejected the credential; refresh it as a human. |
| `UNAUTHORIZED` | The `hb-rest` bridge token file path is wrong or stale. |
| `HTTP_ERROR` | Inspect the upstream status and response. |
