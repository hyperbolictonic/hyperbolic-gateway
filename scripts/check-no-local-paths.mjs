#!/usr/bin/env node
/**
 * Fails if a tracked text file contains a local disk path. With `--fix`, rewrites obvious leaks in
 * Markdown files in place (review the diff before you commit).
 *
 * A public repository must not contain a path from a contributor's machine. A path leaks a username,
 * a folder layout and sometimes an email address. It also survives in Git history after the current
 * file is fixed.
 *
 * Rules:
 *  - No personal home path anywhere: C:\Users\<name>, /Users/<name>, /home/<name>, file:///C:/...
 *  - No personal workspace folder ("Bot Projects").
 *  - No drive-letter path in Markdown. Use <repo>, <userData>, %APPDATA%, ~/ or a relative link.
 *
 * Run:  npm run check:no-local-paths
 * Fix:  npm run fix:local-paths        (Markdown only; prints what it changed)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIX = process.argv.includes('--fix');

const SKIP = /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|svgz|zip|gz|tgz|dmg|exe|msi|AppImage|deb|rpm|node|woff2?|ttf|otf|mp[34]|webm|wav|pdf)$/i;

const rules = [
  { label: 'Windows user path', re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/i },
  { label: 'macOS user path', re: /\/Users\/[^/\s"'<>]+\// },
  { label: 'Linux home path', re: /\/home\/[^/\s"'<>]+\// },
  { label: 'personal workspace folder', re: /Bot Projects/i },
  { label: 'file URL to a local disk', re: /file:\/\/\/[A-Za-z]:[\\/]/i },
  { label: 'personal email address', re: /\b[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|outlook|hotmail|proton|protonmail|icloud)\.(com|me)\b/i },
  { label: 'drive-letter path in Markdown', re: /(^|[\s`"'(])([A-Za-z]):[\\/]/, markdownOnly: true },
];

// The scanner contains the forbidden patterns, so it must be exempt. This is the only exempt file:
// AGENTS.md is scanned like everything else.
const RULE_DOCS = new Set(['scripts/check-no-local-paths.mjs']);
const FIX_EXEMPT = new Set(['AGENTS.md', 'scripts/check-no-local-paths.mjs']);

const files = execSync('git ls-files -z --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !SKIP.test(file) && !BINARY.test(file));

const isMarkdown = (file) => /\.(md|markdown)$/i.test(file);

function scanText(file, text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.markdownOnly && !isMarkdown(file)) continue;
      if (rule.re.test(line)) {
        hits.push({ file, line: index + 1, label: rule.label, text: line.trim().slice(0, 180) });
        break;
      }
    }
  }
  return hits;
}

/** Conservative fixes for Markdown prose and examples. Review the result before committing. */
function fixMarkdown(text) {
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/g, '<user>')
    .replace(/\/Users\/[^/\s"'<>]+/g, '/Users/<user>')
    .replace(/\/home\/[^/\s"'<>]+/g, '/home/<user>')
    .replace(/Bot Projects/gi, '<workspace>')
    .replace(/file:\/\/\/[A-Za-z]:[\\/]/g, 'file:///<path>/')
    .replace(/\b[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|outlook|hotmail|proton|protonmail|icloud)\.(com|me)\b/gi, 'user@example.com');
}

const fixed = [];
if (FIX) {
  for (const file of files) {
    if (!isMarkdown(file) || RULE_DOCS.has(file)) continue;
    if (FIX_EXEMPT.has(file)) continue;
    let text;
    try {
      text = fs.readFileSync(path.resolve(file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    const next = fixMarkdown(text);
    if (next !== text) {
      fs.writeFileSync(path.resolve(file), next, 'utf8');
      fixed.push(file);
    }
  }
  if (fixed.length) {
    console.log(`Fixed ${fixed.length} Markdown file(s):`);
    for (const file of fixed) console.log(`  ${file}`);
    console.log('Review the diff before you commit.\n');
  } else {
    console.log('Nothing to fix.\n');
  }
}

const hits = [];
for (const file of files) {
  if (RULE_DOCS.has(file)) continue;
  let text;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  hits.push(...scanText(file, text));
}

if (hits.length) {
  console.error(`Found ${hits.length} local-path leak(s):\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.label}]`);
    console.error(`    ${hit.text}`);
  }
  console.error('\nReplace the path with <repo>, <userData>, %APPDATA%, ~/ or a relative link.');
  console.error('See AGENTS.md ("Never publish a local disk path").');
  if (!FIX) console.error('Run `npm run fix:local-paths` to rewrite obvious Markdown leaks.\n');
  process.exit(1);
}

console.log(`PASS — ${files.length} tracked text files contain no local disk paths.`);
