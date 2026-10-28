if (!process.env.TUNNEL_TOKEN) {
  console.error('missing TUNNEL_TOKEN');
  process.exit(2);
}
console.error('INF Registered tunnel connection connIndex=0');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
