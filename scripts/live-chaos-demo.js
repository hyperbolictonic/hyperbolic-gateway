// scripts/live-chaos-demo.js
// Live visual demonstration script for the Bio-Kinematic Chaos Mouse Engine

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function postJson(path, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4111,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ raw: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLiveDemo() {
  console.log('🛸 Initiating Kuang Grade Mark Eleven — Live Chaos Mouse Demonstration...\n');

  // Step 1: Summon window to the front
  console.log('1. Summoning Cyberdeck window to screen foreground...');
  await postJson('/window/visibility', { visible: true });
  await sleep(600);

  // Step 2: Navigate to Hacker News to have rich clickable targets
  console.log('2. Loading target node: https://news.ycombinator.com...');
  await postJson('/navigate', { url: 'https://news.ycombinator.com' });
  await sleep(1500);

  // Step 3: Ballistic reach to top banner
  console.log('\n3. [Movement 1] Ballistic Reach to Top Header (x: 220, y: 115)...');
  console.log('   -> Demonstrating 30% ballistic acceleration + 70% sensory feedback braking.');
  await postJson('/mouse/move', {
    target: { x: 220, y: 115 },
    options: {
      enablePinkNoise: true,
      enableAsymmetricVelocity: true,
      enableTwoThirdsLaw: true,
      enableOvershoot: false,
      enableChaoticAttractor: true,
    },
  });
  await sleep(800);

  // Step 4: Long cross-screen sweep with Ballistic Overshoot & Saccadic Recoil
  console.log('\n4. [Movement 2] Long-Range Reach to Story #1 with Saccadic Overshoot (x: 480, y: 260)...');
  console.log('   -> Demonstrating momentum overshoot past target and 40-80ms corrective recoil.');
  await postJson('/mouse/move', {
    target: { x: 480, y: 260 },
    options: {
      enablePinkNoise: true,
      enableAsymmetricVelocity: true,
      enableTwoThirdsLaw: true,
      enableOvershoot: true,
      enableChaoticAttractor: true,
    },
  });
  await sleep(800);

  // Step 5: High-Curvature S-Curve (Two-Thirds Power Law Demonstration)
  console.log('\n5. [Movement 3] Sweeping Arc to Story #5 (x: 310, y: 440)...');
  console.log('   -> Demonstrating Two-Thirds Power Law: automatic deceleration through tight curves.');
  await postJson('/mouse/move', {
    target: { x: 310, y: 440 },
    options: {
      enablePinkNoise: true,
      enableAsymmetricVelocity: true,
      enableTwoThirdsLaw: true,
      deviationMultiplier: 0.35,
      enableChaoticAttractor: true,
    },
  });
  await sleep(800);

  // Step 6: Targeted Natural Click with dwell
  console.log('\n6. [Movement 4] Hovering with 1/f Pink Tremor & Actuating Physical Click...');
  console.log('   -> Demonstrating pre-click hesitation, contact dwell time, and release.');
  await postJson('/mouse/move', {
    target: { x: 180, y: 160 },
    options: { enablePinkNoise: true, enableChaoticAttractor: true },
  });
  await sleep(400);

  // Click on "new" or a nav tab
  await postJson('/click', { x: 180, y: 160 });
  await sleep(1200);

  // Step 7: Capture Visual Viewport Verification
  console.log('\n7. Capturing Viewport Verification Screenshot...');
  const screenRes = await postJson('/screenshot');
  if (screenRes.success && screenRes.data) {
    const outPath = path.join(process.cwd(), 'chaos_movement_screenshot.png');
    const base64Data = screenRes.data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
    console.log(`   Screenshot successfully saved to: ${outPath}`);
  }

  console.log('\n✨ LIVE CHAOS MOUSE DEMONSTRATION COMPLETE!');
  console.log('   Check the active Cyberdeck window to see the real-time phosphor trail and pointer position.\n');
}

runLiveDemo().catch((err) => {
  console.error('Demo execution failed:', err);
  process.exit(1);
});
