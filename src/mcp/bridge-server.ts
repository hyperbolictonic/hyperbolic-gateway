import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS_CATALOG } from './tools-catalog.js';

const BRIDGE_URL = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

async function callBridge(endpoint: string, method: string = 'GET', body: any = null) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BRIDGE_URL}${endpoint}`, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return await res.json();
}

export function createBridgeMcpServer() {
  const server = new McpServer({
    name: 'kuang-grade-mark-eleven',
    version: '1.0.0',
  });

  for (const tool of TOOLS_CATALOG) {
    server.tool(tool.name, tool.description, tool.parameters, async (args) => {
      try {
        const body = tool.payload ? tool.payload(args) : args;
        const data = await callBridge(tool.endpoint, tool.method || 'POST', body);
        const text = tool.format
          ? tool.format(data, args)
          : typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `[Mark Eleven MCP Error] ${err?.message || err}. (Ensure Cyberdeck is running at ${BRIDGE_URL})`,
            },
          ],
        };
      }
    });
  }

  return server;
}

async function start() {
  const server = createBridgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((err) => {
  console.error('Fatal Mark Eleven MCP Server Error:', err);
  process.exit(1);
});
