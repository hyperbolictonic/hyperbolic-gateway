#!/usr/bin/env node
/**
 * Example: drive the Cyberdeck local bridge from plain Node.
 *
 * This is the pattern to reach for when you want to script the browser from
 * outside an MCP client (CI, cron, a REPL) — it talks to the same HTTP bridge
 * the MCP server forwards to, so it stays on the endorsed humanlike path
 * (Set-of-Marks) and never injects or reads raw page JS.
 *
 * It demonstrates three things that are easy to get wrong:
 *
 *   1. Waiting for results. There is no `wait_for` primitive and `isLoading`
 *      stays `true` on ad-heavy SPAs, so instead we poll the Set-of-Marks scan
 *      until the mark count stops changing ("settles"). This works for
 *      virtualized lists that render their rows lazily.
 *   2. Long, virtualized lists. `include_offscreen=1` numbers elements above and
 *      below the fold so below-the-fold rows become addressable.
 *   3. Actuation. `POST /marks/click` lands a humanised (Bézier) click on a
 *      badge id — no synthetic `element.click()`.
 *
 * Usage:
 *   node examples/bridge-await-results.mjs <url> [--offscreen] [--timeout 25000] [--click "<text>"]
 *
 * Requires the Cyberdeck app running (bridge on http://127.0.0.1:4111).
 *
 * Bridge endpoint -> MCP tool map:
 *   POST /navigate                       -> navigate_to
 *   GET  /marks/screenshot?text_only=1   -> list_marks
 *   GET  /marks/screenshot?economy=1     -> take_economy_screenshot
 *   POST /marks/click                    -> click_mark
 */
const BASE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { url: null, offscreen: false, timeout: 25000, click: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offscreen') args.offscreen = true;
    else if (a === '--timeout') args.timeout = Number(argv[++i]) || args.timeout;
    else if (a === '--click') args.click = argv[++i] || null;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!args.url) args.url = a;
  }
  return args;
}

async function bridge(path, method = 'GET', body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${json.error || json.message || 'unknown error'}`);
  }
  return json;
}

async function listMarks({ offscreen = false } = {}) {
  const params = new URLSearchParams({ text_only: '1' });
  if (offscreen) params.set('include_offscreen', '1');
  const data = await bridge(`/marks/screenshot?${params.toString()}`);
  return data.marks || [];
}

/**
 * Poll list_marks() until the number of interactive elements is non-zero and has
 * stayed constant for `stableMs`. This is the "wait_for" workaround.
 */
async function waitForMarksToSettle({ offscreen, timeoutMs, stableMs = 1500 }) {
  const started = Date.now();
  let lastCount = -1;
  let lastChange = Date.now();
  let marks = [];
  while (Date.now() - started < timeoutMs) {
    marks = await listMarks({ offscreen });
    if (marks.length !== lastCount) {
      lastCount = marks.length;
      lastChange = Date.now();
    } else if (marks.length > 0 && Date.now() - lastChange >= stableMs) {
      return marks;
    }
    await sleep(400);
  }
  return marks;
}

function printMarks(marks) {
  for (const m of marks.slice(0, 40)) {
    const role = m.role ? `[role=${m.role}]` : '';
    const state = m.state ? ` {${m.state}}` : '';
    const label = (m.text || '').replace(/\s+/g, ' ').slice(0, 88);
    console.log(`#${String(m.id).padStart(2)}  ${m.tag}${role}  ${label}${state}`);
  }
  if (marks.length > 40) console.log(`... ${marks.length - 40} more`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log('Usage: node examples/bridge-await-results.mjs <url> [--offscreen] [--timeout 25000] [--click "<text>"]');
    process.exit(args.help ? 0 : 1);
  }

  try {
    await bridge('/health');
  } catch (err) {
    console.error(`Bridge not reachable at ${BASE}. Start the Cyberdeck app first. (${err.message})`);
    process.exit(1);
  }

  console.log(`navigate_to ${args.url}`);
  await bridge('/navigate', 'POST', { url: args.url });

  const marks = await waitForMarksToSettle({ offscreen: args.offscreen, timeoutMs: args.timeout });
  console.log(`\n${marks.length} interactive elements (include_offscreen=${args.offscreen})\n`);
  printMarks(marks);
  if (marks.length === 0) {
    console.log('No marks found. The page may be slow to load, or every control may sit above/below the fold — try --offscreen.');
  }

  if (args.click) {
    const needle = args.click.toLowerCase();
    const target = marks.find((m) => (m.text || '').toLowerCase().includes(needle));
    if (!target) {
      console.error(`\nNo mark matched "${args.click}".`);
      process.exit(2);
    }
    console.log(`\nclick_mark #${target.id} — "${(target.text || '').slice(0, 60)}"`);
    await bridge('/marks/click', 'POST', { markId: target.id });
    console.log('Clicked. Re-run the example to re-scan the resulting page.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
