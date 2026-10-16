/**
 * Kuang Grade Mark Eleven - MCP Stdio Client Test for Cortex Recall & Bookmarks
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function main() {
  console.log('--- 🔌 CONNECTING MCP CLIENT OVER STDIO ---');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(process.cwd(), 'scripts', 'mcp-server.js')],
  });

  const client = new Client({ name: 'test-cortex-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log('   Connected to Kuang Grade Mark Eleven MCP Server!');

  // List tools
  const tools = await client.listTools();
  console.log(`\n[1] Total Available MCP Tools: ${tools.tools.length}`);
  const cortexTools = tools.tools.filter(t => 
    ['recall_memory', 'get_history', 'clear_history', 'add_bookmark', 'list_bookmarks', 'delete_bookmark'].includes(t.name)
  );
  console.log('   Cortex Tools Registered:', cortexTools.map(t => t.name).join(', '));

  // Test list_bookmarks
  console.log('\n[2] Executing MCP Tool: list_bookmarks...');
  const bookmarksResult = await client.callTool({ name: 'list_bookmarks', arguments: {} });
  console.log('   Bookmarks count returned:', JSON.parse(bookmarksResult.content[0].text).length);

  // Test recall_memory
  console.log('\n[3] Executing MCP Tool: recall_memory (query: "hacker news")...');
  const recallResult = await client.callTool({
    name: 'recall_memory',
    arguments: { query: 'hacker news', limit: 2 }
  });
  const parsedRecall = JSON.parse(recallResult.content[0].text);
  console.log(`   Recalled ${parsedRecall.length} memory traces from LanceDB:`);
  parsedRecall.forEach((r, i) => {
    console.log(`     [${i + 1}] (${r.domain}) ${r.title} (score: ${r.score})`);
  });

  // Test get_history
  console.log('\n[4] Executing MCP Tool: get_history...');
  const historyResult = await client.callTool({ name: 'get_history', arguments: { limit: 5 } });
  const parsedHistory = JSON.parse(historyResult.content[0].text);
  console.log(`   Retrieved ${parsedHistory.length} history records.`);

  await client.close();
  console.log('\n--- ✅ ALL MCP STDIO CORTEX TESTS VERIFIED! ---');
}

main().catch(err => {
  console.error('MCP Test Failed:', err);
  process.exit(1);
});
