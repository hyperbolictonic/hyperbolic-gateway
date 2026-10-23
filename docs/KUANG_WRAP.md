# Kuang Wrap — design notes

**Status:** active development, branch `feat/kuang-wrap`. Slice 0 (the pure
recipe library), slice 1 (wrapper store, executor, bridge routes, and the
`kuang-wrap` MCP server), and the rotating bridge-token gate are implemented.
Secrets are **not** enabled yet; anything marked *planned* is not shipped.

Kuang Wrap is a second MCP server that lets an agent turn a REST endpoint into
a saved, typed tool: a wrapper for the request, a recipe for the response, and
a secret reference for the credential. It is the other half of the browser:
HTML for humans, JSON for agents.

## Shape

```
Agent ──stdio──▶ kuang-wrap ──HTTP──▶ localhost bridge ──▶ WrapService (main)
                    │                                      ├─ wrapper store
                    │                                      ├─ secret store (safeStorage)
                    └─ tools/list + list_changed            ├─ HTTP executor
                                                           └─ recipe → Markdown
```

| Layer | Owns | Never owns |
| --- | --- | --- |
| `packages/recipe` | Pure JSON → Markdown translation | Network, files, secrets, Electron |
| `src/main/wrap` | Wrappers, secrets, execution, audit | MCP protocol |
| `src/mcp/wrap-server.ts` | MCP tool surface, dynamic tool list | Credentials, parsing rules |
| Bridge | Local routing + auth token | Long-lived state |

The MCP process is stateless. It asks the app for the manifest and forwards
calls. **Secrets never enter the MCP process.** That is the whole security
model in one sentence.

## Non-goals for v1

- OAuth2 flows and token refresh (static bearer/header/basic first).
- A standalone daemon that runs without the Kuang app.
- GraphQL, gRPC, WebSocket subscriptions.
- Binary downloads (the existing download manager owns that).
- Arbitrary JavaScript in recipes or request templates.
- Cloud sync of wrappers or secrets.

## Agent-facing surface

The wrapper is a **projection** of the API, not a mirror of it. The agent
should never assemble a URL, a header set, or a body JSON unless the wrapper
author explicitly exposes a raw body. The wrapper author — human or agent —
does that work once; every call is a short, typed argument list.

1. **Semantic inputs, flat arguments.** `customer_id`, `items`, `note`; not
   `{ data: { attributes: { … } } }`. The MCP `inputSchema` carries the types,
   descriptions, enums, defaults, and examples.
2. **One action, one tool.** `wrap_orders_create` beats a generic
   `wrap_request(url, method, body)` for discoverability and token cost. Until
   generated tools land in S4, the stable `wrap_run { id, args }` meta-tool is
   the call path; the id names the action, and `wrap_get` carries the schema.
3. **Deterministic mapping.** `request.body` is a template. The same arguments
   always produce the same request. There is no model-authored JSON.
4. **Preview before mutation.** A dry run returns the exact URL, headers
   (redacted), and body without sending it.
5. **Dual output.** Markdown for reading, `records` for querying. The agent
   asks for `format: "json"` instead of parsing the Markdown.
6. **Token budget is part of the contract.** Only declared fields, caps on
   items and characters, and a compact `wrap_list`.
7. **Errors are actionable.** Status, code, field, retryable, and a short hint;
   never a full HTML error page.

### POST, the simple path

A create wrapper:

```json
{
  "schemaVersion": 1,
  "id": "orders.create",
  "name": "Create order",
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v1/orders",
    "body": {
      "customer": "{{customer_id}}",
      "line_items": "{{items}}",
      "note": "{{note}}"
    }
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "customer_id": { "type": "string", "description": "Customer ID" },
      "items": {
        "type": "array",
        "description": "Line items",
        "items": {
          "type": "object",
          "properties": {
            "sku": { "type": "string" },
            "qty": { "type": "integer", "minimum": 1 }
          },
          "required": ["sku", "qty"]
        }
      },
      "note": { "type": "string", "description": "Optional note" }
    },
    "required": ["customer_id", "items"],
    "additionalProperties": false
  },
  "mutating": true,
  "response": {
    "schemaVersion": 1,
    "select": "$",
    "mode": "document",
    "record": { "id": "id", "status": "status", "total": "total" },
    "fields": {
      "Order": "id",
      "Status": "status",
      "Total": { "path": "total", "format": "number" }
    }
  }
}
```

The agent sees a tool with three arguments and calls it:

```json
wrap_orders_create({
  "customer_id": "cus_123",
  "items": [{ "sku": "A-1", "qty": 2 }],
  "note": "gift"
})
```

The app sends exactly:

```http
POST /v1/orders
Content-Type: application/json

{"customer":"cus_123","line_items":[{"sku":"A-1","qty":2}],"note":"gift"}
```

In S1 the agent never sees the URL, headers, or body envelope, but there is no
credential yet. S2 adds the secret reference and the authorization header in
the main process.

The agent saw a create-order action with a customer, line items, and an
optional note.

### Interpolation rules

| Template | Input | Result |
| --- | --- | --- |
| `"{{items}}"` (whole string) | array/object/number/boolean | inserted with its JSON type |
| `"Order for {{customer_id}}"` (embedded) | string | text interpolation |
| `"{{note}}"` | omitted/`undefined` | key omitted from the body |
| `"{{note}}"` | explicit `null` | `null`, if the schema allows it |
| `"{{q}}"` in `query` | string | URL-encoded |
| `"{{tag}}"` in `query` | array | repeated `tag=a&tag=b` |
| `"{{value}}"` in `headers` | string | value only; header names are fixed |

No expressions, no `eval`, no model-generated JSON. If an API truly needs a
free-form body (for example an Elasticsearch query DSL), the wrapper opts in
with `body: "{{body}}"` and an input of `type: "object"`; that is explicit,
visible in the schema, and still previewable.

### The agent loop

```
wrap_list                     # what can I do? one line per wrapper
wrap_get { id }               # full input schema, request template, recipe
wrap_test { id, args }        # dry-run the exact request (default)
wrap_run { id, args }         # execute; add format: "json" for records
  └─ mutating? wrap_test first
result.markdown               # what to read
result.records                # what to filter, store, or return as JSON
```

`wrap_list` returns only `id`, a one-line description, method + host, and the
required argument names. `wrap_get` returns the full schema when the agent
needs it. That keeps discovery cheap.

## Trying S1

```bash
npm run build:mcp        # writes bin/mcp-server.cjs and bin/wrap-server.cjs
npm run test:wrap        # 12 offline store/executor tests
```

Open Settings → MCP Clients, choose **REST wrappers (kuang-wrap)** as the
server, then copy the snippet into the agent client. The snippet includes
`KUANG_WRAP_TOKEN_FILE`, which the server reads on each call. The Cyberdeck must
be running; the wrap server only forwards to the existing local bridge.

A first loop with a public API:

```
wrap_create { wrapper: { id, name, request, inputSchema, response } }
wrap_test   { id, args }        # dry run: exact method, URL, headers, body
wrap_run    { id, args }        # live; add format: "json" for records
```

## Wrapper spec

A wrapper is a small JSON document. `request` is executed; `response` is a
[recipe](../packages/recipe/README.md); `inputSchema` is the MCP input schema.

```json
{
  "schemaVersion": 1,
  "id": "weather.current",
  "name": "Current weather",
  "description": "Current conditions for a city.",
  "request": {
    "method": "GET",
    "url": "https://api.example.com/v1/weather",
    "query": { "q": "{{city}}" },
    "headers": { "Accept": "application/json" },
    "timeoutMs": 15000
  },
  "inputSchema": {
    "type": "object",
    "properties": { "city": { "type": "string" } },
    "required": ["city"]
  },
  "response": {
    "schemaVersion": 1,
    "select": "$.current",
    "mode": "document",
    "record": {
      "city": "location.name",
      "temp_c": "temp_c",
      "updated": "last_updated"
    },
    "fields": {
      "City": "location.name",
      "Temperature": { "path": "temp_c", "format": "number", "suffix": " °C" },
      "Updated": { "path": "last_updated", "format": "date" }
    }
  },
  "exposeAsTool": false,
  "mutating": false
}
```

- `{{name}}` interpolation in `url`, `query`, and `headers` is limited to
  validated input properties. There is no expression language.
- `auth` is reserved for S2 and is a **secret name**, never a value. This build
  rejects any non-empty `auth` field, credential-shaped headers
  (`Authorization`, `X-Api-Key`, cookies, and similar), and credential-shaped
  query keys (`api_key`, `token`, `password`, and similar), so a wrapper cannot
  smuggle a literal credential into a saved file.
- `mutating` defaults to `true` for `POST`/`PUT`/`PATCH`/`DELETE`. Read-only
  wrappers are the default; mutating calls can require human approval.
- `exposeAsTool` is stored but not acted on until S4. Generated tools will be
  opt-in, capped, and namespaced.

## Recipes

The translation layer is `packages/recipe`, a pure ESM package with no
dependencies. It exports `deriveRecipe`, `renderRecipe`, `resolvePath`,
`renderTemplate`, `validateRecipe`, and the format types. The JSON Schema is
[`recipe.schema.json`](../packages/recipe/schema/recipe.schema.json).

It deliberately has no `eval`, no network and no clock. That makes it safe to
run on untrusted API responses, easy to test with Node's built-in runner, and
publishable on its own later.

`renderRecipe` returns `markdown`, `records`, `documents`, and `meta`.
`records` is the queryable projection (`recipe.record` names the keys) with
original JSON types. In `documents` mode each entry is
`{ title, markdown, record }`. There is no Markdown → JSON parser: the
executor can return the records directly with `format: "json"`, which is
lossless and cheaper.

**Packaging decision:** monorepo now, standalone repository/package when the
format has survived a few real APIs unchanged or a second consumer appears.
The package boundary is enforced by imports: nothing in `packages/recipe` may
import Electron or MCP.

## Secrets (planned, S2)

No secret route ships in S1. Everything in this section is the target design.

| Rule | Why |
| --- | --- |
| Secrets are written only from Settings over IPC | An agent must not be able to create or read a credential |
| `safeStorage` encrypts at rest in main | DPAPI / Keychain / libsecret, no custom crypto |
| Agents see names and allowed hosts, never values | A future `wrap_secret_list` returns metadata only |
| A secret is bound to `allowedHosts` | A wrapper cannot attach it to an attacker's host |
| Binding a secret to a host is human-only | Prevents agent-authored exfiltration |
| No auth on cross-origin redirects | Prevents a 302 from leaking a token |
| No credentials in query strings | Query strings end up in logs and proxies |
| Audit log records method, host, status, bytes | Debugging without storing headers or bodies |

**Prerequisite (done):** every `/wrap/*` route now requires a rotating bearer
token. The token is generated on each app start, written to
`<userData>/wrap/token` with owner-only permissions, and the MCP config carries
`KUANG_WRAP_TOKEN_FILE` (the path), not the value. The wrap server reads the
file per call, so a long-lived MCP process survives an app restart. Without a
valid token the bridge returns 401 and never touches a wrapper.

On Linux, `safeStorage.getSelectedStorageBackend()` can return `basic_text`
when no keyring is available. Detect it and warn; do not pretend the secret is
protected.

## Execution policy

- Schemes: `https` by default. Plain `http` is rejected unless
  `KUANG_WRAP_ALLOW_HTTP=1` or the private-host escape hatch is enabled.
- Block `file:`, `ftp:`, `data:`, and anything that is not HTTP(S).
- Resolve the host and refuse loopback, private, link-local, unique-local, and
  cloud metadata addresses (`169.254.169.254`, `fd00::/8`, …). Local
  development APIs are legitimate but opt-in with `KUANG_WRAP_ALLOW_PRIVATE=1`.
- Redirects: maximum 5; re-check the scheme and address on every hop. S2 will
  drop `Authorization` when the origin changes.
- Response cap: 5 MB; timeout 15 s (per wrapper, capped at 60 s).
- Retries and a per-host concurrency queue are planned; S1 sends one request.
- Redact `Authorization`, `Cookie`, `Set-Cookie`, and other credential-shaped
  keys from bridge logs, previews, and errors.
- Residual risk: DNS is checked before `fetch`, which resolves again. A
  hostile DNS server could rebind between the two. Pinning the checked address
  in the socket is required before credentials ship in S2.

## MCP surface

Meta-tools (always present):

| Tool | Purpose |
| --- | --- |
| `wrap_list` | List wrappers: id, name, method, host, required arguments |
| `wrap_get` | Read one wrapper definition (no secret values) |
| `wrap_create` | Validate and save a wrapper |
| `wrap_update` | Replace a saved wrapper |
| `wrap_delete` | Remove a wrapper |
| `wrap_run` | Execute by id with flat arguments; Markdown, records, or both |
| `wrap_test` | Dry-run, or render a sample response without sending |
| `wrap_reload` | Re-read the manifest after an external edit |

Generated tools are planned for S4: one `wrap_<id>` per wrapper **only** when
`exposeAsTool` is true, capped at 40, with `sendToolListChanged()` after a
mutation. S1 keeps the surface at eight meta-tools.

S1 returns Markdown text; `format: "json"` returns the record array. Structured
`structuredContent` and document passthrough are planned.

## Bridge routes

All under `/wrap` on the existing 127.0.0.1 bridge. Every route requires the
rotating bridge token described below. Secret management will stay IPC-only
and will never be exposed here.

| Route | Body | Result |
| --- | --- | --- |
| `GET /wrap/manifest` | — | `{ wrappers: [{ id, name, method, host, required, … }] }` |
| `GET /wrap/status` | — | wrapper count and whether private hosts are allowed |
| `GET /wrap/wrapper?id=…` | — | one full wrapper |
| `POST /wrap/run` | `{ id, args, format? }` | `{ ok, status, markdown, records, request, … }` |
| `POST /wrap/test` | `{ wrapper?, id?, args?, sample?, dryRun? }` | preview or sample render; nothing saved |
| `POST /wrap/wrappers` | `{ action: "create"\|"update"\|"delete"\|"get", wrapper? , id? }` | saved wrapper or error list |
| `GET /wrap/audit?limit=50` | — | planned (S2) |

### Bridge token

- Generated in main on every app start (`crypto.randomBytes(32)`, 64 hex
  characters) and written to `<userData>/wrap/token`.
- The MCP client config gets `KUANG_WRAP_TOKEN_FILE`; the server reads the file
  on each call and sends `Authorization: Bearer <token>`.
- `X-Kuang-Wrap-Token` is accepted as an alternative header.
- Missing or stale tokens get `401 { code: "UNAUTHORIZED" }`; the MCP error
  tells the user to refresh the client config or restart the app.
- The token is a local capability, not an upstream credential. It is safe for
  the MCP process to hold; API secrets will not be.

## Storage

```
<userData>/wrap/
  wrappers/<id>.json      one file per wrapper, atomic write (tmp + rename)
  recipes/<id>.json       planned: reusable response recipes
  secrets.enc             planned: safeStorage ciphertext, main process only
  audit.jsonl             planned: append-only, redacted
```

Every wrapper carries `schemaVersion`. S1 normalises to the known fields;
unknown top-level fields are dropped, so add a field to the spec before relying
on it. No credentials ever appear in `wrappers/`.

## Packaging

- `bin/wrap-server.cjs`, built by `build:mcp` next to `mcp-server.cjs`.
- `bin/**/*` is already in `asarUnpack`; the userData copy step copies both
  binaries and refreshes them on update.
- Settings → MCP Clients has a Server selector: Browser (`kuang`) or REST
  wrappers (`kuang-wrap`), with the same bundled-runtime / system-Node switch
  and bridge URL. The wrap snippet sets `KUANG_WRAP_TOKEN_FILE`.
- `KUANG_WRAP_ALLOW_PRIVATE=1` permits localhost/private destinations;
  `KUANG_WRAP_ALLOW_HTTP=1` permits plain http; `KUANG_MCP_LOG=0` silences the
  wrap server file log; `KUANG_WRAP_TIMEOUT_MS` overrides its bridge timeout.
- The recipe library is bundled into main and is not a runtime dependency of
  the MCP server. It has no dependencies of its own, so until it is linked into
  the pnpm workspace it is imported by relative path and tested directly with
  Node's runner.

## Slices

| Slice | Scope | Gate |
| --- | --- | --- |
| **S0** ✅ | Pure recipe package, schema, tests, design | 25 tests pass, typecheck clean |
| **S1** ✅ | Wrapper store, executor, `/wrap/*`, `kuang-wrap` MCP server, create/update/delete, dry-run and sample tests | 14 core tests pass; a live GitHub API call returned Markdown and records; no secrets exist yet |
| **S2a** ✅ | Rotating wrap bridge token, token-file handoff, 401 gate | Missing/stale token gets 401 before any wrapper or outbound request |
| **S2** | `safeStorage`, host binding, Settings → Wrappers, audit | Exfiltration test: agent-created wrapper cannot attach a secret to a foreign host |
| **S3** | Derived recipes, save/reuse, documents mode, pagination, Cortex indexing | A paginated API returns all pages up to the cap; documents are searchable |
| **S4** | Generated tools, `sendToolListChanged`; MCP Clients entry and docs are already in S1 | 40-tool cap holds; client sees a new tool without restart |
| **S5** | OAuth2 client credentials, expiry HIL, `lastVerified` | Expired token produces a human-action request, not a silent 401 loop |

## Threat model

| Threat | Control |
| --- | --- |
| Agent creates a wrapper pointing at an attacker host and attaches a secret | Host-bound secrets; human-only binding; no cross-origin auth redirect |
| Local process calls the bridge and spends tokens | Rotating token, read from a user-private file; every `/wrap/*` route returns 401 without it. |
| SSRF into localhost or cloud metadata | Scheme + DNS/IP checks; private hosts require `KUANG_WRAP_ALLOW_PRIVATE=1`. DNS rebinding stays open until S2 pins the checked address. |
| Credential leaks into logs | S1 redacts credential-shaped keys in bridge logs and request previews; a no-leak test lands with S2. |
| Prompt injection inside an API response | Response is data; it is rendered, never executed |
| Tool-list exhaustion | Eight meta-tools in S1; opt-in generated tools + cap in S4 |
| Schema drift breaks a wrapper | `wrap_test` and clear upstream errors; `lastVerified` is stored but not refreshed yet |
| Linux has no keyring | Detect `basic_text`; warn and refuse secrets if requested |

## Open questions

1. Should a wrapper be runnable headless (without the Electron app)? Not in v1.
   The separate MCP binary keeps that door open.
2. Secret scope: host-only, or host + wrapper? Start host-only; add an optional
   wrapper scope if a shared host needs separate credentials.
3. Should `POST` require human approval by default? Leaning yes for the first
   call per wrapper per session; read-only remains frictionless.
4. Where do parsed documents go? Return them first; Cortex indexing is opt-in
   per recipe because it costs embeddings and disk.
5. Do we expose generated tools by default? No. Meta-tools are enough until a
   wrapper is stable.

## Decision log

- **2026-10-23** — Recipe engine is a pure package; monorepo first, standalone
  later. No Electron or MCP imports.
- **2026-10-23** — Kuang Wrap is a second **stdio MCP server**, not a second
  HTTP service. It shares the app's bridge and lifecycle.
- **2026-10-23** — No separate port in v1. Isolation comes from a route
  namespace and an auth token, not a second daemon.
- **2026-10-23** — Secrets live in main behind `safeStorage`; the MCP process
  never sees a value.
- **2026-10-23** — Ship the bridge token before the first secret, not after.
- **2026-10-23** — S1 keeps the MCP surface at eight meta-tools and forwards
  every call over the existing 127.0.0.1 bridge. The wrapper server has no
  file-system or secret access; the store and executor live in main.
- **2026-10-23** — Plain `http` and private addresses are opt-in, not defaults.
  The bridge body log and request previews redact credential-shaped keys even
  though S1 has no credentials yet.
- **2026-10-23** — The bridge token rotates on app start. MCP configs carry the
  token *file path*, not the token, so the wrap server can survive a restart and
  no copied secret goes stale.
