/**
 * Test script for Kuang Grade Mark Eleven - Cortex LanceDB Memory & Bookmarks Subsystem
 */

const BRIDGE_URL = 'http://127.0.0.1:4111';

async function req(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BRIDGE_URL}${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`[${res.status}] ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('--- 🧠 STARTING CORTEX & LANCEDB RECALL VERIFICATION ---');

  // 1. Health check
  console.log('\n[1] Checking Chassis Health & HTTP Bridge...');
  const health = await req('/health');
  console.log('   Bridge OK. Active Tab Title:', health.info.title);

  // 2. Add Bookmarks
  console.log('\n[2] Adding Test Bookmarks to LanceDB...');
  const bkmk1 = await req('/bookmarks/add', 'POST', {
    url: 'https://news.ycombinator.com',
    title: 'Hacker News (YCombinator)',
    notes: 'Primary intelligence node for technology breakthroughs and startups',
    tags: ['intel', 'tech', 'startups', 'news']
  });
  console.log('   Bookmark 1 Added:', bkmk1.bookmark.title, bkmk1.bookmark.tags);

  const bkmk2 = await req('/bookmarks/add', 'POST', {
    url: 'https://en.wikipedia.org/wiki/Neuromancer',
    title: 'Neuromancer - William Gibson',
    notes: 'Foundational cyberpunk canon detailing the Kuang Grade Mark Eleven Icebreaker',
    tags: ['cyberpunk', 'canon', 'kuang-grade', 'literature']
  });
  console.log('   Bookmark 2 Added:', bkmk2.bookmark.title, bkmk2.bookmark.tags);

  // 3. List & Filter Bookmarks
  console.log('\n[3] Listing Bookmarks from LanceDB...');
  const allBookmarks = await req('/bookmarks');
  console.log(`   Retrieved ${allBookmarks.bookmarks.length} bookmarks total.`);

  console.log('\n[4] Semantic Search on Bookmarks for "icebreaker"...');
  const filteredBkmk = await req('/bookmarks?q=icebreaker');
  console.log('   Top semantic match:', filteredBkmk.bookmarks[0]?.title);

  // 4. Navigate & Harvest to ingest page into LanceDB
  console.log('\n[5] Navigating active tab to Hacker News to trigger auto-indexing...');
  await req('/navigate', 'POST', { url: 'https://news.ycombinator.com' });
  console.log('   Waiting 3.5s for page settlement & auto-indexing...');
  await sleep(3500);

  console.log('\n[6] Explicitly harvesting page to verify token extraction & indexing...');
  const harvest = await req('/markdown', 'GET');
  console.log(`   Harvested: "${harvest.construct.title}" (${harvest.construct.estimatedTokens} tokens)`);

  // 5. Test Semantic Recall on LanceDB
  console.log('\n[7] Querying LanceDB Cortex Recall for "technology startups and news"...');
  const recall1 = await req('/cortex/recall', 'POST', {
    query: 'technology startups and news',
    limit: 3
  });
  console.log(`   Found ${recall1.results.length} recall traces:`);
  recall1.results.forEach((r, i) => {
    console.log(`     [${i + 1}] (${r.domain}) ${r.title} - Match score: ${r.score?.toFixed(3)}`);
    console.log(`         Snippet preview: "${r.snippet.slice(0, 100).replace(/\n/g, ' ')}..."`);
  });

  // 6. Test Chronological Browsing History
  console.log('\n[8] Inspecting Chronological History in LanceDB...');
  const history = await req('/cortex/history');
  console.log(`   Retrieved ${history.history.length} distinct history visits:`);
  history.history.forEach((h, i) => {
    console.log(`     [${i + 1}] ${h.visitedAt} | [${h.domain}] ${h.title}`);
  });

  console.log('\n--- ✅ ALL CORTEX LANCEDB TESTS COMPLETED SUCCESSFULLY ---');
}

main().catch(err => {
  console.error('\n❌ Cortex Test Failed:', err);
  process.exit(1);
});
