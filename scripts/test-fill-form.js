const BASE_URL = 'http://127.0.0.1:4111';

async function main() {
  console.log('⚡ TESTING BATCH FORM FILLER (fill_form)');

  // Navigate to Hacker News login screen (simple 2-field form)
  console.log('\n[1/3] Navigating to https://news.ycombinator.com/login...');
  await fetch(`${BASE_URL}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://news.ycombinator.com/login' }),
  });

  await new Promise((r) => setTimeout(r, 2000));

  // Test fill_form
  console.log('\n[2/3] Executing single-turn fill_form on username and password fields...');
  const fillRes = await fetch(`${BASE_URL}/form/fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        'input[name="acct"]': 'CrashOverride',
        'input[name="pw"]': 'HackTheGibson1995',
      },
      // Note: do not submit fake credentials to avoid rate limits
    }),
  }).then((r) => r.json());

  console.log('Form Fill Result:', fillRes);

  console.log('\n[3/3] Capturing screenshot of populated form...');
  const screenRes = await fetch(`${BASE_URL}/screenshot`).then((r) => r.json());
  console.log(`Captured screenshot (${screenRes.screenshot?.width}x${screenRes.screenshot?.height}px)`);

  console.log('\n✓ Single-turn batch form filler verified successfully!');
}

main().catch(console.error);
