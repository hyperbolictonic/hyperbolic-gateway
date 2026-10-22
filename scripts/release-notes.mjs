#!/usr/bin/env node
/**
 * Print the CHANGELOG section for a release tag, ready for `gh release create --notes-file`.
 *
 * The release body is owned by CHANGELOG.md so notes cannot drift from the recorded change.
 * If the section is missing (e.g. a re-published old tag), prints a short fallback rather than
 * failing the publish job.
 *
 * Usage: node scripts/release-notes.mjs v1.4.5 > notes.md
 */
import fs from 'node:fs';

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const version = String(tag).trim().replace(/^v/, '');

if (!version) {
  console.error('usage: node scripts/release-notes.mjs v1.4.5');
  process.exit(2);
}

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^## \\[${escaped}\\]`, 'm');
const match = heading.exec(changelog);

const footer =
  '\n\n**Full changelog:** https://github.com/hyperbolictonic/kuang-grade-mark-eleven/blob/main/CHANGELOG.md';

if (!match) {
  console.log(`Release ${tag}. See CHANGELOG.md for details.${footer}`);
  process.exit(0);
}

const lineEnd = changelog.indexOf('\n', match.index);
const rest = changelog.slice(lineEnd === -1 ? changelog.length : lineEnd + 1);
const nextHeading = rest.search(/^## \[/m);
const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading))
  .replace(/\n---\s*$/, '')
  .trim();

console.log(`# ${tag}\n\n${body}${footer}`);
