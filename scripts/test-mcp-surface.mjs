#!/usr/bin/env node
/**
 * MCP surface test — asserts the advertised tool surface matches the hidden-alias policy.
 *
 * Phase 2 of docs/TOOL_CATALOG_REVIEW.md: deprecated names are hidden from `tools/list`
 * but must remain callable by name via `tools/call`, and calling one should return a
 * deprecation notice. This needs a running Cyberdeck (it calls a couple of read-only tools).
 *
 * Run: npm run test:mcp:surface
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Deprecated names that must NOT appear in tools/list.
const HIDDEN = [
  'go_to_url',
  'harvest_markdown',
  'send_desktop_notification',
  'save_session',
  'restore_session',
  'list_sessions',
  'get_history',
  'clear_history',
  'take_annotated_screenshot',
  'take_economy_screenshot',
  'list_marks',
  'get_page_markdown',
  'get_api_payload',
  'get_stream_messages',
  'get_page_info',
  'click_element',
  'click_mark',
  'type_text',
  'type_mark',
  'recall_script',
  'focus_window',
  'clear_network_traffic',
  'clear_stream_messages',
];
// Canonical replacements that MUST appear.
const CANONICAL = [
  'navigate_to',
  'take_screenshot',
  'observe',
  'act',
  'send_notification',
  'query_json_data',
  'bridge_health',
  'context_save',
  'context_open',
  'context_list',
  'context_delete',
  'browsing_history',
  'browsing_history_clear',
  'list_scripts',
  'set_window_visibility',
  'clear_capture',
  'llm_surface',
  'llm_fetch',
  'read_url',
  'search_web',
  'deep_crawl',
  'research_topic',
];

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// This suite drives live tools, so skip cleanly when the Cyberdeck app is down (matching the other
// bridge-level suites) rather than failing every tool call and looking like a product regression.
const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
try {
  const res = await fetch(`${BRIDGE}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
  process.exit(0);
}

const transport = new StdioClientTransport({ command: 'node', args: ['./bin/mcp-server.cjs'] });
const client = new Client({ name: 'mcp-surface-test', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

try {
  console.log('\n▶ tools/list surface');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  const set = new Set(names);

  const leaked = HIDDEN.filter((n) => set.has(n));
  check('deprecated names are hidden from tools/list', leaked.length === 0, leaked.length ? `leaked: ${leaked.join(', ')}` : `${names.length} tools advertised`);

  const absent = CANONICAL.filter((n) => !set.has(n));
  check('canonical names are present', absent.length === 0, absent.length ? `missing: ${absent.join(', ')}` : '');
  check('help is present', set.has('help'));

  const byName = new Map(tools.map((t) => [t.name, t]));
  const describes = (n) => byName.get(n)?.description || '';
  check(
    'tiered tools carry a [TIER n] prefix',
    describes('observe').startsWith('[TIER 1') && describes('act').startsWith('[TIER 1') && describes('take_screenshot').startsWith('[TIER 2') && describes('evaluate_javascript').startsWith('[TIER 3'),
    `observe: "${describes('observe').slice(0, 24)}..."`,
  );
  check(
    'act advertises all three addressing modes',
    describes('act').includes('mark_id') && describes('act').includes('CSS selector') && /coordinates/.test(describes('act')),
    `act: "${describes('act').slice(0, 80)}..."`,
  );
  check('un-tiered tools stay unprefixed', !describes('navigate_to').startsWith('[TIER'));

  const { resources } = await client.listResources();
  check('mark-eleven://tools/recommended is registered', resources.some((r) => r.uri === 'mark-eleven://tools/recommended'));
  const rec = await client.readResource({ uri: 'mark-eleven://tools/recommended' });
  const recText = rec.contents?.[0]?.text || '';
  check('recommended resource names the 5 jobs', recText.includes('collect_all') && recText.includes('wait_for') && recText.includes('observe'));

  console.log('\n▶ deprecated names stay callable via tools/call');
  const hiddenRes = await client.callTool({ name: 'harvest_markdown', arguments: {} });
  check('harvest_markdown still executes', !hiddenRes.isError, hiddenRes.isError ? hiddenRes.content?.[0]?.text : '');
  const hiddenText = hiddenRes.content?.[0]?.text || '';
  check('returns a deprecation notice', hiddenText.startsWith('⚠ deprecated tool name') && hiddenText.includes('observe'));

  console.log('\n▶ renamed canonical works');
  const hist = await client.callTool({ name: 'browsing_history', arguments: { limit: 2 } });
  check('browsing_history executes', !hist.isError, (hist.content?.[0]?.text || '').replace(/\s+/g, ' ').slice(0, 80));

  const legacyHist = await client.callTool({ name: 'get_history', arguments: { limit: 2 } });
  check('legacy get_history still executes', !legacyHist.isError, '');
  check('legacy get_history points at browsing_history', (legacyHist.content?.[0]?.text || '').includes('browsing_history'));
  console.log('');
  console.log('▶ screenshot merge (Phase 3)');
  const plain = await client.callTool({ name: 'take_screenshot', arguments: {} });
  check('take_screenshot() plain returns an image', !plain.isError && (plain.content || []).some((c) => c.type === 'image'), (plain.content?.[0]?.text || '').slice(0, 60));

  const md = await client.callTool({ name: 'take_screenshot', arguments: { marks: true, detail: 'markdown' } });
  const mdText = md.content?.[0]?.text || '';
  check('take_screenshot(marks:true, detail:"markdown") returns a marks table with NO image', !md.isError && mdText.includes('Interactive Elements') && !(md.content || []).some((c) => c.type === 'image'));

  const eco = await client.callTool({ name: 'take_screenshot', arguments: { marks: true, detail: 'economy' } });
  check('take_screenshot(marks:true, detail:"economy") returns an image', !eco.isError && (eco.content || []).some((c) => c.type === 'image'));

  const legacyEco = await client.callTool({ name: 'take_economy_screenshot', arguments: {} });
  check('legacy take_economy_screenshot still works (hidden)', !legacyEco.isError && (legacyEco.content?.[0]?.text || '').includes('Set-of-Marks'));

  console.log('\n▶ merges (Phase 7)');

  // observe/extract: the structured modes now live only on `extract`.
  const observeEnum = byName.get('observe')?.inputSchema?.properties?.as?.enum || [];
  check(
    'observe enum no longer advertises list/table/app_data',
    !observeEnum.includes('list') && !observeEnum.includes('table') && !observeEnum.includes('app_data'),
    observeEnum.join('|'),
  );
  const extractEnum = byName.get('extract')?.inputSchema?.properties?.kind?.enum || [];
  check('extract owns the structured kinds', extractEnum.includes('table') && extractEnum.includes('app_data'), extractEnum.join('|'));

  // scripts: list_scripts now lists AND searches; recall_script is a hidden alias.
  const scripts = await client.callTool({ name: 'list_scripts', arguments: { limit: 5 } });
  check('list_scripts executes (list mode)', !scripts.isError, (scripts.content?.[0]?.text || '').replace(/\s+/g, ' ').slice(0, 70));
  const scriptSearch = await client.callTool({ name: 'list_scripts', arguments: { query: 'extract links', limit: 5 } });
  check('list_scripts(query) searches the vault', !scriptSearch.isError && !/No matching scripts/.test(scriptSearch.content?.[0]?.text || ''), (scriptSearch.content?.[0]?.text || '').replace(/\s+/g, ' ').slice(0, 70));
  const legacyRecall = await client.callTool({ name: 'recall_script', arguments: { query: 'links' } });
  check('legacy recall_script still executes', !legacyRecall.isError, '');
  check('legacy recall_script points at list_scripts', (legacyRecall.content?.[0]?.text || '').includes('list_scripts'));

  // window: set_window_visibility shows+focuses; focus_window is a hidden alias.
  const win = await client.callTool({ name: 'set_window_visibility', arguments: { visible: true } });
  check('set_window_visibility shows and focuses', !win.isError && /"focused"/.test(win.content?.[0]?.text || ''), (win.content?.[0]?.text || '').slice(0, 60));
  const legacyFocus = await client.callTool({ name: 'focus_window', arguments: {} });
  check('legacy focus_window still executes', !legacyFocus.isError, '');
  check('legacy focus_window points at set_window_visibility', (legacyFocus.content?.[0]?.text || '').includes('set_window_visibility'));

  // capture: clear_capture replaces the two per-buffer clears.
  const cap = await client.callTool({ name: 'clear_capture', arguments: { scope: 'all' } });
  check('clear_capture(all) clears both buffers', !cap.isError && /Cleared capture/i.test(cap.content?.[0]?.text || ''), (cap.content?.[0]?.text || '').slice(0, 70));
  const legacyClear = await client.callTool({ name: 'clear_network_traffic', arguments: {} });
  check('legacy clear_network_traffic still executes', !legacyClear.isError, '');
  check('legacy clear_network_traffic points at clear_capture', (legacyClear.content?.[0]?.text || '').includes('clear_capture'));

  console.log('\n▶ read_url paging (machine-readable cursor)');
  const LONG_JSON = 'https://dummyjson.com/users?limit=0';
  const firstRead = await client.callTool({ name: 'read_url', arguments: { url: LONG_JSON, max_chars: 500 } });
  const firstText = firstRead.content?.[0]?.text || '';
  const cursor = Number((firstText.match(/next_cursor=(\d+)/) || [])[1]);
  check(
    'read_url reports next_cursor=N (not prose) when truncated',
    !firstRead.isError && Number.isFinite(cursor) && cursor > 0,
    `next_cursor=${cursor}`,
  );

  const secondRead = await client.callTool({ name: 'read_url', arguments: { url: LONG_JSON, cursor, max_chars: 500 } });
  const secondText = secondRead.content?.[0]?.text || '';
  const nextCursor = Number((secondText.match(/next_cursor=(\d+)/) || [])[1]);
  check(
    'passing that cursor advances the offset by the requested budget',
    !secondRead.isError && nextCursor === cursor + 500,
    `next_cursor=${nextCursor} (from ${cursor})`,
  );
} finally {
  await client.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)\n`);
process.exit(failed.length === 0 ? 0 : 1);
