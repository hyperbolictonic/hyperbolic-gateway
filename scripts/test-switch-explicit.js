async function test() {
  const r = await fetch('http://127.0.0.1:4111/tabs/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId: 'tab_5' }),
  });
  const data = await r.json();
  console.log('Switch Response:', data);

  const tabs = await fetch('http://127.0.0.1:4111/tabs').then(r => r.json());
  console.log('Active tab now:', tabs.tabs.find(t => t.isActive)?.id);
}
test();
