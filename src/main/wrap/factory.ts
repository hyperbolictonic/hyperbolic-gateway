/**
 * Pick the wrapper core for this process.
 *
 * Wrappers run through `anyapi-to-mcp` by default. Wrappers the package cannot
 * reproduce exactly are handed back to the legacy executor by
 * `AnyApiWrapExecutor`, so enabling the core does not change behaviour for them.
 * `HB_WRAP_CORE=legacy` runs everything on the old executor — the rollback, and
 * the way to compare the two cores.
 */

import { WrapExecutor } from './executor.ts';
import type { ExecutorOptions } from './executor.ts';
import { AnyApiWrapExecutor } from './anyapi/executor.ts';
import type { WrapCore } from './core.ts';
import type { WrapStore } from './store.ts';
import type { SecretStore } from './secrets.ts';

export type WrapCoreMode = 'legacy' | 'anyapi';

export function wrapCoreMode(env: NodeJS.ProcessEnv = process.env): WrapCoreMode {
  const raw = (env.HB_WRAP_CORE ?? env.KUANG_WRAP_CORE ?? '').trim().toLowerCase();
  return raw === 'legacy' ? 'legacy' : 'anyapi';
}

export function createWrapExecutor(
  store: WrapStore,
  options: ExecutorOptions,
  secretSource?: Pick<SecretStore, 'list' | 'resolve'>,
): WrapCore {
  const legacy = new WrapExecutor(store, options);
  if (wrapCoreMode() === 'legacy') return legacy;
  return new AnyApiWrapExecutor(store, { ...options, legacy, secretSource });
}
