# anyapi-to-mcp integration

Status: **stage 2, opt-in switch.** `anyapi-to-mcp` is installed from the
registry. Wrappers run through it when `HB_WRAP_CORE=anyapi`; the legacy executor
is still the default and remains the fallback for every wrapper the package
cannot reproduce exactly. `npx tsc --noEmit`, `npm run test:anyapi`,
`npm run test:wrap` and `npm run test:mcp:contract` are green.

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
   **Done.**
2. **Opt-in switch.** `HB_WRAP_CORE=anyapi` selects the new path per process.
   Both cores remain present. **Done** — `src/main/wrap/factory.ts` chooses, and
   `src/main/wrap/anyapi/executor.ts` runs the wrappers the core can serve.
3. **Parity.** Run the existing wrapper suites against both cores, plus a live
   DummyJSON run, then make the new path the default.
4. **Delete the old executor** after one release with no regressions.

## The switch

`createWrapExecutor()` in `src/main/wrap/factory.ts` reads
`HB_WRAP_CORE` (falling back to `KUANG_WRAP_CORE`). Anything other than
`anyapi` — including unset — keeps the legacy executor. The choice is per
process, never per wrapper file, so a wrapper cannot change cores between calls.

`AnyApiWrapExecutor` hands a wrapper to the legacy executor when `coreGate()`
cannot promise the same behaviour. The gate is deliberately conservative:

| Kept on the legacy core | Why |
| --- | --- |
| `request.methods` with more than one method | The core operation has one method. |
| `bodyFormat: "form"` or `"text"` | The core only builds JSON bodies. |
| Recipe pagination | The legacy loop merges pages; the core cursors have a different shape. |
| `response.index: "cortex"` | The index hook is host-side, not part of the core. |
| `{{name|raw}}` in a URL | Projection loses the raw flag. |
| Array or object input properties | The core input contract is scalar; arrays would be coerced to a string. |
| An optional path placeholder | The core refuses an unfilled path; the legacy executor substitutes an empty segment. |
| OAuth2, wildcard or multi-host secrets | No exact-host binding can express them. |

Everything else runs on the core. When it does, the published surface is
unchanged: the same IPC channels and bridge routes, the same `WrapRunResult`
shape, the same rendering (shared with the legacy executor in
`src/main/wrap/render.ts`), and the same file layout.

Two deliberate differences remain while both cores exist:

- A live run's `request.headers` shows `<redacted>` for every value. The core
  never returns a header value, so the preview is stricter than before.
- A response over the byte cap is `RESPONSE_TOO_LARGE` instead of a truncated
  body. The core refuses rather than truncates.


## Adapter notes

- **Maps**: point `loadLocation` at `<userData>/wrap/wrappers`. Legacy wrappers
  project through the package; an invalid file is skipped, as today.
  Implemented in `src/main/wrap/anyapi/maps.ts` (read-only, adds no side effects).
- **Secrets**: implement `get(name, host)` over `SecretStore.resolve(name, host)`
  and build the package's binding table from each record's metadata. Only an
  exact single host is representable today; wildcard `allowedHosts` entries are
  refused with a reason, never widened silently. Implemented in
  `src/main/wrap/anyapi/secrets.ts`; the provider repeats the binding's host
  check before asking the store to decrypt.
- **Result mapping**: the package returns its own envelope and handles. The
  wrapper surface needs `WrapRunResult`, so the adapter renders the recipe as it
  does today and translates status/error codes. Redaction, cross-origin secret
  drop, paging and audit must keep their current guarantees. Implemented in
  `src/main/wrap/anyapi/result.ts`: rendering stays with the gateway recipe
  renderer (so the markdown and records are unchanged), the core supplies
  status/bytes, and core error codes map onto the published wrapper codes.
  Codes the old executor could not produce are explicit and new:
  `RESPONSE_TOO_LARGE`, `INVALID_RESPONSE`, `WRITE_DENIED`,
  `WRITE_NOT_CONFIRMED`, `OUTCOME_UNKNOWN`, `INVALID_CURSOR`. A core dry run
  exposes header names only, so a preview built from it shows every value as
  `<redacted>` (stricter than today).
- **Stays on the old core** until the package covers it: see the gate table
  above. Falling back per wrapper is safer than a silent behaviour change.
  The secret adapter refuses OAuth2 records for the same reason.

## Rollback

Turn the switch off and revert the dependency. The wrapper files and the bridge
contract are untouched, so rollback is not a data migration.

## Verification

```bash
npx tsc --noEmit
npm run test:mcp:contract
npm run test:wrap
npm run test:anyapi
npm run test:wrap:live
```

`npm run test:anyapi` covers both the adapters and the opt-in core
(`scripts/test-anyapi-core.mjs`): the gate, a real read, an omitted optional
argument, a dry run, host-bound secret redaction, and the legacy fallback.

## Open decisions

- Wildcard hosts in secret bindings: **refused for now** (exact single host
  only). Revisit only if a real wrapper needs one, adding dot-boundary wildcard
  bindings as a recorded decision.
- Whether the adapter or the core owns the `WrapRunResult` rendering.
- ~~When the package is published to npm, replace the pinned git dependency with
  a version range.~~ Done: `anyapi-to-mcp` comes from the registry at an exact
  version (no caret while alpha).
