import fs from 'node:fs';
import path from 'node:path';

async function test() {
  const r = await fetch('http://127.0.0.1:4111/screenshot');
  const d = await r.json();
  if (d.screenshot?.base64Image) {
    const b64 = d.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const outPath = path.join(process.cwd(), 'tab_active_screenshot.png');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    console.log(`Saved screenshot to: ${outPath} (${d.screenshot.width}x${d.screenshot.height}px)`);
  }
}
test().catch(console.error);
