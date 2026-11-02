# anyapi-to-mcp integration

Status: **dependency only.** `anyapi-to-mcp` is installed and pinned; no runtime
path uses it yet, and `npx tsc --noEmit` plus `npm run test:mcp:contract` are
green with it present.

## Goal

Run the wrapper core through `anyapi-to-mcp` while keeping every published
surface unchanged: IPC channels, bridge routes, MCP tool names, the
`WrapRunResult` shape, error codes, and the `<userData>/wrap` file layout. The
UI and JEV are out of scope.

## Where the seam is

- `src/main/wrap/executor.ts` already takes injected dependencies
  (`ExecutorOptions`): fetch, host resolver, secrets, audit, indexing. That is
  the preferred insertion point.
- `src/main/wrap/secrets.ts` already isolates encryption behind `SecretCipher`;
  only `createSecretCipher()` in `src/main/index.ts` touches Electron.
- `src/main/http-bridge.ts` consumes a structural `WrapBridge` bundle, so the
  bridge does not need to know which executor is behind it.
- `src/mcp/wrap-server.ts` sees only JSON over the bridge plus the type-only
  `WrapInputSchema` import. It should not change.

## Stages

1. **Adapters, no behaviour change.** Load wrappers as maps, build a binding
   table and a secret provider from `SecretStore`, and map a package run result
   back to `WrapRunResult`. Unit tests only; the old executor stays in charge.
2. **Opt-in switch.** `HB_WRAP_CORE=anyapi` selects the new path per process.
   Both cores remain present.
3. **Parity.** Run the existing wrapper suites against both cores, plus a live
   DummyJSON run, then make the new path the default.
4. **Delete the old executor** after one release with no regressions.

## Adapter notes

- **Maps**: point `loadLocation` at `<userData>/wrap/wrappers`. Legacy wrappers
  project through the package; an invalid file is skipped, as today.
- **Secrets**: implement `get(name, host)` over `SecretStore.resolve(name, host)`
  and build the package's binding table from each record's metadata. Only an
  exact single host is representable today; wildcard `allowedHosts` entries must
  be refused (clear error) until bindings support them, never widened silently.
- **Result mapping**: the package returns its own envelope and handles. The
  wrapper surface needs `WrapRunResult`, so the adapter renders the recipe as it
  does today and translates status/error codes. Redaction, cross-origin secret
  drop, paging and audit must keep their current guarantees.
- **Stays on the old core** until the package covers it: `bodyFormat: form|text`,
  wrappers that accept several methods, OAuth2 token minting, and the Cortex
  index hook. Falling back per wrapper is safer than a silent behaviour change.

## Rollback

Turn the switch off and revert the dependency. The wrapper files and the bridge
contract are untouched, so rollback is not a data migration.

## Verification

```bash
npx tsc --noEmit
npm run test:mcp:contract
npm run test:wrap
npm run test:wrap:live
```

## Open decisions

- Wildcard hosts in secret bindings (core currently allows one exact host).
- Whether the adapter or the core owns the `WrapRunResult` rendering.
- When the package is published to npm, replace the pinned git dependency with a
  version range.
