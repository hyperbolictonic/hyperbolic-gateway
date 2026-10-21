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
if (!tag) {
  console.log('no tag supplied (manual run) — nothing to check');
  process.exit(0);
}

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const stripped = tag.replace(/^v/, '');
const parts = stripped.split('.');

if (parts.length >= 4) {
  console.error(
    `Tag ${tag} is a four-part (documentation-only) increment, but this workflow packages installers.\n` +
      'Per docs/BUILDING.md §7, four-part tags never produce artefacts. Either drop the tag, or bump\n' +
      `package.json to a three-part version (currently ${version}) and retag.`
  );
  process.exit(1);
}

if (stripped !== version) {
  console.error(
    `Tag ${tag} (${stripped}) does not match package.json version ${version}.\n` +
      'The updater compares app versions, so a mismatched tag would ship a build that reports a different\n' +
      'version than the feed. Bump package.json/APP_VERSION first, then tag.'
  );
  process.exit(1);
}

console.log(`tag ${tag} matches package.json ${version} — safe to package`);
