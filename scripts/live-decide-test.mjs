/**
 * Live end-to-end test: components → decide (guarded) → act → verify, on a real page.
 * Usage: node scripts/live-decide-test.mjs https://www.reddit.com/r/petite/
 */
const B = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const url = process.argv[2] || 'https://www.reddit.com/r/petite/';

const post = async (path, body) => {
  const res = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const get = async (path) => (await fetch(B + path)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = await post('/tabs/new', { url });
const tabId = tab.json?.tab?.id || tab.json?.tab?.tabId;
for (let i = 0; i < 40; i++) {
  const h = await get('/health');
  if ((h.info?.url || '').includes('petite')) break;
  await sleep(300);
}
await sleep(2500);
console.log('url:', (await get('/health')).info?.url);

const obs = await post('/observe', { as: 'components' });
const components = obs.json?.components || [];
console.log(`\n--- components (${components.length}) ---`);
console.log((obs.json?.text || '').split('\n').slice(0, 24).join('\n'));

const clickable = components.filter((c) => (c.actions || []).includes('click') && c.name).slice(0, 14);
const targets = Object.fromEntries(clickable.map((c) => [String(c.id), `${c.role}: ${c.name}`]));

const state = [
  'Goal: open the first post in this subreddit (a post permalink, not the subreddit header or a menu).',
  'Visible components:',
  ...components.slice(0, 40).map((c) => `[${c.id}] ${c.role} "${c.name}"${c.value ? ` value "${c.value}"` : ''} {${(c.actions || []).join(',')}}`),
].join('\n');

const questions = {
  operation: {
    type: 'choice',
    instructions: 'What is the next operation to reach the goal?',
    criteria: {
      click: 'Actuate a control: open a post, follow a link, dismiss a banner.',
      type_text: 'Type into a search or text field.',
      done: 'The goal is already satisfied by what is visible.',
      blocked: 'A wall (CAPTCHA, login, consent) stops progress.',
    },
  },
  target: { type: 'choice', instructions: 'Which component should be clicked?', criteria: targets },
  done: { type: 'noul', instructions: 'Is a post already open in front of the user?' },
};

const decided = await post('/decide', {
  state,
  questions,
  guard: { threshold: Number(process.env.THRESHOLD || 0.4), components: clickable.map((c) => ({ id: c.id, actions: c.actions, name: c.name })) },
  eliminate: { max_attempts: 3 },
});

const d = decided.json || {};
console.log(`\n--- decide (HTTP ${decided.status}) ---`);
console.log(`accepted=${d.accepted} attempts=${d.attempts} model=${d.model} ${d.latencyMs}ms`);
console.log('answers:', JSON.stringify(d.answers));
if (d.rejections?.length) console.log('rejections:', JSON.stringify(d.rejections));
if (d.reasons?.length) console.log('reasons:', d.reasons.join(' | '));

if (d.accepted && d.answers?.operation?.choice === 'click') {
  const before = await get('/health');
  const acted = await post('/act', { mark_id: Number(d.answers.target.choice), action: 'click' });
  await sleep(2500);
  const after = await get('/health');
  console.log(`\n--- act (HTTP ${acted.status}) ---`);
  console.log('ok:', acted.json?.ok, '| address:', acted.json?.address, '| delta urlChanged:', acted.json?.delta?.urlChanged);
  console.log('url before:', before.info?.url);
  console.log('url after :', after.info?.url);
} else {
  console.log('\nNo click executed (the guard/fallback decided otherwise).');
}

const log = await get('/decisions');
console.log(`\n/decisions count = ${log.count}`);

if (tabId) await post('/tabs/close', { tabId });
process.exit(0);
