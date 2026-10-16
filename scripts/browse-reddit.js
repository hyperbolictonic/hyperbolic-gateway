import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('⚡ MARK ELEVEN // LIVE REDDIT EXPLORATION MISSION');

  const BASE_URL = 'http://127.0.0.1:4111';

  // 1. Navigate to Reddit r/news
  console.log('\n[1/6] Calling MCP tool: navigate_to("https://www.reddit.com/r/news")...');
  const navRes = await fetch(`${BASE_URL}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.reddit.com/r/news' }),
  }).then((r) => r.json());
  console.log('Result:', navRes.result);

  console.log('Allowing Chromium engine to execute, solve any challenges, and render feed...');
  await sleep(4000);

  // 2. Query page status
  const infoRes = await fetch(`${BASE_URL}/health`).then((r) => r.json());
  console.log(`\n[2/6] Current Node: "${infoRes.info.title}" (${infoRes.info.url})`);

  // 3. Extract top headlines from r/news
  console.log('\n[3/6] Calling MCP tool: evaluate_javascript to scan top articles...');
  const extractScript = `
    (() => {
      const posts = Array.from(document.querySelectorAll('a[slot="full-post-link"], a[data-testid="post-title"], h3, [slot="title"]'));
      return posts.map((el, i) => ({
        index: i + 1,
        title: el.textContent.trim(),
        href: el.closest('a')?.href || ''
      })).filter(p => p.title.length > 10).slice(0, 5);
    })()
  `;

  const postsRes = await fetch(`${BASE_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: extractScript }),
  }).then((r) => r.json());

  console.log('\n📰 Frontpage Headlines Discovered:');
  const posts = postsRes.result || [];
  posts.forEach((p) => console.log(`  [#${p.index}] ${p.title}`));

  // 4. Navigate into the top news article
  const targetPost = posts.find((p) => p.href && p.href.includes('/comments/')) || posts[0];
  if (targetPost && targetPost.href) {
    console.log(`\n[4/6] Navigating into discussion thread: "${targetPost.title}"...`);
    await fetch(`${BASE_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetPost.href }),
    });
  } else {
    console.log('\n[4/6] Actuating Bézier Ghost Cursor to click first article post...');
    await fetch(`${BASE_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'a[slot="full-post-link"], a[data-testid="post-title"], article a' }),
    });
  }

  console.log('Allowing discussion thread and comment matrix to populate...');
  await sleep(4500);

  // 5. Scroll page slightly to trigger lazy-loaded comments
  console.log('\n[5/6] Calling MCP tool: scroll_page("down", 600) to trigger comment rendering...');
  await fetch(`${BASE_URL}/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'down', amount: 600 }),
  });
  await sleep(2000);

  // 6. Harvest Comments & Markdown Construct
  console.log('\n[6/6] Calling MCP tool: get_page_markdown to harvest discussion & top comments...');
  const mdRes = await fetch(`${BASE_URL}/markdown`).then((r) => r.json());
  const construct = mdRes.construct;

  console.log('\n==============================================');
  console.log(`HARVESTED CONSTRUCT: ${construct.title}`);
  console.log(`Estimated Tokens: ${construct.estimatedTokens}`);
  console.log('==============================================\n');
  console.log(construct.content.substring(0, 1000));
  console.log('\n... [Construct Stream Complete]');

  // 7. Capture Viewport Screenshot
  console.log('\nCapturing viewport screenshot...');
  const screenRes = await fetch(`${BASE_URL}/screenshot`).then((r) => r.json());
  if (screenRes.screenshot?.base64Image) {
    const outPath = path.join(process.cwd(), 'reddit_screenshot.png');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    console.log(`Screenshot saved to: ${outPath} (${screenRes.screenshot.width}x${screenRes.screenshot.height}px)`);
  }
}

main().catch((err) => console.error('Error:', err));
