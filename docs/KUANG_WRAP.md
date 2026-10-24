# Kuang Wrap — design notes

**Status:** active development, branch `feat/kuang-wrap`. Slices 0–4 are
implemented: the pure recipe library, wrapper store/executor, the `kuang-wrap`
MCP server, the rotating bridge-token gate, encrypted host-bound credentials with
a human-only Settings → Wrappers editor, recipe pagination (offset/cursor/link,
page- and item-capped), documents mode, recipe derivation (`wrap_derive`), opt-in
**Cortex indexing**, and opt-in **generated `wrap_<id>` tools** (capped at 40, with
live `tools/list_changed`). Still planned: OAuth/token refresh and human approval
for mutating calls.

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
   `wrap_request(url, method, body)` for discoverability and token cost. A wrapper
   with `exposeAsTool: true` becomes exactly that (`wrap_<id>`); otherwise the stable
   `wrap_run { id, args }` meta-tool is the call path.
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
Authorization: Bearer <from the host-bound secret store>

{"customer":"cus_123","line_items":[{"sku":"A-1","qty":2}],"note":"gift"}
```

The agent never saw the URL, the authorization value, or the body envelope.
The wrapper references `"auth": "orders-key"` by name; main resolved it only
because the request host matched that secret's allowed hosts.

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
wrap_secret_list              # credential names + allowed hosts; never values
wrap_test { id, args }        # dry-run the exact request (default)
wrap_run { id, args }         # execute; add format: "json" for records
  └─ mutating? wrap_test first
result.markdown               # what to read
result.records                # what to filter, store, or return as JSON
```

`wrap_list` returns only `id`, a one-line description, method + host, and the
required argument names. `wrap_get` returns the full schema when the agent
needs it. That keeps discovery cheap.

## Trying it

```bash
npm run build:mcp        # writes bin/mcp-server.cjs and bin/wrap-server.cjs
npm run test:wrap        # 41 offline store/executor/secret/pagination/indexing/schema tests
npm run test:wrap:mcp    # 11 generated-tool lifecycle checks over a real MCP client
npm run test:wrap:live   # 46 live checks against DummyJSON (needs the app; inline wrappers, nothing saved)
```

Open Settings → MCP Clients, choose **REST wrappers (kuang-wrap)** as the
server, then copy the snippet into the agent client. The snippet includes
`KUANG_WRAP_TOKEN_FILE`, which the server reads on each call. The Cyberdeck must
be running; the wrap server only forwards to the existing local bridge.

Open Settings → Wrappers to browse and edit saved wrappers and to add
credentials. A credential is write-only; editing it with a blank value keeps
the current ciphertext and only changes hosts/header metadata.

A first loop with a public API:

```
wrap_create { wrapper: { id, name, request, inputSchema, response } }
wrap_test   { id, args }        # dry run: exact method, URL, headers, body
wrap_run    { id, args }        # live; add format: "json" for records
```

For an authenticated API, a human adds a secret in Settings → Wrappers and
binds it to the API host. The wrapper uses `"auth": "<name>"`; agents can call
`wrap_secret_list` to discover names, but never see values.

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
    "auth": "weather-key",
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
- `auth` is a **secret name**, never a value. Main resolves it at request time
  and refuses unless the URL host is one of the secret's human-authored
  `allowedHosts`. Wrappers may not set credential-shaped headers
  (`Authorization`, `X-Api-Key`, cookies, and similar) or credential-shaped
  query keys (`api_key`, `token`, `password`, and similar), so a literal
  credential cannot be smuggled into a saved file.
- `mutating` defaults to `true` for `POST`/`PUT`/`PATCH`/`DELETE`. Read-only
  wrappers are the default; mutating calls can require human approval.
- `exposeAsTool` opts the wrapper into a generated `wrap_<id>` MCP tool (S4): it is
  registered at server start and after any create/update/delete, capped at 40.

## Pagination

A recipe may declare `pagination`; the executor then follows pages and merges them into
**one** render, so an agent gets one table instead of N tables with repeated headings.

```json
"pagination": {
  "type": "offset",
  "limitParam": "limit",
  "offsetParam": "skip",
  "pageSize": 10,
  "hasMore": "total"
}
```

| `type` | Next page comes from | Stops when |
| :--- | :--- | :--- |
| `offset` | `offsetParam` + `limitParam`, advanced by `pageSize` | a page is shorter than `pageSize`, `hasMore` is false/0, or a cap is hit |
| `cursor` | `next` (path to the next token), sent as `cursorParam` | `next` is missing/null/empty |
| `link` | `nextUrl` (path to the next absolute URL) | `nextUrl` is missing, or points off-origin |
| `none` | — | single request (default) |

Rules:

- **Page cap.** `maxPages` defaults to 10 (hard max 25). `wrap_run { max_pages }` overrides
  it per call; the footer reports `pages n/cap (+more)`.
- **Item cap.** `recipe.limits.maxItems` (default 50) bounds the merged result, and paging
  stops once it is reached.
- **List selections only.** Auto-paging applies when `select` resolves to an array; a
  document selection stays a single request.
- **One audit row per page**, with the same redaction rules as any other call.
- **Merging.** Page lists are concatenated and rendered once (the recipe's `select` is
  re-pointed at the merged list). If the selection is not a list, the per-page renders are
  joined with `---` instead.
- **No new SSRF surface.** Every page URL still goes through `assertSafeUrl`, and a `link`
  page must share the first request's origin — a hostile `next` cannot move the injected
  credential to another host.

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

## Deriving a recipe

`wrap_derive` infers a first-draft recipe from a real response, so you never start
from a blank page:

```
wrap_derive { sample }                                   # object, array, or JSON string
wrap_derive { url }                                      # policy-checked GET, then derive
wrap_derive { sample, max_fields: 6, id, name, description }
```

It picks the first array it recognises (`items`, `results`, `data`, `records`, …,
then any top-level array), takes up to `max_fields` primitive fields from the first
item, and chooses `table` for arrays or `document` for objects. The URL form runs
through the same outbound policy as any wrapper (https, no private hosts) and never
attaches a secret.

The result is a **recipe, not a wrapper**: pass it as `response` to `wrap_create`
(or `wrap_update`, then `wrap_reload`). Edit it afterwards — derivation is
deliberately shallow.

## Cortex indexing (opt-in)

A recipe can ask the executor to store its rendered output in the local **Cortex**, so
`recall_memory` finds it later:

```json
"response": {
  "schemaVersion": 1,
  "mode": "documents",
  "select": "$.items",
  "title": "{{title}}",
  "template": "{{body}}",
  "index": "cortex"
}
```

- **One page per rendered document** in documents mode; otherwise **one page for the whole
  rendered result**, so a 50-row table does not become 50 embeddings. Capped at 50
  documents per run.
- Indexing runs **after** a successful, non-dry call and only when `index: "cortex"`. A dry
  run, an HTTP error, or a recipe without `index` writes nothing.
- **Best-effort:** if Cortex is unavailable the call still succeeds; the result carries
  `indexed.error` and the footer says `index failed: …` instead of `indexed N docs`.
- Chunks use the same chunker/embedder as browsed pages, landing in `page_history` with the
  wrapper's request URL as `url` and the document title as `title`.

## Secrets

Secrets are implemented in main. The Settings → Wrappers panel is the only
writer; the MCP process and the bridge see names and metadata only.

| Rule | Why |
| --- | --- |
| Secrets are written only from Settings over IPC | An agent must not be able to create, read, or bind a credential |
| `safeStorage` encrypts at rest in main | DPAPI / Keychain / libsecret, no custom crypto |
| Agents see names and allowed hosts, never values | `wrap_secret_list` returns metadata only |
| A secret is bound to `allowedHosts` | A wrapper cannot attach it to an attacker's host |
| Binding a secret to a host is human-only | Prevents agent-authored exfiltration |
| No auth on cross-origin redirects | The injected header is dropped when the origin changes |
| No credentials in query strings | Query strings end up in logs and proxies |
| Upstream responses are scrubbed for the injected value | A debug/echo endpoint must not reflect the token back to the agent |
| Audit log records method, host, status, bytes | Debugging without storing headers, bodies, or query strings |

A secret is write-only in the UI. Editing it with a blank value preserves the
ciphertext and lets a human change only the allowed hosts, header, or prefix.
The bridge's `/wrap/secrets` route is read-only metadata; there is no HTTP or
MCP route that sets a value.

**Prerequisite (done):** every `/wrap/*` route requires a rotating bearer
token. The token is generated on each app start, written to
`<userData>/wrap/token` with owner-only permissions, and the MCP config carries
`KUANG_WRAP_TOKEN_FILE` (the path), not the value. The wrap server reads the
file per call, so a long-lived MCP process survives an app restart. Without a
valid token the bridge returns 401 and never touches a wrapper.

On Linux, if `safeStorage.getSelectedStorageBackend()` returns `basic_text`,
secrets are disabled and the panel explains how to fix the keyring. The app does
not pretend that `basic_text` is encryption.

## Execution policy

- Schemes: `https` by default. Plain `http` is rejected unless
  `KUANG_WRAP_ALLOW_HTTP=1` or the private-host escape hatch is enabled.
- Block `file:`, `ftp:`, `data:`, and anything that is not HTTP(S).
- Resolve the host and refuse loopback, private, link-local, unique-local, and
  cloud metadata addresses (`169.254.169.254`, `fd00::/8`, …). Local
  development APIs are legitimate but opt-in with `KUANG_WRAP_ALLOW_PRIVATE=1`.
- Redirects: maximum 5; re-check the scheme and address on every hop. An
  injected credential header is dropped when the origin changes.
- Response cap: 5 MB; timeout 15 s (per wrapper, capped at 60 s).
- Retries and a per-host concurrency queue are planned; the executor sends one
  request.
- Redact `Authorization`, `Cookie`, `Set-Cookie`, and other credential-shaped
  keys from bridge logs, previews, errors, and audit rows. Secret values are
  decrypted only in main and never written to a wrapper file.
- Residual risk: DNS is checked before `fetch`, which resolves again. A hostile
  DNS server could rebind between the two. Pinning the checked address in the
  socket is the next hardening step; it is not yet implemented.

## MCP surface

Meta-tools (always present):

| Tool | Purpose |
| --- | --- |
| `wrap_list` | List wrappers: id, name, method, host, required arguments, secret name |
| `wrap_get` | Read one wrapper definition (no secret values) |
| `wrap_derive` | Infer a first-draft recipe from a JSON sample or a live URL |
| `wrap_secret_list` | Credential names, headers, and allowed hosts only |
| `wrap_create` | Validate and save a wrapper |
| `wrap_update` | Replace a saved wrapper |
| `wrap_delete` | Remove a wrapper |
| `wrap_run` | Execute by id with flat arguments; Markdown, records, or both |
| `wrap_test` | Dry-run, or render a sample response without sending |
| `wrap_reload` | Re-read the manifest after an external edit |

A wrapper with `exposeAsTool: true` is also registered as its own tool, named
`wrap_<id>` with every character outside `[A-Za-z0-9_-]` replaced by `_`
(`dummyjson.auth.me` → `wrap_dummyjson_auth_me`), taking the wrapper's declared
arguments as a typed Zod schema (converted from its JSON Schema). Generated tools are
capped at 40 (first by id); the rest stay callable through `wrap_run`.
Create/update/delete and `wrap_reload` reconcile the set, and the SDK emits
`tools/list_changed`, so a connected client sees the change without a restart. They
belong to `kuang-wrap` only — the browser server's tool list is untouched.

Results are Markdown text; `format: "json"` returns the record array.
`structuredContent` and document passthrough are planned.

## Bridge routes

All under `/wrap` on the existing 127.0.0.1 bridge. Every route requires the
rotating bridge token described below. Secret **writes** are IPC-only; the
bridge exposes read-only metadata.

| Route | Body | Result |
| --- | --- | --- |
| `GET /wrap/manifest` | — | `{ wrappers: [{ id, name, method, host, required, secret, … }] }` |
| `GET /wrap/status` | — | wrapper count and whether private hosts are allowed |
| `GET /wrap/wrapper?id=…` | — | one full wrapper |
| `GET /wrap/secrets` | — | names, headers, allowed hosts, availability; never values |
| `POST /wrap/run` | `{ id, args, format? }` | `{ ok, status, markdown, records, request, … }` |
| `POST /wrap/test` | `{ wrapper?, id?, args?, sample?, dryRun?, maxPages? }` | preview or sample render; nothing saved |
| `POST /wrap/derive` | `{ sample?, url?, id?, name?, description?, max_fields? }` | `{ source, recipe }`; the URL form is a policy-checked GET |
| `POST /wrap/wrappers` | `{ action: "create"\|"update"\|"delete"\|"get", wrapper? , id? }` | saved wrapper or error list |
| `GET /wrap/audit?limit=50` | — | redacted audit rows |

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
  secrets.json            metadata + safeStorage ciphertext, main process only
  audit.jsonl             append-only, redacted, one row per outbound call
  token                   rotating bridge token, owner-only permissions
```

Every wrapper carries `schemaVersion`. The validator normalises to the known
fields; unknown top-level fields are dropped, so add a field to the spec before
relying on it. No credential values ever appear in `wrappers/`; `secrets.json`
contains ciphertext only. Recipes are embedded in the wrapper for now; a
separate reusable recipe store is planned.

## Packaging

- `bin/wrap-server.cjs`, built by `build:mcp` next to `mcp-server.cjs`.
- `bin/**/*` is already in `asarUnpack`; the userData copy step copies both
  binaries and refreshes them on update.
- Settings → MCP Clients has a Server selector: Browser (`kuang`) or REST
  wrappers (`kuang-wrap`), with the same bundled-runtime / system-Node switch
  and bridge URL. The wrap snippet sets `KUANG_WRAP_TOKEN_FILE`.
- Settings → Wrappers has two tabs:
  - **Wrappers**: a filterable list and a reusable create/edit modal with name,
    ID, method, URL, credential picker, mutating switch, and advanced JSON for
    the input schema, query/headers/body templates, and response recipe. The
    modal can create a new credential inline.
  - **Credentials**: the central vault, with add/edit/delete and host bindings.
  Both use IPC; no bridge route can write a secret.
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
| **S1** ✅ | Wrapper store, executor, `/wrap/*`, `kuang-wrap` MCP server, create/update/delete, dry-run and sample tests | 21 core tests now pass; a live GitHub API call returned Markdown and records |
| **S2a** ✅ | Rotating wrap bridge token, token-file handoff, 401 gate | Missing/stale token gets 401 before any wrapper or outbound request |
| **S2** ✅ | `safeStorage`, host binding, Settings → Wrappers editor, audit | Unit tests prove a foreign-host secret is refused and a cross-origin redirect drops the injected header |
| **S3** ✅ | Derived recipes (`wrap_derive`), documents mode, pagination (offset/cursor/link, page- and item-capped), and opt-in Cortex indexing | A paginated API returns all pages up to the cap ✅; documents are searchable ✅ |
| **S4** ✅ | Generated tools, `sendToolListChanged`; MCP Clients entry and docs are already in S1 | 40-tool cap holds ✅; client sees a new tool without restart ✅ |
| **S5** | OAuth2 client credentials, expiry HIL, `lastVerified` | Expired token produces a human-action request, not a silent 401 loop |

## Threat model

| Threat | Control |
| --- | --- |
| Agent creates a wrapper pointing at an attacker host and attaches a secret | Host-bound secrets; human-only binding; no cross-origin auth redirect |
| Local process calls the bridge and spends tokens | Rotating token, read from a user-private file; every `/wrap/*` route returns 401 without it. |
| SSRF into localhost or cloud metadata | Scheme + DNS/IP checks; private hosts require `KUANG_WRAP_ALLOW_PRIVATE=1`. DNS rebinding remains a residual risk until the checked address is pinned in the socket. |
| A paginated `next` link points at an attacker host | `link` pagination is same-origin only; every page URL is re-checked by `assertSafeUrl` before it is fetched |
| Credential leaks into logs or responses | Bridge logs and previews redact credential-shaped keys; an upstream response that echoes a secret is redacted before rendering; audit rows store host/status/bytes only; tests assert values are absent. |
| Prompt injection inside an API response | Response is data; it is rendered, never executed |
| Tool-list exhaustion | Ten meta-tools plus opt-in generated tools, capped at 40 |
| Schema drift breaks a wrapper | `wrap_test` and clear upstream errors; `lastVerified` is stored but not refreshed yet |
| Linux has no keyring | Detect `basic_text`; warn and refuse secrets if requested |

## Open questions

1. Should a wrapper be runnable headless (without the Electron app)? Not in v1.
   The separate MCP binary keeps that door open.
2. Secret scope: host-only is shipped. Add an optional wrapper scope if a
   shared host needs separate credentials.
3. Should `POST` require human approval by default? Leaning yes for the first
   call per wrapper per session; read-only remains frictionless.
4. ~~Where do parsed documents go?~~ **Shipped:** returned inline and, when a recipe sets
   `index: "cortex"`, also written to Cortex — opt-in because it costs embeddings and disk.
5. ~~Do we expose generated tools by default?~~ **Shipped:** no — opt-in per wrapper
   (`exposeAsTool`), capped at 40, with `tools/list_changed` on change.

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
- **2026-10-23** — The MCP surface stays at nine meta-tools and forwards every
  call over the existing 127.0.0.1 bridge. The wrapper server has no
  file-system or credential-value access; the store, secret store, and executor
  live in main.
- **2026-10-23** — Plain `http` and private addresses are opt-in, not defaults.
  The bridge body log, request previews, and audit rows redact credential-shaped
  keys and values.
- **2026-10-23** — The bridge token rotates on app start. MCP configs carry the
  token *file path*, not the token, so the wrap server can survive a restart and
  no copied secret goes stale.
- **2026-10-23** — Secrets are host-bound and write-only. Settings → Wrappers
  edits wrapper JSON and credential metadata; a blank value keeps the existing
  ciphertext. The bridge exposes read-only secret metadata, never a value.
- **2026-10-23** — Audit rows contain method, host, status, bytes, duration,
  and error code only. Headers, bodies, query strings, and secret names do not
  enter the audit log.
