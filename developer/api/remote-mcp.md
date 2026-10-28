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

Phase 1 implemented the gateway and its auth/session lifecycle. Phase 2 adds
the app-generated token and the **Settings → Remote** panel. Phase 3 adds the
optional Cloudflare Quick Tunnel. Named tunnels, custom domains, and
Cloudflare Access remain later work.

- Binary: `bin/remote-server.cjs`
- Endpoint: `POST /mcp/browser`
- Transport: MCP Streamable HTTP with direct JSON responses
- Legacy SSE transport: not implemented
- Default bind: `127.0.0.1:4112`

The gateway is never a proxy for the raw bridge. It exposes only its MCP path;
everything else returns `404`.

## Settings → Remote

The Settings panel can start and stop the gateway, start and stop a Quick
Tunnel, copy the token and client config, rotate the token, and disconnect
sessions. The gateway and tunnel remain off after an app restart; remote access
must be enabled explicitly each run.

The token is generated at app startup if absent and stored at
`<userData>/remote/token` with owner-only permissions. Rotating it stops the
gateway, creates a new token, and restarts it if it was enabled.

## Cloudflare Quick Tunnel

The app starts `cloudflared` only when the tunnel toggle is enabled:

```text
cloudflared tunnel --url http://127.0.0.1:4112 --no-autoupdate
```

It parses the generated `https://<random>.trycloudflare.com` URL and uses that
as the public MCP endpoint:

```text
https://<random>.trycloudflare.com/mcp/browser
```

`cloudflared` is not bundled. The app looks for a managed binary first,
then `PATH` and common install locations; `HB_CLOUDFLARED_PATH` can point at a
specific system binary. Quick Tunnel URLs change every time the process starts,
so update the client config when restarting the tunnel.

### Managed cloudflared

The Remote panel can download the official `cloudflared` binary from Cloudflare
GitHub releases into:

```text
<userData>/remote/bin/cloudflared[.exe]
```

The download is explicit, SHA-256 verified against the GitHub release asset
digest, and installed atomically. `cloudflared` is Apache-2.0 software from
Cloudflare; the app downloads the official binary and does not redistribute it.
The panel supports:

- **Manual** updates: use CHECK and INSTALL / UPDATE.
- **Automatic at startup**: if a managed binary exists, check and install an
  update when the app starts.

System binaries are left alone. If `HB_CLOUDFLARED_PATH` is set, it takes
precedence over the managed binary.

Quick Tunnels do not support SSE and carry no Cloudflare Access policy. This
gateway therefore uses JSON-response Streamable HTTP and requires its own
bearer token. For a stable hostname, custom domain, or Access policy, use a
named Cloudflare Tunnel in a later phase.

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
[`packages/mcp-http`](../../../packages/mcp-http/README.md). The Quick Tunnel
process lifecycle lives in
[`packages/quick-tunnel`](../../../packages/quick-tunnel/README.md), and the
managed `cloudflared` downloader lives in
[`packages/cloudflared`](../../../packages/cloudflared/README.md). The
Hyperbolic Gateway-specific entry points live in `src/mcp/remote-server.ts`
and `src/main/remote/service.ts`.

## Environment

| Variable | Meaning |
| --- | --- |
| `HB_REMOTE_TOKEN_FILE` | Required. Path to the 64-hex-character remote token file. |
| `HB_BRIDGE_URL` | Local bridge URL. The app passes this automatically. |
| `HB_REMOTE_PORT` | Loopback port. Default `4112`. |
| `HB_REMOTE_HOST` | Loopback bind address. Default `127.0.0.1`; non-loopback values are rejected. |
| `HB_REMOTE_PATH` | MCP path. Default `/mcp/browser`. |
| `HB_REMOTE_MAX_SESSIONS` | Concurrent session cap. Default `4`. |
| `HB_REMOTE_IDLE_MS` | Idle session timeout. Default 15 minutes. |
| `HB_REMOTE_MAX_BODY_BYTES` | POST body cap. Default 1 MiB. |
| `HB_REMOTE_LOG_FILE` | JSONL diagnostics path. |
| `HB_CLOUDFLARED_PATH` | Optional explicit path to the `cloudflared` executable. |

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
