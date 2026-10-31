/** Experimental features. Everything here is opt-in and may change or be removed. */
export interface ExperimentalSettings {
  /** Collaboration mode (element notes, thread overlays, resolve controls). Off by default. */
  collab: boolean;
}

export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  collab: false,
};

export function normalizeExperimentalSettings(input: unknown): ExperimentalSettings {
  const source = (input ?? {}) as Partial<ExperimentalSettings>;
  return {
    collab: source.collab === true,
  };
}
