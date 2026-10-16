const b = 'http://127.0.0.1:4111';

async function main() {
  const res = await fetch(`${b}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.map(btn => ({
          text: btn.textContent.trim(),
          id: btn.id,
          rect: {
            x: Math.round(btn.getBoundingClientRect().x),
            y: Math.round(btn.getBoundingClientRect().y),
            width: Math.round(btn.getBoundingClientRect().width),
            height: Math.round(btn.getBoundingClientRect().height)
          }
        }));
      })()`,
    }),
  }).then((r) => r.json());

  console.log('Buttons:', JSON.stringify(res.result, null, 2));
}

main().catch(console.error);
