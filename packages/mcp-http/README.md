# @kuang/mcp-http

Reusable Streamable HTTP host for MCP servers.

It owns:

- the loopback HTTP listener
- bearer-token authorization boundary
- session registry, cap and idle expiry
- direct JSON responses or optional SSE
- graceful shutdown

The MCP server factory is injected, so the same host can serve the browser,
REST, or future tool surfaces.

```ts
import { createBearerAuthorizer, createMcpHttpHost } from './src/index.ts';

const host = createMcpHttpHost({
  port: 4112,
  path: '/mcp/browser',
  createServer: createBrowserMcpServer,
  authorize: createBearerAuthorizer(() => readToken()),
  enableJsonResponse: true,
  allowSse: false,
});

await host.start();
```

This package intentionally has no Electron, Cloudflare, filesystem-token, or
Hyperbolic Gateway imports. Those belong in the application layer.
