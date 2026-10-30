# Collaboration plan

**Status:** planned, post-1.7.0  
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

## Human interface

- **COLLAB** button in the header.
- One selection mode, not separate modes: click any inspectable object.
- A selection popover with comment, tags and optional intent.
- In-page overlay badges for agent highlights, questions and choices.
- A side panel listing threads, unresolved counts, evidence and demonstrations.
- Actions on a thread: reply, resolve, rebind stale target, save recipe.
- **Record demonstration** start/stop control, separate from timelapse recording.

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
2. Human selection, comments, thread panel and agent highlight overlay.
3. Choices, async questions and blocking `ask`.
4. Demonstration recorder and recipe generation.
5. CSS/style targets and inspect/edit actions.
6. Optional remote exposure through the authenticated gateway.

## Tests

- store normalization, atomic write, retention;
- thread create/read/reply/resolve;
- target locator + stale detection;
- choice validation and timeout;
- overlay injection and selection message;
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
