/**
 * Decision-model benchmark (opt-in; downloads local weights on first run).
 *
 *   node scripts/bench-decision-model.mjs kev-0.6b cpu     # local open-jev model
 *   node scripts/bench-decision-model.mjs --bridge         # whatever /decide is configured with
 *
 * Uses the exact shape Kuang sends: a natural-language goal plus the component list from
 * `observe(as:"components")`, with **real criteria descriptions** per option and targets
 * restricted to the components actually present. "Measure before relying" — the output is
 * accuracy + latency, not a vibe.
 */

const viaBridge = process.argv.includes('--bridge');
const model = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'kev-0.6b';
const device = process.argv[3] || 'cpu';
const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

const OPERATIONS = {
  click: 'Actuate a control: submit a form, accept or dismiss a banner, choose an option, follow a link.',
  type_text: 'Type a value into a text field or editable control — fill an empty field, or replace a wrong value.',
  done: 'The goal is already satisfied by what is visible; no further action is needed.',
  blocked: 'A wall stands between the agent and the goal: a CAPTCHA, consent or paywall, a login wall, or an error/empty page.',
};

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
    targets: { '7': 'Email field, already filled', '8': 'Password field, empty', '9': 'Sign in button' },
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
    targets: { '1': 'Welcome heading', '2': 'Profile link', '3': 'Sign out button' },
    expect: { operation: 'done', target: '1', done: true },
  },
  {
    name: 'cookie banner blocks the form',
    state: [
      'Goal: sign in to the account. The user does not want optional cookies.',
      'Visible components:',
      '[1] dialog "Cookies"',
      '[2] button "Reject optional cookies" {click}',
      '[3] button "Accept all" {click}',
      'A cookie banner covers the lower half of the page; the sign-in form is behind it.',
    ].join('\n'),
    targets: { '1': 'Cookie dialog', '2': 'Reject optional cookies', '3': 'Accept all cookies' },
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
    targets: { '1': 'reCAPTCHA challenge iframe', '2': 'Verify button inside the challenge' },
    expect: { operation: 'blocked', target: '2', done: false },
  },
];

function questions(useCriteria, testCase) {
  // TypeSafe `choice` takes **criteria** (option -> description), not `options`. Sending
  // `options` makes the gateway answer 422 "Endpoint is unavailable", which looks like an
  // auth/outage problem rather than a shape problem. open-jev takes `options`.
  const choice = (instructions, criteria) =>
    useCriteria
      ? { type: 'choice', instructions, criteria }
      : { type: 'choice', instructions, options: Object.keys(criteria), descriptions: criteria };

  return {
    operation: choice('What is the next operation for the agent?', OPERATIONS),
    target: choice('Which component should the operation act on?', testCase.targets),
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

for (const testCase of CASES) {
  let answers;
  let ms;
  if (viaBridge) {
    const res = await fetch(`${BRIDGE}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: testCase.state, questions: questions(true, testCase) }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.log(`ERROR ${testCase.name}: HTTP ${res.status} ${json.error || json.code || ''} ${json.hint || ''}`);
      continue;
    }
    ms = json.latencyMs ?? 0;
    answers = json.answers;
  } else {
    const started = Date.now();
    answers = await jev.decide(testCase.state, questions(false, testCase));
    ms = Date.now() - started;
  }
  latencies.push(ms);

  const op = answers?.operation?.choice;
  const tgt = answers?.target?.choice;
  // TypeSafe answers a noul as {noul: p}; open-jev as {answer, probability}. Normalise both.
  const doneP = answers?.done?.noul ?? answers?.done?.probability;
  const done = typeof doneP === 'number' ? doneP >= 0.5 : answers?.done?.answer;
  const opOk = op === testCase.expect.operation;
  // A target only exists for an operation that acts on one: "done"/"blocked" need none.
  const targetMatters = testCase.expect.operation === 'click' || testCase.expect.operation === 'type_text';
  const tgtOk = !targetMatters || tgt === testCase.expect.target;
  const doneOk = done === testCase.expect.done;
  for (const ok of targetMatters ? [opOk, tgtOk, doneOk] : [opOk, doneOk]) {
    total++;
    if (ok) correct++;
  }

  console.log(`${opOk && tgtOk && doneOk ? 'PASS' : 'MISS'}  ${testCase.name} (${ms}ms)`);
  console.log(
    `      operation=${op} ${(answers?.operation?.confidence ?? 0).toFixed(2)} (want ${testCase.expect.operation})` +
      ` · target=${tgt}${targetMatters ? ` (want ${testCase.expect.target})` : ' (n/a)'}` +
      ` · done=${done} p=${typeof doneP === 'number' ? doneP.toFixed(2) : '?'} (want ${testCase.expect.done})`
  );
}

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
console.log(`\n${correct}/${total} field answers correct · latency p50=${p50}ms`);
if (jev) await jev.dispose();
process.exit(0);
