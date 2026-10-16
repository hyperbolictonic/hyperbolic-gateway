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

async function testSessionVault() {
  console.log('🧪 Testing Session Vault & Cookie Jar API...\n');

  // 1. Navigate to a test page that sets cookies
  console.log('1. Navigating to httpbin.org/cookies/set/test_cookie/cyberpunk_val...');
  const nav = await request('/navigate', 'POST', { url: 'https://httpbin.org/cookies/set/test_cookie/cyberpunk_val' });
  console.log('Navigation response:', nav.title || nav.url);

  // Wait a bit
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Save session snapshot
  console.log('\n2. Saving session snapshot "httpbin_test"...');
  const saveRes = await request('/session/save', 'POST', { name: 'httpbin_test' });
  console.log('Save result:', saveRes);

  // 3. List sessions
  console.log('\n3. Listing all saved sessions...');
  const listRes = await request('/session/list', 'GET');
  console.log('Saved sessions:', listRes.sessions);

  // 4. Restore session
  console.log('\n4. Restoring session "httpbin_test"...');
  const restoreRes = await request('/session/restore', 'POST', { name: 'httpbin_test' });
  console.log('Restore result:', restoreRes);

  console.log('\n✅ Session Vault verification test finished!');
}

testSessionVault().catch(console.error);
