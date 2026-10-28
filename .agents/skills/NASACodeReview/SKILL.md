---
name: jpl-code-reviewer
description: Scoped reliability and maintainability review based on NASA JPL-inspired rules, with severity, waivers, and diff-focused evidence for TypeScript, Node, Electron, and MCP code.
---

# NASA JPL-Inspired Code Reviewer

Use this skill to review **changed code and the call sites those changes
directly affect**. The goal is reliable behavior, visible lifecycles, and
honest failure handling, not cosmetic uniformity across a large legacy
codebase.

This is a reliability review, not a security review. Auth, secret handling,
remote exposure, and threat modelling still require a separate security pass.

## Scope policy

- Review the diff and directly affected functions first.
- Review a whole file only when it is new, heavily changed, or explicitly
  requested.
- Do not flag pre-existing style issues as blockers unless the change makes
  them worse or depends on them.
- Do not use this skill for docs, copy, CSS-only, or generated-code changes.
- New reusable modules must meet the full gate. Existing legacy code gets
  findings as warnings unless the new feature changes its behavior.

## Severity

| Severity | Meaning |
| --- | --- |
| **Blocker** | Must be fixed before merge. Security exposure, data loss, auth bypass, unhandled failure, unbounded resource growth, leaked handle/process/timer, broken shutdown, type error, or failing test. |
| **Warning** | Should be fixed in touched code. Complexity, function size, avoidable indirection, missing assertion, weak naming, or a lifecycle risk that is currently contained. |
| **Note** | Style or future cleanup. Never blocks a merge. |

A finding is not a Blocker just because a rule is listed below. It is a
Blocker when the rule protects correctness, security, resource ownership, or
recoverability in this change.

## The 10 rules, adapted for this codebase

### 1. Simple control flow

Prefer linear guards, early returns, and explicit state transitions. Flag deep
recursion, nested callbacks that hide control flow, or jump-like logic that is
hard to reason about.

Exceptions: bounded traversal over a tree, parser recursion with a hard depth
limit, and framework callbacks with a single obvious purpose.

### 2. Bounded loops and collections

Every `for`, `while`, retry, retry loop, page loop, crawl, and session
collection needs a deterministic end condition or a hard cap.

Check specifically:

- session maps
- retry/backoff loops
- request and response body sizes
- pagination and crawl limits
- event queues and in-memory buffers
- timer-driven cleanup

A loop that only ends when a remote peer behaves is a Blocker unless a cap and
cancellation path exist.

### 3. Explicit allocations and lifecycles

Every resource must have a named owner and a release path:

- HTTP server and listening socket
- sockets, streams, and `AbortController`
- `setInterval` / `setTimeout`
- MCP transports and sessions
- child processes such as `cloudflared`
- file handles and token files
- event listeners

Check success, error, timeout, disable, and application-quit paths. A shutdown
path that only calls `kill()` without handling exit and close is incomplete.

### 4. Small, single-purpose functions

Use approximately 60 lines as a review prompt for new code, not an absolute
law. Flag a function when it mixes transport parsing, auth, business logic, and
I/O, or when its length hides a lifecycle mistake.

Exceptions: UI render functions, test fixtures, generated code, and declarative
mapping tables.

### 5. Defensive assertions and invariants

Validate at trust boundaries: HTTP input, IPC input, child-process output,
environment variables, file contents, and MCP arguments.

Prefer explicit checks, Zod schemas, TypeScript narrowing, and exhaustive
switches. Use assertions for programmer invariants, not for untrusted input.
Do not silently coerce invalid data.

### 6. Minimal scope and explicit ownership

Declare state where it is used. Avoid module-level mutable state unless it is a
deliberate singleton with a lifecycle.

New services should expose an instance with `start`, `stop`, and `status`
rather than hiding mutable state in module globals.

### 7. Check every return value and failure path

All promises are awaited or explicitly handed to an error boundary. Handle:

- rejected promises
- `spawn` errors and non-zero exits
- `kill` and `close` failures
- HTTP write/socket errors
- JSON parse and schema failures
- file read/write failures
- transport close errors

Do not use `void` to silence a promise unless the promise has a documented
error handler. Do not use empty catch blocks without a comment explaining why
the failure is safe to ignore.

### 8. No magic or hidden side effects

Flag import-time side effects, environment variables that change module
behavior, implicit global state, dynamic evaluation, and metaprogramming that
obscures control flow.

Framework and SDK boundaries are acceptable when they are explicit and tested.
A reusable module should not auto-start a server or process merely because it
was imported.

### 9. Limit indirection

Avoid wrappers that only rename another function, nested callbacks with no
clear ownership, and abstractions that make shutdown or error paths harder to
follow.

Reusable packages are encouraged when they remove duplication and have a clear
contract. Abstraction is not the problem; hidden behavior is.

### 10. Zero warnings

A change must pass the project gates:

```bash
npx tsc --noEmit
npm run test:mcp:contract
npm run check:no-local-paths
```

Run the relevant test suite for the changed area. New lint warnings, type
errors, failing tests, and unexplained suppressions are Blockers.

## Remote/MCP-specific blocker checks

For remote MCP, tunnel, session, or authentication work, also require:

- the public endpoint never proxies the raw local bridge
- bearer/token checks happen before session creation or tool dispatch
- tokens are not placed in URLs or logs
- sessions are capped and idle-expire
- tunnel and gateway stop when disabled or when the app quits
- child-process `spawn`, `exit`, `error`, `kill`, and `close` are handled
- request body size and timeout limits exist
- shutdown is tested, not just described
- remote access is opt-in and visibly revocable

## Waivers

A waiver must include:

- rule number
- exact location
- reason the risk is acceptable
- owner
- expiry or follow-up issue

No waiver is allowed for an auth bypass, secret leak, unbounded resource, or
leaked child process. If a rule is a poor fit, record it as a **Note**, not a
silent exception.

## Required output

```text
Verdict: BLOCK | APPROVE WITH WARNINGS | APPROVE
Scope: <files/areas reviewed>
Evidence: <commands run, tests passed, manual checks>

Findings
| Severity | Rule | Location | Risk | Required action |
| --- | --- | --- | --- | --- |
| Blocker/Warning/Note | 1-10 | file:line | ... | ... |

Waivers
- <rule, location, owner, reason, expiry>
```

Provide refactored code only for Blocker or small Warning findings. Do not
rewrite an entire legacy file to satisfy a style rule. Prefer a focused patch
and a follow-up note.

If there are no findings, say so directly and list the evidence. Do not invent
issues to fill the format.
