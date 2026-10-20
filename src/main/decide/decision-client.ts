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
 *   typesafe  POST {url}/v1/systemone  (hosted Jev, e.g. jev-1.13). Questions are forwarded
 *             exactly as supplied; answers carry probabilities + confidence.
 *   d1-onnx   local LiquidAI d1-3B via `open-jev` (Transformers.js / ONNX). Loaded lazily from
 *             an optional dependency — no model or runtime is bundled with Kuang. d1 answers in
 *             one forward pass and accepts images in the state, which suits Kuang's screenshots.
 *
 * Configuration comes from the environment, then `data/decision.json` (gitignored):
 *
 *   { "protocol": "typesafe", "url": "https://api.typesafe.ai", "model": "jev-1.13", "key": "…" }
 *   { "protocol": "d1-onnx",  "model": "onnx-community/d1-3B-ONNX",
 *     "revision": "294fdcdf95d14a3fd82626e0abe8ed11fe803e46", "device": "webgpu" }
 *
 * Env names: KUANG_DECISION_PROTOCOL | _URL | _MODEL | _KEY | _REVISION | _DEVICE | _TIMEOUT_MS.
 */
import fs from 'node:fs';
import path from 'node:path';

export type DecisionProtocol = 'typesafe' | 'd1-onnx';

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
}

export type DecisionFailureCode = 'NOT_CONFIGURED' | 'BAD_REQUEST' | 'UPSTREAM_ERROR' | 'TIMEOUT';

export interface DecisionResult {
  ok: boolean;
  protocol?: DecisionProtocol;
  model?: string;
  answers?: Record<string, unknown>;
  latencyMs?: number;
  usage?: unknown;
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
  const protocol = (process.env.KUANG_DECISION_PROTOCOL || file.protocol || '').toLowerCase() as DecisionProtocol | '';
  if (protocol !== 'typesafe' && protocol !== 'd1-onnx') return null;

  const url = process.env.KUANG_DECISION_URL || file.url || undefined;
  // typesafe needs an endpoint; d1-onnx runs in-process and needs none.
  if (protocol === 'typesafe' && !url) return null;

  return {
    protocol,
    url,
    model: process.env.KUANG_DECISION_MODEL || file.model || (protocol === 'typesafe' ? 'jev-1.13' : 'd1-3b'),
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
    local: cfg.protocol === 'd1-onnx',
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
          hint: res.status === 401 || res.status === 403 ? 'check KUANG_DECISION_KEY' : undefined,
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

/** Lazily-loaded local d1-3B (optional dependency: `npm i open-jev`). */
let localModel: any = null;
let localModelKey = '';

async function runLocalD1(cfg: DecisionConfig, call: DecisionCall): Promise<DecisionResult> {
  const started = Date.now();
  const modelId = call.model || cfg.model;
  const key = `${modelId}|${cfg.revision || ''}|${cfg.device || ''}`;

  let mod: any;
  try {
    mod = await import('open-jev' as any);
  } catch {
    return {
      ok: false,
      protocol: 'd1-onnx',
      model: modelId,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'The local decision model runtime is not installed (open-jev).',
        hint: 'npm i open-jev — then the d1-3B ONNX weights download on first use (q8 ≈ 3.8 GB). Nothing is bundled with Kuang.',
      },
    };
  }

  try {
    if (!localModel || localModelKey !== key) {
      localModel = await mod.OpenJev.load({
        model: modelId,
        device: cfg.device || 'webgpu',
        ...(cfg.revision ? { revision: cfg.revision } : {}),
      });
      localModelKey = key;
    }
    const answers = await localModel.decide(call.state, call.questions);
    return { ok: true, protocol: 'd1-onnx', model: modelId, answers, latencyMs: Date.now() - started };
  } catch (err: any) {
    return {
      ok: false,
      protocol: 'd1-onnx',
      model: modelId,
      latencyMs: Date.now() - started,
      error: { code: 'UPSTREAM_ERROR', message: `Local decision model failed: ${err?.message || err}` },
    };
  }
}

/** One decision call. Never throws: failures are returned as typed results. */
export async function runDecision(call: DecisionCall): Promise<DecisionResult> {
  const cfg = resolveDecisionConfig();
  if (!cfg) {
    return {
      ok: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'No decision model is configured.',
        hint: 'Set KUANG_DECISION_PROTOCOL (typesafe | d1-onnx) and, for typesafe, KUANG_DECISION_URL (+ _KEY, optional _MODEL), or write data/decision.json. See docs/DECISION_MODELS.md.',
      },
    };
  }
  if (!call.questions || typeof call.questions !== 'object' || !Object.keys(call.questions).length) {
    return { ok: false, protocol: cfg.protocol, error: { code: 'BAD_REQUEST', message: 'decide needs at least one typed question.' } };
  }
  return cfg.protocol === 'd1-onnx' ? runLocalD1(cfg, call) : runTypesafe(cfg, call);
}
