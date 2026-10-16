# 🔌 Kuang Grade Mark Eleven — Model Context Protocol Server (`src/mcp/`)

This directory contains the in-process TypeScript implementation of the Model Context Protocol (MCP) server using `@modelcontextprotocol/sdk`.

---

## 🏛️ Purpose & Architecture

While [`scripts/mcp-server.js`](../../scripts/README.md) is the standalone stdio server executable communicating via the HTTP bridge (`:4111`), [`src/mcp/server.ts`](./server.ts) allows the MCP server to be instantiated directly inside the Electron main process with zero HTTP serialization overhead when running in unified mode.

---

## 📄 Source Files

- **[`server.ts`](./server.ts)**:
  Defines `createMcpServer(chassis: BrowserChassis)` and registers the standard semantic tool definitions with Zod schemas.
