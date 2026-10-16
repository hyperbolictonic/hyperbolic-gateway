import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('⚡ MARK ELEVEN // MISSION: GOOGLE SEARCH & COOKIE NEGOTIATION');
  const BASE_URL = 'http://127.0.0.1:4111';

  // 1. Navigate to Google
  console.log('\n[1/6] Navigating to https://www.google.com...');
  const navRes = await fetch(`${BASE_URL}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.google.com' }),
  }).then((r) => r.json());
  console.log('Navigation Result:', navRes.result);

  await sleep(2500);

  // 2. Check for Google Cookie Consent Modal
  console.log('\n[2/6] Inspecting DOM for Cookie Consent dialog...');
  const consentScript = `
    (() => {
      // Common Google cookie consent button selectors across locales
      const selectors = [
        '#L2AGLb', // Standard UK / EU "Accept all" button ID
        'button[id*="L2AGLb"]',
        'button:has(div:contains("Accept all"))',
        'form[action*="consent"] button',
      ];
      
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          const rect = btn.getBoundingClientRect();
          return { found: true, selector: sel, text: btn.textContent.trim(), x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
      }

      // Fallback: search all buttons for "Accept all" or "I agree"
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text === 'accept all' || text.includes('accept all') || text === 'i agree' || text === 'agree') {
          const rect = btn.getBoundingClientRect();
          return { found: true, text: btn.textContent.trim(), x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
      }

      return { found: false };
    })()
  `;

  const consentCheck = await fetch(`${BASE_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: consentScript }),
  }).then((r) => r.json());

  console.log('Cookie Consent Scan:', consentCheck.result);

  if (consentCheck.result?.found) {
    console.log(`Cookie consent dialog detected: "${consentCheck.result.text}".`);
    console.log(`Actuating Bézier ghost cursor to coordinates (${consentCheck.result.x}, ${consentCheck.result.y})...`);
    
    // Actuate click via coordinates or selector
    await fetch(`${BASE_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: consentCheck.result.selector,
        x: consentCheck.result.x,
        y: consentCheck.result.y,
      }),
    });
    console.log('✓ Cookie consent accepted with physical mouse actuation.');
    await sleep(2000);
  } else {
    console.log('No cookie consent barrier detected (or already accepted). Proceeding to search input.');
  }

  // 3. Locate and focus the Google search input
  console.log('\n[3/6] Typing search query: "The cake is a lie"...');
  const typeRes = await fetch(`${BASE_URL}/type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'The cake is a lie',
      selector: 'textarea[name="q"], input[name="q"]',
    }),
  }).then((r) => r.json());
  console.log('Typing Cadence Result:', typeRes.result);

  await sleep(500);

  // 4. Press Enter to submit search
  console.log('\n[4/6] Actuating Enter key event...');
  const keyRes = await fetch(`${BASE_URL}/press-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'Enter' }),
  }).then((r) => r.json());
  console.log('Key Press Result:', keyRes.result);

  // Allow Google Search SERP to render
  console.log('Waiting for Google SERP to render results...');
  await sleep(3500);

  // 5. Harvest Google Search Results into Markdown Construct
  console.log('\n[5/6] Harvesting SERP markdown construct...');
  const mdRes = await fetch(`${BASE_URL}/markdown`).then((r) => r.json());
  const construct = mdRes.construct;

  console.log('\n==============================================');
  console.log(`HARVESTED CONSTRUCT: ${construct.title}`);
  console.log(`Estimated Tokens: ${construct.estimatedTokens}`);
  console.log('==============================================\n');
  console.log(construct.content.substring(0, 900));
  console.log('\n... [SERP Construct Stream Complete]');

  // 6. Capture Viewport Screenshot
  console.log('\n[6/6] Capturing live SERP viewport screenshot...');
  const screenRes = await fetch(`${BASE_URL}/screenshot`).then((r) => r.json());
  if (screenRes.screenshot?.base64Image) {
    const b64 = screenRes.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const outPath = path.join(process.cwd(), 'google_search_screenshot.png');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    console.log(`Screenshot saved to: ${outPath} (${screenRes.screenshot.width}x${screenRes.screenshot.height}px)`);
  }
}

main().catch((err) => console.error('Error:', err));
