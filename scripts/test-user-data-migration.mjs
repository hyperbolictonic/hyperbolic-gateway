import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-user-data-'));

const { migrateLegacyUserData } = await import('../src/main/migrate-user-data.ts');

function makeProfile(name, marker) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ marker }), 'utf8');
  return dir;
}

test('imports a legacy profile once and writes the marker', () => {
  makeProfile('Hyperbolic Gateway', 'old');
  const result = migrateLegacyUserData(root, 'Hypagon Gateway');
  assert.equal(path.basename(result.from ?? ''), 'Hyperbolic Gateway', 'reports the source directory');

  const settings = JSON.parse(fs.readFileSync(path.join(root, 'Hypagon Gateway', 'settings.json'), 'utf8'));
  assert.equal(settings.marker, 'old');
  assert.ok(fs.existsSync(path.join(root, 'Hypagon Gateway', '.migrated-user-data')));
});

test('does not run twice', () => {
  const again = migrateLegacyUserData(root, 'Hypagon Gateway');
  assert.equal(again.from, null);
});

test('never overwrites data already in the current profile', () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-user-data-nested-'));
  const legacy = path.join(fresh, 'Hyperbolic Gateway');
  const target = path.join(fresh, 'Hypagon Gateway');
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'cortex.db'), 'stale', 'utf8');
  fs.writeFileSync(path.join(legacy, 'new-file.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(target, 'cortex.db'), 'live', 'utf8');

  migrateLegacyUserData(fresh, 'Hypagon Gateway');

  assert.equal(fs.readFileSync(path.join(target, 'cortex.db'), 'utf8'), 'live', 'existing file wins');
  assert.equal(fs.readFileSync(path.join(target, 'new-file.json'), 'utf8'), '{}', 'missing file is imported');
  fs.rmSync(fresh, { recursive: true, force: true });
});

test('is a no-op when there is nothing to import', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-user-data-empty-'));
  const result = migrateLegacyUserData(empty, 'Hypagon Gateway');
  assert.equal(result.from, null);
  assert.ok(!fs.existsSync(path.join(empty, 'Hypagon Gateway')), 'does not create an empty target');
  fs.rmSync(empty, { recursive: true, force: true });
});

test('ignores a legacy directory with the same name as the current one', () => {
  const same = fs.mkdtempSync(path.join(os.tmpdir(), 'hypagon-user-data-same-'));
  const result = migrateLegacyUserData(same, 'Hypagon Gateway', ['Hypagon Gateway']);
  assert.equal(result.from, null);
  fs.rmSync(same, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
