import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testAllMcpToolsLive() {
  console.log('⚡ ========================================================');
  console.log('⚡ KUANG GRADE MARK ELEVEN: COMPREHENSIVE LIVE MCP SUITE');
  console.log('⚡ Testing real tools against active Cyberdeck on 127.0.0.1:4111');
  console.log('⚡ ========================================================\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['./bin/mcp-server.cjs'],
  });

  const client = new Client(
    { name: 'mark-eleven-full-suite', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✓ Successfully connected to Mark Eleven MCP Server over stdio!\n');

  // Verify full tool discovery
  const toolList = await client.listTools();
  console.log(`Discovered ${toolList.tools.length} total semantic MCP tools.\n`);

  let passed = 0;
  let failed = 0;

  async function call(name, args = {}, label = '') {
    try {
      console.log(`\n▶ [TEST ${passed + failed + 1}] ${name} ${label ? `(${label})` : ''}`);
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) {
        console.error(`  ❌ FAILED: ${res.content?.[0]?.text}`);
        failed++;
        return null;
      }
      const output = res.content?.[0]?.text || '';
      const preview = output.length > 180 ? output.substring(0, 180) + '... [truncated]' : output;
      console.log(`  ✓ SUCCESS: ${preview.replace(/\n/g, ' ')}`);
      passed++;
      return output;
    } catch (err) {
      console.error(`  ❌ EXCEPTION: ${err.message}`);
      failed++;
      return null;
    }
  }

  // 1. Diagnostics & Hardware
  await call('get_page_info', {}, 'Initial Page Diagnostics');
  await call('get_fingerprint_profile', {}, 'Inspect Hardware Spoofing');

  // 2. Navigation
  await call('navigate_to', { url: 'https://news.ycombinator.com', auto_dismiss_consent: true }, 'Live Navigation to Hacker News');
  
  // 3. Inspection & Content
  await call('get_page_markdown', {}, 'Extract Page Markdown Envelope');
  await call('take_screenshot', {}, 'Capture High-Res Viewport Image');
  await call('evaluate_javascript', { script: 'document.title' }, 'Query DOM via JS');
  await call('get_console_logs', { limit: 5 }, 'Inspect Live Console Logs');

  // 4. Bio-Kinematic Interaction
  await call('scroll_page', { direction: 'down', amount: 350 }, 'Inertial Wheel Scroll');
  await call('click_element', { x: 220, y: 150 }, 'Bio-Kinematic Chaos Click & Shockwave');
  await call('scroll_page', { direction: 'top', amount: 0 }, 'Scroll Back to Top');

  // 5. Multi-Tab Orchestration
  const newTabRes = await call('new_tab', { url: 'https://wikipedia.org' }, 'Open Wikipedia in Child Tab');
  await call('list_tabs', {}, 'List All Active Tabs');
  let tabId = 'tab_2';
  try {
    const match = newTabRes && newTabRes.match(/tab_\d+/);
    if (match) tabId = match[0];
  } catch {}
  await call('switch_tab', { tab_id: 'tab_1' }, 'Switch Focus to Primary Tab');
  await call('switch_tab', { tab_id: tabId }, 'Switch Focus Back to Child Tab');
  await call('close_tab', { tab_id: tabId }, 'Close Child Tab');

  // 6. LanceDB Cortex & Bookmarks
  await call('add_bookmark', {
    url: 'https://news.ycombinator.com',
    title: 'Hacker News Live Test',
    notes: 'Live verification from MCP test client',
    tags: ['testing', 'mcp', 'live'],
  }, 'Vault Bookmark to LanceDB');
  await call('list_bookmarks', { query: 'Hacker News' }, 'Recall Bookmarks via Hybrid Search');
  await call('delete_bookmark', { url_or_id: 'https://news.ycombinator.com' }, 'Clean up Bookmark');
  await call('get_history', { limit: 5 }, 'Retrieve Browsing History from Cortex');

  // 7. Shield Breaker
  await call('dismiss_consent', {}, 'Autonomous Shield Breaker Scan');

  // 8. Session Jar Vault
  await call('save_session', { name: 'test_mcp_session' }, 'Snapshot Session State');
  await call('list_sessions', {}, 'Inspect Session Vault');

  // 9. Script Vault & Macro Engine
  await call('save_script', {
    name: 'test_headline_counter',
    description: 'Counts headlines on the page',
    code: 'return document.querySelectorAll("a").length;',
    parameters: {},
  }, 'Vault Automation Script');
  await call('recall_script', { query: 'count headlines on page' }, 'Semantic Script Recall');
  await call('run_script', { name: 'test_headline_counter', args: {} }, 'Execute Macro in Live Tab');
  await call('list_scripts', {}, 'List Vaulted Macros');
  await call('delete_script', { name: 'test_headline_counter' }, 'Clean up Macro');

  // 10. Real-time Streams & Network
  await call('list_realtime_streams', {}, 'Inspect Real-time WebSocket/SSE Streams');
  await call('get_network_traffic', { limit: 5 }, 'Inspect Live Network Buffer');

  // 11. Notifications & System Tray
  await call('send_notification', {
    title: 'Mark Eleven Live Test',
    message: 'Live MCP verification suite is running successfully.',
    urgency: 'low',
    sound: false,
  }, 'Dispatch OS Desktop Notification');
  await call('get_human_intervention_status', {}, 'Inspect HIL Status');
  await call('configure_system_tray', {}, 'Inspect Tray Configuration');

  console.log('\n========================================================');
  console.log(`📊 FINAL TEST REPORT: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================\n');

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

testAllMcpToolsLive().catch((err) => {
  console.error('Fatal test suite exception:', err);
  process.exit(1);
});
