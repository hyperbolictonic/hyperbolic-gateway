#!/usr/bin/env node
/**
 * Settings DOM contract: every element the renderer looks up must exist in index.html.
 *
 * This catches the class of failure where a new control is referenced in the renderer but its
 * markup was dropped/overwritten, which surfaces at runtime as "Cannot set properties of null".
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

const renderer = walk(path.join(root, 'src', 'renderer'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const refs = [
  ...renderer.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g),
  ...renderer.matchAll(/\bbyId(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]\s*\)/g),
]
  .map((m) => m[1])
  // Scope to the Settings/Shadow Walk surfaces declared in index.html. Some renderer ids are
  // created dynamically (HUD banner) or live in other views.
  .filter((id) => id.startsWith('settings-') || id.startsWith('shadow-'));
const missing = [...new Set(refs)].filter((id) => !ids.has(id));

if (missing.length) {
  console.error(`FAIL — ${missing.length} renderer getElementById target(s) missing from index.html:`);
  for (const id of missing) console.error(`  #${id}`);
  process.exit(1);
}

console.log(`PASS — all ${new Set(refs).size} static getElementById targets exist in index.html.`);
