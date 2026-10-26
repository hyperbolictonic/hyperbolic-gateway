# Kuang Wrap — design notes

**Status:** active development, branch `feat/kuang-wrap`. Slices 0–5 are
implemented: the pure recipe library, wrapper store/executor, the `kuang-wrap`
MCP server, the rotating bridge-token gate, encrypted host-bound credentials with
a human-only Settings → Wrappers editor, recipe pagination, documents mode,
`wrap_derive`, opt-in Cortex indexing, generated `wrap_<id>` tools, and OAuth2
client-credentials with `AUTH_REQUIRED` handling and `lastVerified`. Read
[Honest status](#honest-status-what-works-what-doesnt-what-is-untested-what-is-risky)
for what is partial, untested, and risky; the main open product decision is human
approval for mutating calls.

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

## Honest status: what works, what doesn't, what is untested, what is risky

This section is deliberately blunt. The wrapper system is a developer tool, not a hardened
API gateway; read it before pointing it at anything that matters.

### What it does and what it is for

Kuang Wrap turns a REST endpoint into a **saved, typed tool**. A wrapper is a deterministic
request template plus a response recipe; a credential is a host-bound secret that main
attaches at request time. An agent gets flat, validated arguments instead of assembling
URLs, headers, and JSON bodies, and it never sees a credential value. It is for **agent
access to JSON APIs** — dashboards, internal tools, SaaS APIs, documentation — not for
general web scraping (that is the browser) and not for streaming or binary workloads.

### What works

| Area | State |
| --- | --- |
| Request build | URL/query/header/body templates, typed JSON (numbers/booleans/arrays/objects preserved), omitted vs explicit `null`, defaults, no expression language |
| Argument validation | JSON Schema subset in main; generated tools get the same schema as Zod for the client |
| Outbound policy | HTTPS only (plain HTTP opt-in), private/loopback/link-local blocked, redirect cap + re-check, credential dropped on a cross-origin redirect, 5 MB cap, 15 s default timeout |
| Credentials | Static value, or **OAuth2 client_credentials** (mint, cache, early refresh, one forced re-mint on 401); encrypted with `safeStorage`; human-only writes; host-bound; values never enter the MCP process |
| Recipes | Table / document / documents; fields, record projection, templates; escaping, item and character caps with `meta.truncated` |
| Pagination | Offset, cursor, and link; page cap (10, max 25) and item cap; merged into one render; one audit row per page; `link` pages must stay same-origin |
| Derivation | `wrap_derive` from a JSON sample or a policy-checked URL |
| Cortex indexing | Opt-in per recipe (`index: "cortex"`); best-effort; documents mode indexes per document, otherwise one page per result |
| Generated tools | Opt-in per wrapper (`exposeAsTool`), typed args, capped by `KUANG_WRAP_MAX_TOOLS` (default 40; `0` disables), `tools/list_changed` on change |
| Verification metadata | `lastVerified` written after a successful live run and shown in `wrap_list` |
| Audit | `audit.jsonl`: method, host, status, bytes, duration, error code — no headers, bodies, or query strings |
| Tests | 50 offline, 11 generated-tool lifecycle (real MCP client), 46 live against DummyJSON |

### What does not work (or is partial)

- **There is no human-approval gate for mutating calls.** `mutating` is metadata only —
  nothing blocks or confirms a `POST`/`PUT`/`PATCH`/`DELETE`. This is an open decision, not
  an oversight (see open question 3).
- **OAuth2 supports only the `client_credentials` grant.** No authorization-code, device
  flow, PKCE, `refresh_token`, per-user tokens, token revocation, or OIDC discovery — you
  paste the token URL and client id/secret.
- **The wrap server never raises HIL itself.** A rejected credential gets one re-mint and
  then a structured `AUTH_REQUIRED` result. The *agent* has to call
  `request_human_intervention` (a browser-server tool) or a human has to update the
  credential. No desktop notification is emitted from this path.
- **`lastVerified` is a liveness signal, not a correctness proof.** It means "the upstream
  answered without an HTTP error", not "the response was right". It also rewrites the
  wrapper file on every successful run.
- **`exposeAsTool` has no Settings control.** Only an agent (`wrap_create`/`wrap_update`) or
  a hand-edited wrapper file can enable it; the editor preserves the flag but cannot set it.
- **The generated-tool cap is a context budget, not a protocol limit.** It registers the first
  `KUANG_WRAP_MAX_TOOLS` exposed wrappers (default 40, max 200, `0` disables) by **id order**,
  so there is no per-wrapper priority: a wrapper whose id sorts late can fall outside the cap
  even if it is the one you wanted. Over-cap wrappers are now reported (see the risks below).
- **Secret scope is host-only**, not per-wrapper: two wrappers on the same host share one
  credential (open question 2).
- **No retries or backoff** beyond the single auth refresh, and **no per-host concurrency
  queue** (both planned, neither built).
- **`link` pagination stops on a cross-origin next URL** instead of following it; cursor
  paging assumes the same HTTP method for every page (no POST-body cursors).
- **No response-schema validation.** A recipe maps paths; missing or renamed fields render
  empty rather than erroring.
- **No standalone daemon.** The Electron app must be running; the wrap server only forwards
  to the local bridge.
- Out of scope by design: GraphQL, gRPC, WebSocket subscriptions, binary downloads, cloud
  sync of wrappers or secrets.

### What is untested (or only tested offline)

- **OAuth2 against a real identity provider.** The tests inject a token minter; the default
  minter's form-encoded POST, policy check, and error parsing have no live test.
- **Live cursor and link pagination.** DummyJSON has no cursor API, so those paths are
  covered by offline fixtures only; the live suite exercises offset paging.
- **Cortex indexing in CI.** Verified with a one-off probe (the document was recalled as the
  top hit) rather than in the suite, so repeat runs do not accumulate embeddings.
- **The 5 MB response cap and cross-origin redirect credential-drop** are unit-tested, not
  exercised against a live hostile server.
- **The Linux keyring path** (`basic_text` detection and refusal) — developed and tested on
  Windows only.
- **Clients that ignore `tools/list_changed`** — they need a reconnect before a new
  generated tool appears; there is no fallback beyond that.
- **The Settings OAuth2 form** has no automated UI test (the repo has no renderer test
  harness).
- **No staleness policy.** `lastVerified` is displayed but nothing warns or blocks after a
  wrapper has not been verified for a long time.

### What is risky

- **DNS rebinding:** the address is checked before `fetch`, which resolves again. A hostile
  DNS server could rebind between the two; pinning the checked address in the socket is not
  implemented.
- **Prompt injection is a data problem, not a code one.** Responses are rendered, never
  executed, but a model can still be persuaded by text inside a response. Treat wrapper
  output as untrusted input.
- **Agents can author wrappers.** A secret cannot be created or bound by an agent, and it is
  only attached on hosts a human approved. But an agent *can* save a wrapper pointing at any
  public HTTPS host; if a human later binds a credential to that host, the credential goes
  there. Human binding is the boundary.
- **The token URL is not restricted by `allowedHosts`.** It is a separate, human-authored
  destination; a typo or a hostile value sends your client secret there. HTTPS and the
  private-host policy still apply, but there is no allowlist.
- **Secrets and tokens live in the main process** while in use and in encrypted files at
  rest. Anyone who can run code as your OS user (or unlock the same keychain) can decrypt
  them. That is the same trust boundary as the app itself.
- **No approval gate on writes** (above): an agent holding a write wrapper can mutate the
  upstream API.
- **The audit log is local and append-only, not tamper-proof**, and it records metadata
  only — enough to debug, not to prove what was sent.
- **The generated-tool cap** (default 40, `KUANG_WRAP_MAX_TOOLS`) selects by id order, so an
  exposed wrapper can fall outside it. `wrap_list` marks it (`tool (over cap: call wrap_run)`)
  and create/update warn, but as a *tool* it is still invisible to the agent until the cap is
  raised or another wrapper is removed.

## Non-goals for v1

- OAuth2 grants beyond client credentials (authorization-code, device flow, PKCE,
  refresh tokens, per-user tokens, discovery).
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
| `"{{path\|raw}}"` in `url` | string | slash-separated path: each segment encoded, `/` preserved; `.`, `..`, empty segments and backslashes rejected |

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
npm run test:wrap        # 50 offline store/executor/secret/pagination/indexing/schema/oauth2 tests
npm run test:wrap:mcp    # 15 generated-tool lifecycle + cap checks over a real MCP client
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
    "methods": ["GET", "POST"],
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
  validated input properties. There is no expression language. `{{path|raw}}` is a URL-only
  modifier for multi-segment paths: it preserves `/`, encodes each segment, and rejects `.`/`..`,
  empty segments, backslashes, and control characters. Normal `{{name}}` remains a single encoded
  segment.
- `request.method` is the default method. Add `request.methods` (or use an array for
  `request.method`) to allow several methods on one wrapper. A generated `method` input is then
  added to the effective schema as an enum, and callers choose `method: "POST"` in `args`; omitting
  it uses the primary/default. A body is only allowed when at least one allowed method can carry
  one (not GET/HEAD-only). `mutating` defaults to true when any allowed method is a write method.
- `auth` is a **secret name**, never a value. Main resolves it at request time
  and refuses unless the URL host is one of the secret's human-authored
  `allowedHosts`. Wrappers may not set credential-shaped headers
  (`Authorization`, `X-Api-Key`, cookies, and similar) or credential-shaped
  query keys (`api_key`, `token`, `password`, and similar), so a literal
  credential cannot be smuggled into a saved file.
- `mutating` defaults to `true` for `POST`/`PUT`/`PATCH`/`DELETE`. Read-only
  wrappers are the default; mutating calls can require human approval.
- `exposeAsTool` opts the wrapper into a generated `wrap_<id>` MCP tool (S4): it is
  registered at server start and after any create/update/delete, capped by
  `KUANG_WRAP_MAX_TOOLS` (default 40; `0` disables).

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

### OAuth2 client credentials

A credential is either a static value (paste the token/key) or an OAuth2
`client_credentials` client:

| Field | Meaning |
| :--- | :--- |
| `tokenUrl` | HTTPS token endpoint. Policy-checked (no private hosts unless allowed) but **not** restricted by `allowedHosts` |
| `clientId` | sent as `client_id` |
| value (write-only) | the client secret, encrypted at rest |
| `scope` / `audience` | optional, sent only when present |

Minting is a form-encoded `POST` (`grant_type=client_credentials&client_id=…&client_secret=…`).
The access token is cached (encrypted, alongside the record) until **60 s before**
`expires_in`, then re-minted. A wrapper call that gets 401/403 triggers **one** forced
re-mint and a single retry; if that still fails the result is `AUTH_REQUIRED` with a hint to
update the credential or raise HIL. There is no retry loop and no background refresher.

Not supported: authorization-code, device flow, PKCE, refresh tokens, per-user tokens,
token revocation, OIDC discovery. The honest-status section lists the associated risks.

### Verification metadata

Every successful live run writes `lastVerified` (ISO timestamp) into the wrapper file.
`wrap_list` shows `verified YYYY-MM-DD`, or `never verified`. It means "the upstream
answered without an HTTP error" — a liveness signal only, not proof that the output was
correct.

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
capped by `KUANG_WRAP_MAX_TOOLS` (default 40; `0` disables); the rest stay callable through `wrap_run`.
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
  wrap server file log; `KUANG_WRAP_TIMEOUT_MS` overrides its bridge timeout;
  `KUANG_WRAP_MAX_TOOLS` sets the generated-tool cap (default 40, max 200, `0` disables
  generated tools — a context budget, not an MCP limit).
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
| **S4** ✅ | Generated tools, `sendToolListChanged`; MCP Clients entry and docs are already in S1 | cap configurable (`KUANG_WRAP_MAX_TOOLS`) and visible ✅; client sees a new tool without restart ✅ |
| **S5** ✅ | OAuth2 client credentials, expiry handling, `lastVerified` | One re-mint, then `AUTH_REQUIRED` with a human-action hint ✅ (no silent 401 loop); `lastVerified` written on success ✅ |

## Threat model

| Threat | Control |
| --- | --- |
| Agent creates a wrapper pointing at an attacker host and attaches a secret | Host-bound secrets; human-only binding; no cross-origin auth redirect |
| Local process calls the bridge and spends tokens | Rotating token, read from a user-private file; every `/wrap/*` route returns 401 without it. |
| SSRF into localhost or cloud metadata | Scheme + DNS/IP checks; private hosts require `KUANG_WRAP_ALLOW_PRIVATE=1`. DNS rebinding remains a residual risk until the checked address is pinned in the socket. |
| A paginated `next` link points at an attacker host | `link` pagination is same-origin only; every page URL is re-checked by `assertSafeUrl` before it is fetched |
| Credential leaks into logs or responses | Bridge logs and previews redact credential-shaped keys; an upstream response that echoes a secret is redacted before rendering; audit rows store host/status/bytes only; tests assert values are absent. |
| Prompt injection inside an API response | Response is data; it is rendered, never executed |
| Tool-list exhaustion | Ten meta-tools plus opt-in generated tools, capped by `KUANG_WRAP_MAX_TOOLS` (default 40) |
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
   (`exposeAsTool`), capped by `KUANG_WRAP_MAX_TOOLS`, with `tools/list_changed` on change.

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
