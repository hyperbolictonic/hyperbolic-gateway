import assert from 'node:assert/strict';
import { classifyNavigationFailure } from '../src/main/navigation-error.ts';

const host = classifyNavigationFailure('https://wrong.example.com/path', {
  code: 'ERR_NAME_NOT_RESOLVED',
});
assert.equal(host.code, 'NAVIGATION_HOST_NOT_FOUND');
assert.match(host.message, /Host not found: wrong\.example\.com/);
assert.match(host.message, /ERR_NAME_NOT_RESOLVED/);

const refused = classifyNavigationFailure('http://127.0.0.1:9', {
  code: 'ERR_CONNECTION_REFUSED',
});
assert.equal(refused.code, 'NAVIGATION_CONNECTION_REFUSED');
assert.match(refused.message, /Connection refused/);

const timeout = classifyNavigationFailure('https://slow.example.com', {
  code: 'ERR_CONNECTION_TIMED_OUT',
});
assert.equal(timeout.code, 'NAVIGATION_TIMEOUT');

const other = classifyNavigationFailure('https://example.com', new Error('boom'));
assert.equal(other.code, 'NAVIGATION_FAILED');
assert.match(other.message, /boom/);

console.log('navigation error classification passed');
