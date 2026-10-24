#!/usr/bin/env node
/**
 * Recipe compiler test (offline).
 *
 * `compileDriveSteps` turns a verified drive transcript into descriptor steps. The rules that matter:
 * failed steps, dry-run plans and unrecoverable type steps must never become a "path".
 */
import { compileDriveSteps } from '../src/main/recipes/compile.ts';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const steps = [
  { operation: 'click', target: 3, targetName: 'Open settings', ok: true },
  { operation: 'type_text', target: 4, targetName: 'Your name', ok: true, typedChars: 5 },
  { operation: 'click', target: 5, targetName: 'Save', ok: true },
  { operation: 'click', target: 6, targetName: 'Never worked', ok: false },
  { operation: 'scroll', target: 7, targetName: 'Footer', ok: true },
  { operation: 'click', target: 8, targetName: '', ok: true },
];

const compiled = compileDriveSteps(steps, { values: { 'Your name': 'Kuang' } });
check('only verified, replayable steps are compiled', compiled.length === 3, compiled.map((s) => `${s.action}:${s.target}`).join(' → '));
check('clicks become click steps', compiled[0]?.action === 'click' && compiled[0]?.target === 'Open settings');
check('a typed value is recovered by field name', compiled[1]?.action === 'type' && compiled[1]?.value === 'Kuang', compiled[1]?.value);
check('failed steps are excluded', !compiled.some((s) => s.target === 'Never worked'));
check('scroll steps are not treated as actions', !compiled.some((s) => s.target === 'Footer'));
check('steps without a target name are skipped', !compiled.some((s) => s.target === ''));

const noValues = compileDriveSteps(steps, {});
check('a type step without a recoverable value is dropped', !noValues.some((s) => s.action === 'type'), `${noValues.length} steps`);

const dryRun = compileDriveSteps([{ operation: 'click', target: 1, targetName: 'X', ok: true, note: 'dry run' }], {});
check('dry-run plans are never compiled', dryRun.length === 0);

const idMatch = compileDriveSteps([{ operation: 'type_text', target: 9, targetName: 'Search', ok: true }], { values: { '9': 'flights' } });
check('a value can be recovered by component id', idMatch[0]?.value === 'flights', idMatch[0]?.value);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
