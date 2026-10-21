#!/usr/bin/env node
/**
 * Regenerates the collapsible "Complete tool list" block in `public/welcome.html`
 * (Kuang's default-tab Manual) from the maintained tool table in `README.md`.
 *
 * Why: the Manual's headline table is a curated, tier-grouped highlight; the full list lives in
 * a `<details>` block so the page stays tidy without ever being out of date. Sourcing it from the
 * README (the canonical, hand-maintained catalog view) means parameters/descriptions cannot drift.
 *
 * Idempotent: re-running replaces the generated block (delimited by BEGIN/END markers) rather than
 * appending another. It also upgrades the original, marker-less block in place.
 *
 * Run: npm run manual:tools
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(ROOT, 'README.md');
const WELCOME_PATH = path.join(ROOT, 'public', 'welcome.html');

const BEGIN = '        <!-- BEGIN GENERATED: complete tool list — regenerate with `npm run manual:tools` -->';
const END = '        <!-- END GENERATED: complete tool list -->';

// Authoritative hidden-alias count: 81 registered entries − 58 advertised catalog entries.
// (The README's dagger rows only mark 21 of the 23; two renamed aliases have no row.)
const DEPRECATED_ALIASES = 23;

// ---- parse README.md's tool table (only that table) ------------------------
const readme = fs.readFileSync(README_PATH, 'utf8').split('\n');
const rows = [];
let category = '';
let inTable = false;
for (const line of readme) {
  if (line.startsWith('| Category | Tool |')) {
    inTable = true;
    continue;
  }
  if (!inTable) continue;
  if (!line.startsWith('|')) break; // table ended
  const cells = line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
  if (cells.length < 4 || cells[0] === ':---') continue;
  const [cat, tool, params, desc] = cells;
  if (cat) category = cat.replace(/\*\*/g, '');
  if (!tool) continue;
  const optional = tool.startsWith('⌥');
  rows.push({ category, deprecated: tool.startsWith('†'), optional, tool: tool.replace(/^[†⌥]\s*/, ''), params, desc });
}

const advertised = rows.filter((r) => !r.deprecated && !r.optional);
const optionalRows = rows.filter((r) => r.optional);
// Optional tools are listed first, matching tools/list order when a decision model is active.
const listed = [...optionalRows, ...advertised];

// Guard: the README states its own advertised count — fail loudly if they disagree.
const claimed = readme.join('\n').match(/\*\*(\d+) advertised tools\*\*/);
if (claimed && Number(claimed[1]) !== advertised.length) {
  console.error(`README claims ${claimed[1]} advertised tools but its table has ${advertised.length} — refusing to write.`);
  process.exit(1);
}

// ---- markdown inline -> escaped HTML (escape first, then code/bold) --------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/\\\|/g, '|')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

let lastCat = null;
const body = listed
  .map((r) => {
    const catCell = r.category !== lastCat ? `<strong>${inline(r.category)}</strong>` : '';
    lastCat = r.category;
    return [
      // Optional tools get an amber shade in the manual, mirroring the ⌥ marker in the README.
      r.optional ? '              <tr style="background:rgba(234,179,8,0.10);">' : '              <tr>',
      `                <td>${catCell}</td>`,
      `                <td>${inline(r.tool)}</td>`,
      `                <td>${inline(r.params) || '_none_'}</td>`,
      `                <td>${inline(r.desc)}</td>`,
      '              </tr>',
    ].join('\n');
  })
  .join('\n');

const generated = [
  BEGIN,
  '        <details style="margin-top:18px;">',
  '          <summary style="cursor:pointer; font-weight:700; font-size:15px; color:var(--accent); padding:6px 0;">',
  `            Complete tool list — ${advertised.length} advertised${optionalRows.length ? ` + ${optionalRows.length} optional` : ''} (click to expand)`,
  '          </summary>',
  '          <p style="font-size:12px; color:var(--text-muted);">',
  `            Every advertised tool grouped by area. Rows shaded amber are <strong>optional</strong>: they appear only when a decision model is configured, and are then listed first. ${DEPRECATED_ALIASES} deprecated aliases (e.g. <code>go_to_url</code>,`,
  '            <code>get_page_markdown</code>, <code>click_element</code>) remain callable by name but are hidden from',
  '            <code>tools/list</code>.',
  '          </p>',
  '          <table>',
  '            <thead>',
  '              <tr>',
  '                <th>Area</th>',
  '                <th>Tool</th>',
  '                <th>Parameters</th>',
  '                <th>Description</th>',
  '              </tr>',
  '            </thead>',
  '            <tbody>',
  body,
  '            </tbody>',
  '          </table>',
  '        </details>',
  END,
  '',
].join('\n');

// ---- splice into public/welcome.html (idempotent) --------------------------
const html = fs.readFileSync(WELCOME_PATH, 'utf8');
const nl = html.includes('\r\n') ? '\r\n' : '\n';
const block = generated.split('\n').join(nl);

const skipEol = (s, i) => {
  if (s[i] === '\r') i++;
  if (s[i] === '\n') i++;
  return i;
};

const b = html.indexOf(BEGIN);
const e = html.indexOf(END);
const legacyStart = html.indexOf('        <details style="margin-top:18px;">');
const legacyEndMark = '        </details>';
const legacyEnd = legacyStart >= 0 ? html.indexOf(legacyEndMark, legacyStart) : -1;

let next;
let action;
if (b >= 0 && e > b) {
  next = html.slice(0, b) + block + html.slice(skipEol(html, e + END.length));
  action = 'replaced marked block';
} else if (legacyStart >= 0 && legacyEnd > legacyStart) {
  next = html.slice(0, legacyStart) + block + html.slice(skipEol(html, legacyEnd + legacyEndMark.length));
  action = 'upgraded legacy block';
} else {
  const marker = '        </table>';
  let i = html.indexOf(marker);
  if (i < 0) throw new Error('could not find the curated tool table (</table>) in public/welcome.html');
  i = skipEol(html, i + marker.length);
  next = html.slice(0, i) + block + html.slice(i);
  action = 'inserted new block';
}

if (next === html) {
  console.log(`✓ public/welcome.html already up to date (${advertised.length} advertised tools).`);
} else {
  fs.writeFileSync(WELCOME_PATH, next);
  console.log(`✓ ${action}: ${advertised.length} advertised tools across ${new Set(advertised.map((r) => r.category)).size} areas.`);
}
