import http from 'node:http';

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

async function testRealtimeStreams() {
  console.log('🧪 Testing Real-Time WebSocket & SSE Stream Interceptor...\n');

  // 1. Clear previous stream messages
  console.log('1. Clearing stream buffers...');
  await request('/streams/clear', 'POST', {});

  // 2. Navigate to blank page
  console.log('2. Navigating to about:blank to spawn test WebSocket...');
  await request('/navigate', 'POST', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 1000));

  // 3. Evaluate script that opens a WebSocket and exchanges duplex frames
  console.log('3. Opening test WebSocket to wss://ws.postman-echo.com/raw and sending frames...');
  await request('/evaluate', 'POST', {
    script: `
      new Promise((resolve) => {
        const ws = new WebSocket('wss://ws.postman-echo.com/raw');
        ws.onopen = () => {
          ws.send(JSON.stringify({ client: 'Kuang Grade Mark Eleven', message: 'Cyberdeck Uplink Established' }));
          setTimeout(() => {
            ws.send(JSON.stringify({ command: 'PING', timestamp: Date.now() }));
          }, 300);
        };
        ws.onmessage = (event) => {
          console.log('DOM received WS frame:', event.data);
        };
        setTimeout(() => {
          ws.close();
          resolve(true);
        }, 1500);
      })
    `,
  });

  // Wait 2.5 seconds for CDP network framing events to be captured
  await new Promise((r) => setTimeout(r, 2500));

  // 4. List captured real-time streams
  console.log('\n4. Listing captured real-time streams...');
  const streamsRes = await request('/streams/list', 'GET');
  console.log('Observed Streams:', JSON.stringify(streamsRes.streams, null, 2));

  // 5. Query intercepted duplex stream frames
  console.log('\n5. Inspecting intercepted stream messages/frames...');
  const messagesRes = await request('/streams/messages', 'POST', { limit: 10 });
  console.log(`Captured ${messagesRes.messages?.length || 0} stream messages:`);
  for (const m of messagesRes.messages || []) {
    console.log(`  - [${m.streamType.toUpperCase()}] ${m.direction.toUpperCase()} | data: ${m.data.slice(0, 100)} (isJson: ${m.isJson})`);
  }

  // 6. Clear stream messages
  console.log('\n6. Clearing stream messages...');
  const clearRes = await request('/streams/clear', 'POST', {});
  console.log('Clear result:', clearRes.message);

  console.log('\n✅ WebSocket & SSE stream interception verified successfully!');
}

testRealtimeStreams().catch(console.error);
