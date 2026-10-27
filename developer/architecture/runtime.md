---
type: Architecture
title: Runtime architecture
description: How the Electron app, Chromium views, local HTTP bridge, hb-browser, and hb-rest fit together.
tags: [architecture, runtime, bridge, mcp]
status: stable
---

# Runtime architecture

Hyperbolic Gateway has one desktop process that owns the browser and two
optional stdio server processes that expose it to agent clients.

```text
Agent / MCP client
  |  stdio JSON-RPC
  +-- hb-browser (bin/mcp-server.cjs) -- HTTP --> 127.0.0.1:4111
  |                                                 |
  +-- hb-rest    (bin/wrap-server.cjs) -- HTTP -->  /wrap/*
                                                    |
                                      Electron main process
                                      - BrowserChassis
                                      - WebContentsView tabs
                                      - primitives and input
                                      - Cortex and vaults
                                      - wrapper store and secrets
                                                    |
                                                visible Chromium
```

## Electron app

The main process owns the window, browser tabs, HUD, local database, downloads,
and files. The browser is a real visible Chromium session with persistent
cookies and ordinary navigation state.

The bridge binds to `127.0.0.1` on port `4111` by default. `HB_BRIDGE_PORT`
changes the port. Two app instances cannot share one port; the second reports
`EADDRINUSE`.

## `hb-browser`

Each MCP client starts its own copy of `bin/mcp-server.cjs`. It speaks
JSON-RPC over stdin/stdout and forwards tool calls to the bridge. It does not
open a browser itself and it does not store durable state.

The server name is `hb-browser`; `kuang` is the legacy alias. The process
uses `HB_BRIDGE_URL` (legacy `KUANG_BRIDGE_URL`) and never writes logs to
stdout, because stdout is the protocol channel.

## `hb-rest`

`bin/wrap-server.cjs` is a separate MCP server with its own configuration.
It forwards `/wrap/*` calls to the bridge using a rotating bearer token read
from `HB_WRAP_TOKEN_FILE`.

The wrapper store, secret store, executor, recipe renderer, and audit log all
live in the Electron main process. The MCP process sees wrapper metadata and
rendered results, never credential values.

## Request flow

For a browser call:

1. The agent sends a `tools/call` request to `hb-browser`.
2. The server validates and normalises arguments.
3. It sends an HTTP request to the bridge.
4. The main process executes the browser primitive.
5. The result is formatted as text or an image block and returned over stdio.

For a REST wrapper:

1. The agent calls `wrap_run` or a generated `wrap_<id>`.
2. `hb-rest` reads the bridge token and posts to `/wrap/run`.
3. The executor validates flat arguments, builds the request, applies the
   outbound policy, attaches a host-bound secret if allowed, fetches, and
   renders the recipe.
4. The result returns as Markdown, JSON records, or both.

## Storage

| Location | Contents |
| --- | --- |
| `<userData>/bin/` | MCP binaries copied by an installed build. |
| `<userData>/wrap/wrappers/` | One JSON file per wrapper, written atomically. |
| `<userData>/wrap/secrets.json` | Secret metadata and ciphertext only. |
| `<userData>/wrap/audit.jsonl` | Redacted outbound-call audit rows. |
| `<userData>/wrap/token` | Rotating bridge token, owner-only permissions. |
| `<data>/logs/` | MCP, bridge, and app logs. |

## Design boundaries

- `packages/recipe` is pure: no network, filesystem, Electron, or MCP.
- `hb-rest` is stateless. The main process owns state and credentials.
- The browser MCP server does not own wrapper credentials.
- The bridge is local-only. It is a control surface, not a remote API gateway.

See [Security model](security.md) for the trust boundaries and known limits.
