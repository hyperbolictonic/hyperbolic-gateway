# Collaboration plan

**Status:** phases 1-2 implemented (store, bridge routes, `collaborate` tool, overlay, human picker, thread panel and human replies/choices); demonstration recording next


**Related:** [`TOOL_SURFACE_CONSOLIDATION.md`](./TOOL_SURFACE_CONSOLIDATION.md), [`CONTROL_LAYER.md`](./CONTROL_LAYER.md), [`../src/main/hil/README.md`](../src/main/hil/README.md)

## Goal

Give humans and agents one shared, persistent way to talk about page objects:

- “this is the element with the issue”
- “use this value here”
- “choose A or B”
- “watch me do this once, then save it as a recipe”
- later: “inspect this CSS rule”

This is not three modes (debug / design / research). It is one **target + thread**
substrate. Presets and filters are UI conveniences, not separate state machines.

## Principles

1. **Targets are first-class.** A thread always points at a page object or a
   captured browser object, with a locator and a visual snapshot.
2. **Human-first.** Agents may annotate and ask, but humans can always reply,
   ignore, resolve or rebind a stale target.
3. **One thread can hold many kinds of intent.** A bug note, a design choice and
   a recorded demonstration can coexist.
4. **Reuse existing systems.** Element targeting uses the mark/selector layer;
   demonstrations compile into the existing recipe format.
5. **No silent writes.** Agent-suggested actions, especially CSS/apply changes,
   require explicit human approval.
6. **Local by default.** Collaboration data is sensitive page context; remote
   exposure reuses the gateway auth and is opt-in.

## Data model

```ts
type TargetKind =
  | 'element'
  | 'text'
  | 'frame'
  | 'console'
  | 'network'
  | 'region'
  | 'style'
  | 'page';

interface Target {
  kind: TargetKind;
  url: string;
  tabId?: string;
  frameId?: string;
  revision?: number;
  markId?: number;
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
  reference?: string; // console id, request id, style rule id, region hash
}

interface ThreadMessage {
  id: string;
  author: 'human' | 'agent';
  kind: 'comment' | 'question' | 'choice' | 'answer' | 'status';
  text: string;
  source?: 'text' | 'voice';
  voice?: {
    durationMs: number;
    language?: string;
    confidence?: number;
    /** Omitted when audio retention is off. */
    audioPath?: string;
  };
  choices?: string[];
  answer?: string;
  createdAt: number;
}

interface DemonstrationStep {
  action: 'click' | 'type' | 'select' | 'press' | 'navigate';
  target?: Target;
  value?: string;
  secret?: boolean;
  expect?: Array<Record<string, unknown>>;
  at: number;
}

interface CollaborationThread {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'open' | 'answered' | 'resolved' | 'stale';
  target: Target;
  intent?: string;
  tags: string[];
  messages: ThreadMessage[];
  demonstrations: Array<{
    id: string;
    createdAt: number;
    steps: DemonstrationStep[];
    recipeId?: string;
  }>;
  resolution?: string;
}
```

Storage: `<userData>/collaboration.json` with atomic writes and a bounded history
policy. Keep the active threads and a capped archive.

## Agent interface

Add one advertised tool: `collaborate`.

| Action | Purpose |
| --- | --- |
| `highlight` | Highlight a target with a comment/evidence note. |
| `ask` | Highlight a target and ask a question, optionally with choices. |
| `read` | Read threads for the current page/job, with filters. |
| `reply` | Add an agent message to a thread. |
| `resolve` | Resolve a thread with a note. |
| `list` | List open/stale threads and counts. |
| `request_demo` | Ask the human to demonstrate a flow on a target. |
| `import_demo` | Attach a recorded demonstration to a thread/recipe. |

`ask` supports:

- `wait: true` with a timeout for a synchronous answer;
- `wait: false` to return a thread id immediately;
- choices plus an optional free-text answer.

The tool should not duplicate `request_human_intervention`; HIL remains the
blocking “I need a human to clear this gate” primitive. Collaboration is for
persistent, structured review and demonstration.

## Phase 1 endpoints

```text
GET  /collaboration/threads?id=...
GET  /collaboration/threads?url=&status=&limit=
POST /collaboration/highlight
POST /collaboration/ask
POST /collaboration/reply
POST /collaboration/resolve
```

Storage is `<userData>/collaboration.json`. The agent-facing `collaborate`
tool maps to these routes and the overlay is refreshed after create, reply and
resolve. Phase 2 adds the human picker, comment compose box, thread list and
human reply/choice controls in the COLLAB side panel.

### Human picker

The **COLLAB** control is an icon with a tooltip and a native action menu. Its
first action is **Select element**, which injects a crosshair overlay. A trusted
click creates an anchored note drawer: beside the element when there is room,
below it when there is not, and above it when the lower edge is crowded. The
drawer follows the element on scroll and resize. The selected outline stays
visible and carries an **Add note** icon at its outer top-right with a tooltip;
clicking it expands/focuses the drawer. Escape or the drawer close button
cancels. A minimize control collapses the drawer to a compact note bar without
losing the draft. The target stores selector, role, visible text, mark id and
rect so it can be re-resolved later. The drawer submits directly to the
collaboration store, so the global side panel is not required to write a note.

## Human interface

- **COLLAB** button in the header.
- One selection mode, not separate modes: click any inspectable object.
- A selection popover with comment, tags and optional intent.
- In-page overlay badges for agent highlights, questions and choices.
- A side panel listing threads, unresolved counts, evidence and demonstrations.
- Actions on a thread: reply, resolve, rebind stale target, save recipe.
- **Record demonstration** start/stop control, separate from timelapse recording.

## Voice notes

Notes should not require a keyboard. Add push-to-talk in the selection popover,
thread panel and demonstration recorder:

1. Human selects an element and holds the mic button (or uses a global hotkey).
2. Audio is transcribed locally by default.
3. The transcript lands in the thread as a normal human comment; it is editable
   before sending.
4. Agent `collaborate.read` returns the transcript like any other message; the
   agent can ask a follow-up through the same thread.
5. Audio retention is off by default. If enabled, keep it beside the thread and
   make its lifecycle explicit.

Rules:

- explicit recording indicator and stop control;
- no cloud speech service by default;
- never send raw audio to the model when a transcript is enough;
- allow "retry transcription" without re-recording;
- keep the raw audio local if retention is enabled;
- typed text remains the fallback when no STT model is installed;
- the same redaction rules apply to transcripts and audio paths.

The optional agent action is `collaborate.request_note(target, prompt)` — ask
for a spoken note on a target, returning a thread id immediately.

## Demonstration → recipe

1. Human selects a target and writes the intent.
2. Human starts **Record demonstration**.
3. Trusted human events are captured as targets + values + navigation.
4. Stop produces a demonstration attached to the thread.
5. Agent reads the trace and proposes recipe steps.
6. Human reviews and saves; the existing recipe store owns replay.

Rules:

- never record passwords/secrets; redact or mark them;
- resolve targets by selector/role/text, not just coordinates;
- keep navigation and waits;
- refuse to save a recipe with unresolved targets;
- allow retry before saving.

## CSS and design targets

Later, add `style` targets:

- `style.highlight` — outline a rule/property source;
- `style.inspect` — computed styles, matched rules, specificity;
- `style.suggest` — propose a change with before/after;
- `style.apply` — apply only with human approval;
- preview/undo for edits.

This is an extension of the same thread, not a new mode.

## Phases

1. Store + target schema + bridge routes + `collaborate` tool.
2. Human selection, comments, thread panel and agent highlight overlay. **Done**
3. Choices, async questions and blocking `ask`. **Done (choice UI)**
4. Voice notes: push-to-talk, local transcription, editable transcript.
5. Demonstration recorder and recipe generation.
6. CSS/style targets and inspect/edit actions.
7. Optional remote exposure through the authenticated gateway.

## Tests

- store normalization, atomic write, retention;
- thread create/read/reply/resolve;
- target locator + stale detection;
- choice validation and timeout;
- overlay injection and selection message;
- voice-note transcription and transcript editing;
- audio retention off/on lifecycle;
- demonstration capture → recipe compile;
- recipe replay from a demonstration;
- hidden/remote access policy;
- MCP contract and tool-surface tests.

## Open questions

- Should a measured demonstration auto-save a recipe or always ask first?
- How long should resolved threads be retained?
- Should console/network threads capture the relevant payload or only a reference?
- Do we need a job/workspace concept above individual page threads?
- Can a human record a demonstration across tabs, or only one tab?
- Do we ship a local STT model, use an existing local runtime, or fall back to
  the host OS dictation API when available?
