# @kuang/mcp-oauth

Small OAuth 2.1 authorization server for one MCP HTTP resource and one static
client.

It implements:

- protected-resource metadata
- authorization-server metadata
- authorization code + PKCE S256
- local consent page
- access and refresh tokens
- token revocation

It intentionally does **not** advertise dynamic client registration, so Gemini
falls back to the client ID/secret entered under Advanced features.

The package has no Electron, Cloudflare, or Hyperbolic Gateway imports.
