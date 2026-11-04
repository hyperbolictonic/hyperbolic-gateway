/**
 * Pick the wrapper core for this process.
 *
 * `HB_WRAP_CORE=anyapi` runs wrappers through `anyapi-to-mcp`; the default is
 * still the legacy executor. The switch is per process, never per file, so a
 * wrapper cannot silently change cores between calls. Wrappers the package
 * cannot reproduce exactly are handed back to the legacy executor by the caller
 * (`AnyApiWrapExecutor`), which keeps the switch safe to turn on.
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
  return raw === 'anyapi' ? 'anyapi' : 'legacy';
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
