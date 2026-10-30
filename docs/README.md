# 📚 Hyperbolic Gateway — Documentation

**Hyperbolic Browser + Hyperbolic Rest for your local AI agents.**

This is the curated documentation set published on GitHub Pages. Internal field notes, plans and
handoffs are intentionally not published here; links to them go back to the repository.

## Start

- [Overview](../README.html) — what Hyperbolic Gateway is and how the pieces fit together.
- [Building & packaging](./BUILDING.html) — installers, CI, signing, auto-update and release policy.
- [Packaging notes](./PACKAGING.html) — distribution-specific notes.
- [Changelog](../CHANGELOG.html) — every shipped release.

## Developer documentation

- [Developer guide](../developer/index.html) — the standard OKF v0.2 bundle for API and integration work.
- [Connect an MCP client](../developer/getting-started/mcp-clients.html) — `hb-browser`, `hb-rest`, bundled runtime and environment variables.
- [Agent skills](../developer/getting-started/skills.html) — install the `hb-browser` and `hb-wrap` skills from GitHub.
- [Browser MCP API](../developer/api/browser-mcp.html) — tool groups, resources and call shape.
- [REST MCP API](../developer/api/rest-mcp.html) — meta-tools, generated tools and result shapes.
- [Remote MCP gateway (experimental)](../developer/api/remote-mcp.html) — Streamable HTTP gateway, bearer/OAuth modes, and named Cloudflare Tunnel. Third-party client support is experimental; Gemini Connected Apps is known to be flaky.
- [Development logs MCP](../developer/api/devlogs.html) — local-only log access for development.
- [Wrapper format](../developer/formats/wrapper-format.html) and [recipe format](../developer/formats/recipe-format.html).

## Hyperbolic Browser

- [Architecture](./CODEBASE.html) — system maps, call paths and subsystem findings.
- [Control layer](./CONTROL_LAYER.html) — targeting, consent, human takeover and input pacing.
- [Shadow DOM & frames](./SHADOW_DOM_AND_FRAMES.html) — what the browser can see and click.
- [Shadow Walk](./SHADOW_WALK.html) — sealed-content discovery and the tiered risk levers.
- [Research mode](./RESEARCH_STEALTH.html) — isolated research sessions, proxies and challenge backoff.
- [Cortex embeddings](./EMBEDDING_PROVIDERS.html) — embedding providers and local recall.
- [Decision models](./DECISION_MODELS.html) — the optional `decide` / `drive` layer.

## Hyperbolic Rest

- [Hyperbolic Rest man page](./HYPERBOLIC_REST.html) — wrappers, recipes, credentials, pagination and the MCP surface.
- [Legacy Kuang Wrap link](./KUANG_WRAP.html) — compatibility stub for existing links.

## Reference

- [Concept and lore](./concept.html) — design philosophy and the original inspiration.
- [Browser navigation playbook](../kuang_docs/partitions/browser_navigation_playbook.html)
- [CAPTCHA and anti-bot strategies](../kuang_docs/partitions/captcha_and_anti_bot_strategies.html)
- [Primitives and workflows](../kuang_docs/partitions/primitives_and_workflows.html)
- [Selector and set-of-marks recipes](../kuang_docs/partitions/selector_and_som_recipes.html)

## Compatibility

New MCP configurations use `hb-browser` and `hb-rest`. The legacy `kuang` and `kuang-wrap`
labels, `KUANG_*` environment variables and existing wrapper files remain supported.
