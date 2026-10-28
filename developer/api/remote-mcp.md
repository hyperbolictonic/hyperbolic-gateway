---
type: API Reference
title: Remote MCP gateway
description: The Phase 1 Streamable HTTP gateway for exposing the browser MCP surface beyond stdio.
tags: [api, remote, streamable-http, mcp, cloudflare]
status: draft
---

# Remote MCP gateway

The remote gateway is the first step toward using Hyperbolic Gateway from a
remote MCP client through a Cloudflare Tunnel. It is a separate, loopback-only
Streamable HTTP process; the stdio servers are unchanged.

## Status

Phase 1 implements the gateway and its auth/session lifecycle. The Settings
UI, Cloudflare Quick Tunnel manager, and client recipes are later phases.

- Binary: `bin/remote-server.cjs`
- Endpoint: `POST /mcp/browser`
- Transport: MCP Streamable HTTP with direct JSON responses
- Legacy SSE transport: not implemented
- Default bind: `127.0.0.1:4112`

The gateway is never a proxy for the raw bridge. It exposes only its MCP path;
everything else returns `404`.

## Architecture

```text
remote MCP client
      |
      |  Streamable HTTP + bearer token
      v
127.0.0.1:4112/mcp/browser
      |
      v
127.0.0.1:4111 local bridge
```

The reusable HTTP host and session lifecycle live in
[`packages/mcp-http`](../../../packages/mcp-http/README.md). The Hyperbolic
Gateway-specific entry point lives in `src/mcp/remote-server.ts`.

## Environment

| Variable | Meaning |
| --- | --- |
| `HB_REMOTE_TOKEN_FILE` | Required. Path to the 64-hex-character remote token file. |
| `HB_REMOTE_PORT` | Loopback port. Default `4112`. |
| `HB_REMOTE_HOST` | Loopback bind address. Default `127.0.0.1`; non-loopback values are rejected. |
| `HB_REMOTE_PATH` | MCP path. Default `/mcp/browser`. |
| `HB_REMOTE_MAX_SESSIONS` | Concurrent session cap. Default `4`. |
| `HB_REMOTE_IDLE_MS` | Idle session timeout. Default 15 minutes. |
| `HB_REMOTE_MAX_BODY_BYTES` | POST body cap. Default 1 MiB. |
| `HB_REMOTE_LOG_FILE` | JSONL diagnostics path. |

The token is read from the file on every request, so rotation does not require
restarting the gateway. A missing or malformed token produces `401`.

## Client shape

Once the gateway is running and the token is known:

```json
{
  "mcpServers": {
    "hyperbolic-browser": {
      "httpUrl": "http://127.0.0.1:4112/mcp/browser",
      "headers": {
        "Authorization": "Bearer <remote-token>"
      }
    }
  }
}
```

This is the local shape. The Cloudflare Tunnel phase will replace the URL with
the generated HTTPS tunnel URL.

## Security boundaries

- Bind is loopback-only.
- Bearer auth runs before session creation or body parsing.
- The remote token is separate from the Hyperbolic Rest bridge token.
- The raw bridge and `/wrap/*` are not routed through the gateway.
- Sessions are capped, idle-expire, and close on shutdown.
- No SSE GET stream is exposed in this phase.
- No custom domains, named tunnels or Cloudflare Access yet.

The quick-tunnel URL is not authentication. A future tunnel phase must keep
the bearer token requirement in place.

## Verification

```bash
npm run test:mcp-http
npm run test:remote
```

`test:remote` starts the built gateway with a temporary token file, rejects an
unauthenticated request, connects a real MCP client, and verifies the browser
tool list.
