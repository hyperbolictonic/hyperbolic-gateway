---
type: API Reference
title: Development logs MCP
description: Local-only MCP access to allowlisted Hyperbolic Gateway development logs.
tags: [api, mcp, devlogs, development, logs]
status: stable
---

# Development logs MCP

`hb-devlogs` is a local stdio MCP server for reading Hyperbolic Gateway log
files while developing. It is not part of the remote gateway and must not be
exposed through a tunnel.

## Enable

The server refuses to start unless `HB_DEV_LOGS=1`. Point it at the log
directory with `HB_DEVLOGS_DIR`.

```json
{
  "mcpServers": {
    "hb-devlogs": {
      "command": "node",
      "args": ["<repo>/bin/devlogs-server.cjs"],
      "env": {
        "HB_DEV_LOGS": "1",
        "HB_DEVLOGS_DIR": "<data>/logs"
      }
    }
  }
}
```

The MCP Clients settings screen adds a **Dev Logs** server option when the app
is running unpackaged.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_logs` | List allowlisted `*.log` files with size and modification time. |
| `read_log` | Read a tail or follow from a byte offset; optional literal grep. |
| `search_logs` | Search one or all logs with a literal query. |

`read_log` returns `next_offset`, so a client can poll for new output without
re-reading the file.

## Safety

- Read-only.
- Only simple `*.log` filenames directly inside the configured log directory.
- Realpath checks prevent path traversal and symlink escapes.
- Reads are capped at 1 MiB by default.
- Bearer tokens, 64-hex tokens, and obvious secret assignments are redacted.
- No write, delete, rotate, or arbitrary filesystem access.
- No remote/OAuth route.

## Tests

```bash
npm run test:devlogs
```

The smoke test lists, reads, searches, and verifies token redaction through a
real MCP client.
