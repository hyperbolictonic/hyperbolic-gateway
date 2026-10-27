---
type: Guide
title: Install and run Hyperbolic Gateway
description: Launch the desktop app, build from source, and verify the local bridge before connecting an MCP client.
tags: [getting-started, install, bridge]
status: stable
---

# Install and run

Hyperbolic Gateway is a desktop Electron app. The app owns the visible
Chromium browser and the local HTTP bridge. MCP servers are started by your
agent client, not by the app, and they forward tool calls to that bridge.

## Requirements

- Windows, Linux, or macOS on the targets listed in the release notes.
- Node.js 20 or newer and pnpm for a source build.
- A real desktop session. The browser is intentionally visible and is not a
  headless server product.

## Run a development build

From the repository root:

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Electron with live reload. The app listens on
`http://127.0.0.1:4111` by default.

## Run a production build

```bash
pnpm build
pnpm start
```

`pnpm build` also builds the stdio bundles used by MCP clients:

```text
bin/mcp-server.cjs   hb-browser
bin/wrap-server.cjs  hb-rest
```

Build the MCP bundles alone with:

```bash
pnpm build:mcp
```

## Verify the bridge

With the app running:

```bash
curl http://127.0.0.1:4111/health
```

A healthy response includes the app version, page revision, and bridge
capabilities. If another process already owns port `4111`, the app reports
`EADDRINUSE`; either close the other instance or start this one with:

```bash
HB_BRIDGE_PORT=4112
```

When the port changes, set `HB_BRIDGE_URL` to the same URL in the MCP client
configuration.

## Installed builds and `userData`

Installed builds copy the MCP binaries into `<userData>/bin/` and refresh them
on update. Portable and AppImage builds must not be pointed at a temporary
`resources/` path, so use the copied binaries in `userData`.

Hyperbolic Rest stores its state under `<userData>/wrap/`:

```text
<userData>/wrap/wrappers/<id>.json
<userData>/wrap/secrets.json
<userData>/wrap/audit.jsonl
<userData>/wrap/token
```

The token is regenerated whenever the app starts. The MCP client is configured
with the token **file**, never the token value.

## Next

- [Connect an MCP client](mcp-clients.md)
- [First browser session](first-session.md)
- [Build and packaging](../../docs/BUILDING.md)
