#!/usr/bin/env node
/**
 * The decision loop, in the **runner**, using only Kuang's HTTP API.
 *
 * This is the reference implementation of "observe → decide → act" without the `drive` tool:
 * useful if you want your own policy in the loop (retries, fallbacks, logging, multi-tab), or
 * simply want to see what `drive` does internally. Everything here is a plain tool call —
 * no prompt engineering, no selectors, no coordinates.
 *
 *   node scripts/drive-example.mjs \
 *     --url "https://www.skyscanner.net/transport/flights/lond/mle/261101/261107/?rtn=1" \
 *     --goal "sort the results so the cheapest flight is first" \
 *     --values '{"Cheapest":"ignored"}'          # values are only used for type_text steps
 *
 * Flags: --url, --goal, --values <json>, --max-steps <n>, --dry-run
 */
const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const url = arg('url', 'https://www.skyscanner.net/');
const goal = arg('goal', 'find the cheapest flight');
const maxSteps = Number(arg('max-steps', '8'));
const dryRun = flag('dry-run');
let values = {};
try {
  values = JSON.parse(arg('values', '{}'));
} catch {
  console.error('--values must be JSON');
  process.exit(1);
}

const post = async (path, body) => {
  const res = await fetch(BRIDGE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${json.error || json.code || res.statusText}`);
  return json;
};

const OPERATIONS = {
  click: 'Actuate a control: submit, dismiss, choose an option, follow a link, sort.',
  type_text: 'Type into a text field.',
  done: 'The goal is already satisfied by what is visible.',
  blocked: 'A wall (CAPTCHA, consent, login, payment) prevents progress.',
};

function buildQuestions(components) {
  const clickable = components.filter((c) => (c.actions || []).includes('click') && c.name);
  const typeable = components.filter((c) => (c.actions || []).includes('type'));
  const criteria = (list) => Object.fromEntries(list.slice(0, 40).map((c) => [String(c.id), `${c.role}: ${c.name || ''}`.slice(0, 100)]));
  const q = {
    operation: { type: 'choice', instructions: 'What is the next operation to reach the goal?', criteria: OPERATIONS },
    done: { type: 'noul', instructions: 'Is the goal already satisfied by the visible state?' },
  };
  if (clickable.length) q.click_target = { type: 'choice', instructions: 'Which component should be clicked?', criteria: criteria(clickable) };
  if (typeable.length) q.type_text_target = { type: 'choice', instructions: 'Which component should be typed into?', criteria: criteria(typeable) };
  return q;
}

async function main() {
  await post('/navigate', { url });
  await new Promise((r) => setTimeout(r, 3500));

  const started = Date.now();
  for (let step = 1; step <= maxSteps; step++) {
    const comps = await post('/observe', { as: 'components' });
    if (!comps.components?.length) return console.log(`step ${step}: no components — stopping`);

    const questions = buildQuestions(comps.components);
    const state = [
      `Goal: ${goal}`,
      'Visible components:',
      ...comps.components.slice(0, 40).map((c) => `[${c.id}] ${c.role} "${c.name || ''}" {${(c.actions || []).join(',')}}`),
    ].join('\n');

    // One call, guarded: the target questions are speculative; we only use the head matching the operation.
    const decided = await post('/decide', {
      state,
      questions,
      guard: { threshold: 0.45, components: comps.components.map((c) => ({ id: c.id, actions: c.actions })) },
      eliminate: { max_attempts: 2 },
    });

    if (!decided.accepted) {
      console.log(`step ${step}: no acceptable decision — handing back to the agent`);
      console.log('  reasons:', (decided.reasons || []).join(' | '));
      return;
    }

    const operation = decided.answers?.operation?.choice;
    const target = decided.answers?.[`${operation}_target`]?.choice;
    const component = comps.components.find((c) => String(c.id) === String(target));

    console.log(`step ${step}: ${operation} #${target} "${component?.name || ''}"  (${decided.attempts} attempt(s), ${decided.latencyMs}ms)`);

    if (operation === 'done') return console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (operation === 'blocked') return console.log('blocked — the agent decides (call request_human_intervention if it is a compliance wall)');
    if (dryRun) return console.log('dry run — not acting');
    if (operation !== 'click' && operation !== 'type_text') return console.log(`unsupported operation ${operation}`);

    let text;
    if (operation === 'type_text') {
      text = values[component?.name] ?? values[String(target)];
      if (text === undefined) return console.log(`needs a value for "${component?.name}" — pass it in values and re-run`);
    }

    const acted = await post('/act', {
      mark_id: Number(target),
      action: operation === 'type_text' ? 'type' : 'click',
      text,
      clear_first: operation === 'type_text',
    });
    console.log(`  act: ok=${acted.ok}${acted.warning ? ` ⚠ ${acted.warning}` : ''}${acted.delta?.urlChanged ? ' → navigated' : ''}`);
    if (!acted.ok) return console.log(`  failed: ${acted.error?.code} ${acted.error?.message || ''}`);

    await post('/wait-for', { conditions: [{ type: 'stable', target: 'text', holdMs: 250 }], timeout_ms: 2500 }).catch(() => {});
  }
  console.log(`stopped after ${maxSteps} steps`);
}

main().catch((err) => {
  console.error('drive-example failed:', err.message);
  process.exit(1);
});
