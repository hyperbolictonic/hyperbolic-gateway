---
type: Reference
title: Error catalogue
description: Machine-readable browser, wrapper, and bridge errors, with recovery guidance.
tags: [errors, troubleshooting, browser, wrappers, bridge]
status: stable
---

# Error catalogue

Errors are machine-readable where the implementation has a code. Treat the
code as the contract and the message as human guidance.

## Browser errors

| Code | Meaning | Recovery |
| --- | --- | --- |
| `STALE_REF` | A mark or element reference no longer resolves. | Re-run `observe` or `find`; act on a fresh mark. |
| `TIMEOUT` | A condition or tool did not finish within its budget. | Re-read state, raise the timeout deliberately, or wait for a narrower condition. |
| `NO_TARGET` | The requested element or page target was not found. | Re-scan; check the selector, role, or name. |
| `BAD_REQUEST` | Arguments are missing or invalid. | Fix the tool arguments; inspect the schema. |
| `NOT_SUPPORTED` | The operation is not available for this page or build. | Use a supported primitive or report the gap. |
| `TYPE_NO_EFFECT` | Typing was attempted but the value did not change. | Check focus, the field type, and whether the control accepts input. Use `clear_first` where appropriate. |
| `HUMAN_IN_PROGRESS` | A human is using the browser; synthetic input is paused. | Wait for the human to go idle, then re-observe. |
| `NO_LLM_SURFACE` | A site advertises no fetchable Markdown/Text representation. | Use `observe(as:"markdown")` or `read_url` with a detached render. |
| `FETCH_BLOCKED` | The representation fetch was blocked or failed. | Fall back to a normal rendered read and report the reason. |
| `NAVIGATION_HOST_NOT_FOUND` | DNS could not resolve the target host. | Check the URL and DNS; this is a client error, not a gateway crash. |
| `NAVIGATION_CONNECTION_REFUSED` | The host refused the connection. | Check the port and whether the server is running. |
| `NAVIGATION_TIMEOUT` | The connection timed out. | Check reachability; retry deliberately. |
| `NAVIGATION_OFFLINE` | The machine has no network connection. | Restore connectivity and retry. |
| `NAVIGATION_UNREACHABLE` | The host is unreachable. | Check the network and target host. |
| `NAVIGATION_TOO_MANY_REDIRECTS` | The redirect cap was exceeded. | Use the final URL or fix the redirect chain. |
| `NAVIGATION_CERTIFICATE` | The TLS certificate was rejected. | Check the certificate; do not bypass it silently. |
| `NAVIGATION_ABORTED` | Navigation was aborted by the page or client. | Retry once, then inspect the page/Browser state. |
| `NAVIGATION_FAILED` | Chromium could not load the URL for another reason. | Inspect the message and the target URL. |

Navigation failures are returned as `400`, not `500`. Always show the message,
the code and the failing URL.

Other errors may be surfaced by Chromium, the bridge, or a tool-specific
implementation. Always show the message and the failing tool name.

## Wrapper and recipe errors

| Code | Meaning | Recovery |
| --- | --- | --- |
| `WRAPPER_NOT_FOUND` | No saved wrapper with that id. | Call `wrap_list`. |
| `WRAPPER_REQUIRED` | `wrap_test` received neither `id` nor `wrapper`. | Pass one. |
| `INVALID_WRAPPER` | Wrapper validation failed. | Fix the fields named in the error. |
| `INVALID_ARGS` | The supplied arguments do not match `inputSchema`. | Fix types, required fields, or ranges. |
| `INVALID_REQUEST` | The request could not be built. | Check templates and method/body compatibility. |
| `METHOD_NOT_ALLOWED` | The chosen method is not in `request.methods`. | Use an allowed method or update the wrapper. |
| `UNRESOLVED_TEMPLATE` | A URL placeholder remained after interpolation. | Supply the argument or fix the template. |
| `INVALID_URL` | The interpolated URL is not valid. | Fix the URL template. |
| `FORBIDDEN_HEADER` | A wrapper tried to set a credential/transport header. | Use `request.auth`; do not set `Authorization`, `Cookie`, etc. |
| `SECRET_ERROR` | A named secret could not be resolved or used. | Check the name, host binding, and credential status. |
| `SECRETS_UNAVAILABLE` | The platform keyring is unavailable. | Fix the OS keyring; on Linux, avoid `basic_text`. |
| `AUTH_REQUIRED` | The upstream rejected the credential. | Refresh the credential or ask a human to intervene. |
| `HTTP_ERROR` | The upstream returned a non-success status. | Inspect status and body; fix the request or handle the API error. |
| `TOO_MANY_REDIRECTS` | The redirect cap was exceeded. | Use the final URL or fix the API. |
| `TIMEOUT` | The outbound request timed out. | Retry deliberately; raise `timeoutMs` only within the cap. |
| `NETWORK_ERROR` | The request could not be completed. | Check connectivity and DNS. |
| `BLOCKED_PROTOCOL` | The scheme is not HTTP(S). | Use HTTPS; plain HTTP needs an explicit opt-in. |
| `BLOCKED_HOST` | A private/local hostname is blocked. | Use a public host or opt in for local development. |
| `BLOCKED_ADDRESS` | The host resolves to a private or metadata address. | Do not bypass unless you control the network and the risk. |
| `DNS_LOOKUP_FAILED` | The host could not be resolved. | Check the hostname and network. |
| `BLOCKED_URL_CREDENTIALS` | The URL contains a username or password. | Use a host-bound secret instead. |

## Bridge errors

| Code | Meaning | Recovery |
| --- | --- | --- |
| `UNAUTHORIZED` | The `/wrap/*` token is missing or stale. | Check `HB_WRAP_TOKEN_FILE`; restart the app/client if the token rotated. |
| `WRAP_UNAVAILABLE` | Hyperbolic Rest is not initialised. | Start the app build that includes wrappers. |
| `BAD_REQUEST` | A bridge route received invalid input. | Fix the JSON body or query. |
| `NOT_FOUND` | Unknown route or wrapper endpoint. | Check the path and HTTP method. |
| `RECORDING_TOOLS_DISABLED` | Recording is disabled by the human switch. | Enable recording in Settings or stop calling the tools. |
| `HUMAN_DECISION_REQUIRED` | A decision or drive path requires a human choice. | Resolve the human gate, then retry. |
| `NOT_CONFIGURED` | A decision model is not configured. | Configure one in Settings or use deterministic tools. |

## Handling rules

1. Do not retry a non-retryable validation or policy error.
2. Re-read state after `STALE_REF`, `NO_TARGET`, or a page change.
3. Use `wait_for` or `expect` instead of sleeping and hoping.
4. Surface `UNAUTHORIZED`, `SECRETS_UNAVAILABLE`, and `AUTH_REQUIRED` to the
   operator; they are configuration or credential problems.
5. Treat a wrapper's `ok: false` as a failed call even when the HTTP round-trip
   to the local bridge succeeded.
