# @kuang/quick-tunnel

Reusable Cloudflare Quick Tunnel process manager.

- starts `cloudflared tunnel --url <local> --no-autoupdate`
- parses the public `trycloudflare.com` URL
- bounds startup to 15 seconds by default
- stops with SIGTERM, then SIGKILL after 3 seconds
- emits state and log callbacks

It has no Electron, MCP, or Hyperbolic Gateway imports. The application layer
owns the UI, the gateway URL, and the decision to start the tunnel.
