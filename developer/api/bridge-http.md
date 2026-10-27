---
type: API Reference
title: Local bridge HTTP API
description: Supported loopback routes, authentication, response conventions, and the boundary between public and internal endpoints.
tags: [api, http, bridge, local]
status: stable
---

# Local bridge HTTP API

The Electron app listens on a loopback-only HTTP server. The two MCP servers
use it internally. You can call the diagnostic and wrapper routes directly
when building a local integration.

Base URL: `http://127.0.0.1:4111` by default, or `HB_BRIDGE_PORT`.

## What is supported

The stable integration surface is:

1. The MCP servers (`hb-browser` and `hb-rest`).
2. The diagnostic routes below.
3. The `/wrap/*` routes, with the rotating bearer token.

The browser automation routes (`/navigate`, `/click`, `/observe`, etc.) exist
because the MCP server uses them. They are contract-tested against the tool
catalogue, but they are **internal** and may change with the tool surface. Use
the MCP tools for automation; do not build a second public API on the raw
browser routes.

## Authentication

| Route family | Authentication |
| --- | --- |
| `/health`, `/page-info`, `/metrics`, `/human/*`, `/decisions` | None. Loopback only. |
| `/wrap/*` | `Authorization: Bearer <token>` or `X-Kuang-Wrap-Token: <token>`. |

The wrap token is generated on each app start and written to
`<userData>/wrap/token`. The MCP configuration carries the file path, not the
value:

```bash
TOKEN="$(cat "<userData>/wrap/token")"
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4111/wrap/manifest
```

The bridge binds `127.0.0.1`. Do not reverse-proxy it or expose it on a
public interface. CORS is permissive for local clients, not a security
control.

## Diagnostic routes

### `GET /health` and `GET /page-info`

Returns liveness, app version, page revision, capabilities, decision status,
last action time, window state, input transport, human state, metrics, Shadow
Walk state, and page info.

```bash
curl http://127.0.0.1:4111/health
```

### `GET /metrics`

Returns version and counters. `POST /metrics/reset` resets the counters.

### `GET /human/status`

Returns the current human-intervention state. `POST /human/resume` resumes the
agent after a human pause.

### `GET /decisions`

Returns the last decision events. `GET /decide` returns the decision backend
status; `POST /decide` is the direct decision call. It returns `NOT_CONFIGURED`
when no decision model is set.

## Hyperbolic Rest routes

All wrapper routes require the token. A missing or stale token returns:

```json
{
  "success": false,
  "error": "Unauthorized. Set HB_WRAP_TOKEN_FILE (or KUANG_WRAP_TOKEN_FILE) to the app-generated token file.",
  "code": "UNAUTHORIZED"
}
```

| Method and route | Body | Result |
| --- | --- | --- |
| `GET /wrap/status` | none | Wrapper count and private-host policy. |
| `GET /wrap/manifest` | none | Wrapper summaries. |
| `GET /wrap/wrapper?id=<id>` | none | One full wrapper or `WRAPPER_NOT_FOUND`. |
| `GET /wrap/secrets` | none | Secret names, headers, allowed hosts, availability. Never values. |
| `GET /wrap/audit?limit=50` | none | Redacted audit rows. |
| `POST /wrap/run` | `{ id, args, format?, includeRaw?, maxPages? }` | Execution result. |
| `POST /wrap/test` | `{ id?, wrapper?, args?, sample?, dryRun?, format?, maxPages? }` | Dry-run or sample render. |
| `POST /wrap/derive` | `{ sample?, url?, id?, name?, description?, max_fields? }` | `{ source, recipe }`. |
| `POST /wrap/wrappers` | `{ action: "create"\|"update"\|"delete"\|"get", wrapper?, id? }` | Saved wrapper or error list. |

`/wrap` is also the prefix for the wrapper bridge. A request to an unknown
`/wrap/*` path returns `NOT_FOUND`.

## Response conventions

Most routes return JSON. Success bodies generally include `success: true` or
`status: "ok"`. Errors include `success: false` and a machine-readable
`code`; HTTP status is 400, 401, 404, 409, 500, or 503 as appropriate.

The bridge redacts credential-shaped keys from logs, previews, and errors. It
does not make the wrapper system a hardened gateway; see
[Security model](../architecture/security.md).

## Health example

```bash
curl -s http://127.0.0.1:4111/health | jq '{status, version, revision, input, human}'
```

```json
{
  "status": "ok",
  "version": "1.6.0",
  "revision": 42,
  "input": { "transport": "cdp" },
  "human": { "paused": false }
}
```

## Related

- [REST MCP API](rest-mcp.md)
- [Wrapper format](../formats/wrapper-format.md)
- [Error catalogue](../formats/errors.md)
