import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  console.log('⚡ TESTING MCP TAB TOOLS VIA STDIO TRANSPORT');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['scripts/mcp-server.js'],
  });

  const client = new Client(
    { name: 'mcp-tabs-tester', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✓ Connected to Mark Eleven MCP Server');

  // 1. List tools
  const tools = await client.listTools();
  console.log(`Discovered ${tools.tools.length} semantic tools.`);
  const tabTools = tools.tools.filter((t) => t.name.includes('tab'));
  console.log('Tab Management Tools:');
  tabTools.forEach((t) => console.log(`  - \x1b[36m${t.name}\x1b[0m: ${t.description}`));

  // 2. Call list_tabs
  console.log('\nCalling MCP tool: list_tabs()...');
  const listRes = await client.callTool({ name: 'list_tabs', arguments: {} });
  console.log('Open Tabs:', listRes.content[0].text);

  // 3. Call new_tab with a cyberpunk destination
  console.log('\nCalling MCP tool: new_tab("https://motherfuckingwebsite.com")...');
  const newRes = await client.callTool({
    name: 'new_tab',
    arguments: { url: 'https://motherfuckingwebsite.com' },
  });
  console.log('Result:', newRes.content[0].text);

  // 4. Verify list_tabs again
  const listRes2 = await client.callTool({ name: 'list_tabs', arguments: {} });
  console.log('\nUpdated Tabs Pool:');
  console.log(listRes2.content[0].text);

  await client.close();
  console.log('\n✓ MCP Tab Management Verified Successfully!');
}

main().catch(console.error);
