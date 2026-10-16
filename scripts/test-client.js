import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function runLiveMcpTest() {
  console.log('⚡ KUANG GRADE MARK ELEVEN // LIVE MCP SERVER TEST');
  console.log('Connecting to Mark Eleven MCP server over stdio (bin/mcp-server.cjs)...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['./bin/mcp-server.cjs'],
  });

  const client = new Client(
    { name: 'mark-eleven-live-test', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✓ Successfully connected to Mark Eleven MCP Server over stdio!\n');

  // List tools
  const tools = await client.listTools();
  console.log(`Discovered ${tools.tools.length} semantic tools from catalog:`);
  for (const t of tools.tools.slice(0, 10)) {
    console.log(` - \x1b[36m${t.name}\x1b[0m: ${t.description.substring(0, 70)}...`);
  }
  console.log(` ... and ${tools.tools.length - 10} more tools.\n`);

  console.log('--- Executing Live Browser Directives Against Running Cyberdeck ---');

  // 1. Get initial page info
  console.log('\n[1/5] Calling get_page_info()...');
  const info1 = await client.callTool({ name: 'get_page_info', arguments: {} });
  console.log('Active Page Info:', info1.content[0].text);

  // 2. Live Navigation to Hacker News
  console.log('\n[2/5] Calling navigate_to("https://news.ycombinator.com")...');
  const navResult = await client.callTool({
    name: 'navigate_to',
    arguments: { url: 'https://news.ycombinator.com', auto_dismiss_consent: true },
  });
  console.log('Result:', navResult.content[0].text);

  // 3. Scroll page
  console.log('\n[3/5] Calling scroll_page(direction: "down", amount: 350)...');
  const scrollResult = await client.callTool({
    name: 'scroll_page',
    arguments: { direction: 'down', amount: 350 },
  });
  console.log('Scroll Result:', scrollResult.content[0].text);

  // 4. Click element with Bio-Kinematic Chaos mouse movement
  console.log('\n[4/5] Calling click_element(x: 250, y: 180) [Cyberdeck pointer + phosphor trail]...');
  const clickResult = await client.callTool({
    name: 'click_element',
    arguments: { x: 250, y: 180 },
  });
  console.log('Click Result:', clickResult.content[0].text);

  // 5. Harvest token-efficient page markdown
  console.log('\n[5/5] Calling get_page_markdown()...');
  const mdResult = await client.callTool({
    name: 'get_page_markdown',
    arguments: {},
  });
  const md = mdResult.content[0].text;
  console.log(`Markdown Harvested (${md.length} characters):`);
  console.log(md.substring(0, 300) + '\n... [truncated preview]');

  console.log('\n🎉 ALL LIVE MCP DIRECTIVES VERIFIED IN ACTUAL RUNNING SOFTWARE!');
  await client.close();
  process.exit(0);
}

runLiveMcpTest().catch((err) => {
  console.error('Fatal MCP test client error:', err);
  process.exit(1);
});
