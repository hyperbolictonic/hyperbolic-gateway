/**
 * Optional decision-model bridge — **off unless configured**.
 *
 * Kuang surfaces facts; a decision model picks between them. This module is the only place
 * Kuang talks to one, and it is deliberately a dumb pipe:
 *
 *   state + typed questions  →  the model's answers, verbatim
 *
 * No prompt assembly, no retries that change the question, no synthesis. If the upstream is
 * down the caller gets a typed error, never a fabricated answer. Nothing in Kuang calls this
 * implicitly — every call is somebody's explicit request, so the tool surface stays
 * deterministic and local-first.
 *
 * Two protocols:
 *
 *   typesafe      POST {url}/v1/systemone  (hosted Jev, e.g. jev-1.13). Questions are forwarded
 *                 exactly as supplied; answers carry probabilities + confidence.
 *   local-onnx    In-process via `open-jev` (Transformers.js / ONNX). Default model `kev-0.6b`
 *                 (0.34 GB, Qwen3-0.6B); `open-jev` (DeBERTa-v3-large) is the other small option.
 *
 *                 NOTE: LiquidAI's d1-3B is NOT loadable by open-jev — its `detectFamily()` only
 *                 understands `open_jev` / `kev` configs and d1's config is `lfm2_vl`. Running d1
 *                 needs its own prompt + readout against @huggingface/transformers and a
 *                 WebGPU-capable context (see docs/DECISION_MODELS.md).
 *
 *                 Measured with scripts/bench-decision-model.mjs on four page states: kev-0.6b
 *                 5/12 field answers (p50 1,118 ms), open-jev 7/12 (p50 750 ms). Mechanically sound,
 *                 not yet trustworthy for page decisions — the bench is how a model is checked.
 *
 * Configuration comes from the environment, then `data/decision.json` (gitignored):
 *
 *   { "protocol": "typesafe",   "url": "https://api.typesafe.ai", "model": "jev-1.13", "key": "…" }
 *   { "protocol": "local-onnx", "model": "kev-0.6b", "device": "cpu" }
 *
 * Env names: KUANG_DECISION_PROTOCOL | _URL | _MODEL | _KEY | _DEVICE | _TIMEOUT_MS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { detectSensitiveGate } from './sensitive-gate.js';

export type DecisionProtocol = 'typesafe' | 'local-onnx';

export interface DecisionConfig {
  protocol: DecisionProtocol;
  url?: string;
  model: string;
  key?: string;
  revision?: string;
  device?: string;
  timeoutMs: number;
}

export interface DecisionCall {
  state: unknown;
  questions: Record<string, unknown>;
  /** Optional per-call overrides (e.g. a different model), never credentials. */
  model?: string;
  /** URL of the page the state came from — lets the gate rule ignore app-internal pages. */
  pageUrl?: string;
}

export type DecisionFailureCode = 'NOT_CONFIGURED' | 'BAD_REQUEST' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NO_DECISION' | 'HUMAN_REQUIRED';

export interface DecisionResult {
  ok: boolean;
  protocol?: DecisionProtocol;
  model?: string;
  answers?: Record<string, unknown>;
  latencyMs?: number;
  usage?: unknown;
  /** Set when a sensitive gate (age verification, CAPTCHA) stopped the call before the model. */
  gate?: 'age_verification' | 'captcha';
  error?: { code: DecisionFailureCode; message: string; hint?: string; status?: number };
}

const CONFIG_FILE = path.join(process.cwd(), 'data', 'decision.json');

function readConfigFile(): Partial<DecisionConfig> | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // A malformed config is treated as absent (and reported through NOT_CONFIGURED).
    return null;
  }
}

/** Resolve configuration (env overrides file). Returns null when nothing is configured. */
export function resolveDecisionConfig(): DecisionConfig | null {
  const file = readConfigFile() || {};
  const rawProtocol = (process.env.KUANG_DECISION_PROTOCOL || file.protocol || '').toLowerCase();
  // `d1-onnx` was the first name for the local path; d1-3B cannot be loaded by open-jev, so the
  // local family is honestly named for what it runs (kev / open-jev ONNX) and the old name is
  // accepted as an alias so existing config files keep working.
  const protocol = (rawProtocol === 'd1-onnx' ? 'local-onnx' : rawProtocol) as DecisionProtocol | '';
  if (protocol !== 'typesafe' && protocol !== 'local-onnx') return null;

  const url = process.env.KUANG_DECISION_URL || file.url || undefined;
  // typesafe needs an endpoint; the local model runs in-process and needs none.
  if (protocol === 'typesafe' && !url) return null;

  return {
    protocol,
    url,
    model: process.env.KUANG_DECISION_MODEL || file.model || (protocol === 'typesafe' ? 'jev-1.13' : 'kev-0.6b'),
    key: process.env.KUANG_DECISION_KEY || file.key || undefined,
    revision: process.env.KUANG_DECISION_REVISION || file.revision || undefined,
    device: process.env.KUANG_DECISION_DEVICE || file.device || undefined,
    timeoutMs: Number(process.env.KUANG_DECISION_TIMEOUT_MS || file.timeoutMs || 30000),
  };
}

/** Raw configuration as stored on disk (file values only — env is read at resolve time). */
export function readStoredDecisionConfig(): Partial<DecisionConfig> {
  return readConfigFile() || {};
}

/**
 * Persist (or clear) `data/decision.json`. Returns the resolved status so the caller can show
 * exactly what the app will use, including the effect of environment overrides.
 */
export function saveDecisionConfig(input: Partial<DecisionConfig> | null): { ok: boolean; status: ReturnType<typeof decisionStatus> } {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    if (!input || !input.protocol) {
      fs.rmSync(CONFIG_FILE, { force: true });
      return { ok: true, status: decisionStatus() };
    }
    const clean: Record<string, unknown> = { protocol: input.protocol };
    for (const key of ['url', 'model', 'key', 'revision', 'device'] as const) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
    }
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) clean.timeoutMs = input.timeoutMs;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    return { ok: true, status: decisionStatus() };
  } catch (err: any) {
    return { ok: false, status: decisionStatus() };
  }
}

/** Shape reported by `/health` and `help`, so an agent can tell whether `decide` will work. */
export function decisionStatus(): {
  configured: boolean;
  protocol?: DecisionProtocol;
  model?: string;
  endpoint?: string;
  local?: boolean;
} {
  const cfg = resolveDecisionConfig();
  if (!cfg) return { configured: false };
  return {
    configured: true,
    protocol: cfg.protocol,
    model: cfg.model,
    endpoint: cfg.protocol === 'typesafe' ? cfg.url : 'in-process',
    local: cfg.protocol === 'local-onnx',
  };
}

function systemOneUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return /\/systemone$/i.test(trimmed) ? trimmed : `${trimmed}/v1/systemone`;
}

async function runTypesafe(cfg: DecisionConfig, call: DecisionCall): Promise<DecisionResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(systemOneUrl(cfg.url || ''), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
      },
      body: JSON.stringify({ model: call.model || cfg.model, state: call.state, questions: call.questions }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw body for the error below
    }
    if (!res.ok) {
      return {
        ok: false,
        protocol: 'typesafe',
        model: call.model || cfg.model,
        latencyMs: Date.now() - started,
        error: {
          code: 'UPSTREAM_ERROR',
          status: res.status,
          message: `Decision endpoint returned HTTP ${res.status}: ${(text || '').slice(0, 300)}`,
          hint:
            res.status === 401 || res.status === 403
              ? /opencode\.ai/i.test(cfg.url || '')
                ? 'The key was rejected upstream. Verify it on its own with: curl https://opencode.ai/inference/v1/models -H "Authorization: Bearer $KEY" (200 = valid). Jev is an OpenCode *Console* pay-as-you-go model, so an OpenCode Go subscription key will not authorise it, and a TypeSafe key does not work on the opencode.ai endpoint.'
                : 'The key was rejected upstream — check KUANG_DECISION_KEY (a TypeSafe key for api.typesafe.ai; an OpenCode Console key for opencode.ai/inference/systemone).'
              : undefined,
        },
      };
    }
    if (!json || typeof json !== 'object') {
      return {
        ok: false,
        protocol: 'typesafe',
        latencyMs: Date.now() - started,
        error: { code: 'UPSTREAM_ERROR', message: 'Decision endpoint returned a non-JSON body', hint: (text || '').slice(0, 200) },
      };
    }
    return {
      ok: true,
      protocol: 'typesafe',
      model: json.model || call.model || cfg.model,
      // Pass the answers through untouched: no coercion, no defaulting, no interpretation.
      answers: json.answers || json,
      usage: json.usage,
      latencyMs: Date.now() - started,
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      protocol: 'typesafe',
      latencyMs: Date.now() - started,
      error: {
        code: aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR',
        message: aborted ? `Decision endpoint did not answer within ${cfg.timeoutMs} ms` : `Decision call failed: ${err?.message || err}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Lazily-loaded local ONNX decision model (open-jev: kev-0.6b by default). */
let localModel: any = null;
let localModelKey = '';

async function runLocalOnnx(cfg: DecisionConfig, call: DecisionCall): Promise<DecisionResult> {
  const started = Date.now();
  const modelId = call.model || cfg.model;
  const key = `${modelId}|${cfg.device || ''}`;

  let mod: any;
  try {
    mod = await import('open-jev' as any);
  } catch {
    return {
      ok: false,
      protocol: 'local-onnx',
      model: modelId,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'The local decision runtime is not installed (open-jev).',
        hint: 'Run `pnpm add open-jev @huggingface/transformers`. The model weights (kev-0.6b â‰ˆ 0.34 GB) download on first use; nothing is bundled with Kuang.',
      },
    };
  }

  try {
    if (!localModel || localModelKey !== key) {
      localModel = await mod.OpenJev.load({ model: modelId, device: cfg.device || 'cpu' });
      localModelKey = key;
    }
    // open-jev takes the state as one piece of text. Kuang states are often the components array,
    // so serialise it rather than silently dropping structure. Revision pinning is not exposed by
    // open-jev (Transformers.js resolves the repo head), which is why the envelope reports the
    // resolved model family back to the caller.
    const state = typeof call.state === 'string' ? call.state : JSON.stringify(call.state, null, 2);
    const answers = await localModel.decide(state, call.questions);
    return {
      ok: true,
      protocol: 'local-onnx',
      model: localModel?.runtime?.model || modelId,
      answers,
      latencyMs: Date.now() - started,
    };
  } catch (err: any) {
    return {
      ok: false,
      protocol: 'local-onnx',
      model: modelId,
      latencyMs: Date.now() - started,
      error: { code: 'UPSTREAM_ERROR', message: `Local decision model failed: ${err?.message || err}` },
    };
  }
}

/** One completed decision call, for the HUD's DECISIONS tab. Never contains the API key. */
export interface DecisionEvent {
  ts: number;
  protocol?: DecisionProtocol;
  model?: string;
  latencyMs?: number;
  ok: boolean;
  error?: { code?: DecisionFailureCode; message?: string };
  statePreview: string;
  questions: Array<{ id: string; type?: string; instruction?: string }>;
  answers?: Record<string, unknown>;
}

const listeners = new Set<(event: DecisionEvent) => void>();

/** Subscribe to completed decision calls (the HUD mirrors this; it never gates the call). */
export function onDecision(listener: (event: DecisionEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDecisionEvent(event: DecisionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A UI listener must never break a decision.
    }
  }
}

function summarizeQuestions(questions: Record<string, any>): DecisionEvent['questions'] {
  return Object.entries(questions || {}).map(([id, q]: [string, any]) => ({
    id,
    type: q?.type,
    instruction: typeof q?.instructions === 'string' ? q.instructions.slice(0, 120) : undefined,
  }));
}

/** One decision call. Never throws: failures are returned as typed results. */
export async function runDecision(call: DecisionCall): Promise<DecisionResult> {
  const startedAt = Date.now();
  const cfg = resolveDecisionConfig();
  const record: DecisionEvent = {
    ts: startedAt,
    protocol: cfg?.protocol,
    model: call.model || cfg?.model,
    ok: false,
    statePreview: (typeof call.state === 'string' ? call.state : JSON.stringify(call.state ?? '')).slice(0, 160),
    questions: summarizeQuestions(call.questions || {}),
  };

  if (!cfg) {
    const result: DecisionResult = {
      ok: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'No decision model is configured.',
        hint: 'Set KUANG_DECISION_PROTOCOL (typesafe | local-onnx) and, for typesafe, KUANG_DECISION_URL (+ _KEY, optional _MODEL), or write data/decision.json. See docs/DECISION_MODELS.md.',
      },
    };
    emitDecisionEvent({ ...record, latencyMs: Date.now() - startedAt, error: result.error });
    return result;
  }
  if (!call.questions || typeof call.questions !== 'object' || !Object.keys(call.questions).length) {
    const result: DecisionResult = { ok: false, protocol: cfg.protocol, error: { code: 'BAD_REQUEST', message: 'decide needs at least one typed question.' } };
    emitDecisionEvent({ ...record, protocol: cfg.protocol, latencyMs: Date.now() - startedAt, error: result.error });
    return result;
  }

  // Sensitive gate: ask a human, not a model. Checked before any network call, so it cannot be
  // out-voted by a confident answer and cannot spend an attempt.
  const gate = detectSensitiveGate(call.state, { url: call.pageUrl });
  if (gate) {
    const result: DecisionResult = {
      ok: false,
      protocol: cfg.protocol,
      gate: gate.kind,
      error: {
        code: 'HUMAN_REQUIRED',
        message: gate.reason,
        hint: gate.evidence.length ? `Matched: ${gate.evidence.join(' | ')}` : undefined,
      },
    };
    emitDecisionEvent({ ...record, protocol: cfg.protocol, latencyMs: Date.now() - startedAt, ok: false, error: result.error });
    return result;
  }

  const result = cfg.protocol === 'local-onnx' ? await runLocalOnnx(cfg, call) : await runTypesafe(cfg, call);  emitDecisionEvent({
    ...record,
    protocol: result.protocol || cfg.protocol,
    model: result.model || record.model,
    latencyMs: result.latencyMs ?? Date.now() - startedAt,
    ok: result.ok,
    error: result.error,
    answers: result.answers,
  });
  return result;
}
