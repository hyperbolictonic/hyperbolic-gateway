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

async function testNetworkInterceptor() {
  console.log('🧪 Testing Chrome DevTools Protocol Network Interceptor...\n');

  // 1. Clear previous traffic
  console.log('1. Clearing existing network buffer...');
  await request('/network/clear', 'POST');

  // 2. Navigate to JSON test API
  const testUrl = 'https://jsonplaceholder.typicode.com/todos/1';
  console.log(`2. Navigating to ${testUrl}...`);
  await request('/navigate', 'POST', { url: testUrl });

  // Wait 2.5 seconds for CDP network events and payload buffering
  await new Promise((r) => setTimeout(r, 2500));

  // 3. Query captured network traffic
  console.log('\n3. Querying captured network traffic...');
  const trafficRes = await request('/network/traffic', 'POST', { limit: 10 });
  console.log(`Captured ${trafficRes.traffic?.length || 0} network events:`);

  for (const item of (trafficRes.traffic || []).slice(0, 5)) {
    console.log(`  - [${item.method}] ${item.status || 'PENDING'} ${item.resourceType} | ${item.url.slice(0, 80)} (hasBody: ${item.hasBody}, id: ${item.requestId})`);
  }

  // 4. Find the API request with body
  const targetReq = (trafficRes.traffic || []).find((r) => r.hasBody || r.url.includes('jsonplaceholder'));
  if (targetReq) {
    console.log(`\n4. Fetching payload for request ${targetReq.requestId}...`);
    const payloadRes = await request('/network/payload', 'POST', { requestId: targetReq.requestId });
    console.log('Payload Response:');
    console.log('  URL:', payloadRes.payload.url);
    console.log('  Status:', payloadRes.payload.status);
    console.log('  MIME:', payloadRes.payload.mimeType);
    console.log('  Is JSON:', payloadRes.payload.isJson);
    console.log('  Data:\n', JSON.stringify(payloadRes.payload.data, null, 2));
  } else {
    console.log('\n⚠️ No request with buffered body found in top events.');
  }

  console.log('\n✅ Live Network Interceptor test completed successfully!');
}

testNetworkInterceptor().catch(console.error);
