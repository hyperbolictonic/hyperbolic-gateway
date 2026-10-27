---
type: Security Guide
title: Security model
description: Trust boundaries, bridge authentication, credential handling, SSRF policy, and human takeover.
tags: [security, credentials, bridge, ssrf, hitl]
status: stable
---

# Security model

Hyperbolic Gateway is local-first, but local does not mean trusted. This page
states what is protected, what is not, and which limits are deliberate.

## Trust boundaries

| Boundary | Protection |
| --- | --- |
| Remote network to the bridge | The bridge binds `127.0.0.1`, not a public interface. |
| Local process to `/wrap/*` | Rotating bearer token from `<userData>/wrap/token`. |
| Agent to API credentials | Secrets live in the Electron main process and never enter `hb-rest`. |
| Agent to the browser | The browser is a real session; a human can watch and take over. |
| Wrapper to an arbitrary host | Scheme, DNS, private-address, redirect, and host-binding checks. |

The browser bridge routes are intentionally not protected by the wrap token.
They are a local control surface used by the MCP server. Any process that can
reach `127.0.0.1:4111` can call them. Run the app on a machine and account you
trust, and do not expose the bridge through a proxy or port forward.

The bridge advertises permissive CORS (`Access-Control-Allow-Origin: *`) for
local clients. That does not make it safe to expose to a network. Bind and
firewall it as a loopback-only service.

## Hyperbolic Rest token

- A 32-byte random token is generated on each app start.
- It is written to `<userData>/wrap/token` with owner-only permissions.
- `hb-rest` is configured with `HB_WRAP_TOKEN_FILE`, not the token value.
- It reads the file per call, so an app restart rotates the capability without
  requiring the MCP process to restart.
- A missing or stale token returns `401 { "code": "UNAUTHORIZED" }` before any
  wrapper or outbound request is touched.

`X-Kuang-Wrap-Token` is accepted as an alternative to the bearer header for
compatibility. New clients should use `Authorization: Bearer`.

## Credentials

A credential is either a static value or an OAuth2 `client_credentials`
client. It is written only through Settings over IPC; there is no HTTP or MCP
route that creates or changes a secret.

- `safeStorage` encrypts secrets at rest (DPAPI, Keychain, or libsecret).
- A secret is bound to human-authored `allowedHosts`.
- The injected credential is dropped on a cross-origin redirect.
- Credential-shaped headers and query keys are rejected in wrapper files.
- Upstream responses are scrubbed for the injected value before rendering.
- Audit rows record method, host, status, bytes, and duration, not headers,
  bodies, or query strings.

On Linux, if `safeStorage` selects `basic_text`, secrets are disabled rather
than pretending the keyring is encrypted.

OAuth2 support is limited to the client-credentials grant. Authorization-code,
device flow, PKCE, refresh tokens, per-user tokens, revocation, and OIDC
discovery are not supported.

## Outbound wrapper policy

Every wrapper request passes through the executor's policy:

- HTTPS is required by default; plain HTTP needs `HB_WRAP_ALLOW_HTTP=1`.
- `file:`, `ftp:`, `data:`, and other schemes are rejected.
- URLs with embedded usernames or passwords are rejected.
- Loopback, private, link-local, unique-local, and metadata addresses are
  rejected unless `HB_WRAP_ALLOW_PRIVATE=1`.
- Redirects are capped at five and re-checked on every hop.
- A `link` pagination URL must stay on the first request's origin.
- Responses are capped at 5 MB and default to a 15-second timeout.

DNS is checked before `fetch`, which resolves again. DNS rebinding between the
check and the connection is a residual risk until the checked address is
pinned in the socket. Treat the wrapper system as a developer tool, not a
hardened public API gateway.

## Browser input and human takeover

Clicks and typing are dispatched through the Chrome DevTools Protocol with
humanised movement and cadence. This is not a security boundary and does not
guarantee a site will accept the session.

When a page requires a human, call `request_human_intervention`. The app can
show the window, notify the operator, and wait for a resolution. The browser
also has a focus-independent input path, but synthetic input is paused while a
human is actively using the browser; the tool may return `HUMAN_IN_PROGRESS`.

## Prompt injection

Any page, API response, download, or search result is untrusted data. A
recipe renders data and never executes it. An agent should treat instructions
found inside page content as untrusted and should not let them change its
goals, credentials, or tool permissions.

## Reporting and debugging

Logs are written to files, not stdout. `HB_MCP_LOG=0` disables the MCP file
log. `HB_MCP_STDERR=verbose` enables per-call stderr for local debugging only;
do not enable it in a client that does not drain stderr.

See [Error catalogue](../formats/errors.md) for the codes that surface these
controls.
