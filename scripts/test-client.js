import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function runTest() {
  console.log('⚡ KUANG GRADE MARK ELEVEN // MCP TEST CLIENT');
  console.log('Connecting to Mark Eleven MCP server over stdio...');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['electron', './dist-electron/main/index.js'],
  });

  const client = new Client(
    { name: 'mark-eleven-test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✓ Successfully connected to Mark Eleven MCP Server!\n');

  // List tools
  const tools = await client.listTools();
  console.log(`Discovered ${tools.tools.length} semantic tools:`);
  for (const t of tools.tools) {
    console.log(` - \x1b[36m${t.name}\x1b[0m: ${t.description}`);
  }

  console.log('\n--- Executing Test Directives ---');

  // 1. Navigate to Hacker News
  console.log('\n1. Calling navigate_to("https://news.ycombinator.com")...');
  const navResult = await client.callTool({
    name: 'navigate_to',
    arguments: { url: 'https://news.ycombinator.com' },
  });
  console.log('Result:', navResult.content[0].text);

  // 2. Get Page Info
  console.log('\n2. Calling get_page_info()...');
  const infoResult = await client.callTool({
    name: 'get_page_info',
    arguments: {},
  });
  console.log('Page Info:', infoResult.content[0].text);

  // 3. Harvest Markdown
  console.log('\n3. Calling get_page_markdown()...');
  const markdownResult = await client.callTool({
    name: 'get_page_markdown',
    arguments: {},
  });
  const md = markdownResult.content[0].text;
  console.log(`Markdown Harvested (${md.length} characters):`);
  console.log(md.substring(0, 350) + '\n... [truncated preview]');

  // 4. Evaluate JavaScript in page context
  console.log('\n4. Calling evaluate_javascript("document.querySelectorAll(\'.athing\').length")...');
  const evalResult = await client.callTool({
    name: 'evaluate_javascript',
    arguments: { script: 'document.querySelectorAll(".athing").length' },
  });
  console.log('Story items count on page:', evalResult.content[0].text);

  // 5. Get Console Logs
  console.log('\n5. Calling get_console_logs()...');
  const logsResult = await client.callTool({
    name: 'get_console_logs',
    arguments: { limit: 5 },
  });
  console.log('Console logs captured:', logsResult.content[0].text);

  console.log('\n✓ All semantic MCP directives executed successfully!');
  await client.close();
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test client error:', err);
  process.exit(1);
});
