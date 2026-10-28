---
type: API Reference
title: Remote MCP gateway
description: The Streamable HTTP gateway for exposing the browser MCP surface through a named Cloudflare Tunnel.
tags: [api, remote, streamable-http, mcp, cloudflare, oauth]
status: experimental
---

# Remote MCP gateway (experimental)

> **Experimental.** Remote MCP, named Cloudflare Tunnel support and OAuth are
> new and their third-party client compatibility varies. Gemini Connected Apps
> is known to be flaky: it can show the connector as connected without
> injecting its tools into a conversation, and it may reuse stale state after a
> gateway restart. Keep remote access off unless you are actively testing it,
> and never expose it unattended.

The remote gateway exposes the browser MCP surface to remote clients through a
loopback Streamable HTTP process. A named Cloudflare Tunnel publishes it on a
hostname you control; the stdio servers are unchanged.

## Status

- Maturity: **experimental**
- Binary: `bin/remote-server.cjs`
- Endpoint: `POST /mcp/browser`
- Transport: MCP Streamable HTTP with direct JSON responses
- Session model: stateless by default; stateful mode is opt-in
- Legacy SSE transport: not implemented
- Default bind: `127.0.0.1:4112`
- Public access: named Cloudflare Tunnel only

The gateway is never a proxy for the raw bridge. It exposes only its MCP path;
everything else returns `404`.

## Session model

The gateway is **stateless by default**: each POST gets a fresh MCP server and
transport, and no `Mcp-Session-Id` is issued. This is the recommended mode for
third-party clients, because it avoids session caps and stale session IDs.
Browser state is held by the local bridge, not by the MCP session.

Set `HB_REMOTE_STATEFUL=1` to opt into stateful sessions with a concurrent
session cap and idle expiry. Stateful mode is useful for protocol debugging,
not for the default remote deployment.

## Authentication modes

The Remote panel has an authentication selector, defaulting to **Bearer**.

- **Bearer**: the app-generated remote token. Works with MCP clients that
  support custom headers — for example Gemini CLI, MCP Inspector,
  `mcp-remote`, or a manual HTTP client.
- **OAuth 2.0**: a pre-registered static client for OAuth-capable MCP clients,
  such as Gemini Connected Apps or an equivalent custom connector. The app
  generates the client ID and secret. The gateway publishes discovery metadata
  and exposes `/oauth/authorize`, `/oauth/token`, and `/oauth/revoke`.

OAuth mode accepts OAuth access tokens, not the static bearer token. Switching
modes restarts the gateway but leaves a running named tunnel connected.

## Settings → Remote

The panel can start and stop the gateway and the named tunnel, copy the bearer
token or OAuth client credentials, rotate credentials, and disconnect sessions.
The gateway and tunnel remain off after an app restart.

The bearer token is generated at app startup if absent and stored at
`<userData>/remote/token` with owner-only permissions. The OAuth client is
stored at `<userData>/remote/oauth-client.json`.

## Named Cloudflare Tunnel

A named tunnel requires:

- a Cloudflare account
- a hostname on a Cloudflare DNS zone
- a named tunnel with a public hostname pointing to
  `http://127.0.0.1:4112`
- the tunnel token

In the Cloudflare dashboard, create the tunnel and add a **Public Hostname**
that routes to `http://127.0.0.1:4112`. Paste the hostname and tunnel token into
Settings → Remote. The app runs:

```text
cloudflared tunnel --no-autoupdate run
```

with `TUNNEL_TOKEN` in the child environment. The token is stored at
`<userData>/remote/tunnel-token` with owner-only permissions and is never
returned to the renderer or logged.

### OAuth on Cloudflare

Cloudflare Bot Fight Mode / WAF can block Google’s server-to-server OAuth token
exchange even when the browser flow succeeds. If OAuth clients report account
linking failures, add a skip/bypass rule for:

```text
/oauth/token
```

or for the full public hostname used by the MCP gateway.

### Managed cloudflared

The Remote panel can download the official `cloudflared` binary from Cloudflare
GitHub releases into:

```text
<userData>/remote/bin/cloudflared[.exe]
```

The download is explicit, SHA-256 verified against the GitHub release asset
digest, and installed atomically. `cloudflared` is Apache-2.0 software from
Cloudflare; the app downloads the official binary and does not redistribute it.
The macOS `.tgz` is extracted in pure Node, so it does not depend on the host
`tar` binary.

Update modes:

- **Manual**: use CHECK and INSTALL / UPDATE.
- **Automatic at startup**: check and install an update when the app starts.

System binaries are left alone. `HB_CLOUDFLARED_PATH` takes precedence over the
managed binary.

## Architecture

```text
remote MCP client
      |
      |  HTTPS + bearer/OAuth
      v
Cloudflare named tunnel
      |
      v
127.0.0.1:4112/mcp/browser
      |
      v
127.0.0.1:4111 local bridge
```

The reusable HTTP host and session lifecycle live in
[`packages/mcp-http`](../../../packages/mcp-http/README.md). The OAuth
authorization server lives in
[`packages/mcp-oauth`](../../../packages/mcp-oauth/README.md). The named-tunnel
process lifecycle lives in
[`packages/cloudflared-tunnel`](../../../packages/cloudflared-tunnel/README.md),
and the managed `cloudflared` downloader lives in
[`packages/cloudflared`](../../../packages/cloudflared/README.md). The
Hyperbolic Gateway-specific entry points live in `src/mcp/remote-server.ts`
and `src/main/remote/service.ts`.

## Environment

| Variable | Meaning |
| --- | --- |
| `HB_REMOTE_TOKEN_FILE` | Required. Path to the 64-hex-character remote token file. |
| `HB_BRIDGE_URL` | Local bridge URL. The app passes this automatically. |
| `HB_REMOTE_AUTH_MODE` | `bearer` (default) or `oauth`. |
| `HB_OAUTH_CLIENT_FILE` | OAuth client JSON path. Required in `oauth` mode. |
| `HB_OAUTH_REDIRECT_HOSTS` | Optional comma-separated additional callback hostnames. |
| `HB_REMOTE_PORT` | Loopback port. Default `4112`. |
| `HB_REMOTE_HOST` | Loopback bind address. Default `127.0.0.1`. |
| `HB_REMOTE_PATH` | MCP path. Default `/mcp/browser`. |
| `HB_REMOTE_STATEFUL` | Set to `1` to use stateful MCP sessions. Default is stateless, so no session cap or session expiry applies. |
| `HB_REMOTE_MAX_SESSIONS` | Concurrent session cap in stateful mode. Default `8`. |
| `HB_REMOTE_IDLE_MS` | Idle session timeout in stateful mode. Default 15 minutes. |
| `HB_REMOTE_MAX_BODY_BYTES` | POST body cap. Default 1 MiB. |
| `HB_REMOTE_LOG_FILE` | JSONL diagnostics path. |
| `HB_CLOUDFLARED_PATH` | Optional explicit path to the `cloudflared` executable. |

The token is read from the file on every request, so rotation does not require
restarting the gateway. A missing or malformed token produces `401`.

## Client shape

### Bearer mode

```json
{
  "mcpServers": {
    "hyperbolic-browser": {
      "httpUrl": "https://<public-hostname>/mcp/browser",
      "headers": {
        "Authorization": "Bearer <remote-token>"
      }
    }
  }
}
```

The local URL is `http://127.0.0.1:4112/mcp/browser` when the tunnel is stopped.

### OAuth mode

In an OAuth-capable MCP client — for example Gemini Connected Apps or another
custom connector — enter:

- MCP server URL: `https://<public-hostname>/mcp/browser`
- Client ID: the generated OAuth client ID
- Client secret: the generated OAuth client secret
- Advanced features: enable PKCE if the client asks

The gateway serves:

- `/.well-known/oauth-protected-resource/mcp/browser`
- `/.well-known/oauth-authorization-server`
- `/oauth/authorize`
- `/oauth/token`
- `/oauth/revoke`

It does not advertise dynamic client registration, so clients that support a
pre-registered client use the credentials entered under advanced settings.
Authorization requires explicit approval on the local consent page. Access
tokens are short-lived and refresh tokens rotate on use. OAuth tokens live in
the gateway process, so restarting the gateway requires re-authorization.

## Security boundaries

- Bind is loopback-only.
- Bearer/OAuth auth runs before session creation or body parsing.
- The remote bearer token is separate from the Hyperbolic Rest bridge token.
- The raw bridge and `/wrap/*` are not routed through the gateway.
- Sessions are capped, idle-expire, and close on shutdown.
- No SSE GET stream is exposed in this phase.
- Named tunnel token is stored owner-only and never exposed to the renderer.
- Cloudflare Access is not implemented yet; use Cloudflare policy in front of
  the named tunnel if needed.

The public hostname is not authentication. Keep the bearer/OAuth requirement.

## Verification

```bash
npm run test:mcp-http
npm run test:mcp-oauth
npm run test:cloudflared
npm run test:cloudflared-tunnel
npm run test:remote
```
