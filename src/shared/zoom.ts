/**
 * Page zoom policy and the shape reported to the HUD, IPC callers and MCP.
 *
 * Windows scales the whole UI (150% is common on a 1080p laptop). Without a
 * policy that would also make every web page 1.5x larger than the same page in
 * a browser at 100% display scaling. `compensate` divides the page zoom by the
 * display scale so CSS pixels map back to physical pixels; `native` leaves the
 * page at Windows scale. The human can switch from the toolbar, and the choice
 * is persisted.
 */

export type ZoomMode = 'compensate' | 'native';

export interface ZoomSettings {
  schemaVersion: 1;
  mode: ZoomMode;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  schemaVersion: 1,
  mode: 'compensate',
};

export interface ZoomState {
  /** Active policy. */
  mode: ZoomMode;
  /** Windows/monitor scale factor, e.g. 1.5. */
  displayScale: number;
  /** The factor the policy alone would apply. */
  baseFactor: number;
  /** The page zoom actually requested, after a manual override. */
  factor: number;
  /** True when an explicit zoom step/factor is active instead of the policy base. */
  custom: boolean;
  /** CSS pixels to physical pixels: displayScale * factor. */
  devicePixelRatio: number;
  /** The native browsing view, in CSS px and physical px. */
  viewport: {
    css: { width: number; height: number };
    physical: { width: number; height: number };
  };
}

export function normalizeZoomSettings(input: unknown): ZoomSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_ZOOM_SETTINGS };
  }
  const mode = (input as { mode?: unknown }).mode;
  return {
    schemaVersion: 1,
    mode: mode === 'native' ? 'native' : 'compensate',
  };
}

/** Chrome-like zoom stops, used by the toolbar and the agent-facing tool. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;

export function nextZoomStep(current: number, direction: 'in' | 'out'): number {
  // A fitted factor is usually 1/1.5 = 0.6667, one hair below the 0.67 stop.
  // Require a visible 2% change so the first click does not feel like a no-op.
  if (direction === 'in') {
    return ZOOM_STEPS.find((step) => step > current * 1.02) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < current / 1.02) ?? ZOOM_STEPS[0];
}

export function clampZoomFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(0.25, Math.round(value * 1000) / 1000));
}
