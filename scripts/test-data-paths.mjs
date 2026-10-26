import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuang-data-paths-'));
const previous = process.env.KUANG_DATA_DIR;
process.env.KUANG_DATA_DIR = path.join(root, 'runtime');

const { dataPath } = await import('../src/main/data-paths.ts');

test('runtime data uses KUANG_DATA_DIR instead of cwd', () => {
  assert.equal(dataPath('downloads'), path.join(root, 'runtime', 'downloads'));
  assert.ok(fs.existsSync(path.join(root, 'runtime')));
});

test('runtime data is writable', () => {
  const downloads = dataPath('downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const file = path.join(downloads, 'probe.txt');
  fs.writeFileSync(file, 'ok');
  assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
});

after(() => {
  if (previous === undefined) delete process.env.KUANG_DATA_DIR;
  else process.env.KUANG_DATA_DIR = previous;
  fs.rmSync(root, { recursive: true, force: true });
});
