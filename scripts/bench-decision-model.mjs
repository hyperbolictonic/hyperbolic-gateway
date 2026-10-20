/**
 * Decision-model benchmark (opt-in; downloads model weights on first run).
 *
 *   node scripts/bench-decision-model.mjs kev-0.6b cpu
 *   node scripts/bench-decision-model.mjs open-jev cpu
 *
 * Uses the exact shape Kuang sends: a natural-language goal plus the component table from
 * `observe(as:"components")`, with target options restricted by the component's affordances.
 * "Measure before relying" — the output is accuracy + latency, not a vibe.
 */
import { OpenJev, choice, noul } from 'open-jev';

const model = process.argv[2] || 'kev-0.6b';
const device = process.argv[3] || 'cpu';

const CASES = [
  {
    name: 'empty password, submit did nothing',
    state: [
      'Goal: sign in to the account.',
      'Visible components:',
      '[7] input "Email" — value "user@example.com" {type}',
      '[8] input "Password" — empty {type}',
      '[9] button "Sign in" {click}',
      'The password field is empty and the form was already submitted once; nothing happened.',
    ].join('\n'),
    expect: { operation: 'type_text', target: '8', done: false },
  },
  {
    name: 'already signed in',
    state: [
      'Goal: sign in to the account.',
      'Visible components:',
      '[1] heading "Welcome back, Mike"',
      '[2] link "Profile" {click}',
      '[3] button "Sign out" {click}',
      'The session is active and the page greets the user by name.',
    ].join('\n'),
    expect: { operation: 'done', target: '1', done: true },
  },
  {
    name: 'cookie banner blocks the form',
    state: [
      'Goal: sign in to the account.',
      'Visible components:',
      '[1] dialog "Cookies"',
      '[2] button "Reject optional cookies" {click}',
      '[3] button "Accept all" {click}',
      'A cookie banner covers the lower half of the page; the sign-in form is behind it.',
    ].join('\n'),
    expect: { operation: 'click', target: '2', done: false },
  },
  {
    name: 'captcha challenge',
    state: [
      'Goal: sign in to the account.',
      'Visible components:',
      '[1] iframe "recaptcha challenge"',
      '[2] button "Verify" {click}',
      'A CAPTCHA challenge is displayed and no form fields are visible.',
    ].join('\n'),
    expect: { operation: 'blocked', target: '2', done: false },
  },
];

const jev = await OpenJev.load({ model, device });
console.log(`model=${jev.runtime.model} family=${jev.runtime.family} device=${jev.runtime.device} dtype=${jev.runtime.dtype}\n`);

let correct = 0;
let total = 0;
const latencies = [];

for (const c of CASES) {
  const started = Date.now();
  const answers = await jev.decide(c.state, {
    operation: choice('What is the next operation?', ['click', 'type_text', 'done', 'blocked']),
    target: choice('Which component should the operation act on?', ['1', '2', '3', '7', '8', '9']),
    done: noul('Is the goal already satisfied by the visible state?'),
  });
  const ms = Date.now() - started;
  latencies.push(ms);

  const opOk = answers.operation.choice === c.expect.operation;
  const targetOk = answers.target.choice === c.expect.target;
  const doneOk = answers.done.answer === c.expect.done;
  for (const ok of [opOk, targetOk, doneOk]) {
    total++;
    if (ok) correct++;
  }

  console.log(`${opOk && targetOk && doneOk ? 'PASS' : 'MISS'}  ${c.name} (${ms}ms)`);
  console.log(
    `      operation=${answers.operation.choice} ${answers.operation.confidence.toFixed(2)} (want ${c.expect.operation})` +
      ` · target=${answers.target.choice} ${answers.target.confidence.toFixed(2)} (want ${c.expect.target})` +
      ` · done=${answers.done.answer} p=${answers.done.probability.toFixed(2)} (want ${c.expect.done})`
  );
}

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)];
console.log(`\n${correct}/${total} field answers correct · latency p50=${p50}ms max=${latencies[latencies.length - 1]}ms`);
await jev.dispose();
process.exit(0);
