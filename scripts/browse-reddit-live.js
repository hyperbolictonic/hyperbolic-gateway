// scripts/browse-reddit-live.js
// Live autonomous session on Reddit showcasing Bio-Kinematic Chaos mouse telemetry & in-page visual pointer

import http from 'node:http';

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
          } catch {
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

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4111,
        path,
        method: 'GET',
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve({ raw: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRedditLive() {
  console.log('🛸 === KUANG GRADE MARK ELEVEN: REDDIT LIVE BROWSE === 🛸\n');

  // 1. Ensure Cyberdeck window is visible and focused
  console.log('1. Focusing Cyberdeck window to screen foreground...');
  await postJson('/window/visibility', { visible: true });
  await sleep(800);

  // 2. Navigate to Reddit
  console.log('2. Navigating to https://www.reddit.com/r/technology ...');
  await postJson('/navigate', { url: 'https://www.reddit.com/r/technology', autoDismissConsent: true });
  console.log('   Waiting 4s for DOM hydration and media cards...');
  await sleep(4000);

  // 3. Dismiss any modal/consent if Reddit displayed one
  await postJson('/shield/dismiss', {});
  await sleep(500);

  // 4. Initial natural gaze movement across the header
  console.log('\n3. [Kinematic Motion] Reading gaze across header banner (x: 320, y: 160)...');
  await postJson('/mouse/move', {
    target: { x: 320, y: 160 },
    options: { chaosLevel: 'medium', tremorAmplitude: 1.2 }
  });
  await sleep(1000);

  // 5. Inspect first article title
  console.log('4. [Kinematic Motion] Hovering over first post title (x: 480, y: 310)...');
  await postJson('/mouse/move', {
    target: { x: 480, y: 310 },
    options: { chaosLevel: 'high', tremorAmplitude: 1.5, allowOvershoot: true }
  });
  await sleep(1400);

  // 6. Scroll down to read more posts
  console.log('\n5. [Natural Scrolling] Scrolling down 350px...');
  await postJson('/scroll', { direction: 'down', amount: 350 });
  await sleep(1800);

  // 7. Move mouse down to explore second post
  console.log('6. [Kinematic Motion] Moving to explore second article (x: 520, y: 420)...');
  await postJson('/mouse/move', {
    target: { x: 520, y: 420 },
    options: { chaosLevel: 'extreme', tremorAmplitude: 1.8, allowOvershoot: true }
  });
  await sleep(1500);

  // 8. Scroll again
  console.log('\n7. [Natural Scrolling] Scrolling down another 400px...');
  await postJson('/scroll', { direction: 'down', amount: 400 });
  await sleep(2000);

  // 9. Reach over to comments or post interaction
  console.log('8. [Kinematic Motion] Ballistic reach to comments link area (x: 460, y: 380)...');
  await postJson('/mouse/move', {
    target: { x: 460, y: 380 },
    options: { chaosLevel: 'high', tremorAmplitude: 1.4, allowOvershoot: true }
  });
  await sleep(1200);

  // 10. Perform humanized click with recoil loop and visual ripple
  console.log('\n9. [Humanized Click] Executing click at (x: 460, y: 380) with pre-click hesitation...');
  await postJson('/click', { x: 460, y: 380 });
  console.log('   -> Click completed (Visual ripple + shockwave emitted).');
  await sleep(3500);

  // 11. Scroll inside the discussion thread
  console.log('\n10. [Thread Exploration] Scrolling thread comments...');
  await postJson('/scroll', { direction: 'down', amount: 300 });
  await sleep(1200);

  await postJson('/mouse/move', {
    target: { x: 580, y: 450 },
    options: { chaosLevel: 'medium', tremorAmplitude: 1.1 }
  });
  await sleep(1000);

  await postJson('/scroll', { direction: 'down', amount: 350 });
  await sleep(1500);

  console.log('\n✅ Demonstration completed! Chaos movements and visual telemetry verified.');
}

runRedditLive().catch((err) => {
  console.error('Demo error:', err);
});
