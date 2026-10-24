#!/usr/bin/env node
/**
 * Human-takeover predicate test (offline).
 *
 * Node 22+ strips TypeScript types, so the real module is imported directly — no build step and no
 * duplicated logic. Covers the two filters that make takeover detection possible at all:
 *   - untrusted (page-script) events never count
 *   - trusted events inside the synthetic grace window never count
 */
import { shouldCountAsHuman, SYNTHETIC_GRACE_MS } from '../src/main/input/human-activity.ts';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const now = Date.now();

check('untrusted page-script events are ignored', shouldCountAsHuman(false, now, 0) === false);
check('a trusted event long after synthetic input is human', shouldCountAsHuman(true, now, now - 5000) === true);
check(
  `a trusted event inside the ${SYNTHETIC_GRACE_MS}ms grace window is synthetic`,
  shouldCountAsHuman(true, now, now - 50) === false,
  `${now - (now - 50)}ms after dispatch`
);
check(
  'exactly at the grace boundary is still synthetic',
  shouldCountAsHuman(true, now, now - SYNTHETIC_GRACE_MS) === false
);
check(
  'one millisecond past the grace boundary is human',
  shouldCountAsHuman(true, now, now - SYNTHETIC_GRACE_MS - 1) === true
);
check('a non-finite timestamp is not human', shouldCountAsHuman(true, NaN, 0) === false);
check('no synthetic dispatch yet (0) still counts a real event', shouldCountAsHuman(true, now, 0) === true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
