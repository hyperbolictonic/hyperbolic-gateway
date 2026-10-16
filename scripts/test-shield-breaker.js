const BASE_URL = 'http://127.0.0.1:4111';

async function main() {
  console.log('⚡ TESTING AUTONOMOUS SHIELD BREAKER');

  // Test 1: Query shield status on active page
  console.log('\n[1/3] Triggering /shield/dismiss on current active page...');
  const res1 = await fetch(`${BASE_URL}/shield/dismiss`, { method: 'POST' }).then((r) => r.json());
  console.log('Result:', res1);

  // Test 2: Navigate with autoDismissConsent = true to Google
  console.log('\n[2/3] Navigating to Google with automatic shield breaker active...');
  const res2 = await fetch(`${BASE_URL}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.google.com', autoDismissConsent: true }),
  }).then((r) => r.json());
  console.log('Navigate result:', res2);

  console.log('Waiting 3.5s for page to settle and auto-shield to run in background...');
  await new Promise((resolve) => setTimeout(resolve, 3500));

  // Test 3: Verify console / health
  console.log('\n[3/3] Checking chassis health after autonomous shield execution...');
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json());
  console.log('Active Node:', health.info.title, `(${health.info.url})`);

  console.log('\n✓ Autonomous Shield Breaker verification test complete!');
}

main().catch(console.error);
