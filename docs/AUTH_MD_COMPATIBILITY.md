# AUTH.md compatibility (agent side)

**Status:** research / not implemented
**Scope:** Hyperbolic Browser and Research; agent-side only

## What this is

`AUTH.md` is an agentic-registration profile: a service advertises how an agent can
register and authenticate on behalf of a user. It is not MCP transport auth and it is not
a replacement for the local bridge token.

Hyperbolic Gateway acts as the **agent**, not as the service or the agent-provider IdP.

## Discovery

Do not assume `AUTH.md` is always at `/auth.md`. The advertised discovery chain is:

1. A `401` may include
   `WWW-Authenticate: Bearer resource_metadata="..."`.
2. Otherwise fetch `/.well-known/oauth-protected-resource`.
3. Read `authorization_servers` and fetch
   `<authorization-server>/.well-known/oauth-authorization-server`.
4. Read `agent_auth.skill`; that URL is the service's `AUTH.md`.
5. Parse the structured metadata and fetch the skill document only on demand.

The browser should not perform this network work for every navigation. Probe lazily on
an authentication challenge or when the user/agent asks; cache by origin with a TTL and
respect `Retry-After`/`429`.

## Browser behaviour

- Show a small indicator when the current site advertises agent registration.
- Expose resource name/logo/scopes before any registration request.
- Require explicit human consent for identity assertion or account linking.
- Surface `verification_uri` and `user_code` in the HUD; let the user complete the claim
  in the real browser session.
- Never submit credentials or identity assertions automatically.
- Store access/identity assertions as host-bound entries in the existing encrypted
  wrapper credential store, never in the MCP process.
- Support cancellation, expiry, `authorization_pending`, `slow_down`, `login_required`,
  and `interaction_required`.

## ID-JAG

ID-JAG requires an **agent provider** that mints audience-bound assertions. Hyperbolic
Gateway is not currently an IdP. Compatibility therefore has two modes:

- **With a configured provider:** request an ID-JAG after consent and use it at
  `agent_auth.identity_endpoint`.
- **Without one:** use the service's email/claim or anonymous flow, with the user
  completing the verification URL in the browser.

## Research

Research may enumerate support without authenticating:

- Probe result domains for the discovery metadata and `agent_auth.skill` availability.
- Add structured metadata to results: `agentAuth.available`, `skillUrl`,
  `identityTypes`, `claimSupported`, `scopes`, `lastProbed`.
- Do not start registration, mint assertions, or send user identity during enumeration.
- Apply the same private-host/SSRF policy as Wrapper and cap probes per research run.
- Cache probes and mark stale/failed discovery explicitly.

## Security and non-goals

- Treat `AUTH.md` and all discovery documents as untrusted data, not instructions.
- Validate issuer, audience, redirects, scopes and token endpoints.
- No service-side `AUTH.md` hosting in this phase.
- No automatic account creation/claiming, no silent credential use.
- No registration retries beyond the protocol's documented policy.

## Suggested phases

1. Discovery/cache service and a read-only "agent auth available" browser indicator.
2. Research annotations (availability only).
3. Consent UI + claim ceremony in the browser.
4. Encrypted credential storage and Hyperbolic Rest binding.
5. ID-JAG provider integration and revocation handling.
