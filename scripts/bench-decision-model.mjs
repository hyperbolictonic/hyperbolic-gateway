/**
 * Decision-model benchmark (opt-in; downloads local weights on first run).
 *
 *   node scripts/bench-decision-model.mjs kev-0.6b cpu     # local open-jev model
 *   node scripts/bench-decision-model.mjs --bridge         # whatever /decide is configured with
 *
 * Uses the exact shape Kuang sends: a natural-language goal plus the component list from
 * `observe(as:"components")`, with target options restricted by the component's affordances.
 * "Measure before relying" — the output is accuracy + latency, not a vibe.
 */

const viaBridge = process.argv.includes('--bridge');
const model = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'kev-0.6b';
const device = process.argv[3] || 'cpu';
const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

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

function questions(useCriteria) {
  // TypeSafe `choice` takes **criteria** (option -> description), not `options`. Sending
  // `options` makes the gateway answer 422 "Endpoint is unavailable", which looks like an
  // auth/outage problem rather than a shape problem. open-jev takes `options`.
  const choice = (instructions, options) =>
    useCriteria
      ? { type: 'choice', instructions, criteria: Object.fromEntries(options.map((o) => [o, `Choose "${o}"`])) }
      : { type: 'choice', instructions, options };
  return {
    operation: choice('What is the next operation?', ['click', 'type_text', 'done', 'blocked']),
    target: choice('Which component should the operation act on?', ['1', '2', '3', '7', '8', '9']),
    done: { type: 'noul', instructions: 'Is the goal already satisfied by the visible state?' },
  };
}

let jev = null;
let label = '';
if (viaBridge) {
  const status = await (await fetch(`${BRIDGE}/decide`)).json();
  if (!status?.configured) {
    console.log('SKIP: no decision backend configured on the bridge (Settings → decision model).');
    process.exit(0);
  }
  label = `${status.protocol} · ${status.model} · ${status.endpoint}`;
} else {
  const { OpenJev } = await import('open-jev');
  jev = await OpenJev.load({ model, device });
  label = `${jev.runtime.model} · family=${jev.runtime.family} · ${jev.runtime.device}/${jev.runtime.dtype}`;
}
console.log(`backend: ${label}\n`);

let correct = 0;
let total = 0;
const latencies = [];

for (const c of CASES) {
  let answers;
  let ms;
  if (viaBridge) {
    const started = Date.now();
    const res = await fetch(`${BRIDGE}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: c.state, questions: questions(viaBridge) }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.log(`ERROR ${c.name}: HTTP ${res.status} ${json.error || json.code || ''} ${json.hint || ''}`);
      continue;
    }
    ms = Date.now() - started;
    answers = json.answers;
  } else {
    const started = Date.now();
    answers = await jev.decide(c.state, questions(false));
    ms = Date.now() - started;
  }
  latencies.push(ms);

  const op = answers?.operation?.choice;
  const tgt = answers?.target?.choice;
  // TypeSafe answers a noul as {noul: p}; open-jev as {answer, probability}. Normalise both.
  const doneP = answers?.done?.noul ?? answers?.done?.probability;
  const done = typeof doneP === 'number' ? doneP >= 0.5 : answers?.done?.answer;
  const opOk = op === c.expect.operation;
  // A target only exists for an operation that acts on one: "done"/"blocked" need none.
  const targetMatters = c.expect.operation === 'click' || c.expect.operation === 'type_text';
  const tgtOk = !targetMatters || tgt === c.expect.target;
  const doneOk = done === c.expect.done;
  for (const ok of targetMatters ? [opOk, tgtOk, doneOk] : [opOk, doneOk]) {
    total++;
    if (ok) correct++;
  }

  console.log(`${opOk && tgtOk && doneOk ? 'PASS' : 'MISS'}  ${c.name} (${ms}ms)`);
  console.log(
    `      operation=${op} ${(answers?.operation?.confidence ?? 0).toFixed(2)} (want ${c.expect.operation})` +
      ` · target=${tgt}${targetMatters ? ` (want ${c.expect.target})` : ' (n/a)'}` +
      ` · done=${done} p=${typeof doneP === 'number' ? doneP.toFixed(2) : '?'} (want ${c.expect.done})`
  );
}

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
console.log(`\n${correct}/${total} field answers correct · latency p50=${p50}ms`);
if (jev) await jev.dispose();
process.exit(0);
