#!/usr/bin/env node
/**
 * Fails if a tracked text file contains a local disk path.
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
 * Run: npm run check:no-local-paths
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|svgz|zip|gz|tgz|dmg|exe|msi|AppImage|deb|rpm|node|woff2?|ttf|otf|mp[34]|webm|wav|pdf)$/i;

const rules = [
  { label: 'Windows user path', re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/i },
  { label: 'macOS user path', re: /\/Users\/[^/\s"'<>]+\// },
  { label: 'Linux home path', re: /\/home\/[^/\s"'<>]+\// },
  { label: 'personal workspace folder', re: /Bot Projects/i },
  { label: 'file URL to a local disk', re: /file:\/\/\/[A-Za-z]:[\\/]/i },
  { label: 'drive-letter path in Markdown', re: /(^|[\s`"'(])([A-Za-z]):[\\/]/, markdownOnly: true },
];

const files = execSync('git ls-files -z --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !SKIP.test(file) && !BINARY.test(file));

// The rule document and this scanner must contain the forbidden patterns to describe them. They are
// reviewed by hand; every other file must pass.
const RULE_DOCS = new Set(['AGENTS.md', 'scripts/check-no-local-paths.mjs']);

const hits = [];
for (const file of files) {
  if (RULE_DOCS.has(file)) continue;
  let text;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary that slipped past the extension filter

  const isMarkdown = /\.(md|markdown)$/i.test(file);
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.markdownOnly && !isMarkdown) continue;
      if (rule.re.test(line)) {
        hits.push({ file, line: index + 1, label: rule.label, text: line.trim().slice(0, 180) });
        break;
      }
    }
  }
}

if (hits.length) {
  console.error(`\nFound ${hits.length} local-path leak(s):\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.label}]`);
    console.error(`    ${hit.text}`);
  }
  console.error('\nReplace the path with <repo>, <userData>, %APPDATA%, ~/ or a relative link.');
  console.error('See AGENTS.md ("Never publish a local disk path").\n');
  process.exit(1);
}

console.log(`PASS — ${files.length} tracked text files contain no local disk paths.`);
