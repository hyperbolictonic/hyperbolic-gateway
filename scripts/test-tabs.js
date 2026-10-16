import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE_URL = 'http://127.0.0.1:4111';

async function main() {
  console.log('⚡ KUANG GRADE MARK ELEVEN // DUAL-TAB SHOWCASE');

  // 1. Query initial tabs
  const initialTabs = await fetch(`${BASE_URL}/tabs`).then((r) => r.json());
  console.log('Initial tabs:', initialTabs.tabs.map((t) => `[${t.id}] ${t.title}`).join(', '));

  // 2. Open Tab: Hacker News
  console.log('\n[1/4] Ensuring Hacker News tab is open...');
  let hnTab = initialTabs.tabs.find((t) => t.url.includes('news.ycombinator.com'));
  if (!hnTab) {
    const res = await fetch(`${BASE_URL}/tabs/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://news.ycombinator.com' }),
    }).then((r) => r.json());
    hnTab = res.tab;
  } else {
    await fetch(`${BASE_URL}/tabs/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: hnTab.id }),
    });
  }

  await sleep(2500);

  // Capture HN screenshot
  const hnScreen = await fetch(`${BASE_URL}/screenshot`).then((r) => r.json());
  if (hnScreen.screenshot?.base64Image) {
    const b64 = hnScreen.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const out = path.join(process.cwd(), 'tab_hackernews.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log('✓ Captured Hacker News Tab screenshot to:', out);
  }

  // 3. Open Tab: Wikipedia Cyberpunk
  console.log('\n[2/4] Opening Cyberpunk Wikipedia tab...');
  const wikiRes = await fetch(`${BASE_URL}/tabs/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://en.wikipedia.org/wiki/Cyberpunk' }),
  }).then((r) => r.json());
  const wikiTab = wikiRes.tab;

  await sleep(3500);

  // Capture Wikipedia screenshot
  const wikiScreen = await fetch(`${BASE_URL}/screenshot`).then((r) => r.json());
  if (wikiScreen.screenshot?.base64Image) {
    const b64 = wikiScreen.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const out = path.join(process.cwd(), 'tab_wikipedia.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log('✓ Captured Wikipedia Tab screenshot to:', out);
  }

  // 4. Switch back to Hacker News
  console.log(`\n[3/4] Switching active viewport back to Hacker News [${hnTab.id}]...`);
  await fetch(`${BASE_URL}/tabs/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId: hnTab.id }),
  });
  await sleep(1500);

  // 5. Query final state
  console.log('\n[4/4] Final Tab Pool in Cyberdeck:');
  const final = await fetch(`${BASE_URL}/tabs`).then((r) => r.json());
  final.tabs.forEach((t) => {
    console.log(`  ${t.isActive ? '🟢 [ACTIVE]' : '⚪ [INACTIVE]'} [${t.id}] "${t.title}" (${t.url})`);
  });

  console.log('\n✓ Dual-tab showcase completed successfully!');
}

main().catch(console.error);
