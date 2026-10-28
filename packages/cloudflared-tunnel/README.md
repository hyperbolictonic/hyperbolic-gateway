# @kuang/cloudflared-tunnel

Reusable Cloudflare **named tunnel** process manager.

- runs `cloudflared tunnel --no-autoupdate run` with `TUNNEL_TOKEN`
- waits for `Registered tunnel connection`
- bounds startup to 30 seconds
- stops with SIGTERM, then SIGKILL after 3 seconds
- never logs or returns the token

The public hostname and ingress mapping are configured in Cloudflare. This
package has no Electron, MCP, or Hyperbolic Gateway imports.
