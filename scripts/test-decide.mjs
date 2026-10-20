#!/usr/bin/env node
/**
 * Decision-model surface test (offline: mock upstream, no API key, no model download).
 *
 * Verifies the *plumbing contract* of the optional `decide` tool:
 *   1. With no backend configured: `GET /decide` says so, and `POST /decide` fails with
 *      NOT_CONFIGURED instead of pretending to decide.
 *   2. With `data/decision.json` pointing at a mock: state and questions are forwarded
 *      **verbatim** (no prompt assembly, no wrapping), the key travels as a bearer token,
 *      and the answers come back untouched with model/protocol/latency.
 *   3. An upstream failure is an upstream failure (HTTP 502, code UPSTREAM_ERROR) —
 *      never a fabricated answer.
 *
 * It writes and then removes `data/decision.json`; an existing file is restored.
 *
 * Usage: node scripts/test-decide.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const CONFIG = path.join(process.cwd(), 'data', 'decision.json');
const BACKUP = CONFIG + '.test-backup';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridge(p, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

function startMock(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  const hadConfig = fs.existsSync(CONFIG);
  if (hadConfig) fs.copyFileSync(CONFIG, BACKUP);

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const received = { bodies: [], auth: [] };
  let failMode = false;

  const mock = await startMock((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      received.bodies.push(body);
      received.auth.push(req.headers.authorization || null);
      if (failMode) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream exploded' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: body?.model,
          answers: {
            operation: { type: 'choice', choice: 'click', confidence: 0.91, probabilities: { click: 0.91, done: 0.05, type_text: 0.04 } },
            is_done: { type: 'noul', noul: 0.02, confidence: 0.97 },
          },
          usage: { input_tokens: 42, output_tokens: 0 },
        })
      );
    });
  });
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;

  try {
    // ---- 1. Unconfigured ---------------------------------------------------
    fs.rmSync(CONFIG, { force: true });
    const status = await bridge('/decide', 'GET');
    check('an unconfigured bridge reports no decision backend', status.json?.configured === false, `configured=${status.json?.configured}`);
    const none = await bridge('/decide', 'POST', { state: 'x', questions: { q: { type: 'noul', instructions: 'is it?' } } });
    check('an unconfigured call fails loudly', none.status === 400 && none.json?.code === 'NOT_CONFIGURED', `HTTP ${none.status} ${none.json?.code}`);

    // ---- 2. Configured: verbatim forwarding --------------------------------
    fs.writeFileSync(CONFIG, JSON.stringify({ protocol: 'typesafe', url: mockUrl, model: 'jev-1.13', key: 'test-key-123' }, null, 2));
    const configured = await bridge('/decide', 'GET');
    check('the configured backend is reported', configured.json?.configured === true && configured.json?.protocol === 'typesafe', `${configured.json?.protocol} · ${configured.json?.model}`);

    const state = { goal: 'sign in', components: [{ id: 7, role: 'textbox', name: 'Email', actions: ['type'] }] };
    const questions = {
      operation: { type: 'choice', instructions: 'What next?', options: ['click', 'type_text', 'done'] },
      is_done: { type: 'noul', instructions: 'Is the goal complete?' },
    };
    const decided = await bridge('/decide', 'POST', { state, questions });
    check('a configured call answers', decided.json?.ok === true, `${decided.json?.protocol} · ${decided.json?.model} · ${decided.json?.latencyMs}ms`);
    check(
      'answers are passed through untouched',
      decided.json?.answers?.operation?.choice === 'click' &&
        decided.json?.answers?.operation?.confidence === 0.91 &&
        decided.json?.answers?.is_done?.noul === 0.02,
      JSON.stringify(decided.json?.answers?.operation)
    );
    check(
      'state and questions reach the model verbatim',
      JSON.stringify(received.bodies[0]?.state) === JSON.stringify(state) &&
        JSON.stringify(received.bodies[0]?.questions) === JSON.stringify(questions),
      'no prompt assembly, no wrapping'
    );
    check('the configured model is sent', received.bodies[0]?.model === 'jev-1.13', String(received.bodies[0]?.model));
    check('the key travels as a bearer token', received.auth[0] === 'Bearer test-key-123', String(received.auth[0]));
    check('latency is reported', typeof decided.json?.latencyMs === 'number' && decided.json.latencyMs >= 0, `${decided.json?.latencyMs}ms`);

    // ---- 3. Upstream failure is not papered over ---------------------------
    failMode = true;
    const failed = await bridge('/decide', 'POST', { state: 'x', questions: { q: { type: 'noul', instructions: '?' } } });
    check('an upstream failure surfaces as an error', failed.status === 502 && failed.json?.code === 'UPSTREAM_ERROR', `HTTP ${failed.status} ${failed.json?.code}`);
    check('no answers are fabricated', failed.json?.answers === undefined, 'answers absent');
  } catch (err) {
    check('decision surface run', false, err.message);
  } finally {
    mock.close();
    fs.rmSync(CONFIG, { force: true });
    if (hadConfig && fs.existsSync(BACKUP)) {
      fs.copyFileSync(BACKUP, CONFIG);
      fs.rmSync(BACKUP, { force: true });
    }
    await sleep(100);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
