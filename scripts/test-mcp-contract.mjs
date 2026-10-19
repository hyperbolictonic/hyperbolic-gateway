#!/usr/bin/env node
/**
 * MCP ⇄ HTTP bridge contract test (static, dependency-free, no Cyberdeck needed).
 *
 * `tools-catalog.ts` hard-codes the endpoint each MCP tool calls; `http-bridge.ts`
 * declares the routes it actually serves. Nothing links the two, so the catalog
 * silently drifted once already (8 tools were calling paths the bridge 404s).
 *
 * This test parses both files and asserts every catalog entry maps to a real
 * `{method, path}` route. Run it with `npm run test:mcp:contract` (and in CI).
 *
 * A catalog entry is considered served when its `{method, endpoint}` pair is
 * declared by the bridge. Line-oriented parsing is intentional: every route in
 * `http-bridge.ts` is a single-line `if (req.method === '…' && pathname === '…')`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src', 'mcp', 'tools-catalog.ts');
const BRIDGE_PATH = path.join(ROOT, 'src', 'main', 'http-bridge.ts');

/** Parse the MCP catalog into [{ name, method, endpoint }]. */
function parseCatalog(src) {
  const tools = [];
  const nameRe = /\n {4}name: '([^']+)',/g;
  const matches = [];
  let m;
  while ((m = nameRe.exec(src)) !== null) matches.push({ name: m[1], index: m.index });

  for (let i = 0; i < matches.length; i++) {
    const block = src.slice(matches[i].index, i + 1 < matches.length ? matches[i + 1].index : src.length);
    const endpoint = block.match(/\n\s*endpoint:\s*'([^']+)'/);
    const method = block.match(/\n\s*method:\s*'([A-Z]+)'/);
    if (!endpoint) continue;
    // Some tools front more than one route (e.g. take_screenshot); validate them all.
    const endpointsField = block.match(/\n\s*endpoints:\s*\[([^\]]*)\]/);
    const endpoints = endpointsField
      ? [...endpointsField[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      : [endpoint[1]];
    tools.push({
      name: matches[i].name,
      method: method ? method[1] : 'POST', // callBridge defaults to POST
      endpoint: endpoint[1],
      endpoints,
    });
  }
  return tools;
}

/** Parse the bridge into a Set of "METHOD /path" strings (+ a per-path method map). */
function parseBridge(src) {
  const routes = new Set();
  const byPath = new Map();
  for (const line of src.split('\n')) {
    const methods = [...line.matchAll(/req\.method\s*===\s*'([A-Z]+)'/g)].map((x) => x[1]);
    const paths = [...line.matchAll(/pathname\s*===\s*'([^']+)'/g)].map((x) => x[1]);
    if (methods.length === 0 || paths.length === 0) continue;
    for (const p of paths) {
      if (!byPath.has(p)) byPath.set(p, new Set());
      for (const method of methods) {
        routes.add(`${method} ${p}`);
        byPath.get(p).add(method);
      }
    }
  }
  return { routes, byPath };
}

function main() {
  const catalogSrc = fs.readFileSync(CATALOG_PATH, 'utf8');
  const catalog = parseCatalog(catalogSrc);
  const { routes, byPath } = parseBridge(fs.readFileSync(BRIDGE_PATH, 'utf8'));

  // Renamed tools are cloned at runtime from their canonical entry, so the static
  // parser cannot see them — instead assert each clone's canonical name exists, so
  // a clone can never silently vanish.
  const names = new Set(catalog.map((t) => t.name));
  const legacyBlock = catalogSrc.match(/const LEGACY_ALIASES[^=]*=\s*\[([\s\S]*?)\];/);
  const legacyPairs = legacyBlock
    ? [...legacyBlock[1].matchAll(/\['([a-z0-9_]+)',\s*'([a-z0-9_]+)'\]/g)].map((m) => ({ legacy: m[1], canonical: m[2] }))
    : [];
  const danglingAliases = legacyPairs.filter((p) => !names.has(p.canonical));

  const hidden = (catalogSrc.match(/\n\s*hidden:\s*true/g) || []).length;

  // Phase 4: every tiered tool must be a real, advertised (non-hidden) tool.
  const tierBlock = catalogSrc.match(/const TOOL_TIERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  const tiered = tierBlock
    ? [...tierBlock[1].matchAll(/\n\s*([a-z0-9_]+):\s*([123]),/g)].map((m) => ({ name: m[1], tier: Number(m[2]) }))
    : [];
  const hiddenNames = new Set(
    [...catalogSrc.matchAll(/\n\s*name: '([^']+)',\n\s*hidden: true,/g)].map((m) => m[1])
  );
  const badTiers = tiered.filter((t) => !names.has(t.name) || hiddenNames.has(t.name));

  const missing = [];
  const methodOnly = [];
  for (const tool of catalog) {
    for (const ep of tool.endpoints) {
      const key = `${tool.method} ${ep}`;
      if (routes.has(key)) continue;
      if (byPath.has(ep)) {
        methodOnly.push({ tool: { name: tool.name, method: tool.method, endpoint: ep }, served: [...byPath.get(ep)].join('|') });
      } else {
        missing.push({ name: tool.name, method: tool.method, endpoint: ep });
      }
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  const totalChecks = catalog.reduce((n, t) => n + t.endpoints.length, 0);
  console.log(`\nMCP ⇄ bridge contract — ${catalog.length} registered entries vs ${byPath.size} bridge paths\n`);

  const served = totalChecks - missing.length - methodOnly.length;
  console.log(`  matched            ${served}/${totalChecks} route checks (${catalog.length} tools)`);
  console.log(`  hidden aliases     ${hidden} (+${legacyPairs.length} runtime-cloned legacy names)`);
  console.log(`  tiered tools       ${tiered.length} (prefer ${tiered.filter((t) => t.tier === 1).length} · fallback ${tiered.filter((t) => t.tier === 2).length} · last-resort ${tiered.filter((t) => t.tier === 3).length})`);
  if (badTiers.length) {
    console.log(`\n❌ BAD TIER (${badTiers.length}) — tier map names a missing or hidden tool:`);
    for (const t of badTiers) console.log(`   ${pad(t.name, 26)} [TIER ${t.tier}]`);
  }

  if (danglingAliases.length) {
    console.log(`\n❌ DANGLING ALIAS (${danglingAliases.length}) — legacy alias points at a missing canonical tool:`);
    for (const p of danglingAliases) console.log(`   ${pad(p.legacy, 26)} -> ${p.canonical} (not found)`);
  }
  if (methodOnly.length) {
    console.log(`\n❌ METHOD MISMATCH (${methodOnly.length}) — path exists, method does not:`);
    for (const { tool, served: s } of methodOnly) {
      console.log(`   ${pad(tool.name, 26)} catalog=${pad(tool.method, 5)} ${pad(tool.endpoint, 24)} bridge serves: ${s}`);
    }
  }
  if (missing.length) {
    console.log(`\n❌ MISSING ROUTE (${missing.length}) — bridge serves no such path:`);
    for (const t of missing) {
      console.log(`   ${pad(t.name, 26)} catalog=${pad(t.method, 5)} ${t.endpoint}`);
    }
  }

  const failures = missing.length + methodOnly.length + danglingAliases.length + badTiers.length;
  if (failures > 0) {
    console.log(`\nFAILED — ${failures} problem(s) would break at runtime.`);
    console.log('Fix src/mcp/tools-catalog.ts so each endpoint matches src/main/http-bridge.ts.\n');
    process.exit(1);
  }
  console.log('\nPASS — every catalog tool maps to a live bridge route.\n');
}

main();
