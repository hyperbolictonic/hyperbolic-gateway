#!/usr/bin/env node
/**
 * Release-tag guard.
 *
 * Artefact releases must carry a tag that matches `package.json#version` exactly, because the
 * updater compares the *app* version (three-part, semver) against the feed. A four-part tag
 * (`v1.4.2.1`) is a **documentation-only increment** by policy — it never ships binaries, and
 * publishing one would make two different builds advertise the same app version.
 *
 * Usage: node scripts/check-release-tag.mjs v1.4.3
 */
import fs from 'node:fs';

const tag = (process.argv[2] || '').trim();

// Emit a decision for the workflow: docs-only tags skip the matrix instead of failing it, and a
// manual run (no tag) builds everything.
const emit = (build) => {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
};

if (!tag || !/^v\d/.test(tag)) {
  console.log(`no release tag supplied (${tag || 'empty'} — manual run) — building all platforms`);
  emit(true);
  process.exit(0);
}

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const stripped = tag.replace(/^v/, '');
const parts = stripped.split('.');


if (parts.length >= 4) {
  console.log(
    `Tag ${tag} is a four-part (documentation-only) increment — skipping installer builds.\n` +
      'Per docs/BUILDING.md §7, four-part tags never produce artefacts.'
  );
  emit(false);
  process.exit(0);
}

if (stripped !== version) {
  console.error(
    `Tag ${tag} (${stripped}) does not match package.json version ${version}.\n` +
      'The updater compares app versions, so a mismatched tag would ship a build that reports a different\n' +
      'version than the feed. Bump package.json/APP_VERSION first, then tag.'
  );
  process.exit(1);
}

emit(true);
console.log(`tag ${tag} matches package.json ${version} — safe to package`);
