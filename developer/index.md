---
okf_version: "0.2"
---

# Hyperbolic Gateway Developer Knowledge

This is the developer-facing OKF bundle for **Hyperbolic Gateway**: the
Electron app, the local HTTP bridge, the `hb-browser` MCP server, the
`hb-rest` MCP server, and the wrapper/recipe formats.

It is written for people building agents, MCP clients, integrations, or
saved REST tools on top of the app. It is not the end-user manual.

## Start here

* [Install and run](getting-started/installation.md) - local app, build from source, and the bridge.
* [Connect an MCP client](getting-started/mcp-clients.md) - `hb-browser`, `hb-rest`, bundled runtime, and environment variables.
* [First browser session](getting-started/first-session.md) - health check, navigate, observe, act, and wait.
* [Examples](examples/index.md) - a complete browser task and a complete REST wrapper.

## Understand the system

* [Runtime architecture](architecture/runtime.md) - Electron, Chromium, the HTTP bridge, and the two MCP servers.
* [Security model](architecture/security.md) - local trust boundaries, bridge tokens, credentials, SSRF policy, and human takeover.

## API reference

* [Browser MCP API](api/browser-mcp.md) - the `hb-browser` server, tool groups, resources, and call shape.
* [REST MCP API](api/rest-mcp.md) - the `hb-rest` server, ten meta-tools, generated tools, and discovery.
* [Remote MCP gateway](api/remote-mcp.md) - the Phase 1 Streamable HTTP gateway and its auth/session model.
* [Development logs MCP](api/devlogs.md) - local-only development log access.
* [Local bridge HTTP API](api/bridge-http.md) - supported local control-plane routes and authentication.
* [Wrapper format](formats/wrapper-format.md) - the saved request, input schema, auth reference, and validation rules.
* [Recipe format](formats/recipe-format.md) - JSON-to-Markdown projection, templates, limits, and pagination.
* [Error catalogue](formats/errors.md) - browser, wrapper, and bridge error codes.

## Related documentation

* [Documentation hub](../docs/README.md) - user-facing documentation, architecture notes, and operations guides.
* [Hyperbolic Rest man page](../docs/HYPERBOLIC_REST.md) - the full operational guide for wrappers and credentials.
* [Build and packaging](../docs/BUILDING.md) - installers, CI, signing, and release policy.
* [Codebase map](../docs/CODEBASE.md) - subsystem map and implementation findings.

## Using this bundle

Every concept is Markdown with YAML frontmatter. The bundle can be read
directly from the repository, served as static files, or crawled by an
agent. The Pages build publishes both the readable HTML pages and the raw
OKF Markdown at `/developer/`.

The older `kuang_docs/okf.json` bundle is a custom agent-orcha manifest used
for the browser playbooks and MCP resources. It is not part of this standard
OKF v0.2 bundle.
