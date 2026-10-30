import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollaborationStore } from '../src/main/collaboration/store.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-store-'));
const file = path.join(dir, 'collaboration.json');
try {
  const store = new CollaborationStore(file);
  const thread = store.create({
    target: { kind: 'element', url: 'https://example.com', selector: '#submit', text: 'Submit' },
    intent: 'The button does nothing',
    tags: ['bug'],
    text: 'Do you see the same failure?',
    kind: 'question',
    choices: ['yes', 'no'],
  });
  assert.equal(thread.status, 'open');
  assert.equal(thread.messages.length, 1);
  assert.deepEqual(thread.messages[0].choices, ['yes', 'no']);

  const listed = store.list({ url: 'https://example.com' });
  assert.equal(listed.length, 1);

  const replied = store.addMessage(
    thread.id,
    { author: 'human', kind: 'answer', text: 'yes', answer: 'yes' },
    'answered',
  );
  assert.equal(replied.status, 'answered');
  assert.equal(replied.messages.at(-1).author, 'human');

  const resolved = store.resolve(thread.id, 'Fixed');
  assert.equal(resolved.status, 'resolved');

  const reloaded = new CollaborationStore(file);
  assert.equal(reloaded.get(thread.id)?.status, 'resolved');
  assert.equal(reloaded.get(thread.id)?.messages.length, 2);
  console.log('collaboration store passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
