const b = 'http://127.0.0.1:4111';

async function main() {
  const tabs = await fetch(`${b}/tabs`).then((r) => r.json());
  console.log('Tabs:', tabs.tabs);
}
main();
