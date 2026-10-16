import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const b = 'http://127.0.0.1:4111';
  await fetch(`${b}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reload' }),
  });
  await new Promise((r) => setTimeout(r, 1200));

  const s = await fetch(`${b}/screenshot`).then((r) => r.json());
  if (s.screenshot?.base64Image) {
    const b64 = s.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const out = path.join(process.cwd(), 'manual_screenshot.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log('Saved reloaded manual screenshot to:', out);
  }
}

main().catch(console.error);
