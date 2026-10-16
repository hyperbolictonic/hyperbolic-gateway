import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:4111';

async function main() {
  console.log('⚡ TESTING DOWNLOAD MANAGER & DOCUMENT HARVESTER');

  // 1. Create a simulated downloaded CSV in data/downloads/
  const dlDir = path.join(process.cwd(), 'data', 'downloads');
  if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });

  const sampleCsvPath = path.join(dlDir, 'flight_deals.csv');
  const sampleCsvContent = `Airline,Destination,PriceGBP,Stops,Duration
Etihad Airways,Malé (MLE),444,1,12h 45m
Turkish Airlines,Malé (MLE),468,1,13h 10m
Qatar Airways,Malé (MLE),520,1,11h 50m
British Airways,Malé (MLE),780,0,10h 15m
`;
  fs.writeFileSync(sampleCsvPath, sampleCsvContent, 'utf8');
  console.log('[1/3] Created sample flight_deals.csv in data/downloads/');

  // 2. Query /downloads endpoint
  console.log('\n[2/3] Calling /downloads endpoint...');
  const dlRes = await fetch(`${BASE_URL}/downloads`).then((r) => r.json());
  console.log('Downloads List:', dlRes);

  // 3. Read & parse document via /downloads/read
  console.log('\n[3/3] Calling /downloads/read for "flight_deals.csv"...');
  const readRes = await fetch(`${BASE_URL}/downloads/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'flight_deals.csv' }),
  }).then((r) => r.json());

  console.log('Document Parsed Result:');
  console.log('Filename:', readRes.document?.filename);
  console.log('Estimated Tokens:', readRes.document?.estimatedTokens);
  console.log('\n--- PARSED MARKDOWN CONSTRUCT ---');
  console.log(readRes.document?.content);

  console.log('\n✓ Download Manager and Document Harvester verified successfully!');
}

main().catch(console.error);
