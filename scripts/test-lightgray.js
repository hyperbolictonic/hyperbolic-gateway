import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const b = 'http://127.0.0.1:4111';
  // Open fresh tab with Motherfucking Website
  const res = await fetch(`${b}/tabs/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://motherfuckingwebsite.com' }),
  }).then((r) => r.json());

  console.log('Opened new tab:', res.tab.id);
  await new Promise((r) => setTimeout(r, 2000));

  const s = await fetch(`${b}/screenshot`).then((r) => r.json());
  if (s.screenshot?.base64Image) {
    const b64 = s.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const out = path.join(process.cwd(), 'tab_lightgray_demo.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log(`Saved light gray demo screenshot to: ${out} (${s.screenshot.width}x${s.screenshot.height}px)`);
  }
}

main().catch(console.error);
