/**
 * Adapt the app's encrypted `SecretStore` to `anyapi-to-mcp`.
 *
 * Two shapes are needed: a binding table (name -> exact host + header) and a
 * provider that can return a value for a destination host. The store already
 * enforces `allowedHosts`; the binding repeats that as a second check.
 *
 * Refusals are explicit, never silent:
 * - an OAuth2 secret stays on the old core until token minting is wired;
 * - a secret with more than one allowed host has no single binding;
 * - a wildcard host (`*.example.com`) cannot be represented by the core's
 *   exact-host binding. It is refused rather than widened.
 */

import type { BindingTable, SecretBinding, SecretProvider } from 'anyapi-to-mcp/runtime';

import type { WrapSecretMetadata } from '../secrets.ts';

export interface WrapSecretSource {
  list(): WrapSecretMetadata[];
  resolve(name: string, host: string): Promise<{ ok: boolean; value?: string }>;
}

export type WrapSecretRefusal = {
  readonly name: string;
  readonly reason: string;
};

export type WrapSecretAdapter = {
  readonly bindings: BindingTable;
  readonly provider: SecretProvider;
  readonly refused: readonly WrapSecretRefusal[];
};

export function createSecretAdapter(store: WrapSecretSource): WrapSecretAdapter {
  const bindings: Record<string, SecretBinding> = {};
  const refused: WrapSecretRefusal[] = [];

  for (const secret of store.list()) {
    if (secret.kind === 'oauth2') {
      refused.push({ name: secret.name, reason: 'OAuth2 secrets stay on the old core until token minting is wired' });
      continue;
    }

    if (secret.allowedHosts.length !== 1) {
      refused.push({ name: secret.name, reason: 'a core binding names exactly one host' });
      continue;
    }

    const host = secret.allowedHosts[0]!.toLowerCase();
    if (host.startsWith('*.')) {
      refused.push({ name: secret.name, reason: `wildcard host ${host} is not representable; list exact hosts` });
      continue;
    }

    bindings[secret.name] = { host, header: secret.header.toLowerCase(), format: '{value}' };
  }

  const provider: SecretProvider = {
    async get(name: string, host?: string): Promise<string | undefined> {
      // The host is required, and it must be the one the binding names. The
      // runtime checks this first; repeating it here avoids even asking the
      // store to decrypt for a host it would refuse.
      const binding = bindings[name];
      if (host === undefined || binding === undefined || binding.host !== host.toLowerCase()) return undefined;
      const resolved = await store.resolve(name, host);
      return resolved.ok ? resolved.value : undefined;
    },
  };

  return { bindings, provider, refused };
}
