/**
 * Single source of truth for user-facing brand strings.
 *
 * Every surface that names the product — the desktop window title, notification defaults,
 * the HAR `creator`, the `/health` payload and the MCP log prefixes — reads from here, so the
 * next rename is a one-file change instead of a repository sweep.
 *
 * `repoOwner` / `repoName` are deliberately still the pre-rename coordinates: the updater feed,
 * the skill install URLs and the docs links point at them until the GitHub repository itself is
 * moved. Update those two values (and `scripts/build-pages.mjs`) once it is.
 */
export const BRAND = {
  /** The desktop product. */
  product: 'Hypagon Gateway',
  /** Window caption and installer shortcut. `// Cyberdeck` is the in-app harness name. */
  windowTitle: 'Hypagon Gateway // Cyberdeck',
  /** The browser MCP server and the thing that actually drives Chromium. */
  browser: 'Hypagon Browser',
  /** The REST wrapper MCP server. */
  rest: 'Hypagon REST',
  /** Harness name used inside the desktop app (HUD, tray, HAR creator). */
  deck: 'Hypagon Gateway Cyberdeck',
  /** Stable machine key for `/health` and package metadata. */
  appKey: 'hypagon-gateway',
  repoOwner: 'hyperbolictonic',
  repoName: 'hyperbolic-gateway',
} as const;

/**
 * Directory names a previous release used for Electron's `userData`.
 *
 * Electron derives `userData` from `productName`, so a rebrand moves it. `migrateLegacyUserData`
 * copies the first one it finds when the current install is empty.
 */
export const LEGACY_USER_DATA_NAMES = ['Hyperbolic Gateway', 'Kuang Grade Mark Eleven'] as const;
