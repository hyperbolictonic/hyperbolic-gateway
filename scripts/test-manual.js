import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const b = 'http://127.0.0.1:4111';
  console.log('Navigating active tab to about:blank to test Cyberdeck manual...');
  const res = await fetch(`${b}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'about:blank' }),
  }).then((r) => r.json());
  console.log('Result:', res);

  await new Promise((r) => setTimeout(r, 2000));

  const s = await fetch(`${b}/screenshot`).then((r) => r.json());
  if (s.screenshot?.base64Image) {
    const b64 = s.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const out = path.join(process.cwd(), 'manual_screenshot.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log(`Saved Cyberdeck manual screenshot to: ${out} (${s.screenshot.width}x${s.screenshot.height}px)`);
  }
}

main().catch(console.error);
