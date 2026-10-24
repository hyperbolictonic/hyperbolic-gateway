# 🖐️ Human Input Subsystem

Detects a real person using the browser and hands them the wheel. The agent must never fight someone
at the keyboard. (Policy reference: [docs/CONTROL_LAYER.md](../../../docs/CONTROL_LAYER.md#human-takeover).)

---

## Why timing, not identity

Kuang drives pages with **trusted** CDP input. A synthetic click and a human click are
indistinguishable to the DOM — `event.isTrusted` is `true` for both. The only reliable discriminator
is timing:

- every synthetic dispatch is stamped (`markSynthetic`) immediately before it is sent
- the page reports trusted pointer/key/wheel/touch activity over a console channel
- anything inside `SYNTHETIC_GRACE_MS` (180 ms) of a synthetic dispatch is treated as the agent's own
- anything outside it is human

The trade-off is explicit: a human event landing inside the grace window is attributed to the agent.
The alternative — refusing our own clicks — is worse.

## Detection

`humanListenerScript()` is injected on every finished document load (listeners die with the page) and
is idempotent per document. It listens in the capture phase for:

`pointerdown` · `keydown` · `wheel` · `touchstart`

Each event is reported once, with the element description at the pointer:

```
__KUANG_HUMAN__:{"kind":"pointer","at":1792871496780,"url":"https://example.com/","target":"body \"…\""}
```

`HumanActivityMonitor.ingest()` parses that channel and filters it through
`shouldCountAsHuman(trusted, at, lastSyntheticAt)` — a pure function, unit-tested offline.

## Arbitration

| mechanism | behaviour |
|---|---|
| quiet window | every human event sets `humanActiveUntil = now + 2000`; each new event extends it |
| gate | `InputSimulator.setHumanGate()` — `dispatch()` and `typeText()` throw `HUMAN_IN_PROGRESS` while active |
| status | `GET /human/status` → `{active, activeForMs, last}`; `bridge_health` reports `human.paused` |
| resume | `POST /human/resume` clears the window immediately (HUD/manual hand-back) |
| HUD | `AgentStatus = HUMAN_INPUT`, pulsing info badge, takeover description in the action line |

`HUMAN_IN_PROGRESS` is deliberate: it tells the agent to stop and re-observe instead of retrying into
the human's input.

## Tests

```bash
npm run test:human   # offline: untrusted events, grace boundary, no-dispatch case
npm run test:dom     # live: synthetic clicks and page-script events are not human
```

Verified with real OS input: a physical click produces `active: true` with the clicked element
described, and an `act` during the window returns `HUMAN_IN_PROGRESS`.
