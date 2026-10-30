# Developer Knowledge Update Log

## 2026-10-30

* **Creation**: Added the Settings -> Tools tool manager: enable/disable, tiered drag order, per-tool instruction overrides, per-tool and global reset.
* **Update**: Added the curated `tools/list` order (`navigate_to` -> `observe` -> `act` -> `wait_for` -> `find` -> `extract`) and made `navigate_to` Tier 1.
* **Creation**: Documented the proposed 15-tool consolidated surface and nested action-accordion settings shape in `docs/TOOL_SURFACE_CONSOLIDATION.md`.

## 2026-10-28

* **Creation**: Added the Phase 1 remote MCP gateway and its Streamable HTTP host package.
* **Creation**: Added the Phase 2 app-managed token, gateway lifecycle, and Settings -> Remote panel.
* **Creation**: Added the Phase 3 Cloudflare named tunnel manager and public hostname/config handoff.
* **Creation**: Added the managed cloudflared downloader with SHA-256 verification and manual/automatic update policy.
* **Creation**: Added the selectable OAuth 2.0 mode with discovery, PKCE, consent, access/refresh tokens and pre-registered client credentials.
* **Creation**: Added the local-only `hb-devlogs` MCP server with allowlisted, redacted log reads.
* **Creation**: Documented the remote gateway endpoint, auth boundary, environment variables, and non-goals.
* **Update**: Extracted the browser MCP factory from the stdio entry point so HTTP and stdio share one server definition.

## 2026-10-27

* **Creation**: Established the standard OKF v0.2 developer bundle.
* **Creation**: Added getting-started, architecture, API reference, format, and example concepts.
* **Update**: Documented the `hb-browser` and `hb-rest` split, legacy aliases, and bridge token model.
