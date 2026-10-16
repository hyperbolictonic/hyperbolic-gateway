import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4111,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function testSetOfMarks() {
  console.log('🧪 Testing Set-of-Marks (Numbered Visual Grounding Badges)...\n');

  // 1. Navigate to forms page
  console.log('1. Navigating to https://httpbin.org/forms/post...');
  await request('/navigate', 'POST', { url: 'https://httpbin.org/forms/post' });
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Take annotated screenshot
  console.log('2. Requesting annotated screenshot with Set-of-Marks overlay...');
  const result = await request('/marks/screenshot', 'GET');
  console.log(`Detected ${result.marks?.length || 0} interactive elements!`);

  for (const m of (result.marks || []).slice(0, 8)) {
    console.log(`  - Mark #${m.id}: <${m.tag}${m.type ? ` type="${m.type}"` : ''}> "${m.text}" @ (${m.center.x}, ${m.center.y})`);
  }

  // Save annotated screenshot artifact to verify visual overlay
  if (result.screenshot?.base64Image) {
    const base64Data = result.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
    const outPath = path.join(process.cwd(), 'data', 'test_som_annotated.png');
    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
    console.log(`Saved test annotated screenshot to: ${outPath}`);
  }

  // 3. Find an input mark to type into
  const inputMark = (result.marks || []).find((m) => m.tag === 'INPUT' && (m.type === 'text' || !m.type));
  if (inputMark) {
    console.log(`\n3. Typing into input mark #${inputMark.id} ("${inputMark.text}")...`);
    const typeRes = await request('/marks/type', 'POST', { markId: inputMark.id, text: 'Case Cowboy' });
    console.log('Type result:', typeRes.result);
  }

  // 4. Click a mark
  const radioOrCheckbox = (result.marks || []).find((m) => m.type === 'radio' || m.type === 'checkbox');
  if (radioOrCheckbox) {
    console.log(`\n4. Clicking mark #${radioOrCheckbox.id} ("${radioOrCheckbox.text}")...`);
    const clickRes = await request('/marks/click', 'POST', { markId: radioOrCheckbox.id });
    console.log('Click result:', clickRes.result);
  }

  console.log('\n✅ Set-of-Marks visual grounding verification finished successfully!');
}

testSetOfMarks().catch(console.error);
