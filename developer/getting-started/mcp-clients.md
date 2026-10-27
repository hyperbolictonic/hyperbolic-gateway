---
type: Guide
title: Connect an MCP client
description: Configure hb-browser and hb-rest with the bundled Electron runtime or system Node, including the legacy aliases.
tags: [getting-started, mcp, configuration, hb-browser, hb-rest]
status: stable
---

# Connect an MCP client

Hyperbolic Gateway exposes two independent MCP servers:

| Server | Binary | Purpose |
| --- | --- | --- |
| `hb-browser` | `bin/mcp-server.cjs` | Drives the visible Chromium browser and local memory. |
| `hb-rest` | `bin/wrap-server.cjs` | Turns saved REST requests into typed tools and renders JSON responses. |

The legacy labels `kuang` and `kuang-wrap` remain accepted. New configurations
should use `hb-browser` and `hb-rest`.

## Minimal configuration

The Settings screen generates a correct configuration for the current
installation. This is the shape it produces, with placeholders:

```json
{
  "mcpServers": {
    "hb-browser": {
      "command": "node",
      "args": ["<repo>/bin/mcp-server.cjs"],
      "env": {
        "HB_BRIDGE_URL": "http://127.0.0.1:4111"
      }
    },
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

Use `node` only when Node 20+ is installed. To use the bundled Electron
runtime instead, point `command` at the installed application and set
`ELECTRON_RUN_AS_NODE=1`:

```json
{
  "mcpServers": {
    "hb-browser": {
      "command": "<path-to-app>/Hyperbolic Gateway",
      "args": ["<userData>/bin/mcp-server.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

The app must already be running. The MCP server is stateless and forwards
each tool call to the local bridge.

## Environment variables

### `hb-browser`

| Variable | Meaning |
| --- | --- |
| `HB_BRIDGE_URL` | Bridge base URL. Default `http://127.0.0.1:4111`. |
| `HB_BRIDGE_TIMEOUT_MS` | Per-call bridge timeout. Default 300000. |
| `HB_MCP_LOG` | `0` disables the file log. |
| `HB_MCP_STDERR` | `0` disables the boot banner; `verbose` enables per-call stderr. |

Legacy `KUANG_BRIDGE_URL`, `KUANG_BRIDGE_TIMEOUT_MS`, `KUANG_MCP_LOG`, and
`KUANG_MCP_STDERR` are accepted as fallbacks.

### `hb-rest`

| Variable | Meaning |
| --- | --- |
| `HB_WRAP_TOKEN_FILE` | Path to the app-generated bridge token file. Required. |
| `HB_WRAP_MAX_TOOLS` | Generated `wrap_<id>` cap. Default 40; `0` disables them. |
| `HB_WRAP_TIMEOUT_MS` | Bridge timeout for this server. |
| `HB_WRAP_ALLOW_PRIVATE` | `1` allows loopback/private API hosts. |
| `HB_WRAP_ALLOW_HTTP` | `1` allows plain HTTP destinations. |

Legacy `KUANG_WRAP_*` names are accepted as fallbacks.

## Verify the connection

Call `bridge_health` from `hb-browser`. It returns the app version, page
revision, capabilities, window state, and active input transport.

For `hb-rest`, call `wrap_list`. An empty list is a valid response. A `401`
means the token file path is wrong, the app restarted, or the client is still
holding the previous token.

## Client notes

- OpenCode, Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Google
  Antigravity, Gemini CLI, Atomic Chat, and Zed all use an `mcpServers`-style
  configuration. The Settings tab generates the exact variant.
- Do not put credential values in the MCP configuration. `hb-rest` only needs
  the bridge token file; API credentials live in the app's encrypted store.
- Keep `stdout` clean. The MCP server uses stdout for JSON-RPC and writes
  diagnostics to `<data>/logs/mcp-server.log` and stderr.

## Next

- [First browser session](first-session.md)
- [Browser MCP API](../api/browser-mcp.md)
- [REST MCP API](../api/rest-mcp.md)
