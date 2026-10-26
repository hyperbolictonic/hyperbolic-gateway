/**
 * Human-input pacing profile — the knobs behind the humanised mouse and keyboard.
 *
 * These exist because "humanlike" is a dial, not a constant. A gaming mouse at 1200+ dpi crosses
 * 500px in ~250ms, while a slow glide can cost a second per click and make a 10-step flow feel
 * broken. The defaults below aim at a *comfortable fast* human; the Settings → INPUT tab writes
 * this file so the behaviour can be tuned without a rebuild.
 *
 * Stored in `data/input-profile.json` (gitignored), the same convention as `data/decision.json`.
 * Environment overrides win for one-off runs:
 *   KUANG_MOUSE_SPEED_PX_S, KUANG_TYPING_WPM, KUANG_CLICK_DWELL_MS, KUANG_CURSOR_BUDGET_MS
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../data-paths.js';

export interface InputProfile {
  /** Pointer speed used to derive the glide budget for a given distance. */
  mouseSpeedPxPerSec: number;
  /** Typing cadence, in words per minute (5 chars/word). 160 wpm ≈ 37ms per character. */
  typingWpm: number;
  /** Pause between mouse-down and mouse-up. */
  clickDwellMs: number;
}

export const DEFAULT_INPUT_PROFILE: InputProfile = {
  mouseSpeedPxPerSec: 1400,
  typingWpm: 160,
  clickDwellMs: 55,
};

/** Bounds are deliberately generous but finite: 0 would mean "no dwell at all". */
const BOUNDS: Record<keyof InputProfile, { min: number; max: number }> = {
  mouseSpeedPxPerSec: { min: 200, max: 6000 },
  typingWpm: { min: 40, max: 600 },
  clickDwellMs: { min: 0, max: 300 },
};

const CONFIG_FILE = dataPath('input-profile.json');

function clamp(key: keyof InputProfile, value: number): number {
  const { min, max } = BOUNDS[key];
  return Math.round(Math.min(max, Math.max(min, value)));
}

function envOverride(key: keyof InputProfile): number | undefined {
  const name =
    key === 'mouseSpeedPxPerSec'
      ? 'KUANG_MOUSE_SPEED_PX_S'
      : key === 'typingWpm'
        ? 'KUANG_TYPING_WPM'
        : 'KUANG_CLICK_DWELL_MS';
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve the active profile: defaults, then the file, then env overrides.
 * Never throws — a corrupt file falls back to the defaults so input keeps working.
 */
export function loadInputProfile(): InputProfile {
  const merged: InputProfile = { ...DEFAULT_INPUT_PROFILE };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<InputProfile>;
      for (const key of Object.keys(DEFAULT_INPUT_PROFILE) as Array<keyof InputProfile>) {
        const value = parsed[key];
        if (typeof value === 'number' && Number.isFinite(value)) merged[key] = clamp(key, value);
      }
    }
  } catch {
    // keep defaults
  }
  for (const key of Object.keys(DEFAULT_INPUT_PROFILE) as Array<keyof InputProfile>) {
    const value = envOverride(key);
    if (value !== undefined) merged[key] = clamp(key, value);
  }
  return merged;
}

/** Persist a (partial) profile, clamped, and return the profile that is now active. */
export function saveInputProfile(patch: Partial<InputProfile>): { ok: boolean; profile: InputProfile; errors: string[] } {
  const errors: string[] = [];
  const next = { ...DEFAULT_INPUT_PROFILE };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      Object.assign(next, loadInputProfile());
    }
  } catch {
    // ignore, start from defaults
  }
  for (const key of Object.keys(DEFAULT_INPUT_PROFILE) as Array<keyof InputProfile>) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push(`${key} must be a number`);
      continue;
    }
    next[key] = clamp(key, raw);
  }

  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    errors.push(`could not write input profile: ${(err as Error)?.message || err}`);
  }

  return { ok: errors.length === 0, profile: loadInputProfile(), errors };
}
