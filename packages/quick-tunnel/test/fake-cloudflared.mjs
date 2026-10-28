console.log('fake cloudflared starting');
console.log('https://fake-quick-tunnel.trycloudflare.com');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
