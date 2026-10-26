/**
 * Shadow Walk settings.
 *
 * One master switch and a small set of levers, split by the risk they carry:
 *
 *   SAFE     read-only CDP (sealed discovery, frame geometry, deep open roots)
 *   VISIBLE  changes what the human sees (Tab walk moves focus)
 *   RISKY    changes page semantics (force-open) — not built yet
 *
 * Stored in `data/shadow-walk.json` (gitignored), the same convention as the input profile. The
 * file is read on each use, so a save applies immediately and a test can exercise enforcement
 * without restarting the app. Writes go through IPC only; there is no HTTP write route.
 *
 * Environment overrides win for one-off runs:
 *   KUANG_SHADOW_WALK=off        disable every Shadow Walk path
 *   KUANG_FORCE_OPEN_SHADOW=1    arm the (not yet built) force-open patch
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../data-paths.js';

export const SHADOW_WALK_SETTINGS_FILE = dataPath('shadow-walk.json');

export interface ShadowWalkSettings {
  schemaVersion: 1;
  enabled: boolean;
  shadow: {
    /** Existing deep scan over open roots (control facts, frames). */
    deepOpenRoots: boolean;
    /** Closed roots via Accessibility + box model. */
    axSealed: boolean;
    /** Host exported surface (part/exportparts/css vars) — P4, not built yet. */
    componentSurface: boolean;
    /** Trusted Tab/Shift+Tab stepping. */
    tabWalk: boolean;
    tabWalkMaxSteps: number;
    tabWalkRestoreFocus: boolean;
    /** CSS.getMatchedStylesForNode per sealed control — P4, off. */
    cdpStyleMatch: boolean;
    /** Inject ::part outlines — P4, off. */
    partHighlight: boolean;
    /** attachShadow force-open — P5, off, detectably risky. */
    forceOpen: boolean;
  };
  frames: {
    geometry: boolean;
    controls: boolean;
    screenshots: boolean;
    maxFrames: number;
    maxControls: number;
    screenshotMaxSide: number;
  };
  /** Clone Lab is a proposal only; no code path reads this yet. */
  cloneLab: { enabled: boolean };
}

export const DEFAULT_SHADOW_WALK_SETTINGS: ShadowWalkSettings = {
  schemaVersion: 1,
  enabled: true,
  shadow: {
    deepOpenRoots: true,
    axSealed: true,
    componentSurface: true,
    tabWalk: true,
    tabWalkMaxSteps: 8,
    tabWalkRestoreFocus: true,
    cdpStyleMatch: false,
    partHighlight: false,
    forceOpen: false,
  },
  frames: {
    geometry: true,
    controls: true,
    screenshots: true,
    maxFrames: 6,
    maxControls: 40,
    screenshotMaxSide: 1024,
  },
  cloneLab: { enabled: false },
};

export interface ShadowWalkSettingsResult {
  ok: boolean;
  settings: ShadowWalkSettings;
  errors: string[];
}

export type ShadowWalkSurface = 'sealed' | 'tabWalk' | 'frames' | 'deepOpenRoots';

export interface ShadowWalkRefusal {
  code: 'SHADOW_WALK_DISABLED' | 'SEALED_DISABLED' | 'TAB_WALK_DISABLED' | 'FRAMES_DISABLED' | 'DEEP_OPEN_ROOTS_DISABLED';
  message: string;
}

export interface ShadowWalkStatus {
  enabled: boolean;
  axSealed: boolean;
  componentSurface: boolean;
  partHighlight: boolean;
  cdpStyleMatch: boolean;
  tabWalk: boolean;
  tabWalkMaxSteps: number;
  tabWalkRestoreFocus: boolean;
  deepOpenRoots: boolean;
  frames: {
    geometry: boolean;
    controls: boolean;
    screenshots: boolean;
    maxFrames: number;
    maxControls: number;
    screenshotMaxSide: number;
  };
  /** Reported for upcoming phases; false unless the env override arms it. */
  forceOpen: boolean;
}

function cloneDefaults(): ShadowWalkSettings {
  return {
    ...DEFAULT_SHADOW_WALK_SETTINGS,
    shadow: { ...DEFAULT_SHADOW_WALK_SETTINGS.shadow },
    frames: { ...DEFAULT_SHADOW_WALK_SETTINGS.frames },
    cloneLab: { ...DEFAULT_SHADOW_WALK_SETTINGS.cloneLab },
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export function normalizeShadowWalkSettings(input: unknown): ShadowWalkSettingsResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, settings: cloneDefaults(), errors: ['settings must be an object'] };
  }
  const source = input as Record<string, any>;
  const shadow = (source.shadow && typeof source.shadow === 'object' ? source.shadow : {}) as Record<string, any>;
  const frames = (source.frames && typeof source.frames === 'object' ? source.frames : {}) as Record<string, any>;
  const cloneLab = (source.cloneLab && typeof source.cloneLab === 'object' ? source.cloneLab : {}) as Record<string, any>;
  const d = DEFAULT_SHADOW_WALK_SETTINGS;

  const settings: ShadowWalkSettings = {
    schemaVersion: 1,
    enabled: bool(source.enabled, d.enabled),
    shadow: {
      deepOpenRoots: bool(shadow.deepOpenRoots, d.shadow.deepOpenRoots),
      axSealed: bool(shadow.axSealed, d.shadow.axSealed),
      componentSurface: bool(shadow.componentSurface, d.shadow.componentSurface),
      tabWalk: bool(shadow.tabWalk, d.shadow.tabWalk),
      tabWalkMaxSteps: intInRange(shadow.tabWalkMaxSteps, d.shadow.tabWalkMaxSteps, 1, 12),
      tabWalkRestoreFocus: bool(shadow.tabWalkRestoreFocus, d.shadow.tabWalkRestoreFocus),
      cdpStyleMatch: bool(shadow.cdpStyleMatch, d.shadow.cdpStyleMatch),
      partHighlight: bool(shadow.partHighlight, d.shadow.partHighlight),
      forceOpen: bool(shadow.forceOpen, d.shadow.forceOpen),
    },
    frames: {
      geometry: bool(frames.geometry, d.frames.geometry),
      controls: bool(frames.controls, d.frames.controls),
      screenshots: bool(frames.screenshots, d.frames.screenshots),
      maxFrames: intInRange(frames.maxFrames, d.frames.maxFrames, 1, 16),
      maxControls: intInRange(frames.maxControls, d.frames.maxControls, 1, 200),
      screenshotMaxSide: intInRange(frames.screenshotMaxSide, d.frames.screenshotMaxSide, 256, 4096),
    },
    cloneLab: { enabled: bool(cloneLab.enabled, d.cloneLab.enabled) },
  };

  return { ok: true, settings, errors: [] };
}

export class ShadowWalkSettingsStore {
  readonly file: string;

  constructor(file: string = SHADOW_WALK_SETTINGS_FILE) {
    this.file = file;
  }

  load(): ShadowWalkSettings {
    let settings = cloneDefaults();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const normalized = normalizeShadowWalkSettings(parsed);
      if (normalized.ok) settings = normalized.settings;
    } catch {
      // Missing or corrupt file: defaults keep the browser working.
    }

    const master = String(process.env.KUANG_SHADOW_WALK || '').trim().toLowerCase();
    if (['off', '0', 'false', 'disabled'].includes(master)) settings.enabled = false;
    if (['1', 'true', 'on'].includes(String(process.env.KUANG_FORCE_OPEN_SHADOW || '').trim().toLowerCase())) {
      settings.shadow.forceOpen = true;
    }
    return settings;
  }

  save(input: unknown): ShadowWalkSettingsResult {
    const normalized = normalizeShadowWalkSettings(input);
    if (!normalized.ok) return normalized;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(normalized.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
      return normalized;
    } catch (err: any) {
      return { ...normalized, ok: false, errors: [`Could not save Shadow Walk settings: ${err?.message || err}`] };
    }
  }
}

export const shadowWalkSettings = new ShadowWalkSettingsStore();

export function loadShadowWalkSettings(): ShadowWalkSettings {
  return shadowWalkSettings.load();
}

export function saveShadowWalkSettings(input: unknown): ShadowWalkSettingsResult {
  return shadowWalkSettings.save(input);
}

export function shadowWalkStatus(settings: ShadowWalkSettings = loadShadowWalkSettings()): ShadowWalkStatus {
  return {
    enabled: settings.enabled,
    axSealed: settings.shadow.axSealed,
    componentSurface: settings.shadow.componentSurface,
    partHighlight: settings.shadow.partHighlight,
    cdpStyleMatch: settings.shadow.cdpStyleMatch,
    tabWalk: settings.shadow.tabWalk,
    tabWalkMaxSteps: settings.shadow.tabWalkMaxSteps,
    tabWalkRestoreFocus: settings.shadow.tabWalkRestoreFocus,
    deepOpenRoots: settings.shadow.deepOpenRoots,
    frames: { ...settings.frames },
    forceOpen: settings.shadow.forceOpen,
  };
}

/**
 * Structured refusal for a guarded surface, or null when the call may proceed.
 * The master switch wins over every per-lever setting.
 */
export function shadowWalkRefusal(
  surface: ShadowWalkSurface,
  settings: ShadowWalkSettings = loadShadowWalkSettings()
): ShadowWalkRefusal | null {
  if (!settings.enabled) {
    return {
      code: 'SHADOW_WALK_DISABLED',
      message: 'Shadow Walk is off. Enable it in Settings → Shadow Walk before using sealed discovery, Tab walks or frame content.',
    };
  }
  if (surface === 'sealed' && !settings.shadow.axSealed) {
    return { code: 'SEALED_DISABLED', message: 'Sealed shadow-root discovery is off. Enable it in Settings → Shadow Walk.' };
  }
  if (surface === 'tabWalk' && !settings.shadow.tabWalk) {
    return { code: 'TAB_WALK_DISABLED', message: 'The Tab walk is off. Enable it in Settings → Shadow Walk.' };
  }
  if (surface === 'frames' && !settings.frames.geometry) {
    return { code: 'FRAMES_DISABLED', message: 'Frame discovery is off. Enable iframe geometry in Settings → Shadow Walk.' };
  }
  if (surface === 'deepOpenRoots' && !settings.shadow.deepOpenRoots) {
    return {
      code: 'DEEP_OPEN_ROOTS_DISABLED',
      message: 'Deep open-shadow scanning is off. Enable it in Settings → Shadow Walk.',
    };
  }
  return null;
}
