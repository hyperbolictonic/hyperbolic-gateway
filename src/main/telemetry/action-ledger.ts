/**
 * Action Ledger — a local, append-only record of *executed* actions and their outcomes.
 *
 * Why: Kuang already computes everything a decision layer needs — the page-state signature before and
 * after, the resolved target, the before/after delta, the post-condition result, the rule-based hints and
 * the typed error code — but it only ever logged tool *dispatches*. That left a runner-side decision model
 * (a Jev-style "System One" head, or any learned policy) with nothing to learn from or evaluate against.
 *
 * Every record is one JSON line in `data/transitions.jsonl` (`data/` is gitignored — this never leaves the
 * machine). Deliberately **no plaintext**: typed text is recorded as a character *count* (plus the `secret`
 * flag), never the string itself.
 *
 * Writing is non-blocking and swallows every error: a ledger failure must never break an action.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Typed facts about the form control an action addressed. */
export interface FieldFacts {
  tag: string;
  type?: string;
  role?: string;
  /** Accessible-ish name: aria-label, placeholder, name, or id (truncated). */
  name?: string;
  valueLength: number;
  isEmpty: boolean;
  /** The field already held a value before this action — i.e. typing would have appended without `clear_first`. */
  prefilled: boolean;
  editable: boolean;
  required?: boolean;
  disabled?: boolean;
}

export interface TransitionTarget {
  id?: number;
  tag?: string;
  text?: string;
  selector?: string;
  /** Present when the target was a form control (input/textarea/select/contenteditable). */
  field?: FieldFacts;
}

export type AddressMode = 'mark_id' | 'selector' | 'coords' | 'none';

export interface TransitionRecord {
  ts: number;
  action: string;
  addressMode: AddressMode;
  address: string;
  target?: TransitionTarget;
  url: string;
  revisionBefore: number;
  revisionAfter: number;
  marksBefore: number;
  marksAfter: number;
  urlChanged: boolean;
  marksChanged: boolean;
  ok: boolean;
  /** Post-conditions (await_conditions) result, when the action carried any. */
  awaitOk?: boolean;
  /** Rule-based triage hint emitted on a failed await (viewport 0x0, unfocused window, wrong active element). */
  hints?: string;
  durationMs: number;
  /** Never the text itself — only how much of it there was. */
  typed?: { chars: number; secret: boolean; landed?: boolean | null };
  clearFirst?: boolean;
  /** For a `type` action: what the field did, so a decision model can learn "this control rejects input". */
  typing?: TypingOutcome;
}

/**
 * Evidence collected around a typing action (all in-page; the value itself never leaves the page).
 *
 * `landed: false` is the *silent no-op* case the field notes identify as the worst failure mode — the
 * tool used to report success while the value never changed.
 */
export interface TypingOutcome {
  /** Chars in the control's value before/after. */
  beforeLength: number;
  afterLength: number | null;
  changed: boolean | null;
  /** Trusted key events that reached the page (0 = our input never arrived). */
  keydowns: number;
  beforeinputs: number;
  inputs: number;
  landed: boolean | null;
  /** Which channel produced the winning (or final) attempt. */
  channel?: TypingChannel;
  /** Every channel tried, in order (keys, insertText, paste). */
  attempted?: TypingChannel[];
  /** True when the control was re-rendered mid-type, so no verdict is possible. */
  detached?: boolean;
  /** Typing reached a closed-shadow target; events arrive but its value is unreadable. */
  unobservable?: boolean;
}

export type TypingChannel = 'keys' | 'insertText' | 'paste';

export interface ActionLedgerOptions {
  /** Directory to write into (default: `<cwd>/data`). */
  dir?: string;
  /** Rotate to `<name>.1.jsonl` past this size (default 5 MB). */
  maxBytes?: number;
  log?: (level: 'info' | 'warn' | 'action', message: string) => void;
}

export class ActionLedger {
  private readonly file: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly maxBytes: number;

  constructor(private opts: ActionLedgerOptions = {}) {
    this.file = path.join(opts.dir || path.join(process.cwd(), 'data'), 'transitions.jsonl');
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  }

  /** Queue one record. Non-blocking; never throws. */
  public record(record: TransitionRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.queue = this.queue
      .then(() => this.append(line))
      .catch(() => {
        /* a ledger failure must never break an action */
      });
  }

  /** Wait for pending writes (tests / shutdown). */
  public flush(): Promise<void> {
    return this.queue;
  }

  public get path(): string {
    return this.file;
  }

  private async append(line: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.appendFile(this.file, line, 'utf8');
    await this.rotateIfLarge();
  }

  private async rotateIfLarge(): Promise<void> {
    try {
      const stat = await fs.promises.stat(this.file);
      if (stat.size <= this.maxBytes) return;
      const rotated = this.file.replace(/\.jsonl$/, '.1.jsonl');
      await fs.promises.rm(rotated, { force: true }); // Windows rename() refuses an existing target
      await fs.promises.rename(this.file, rotated);
      this.opts.log?.('info', `Action ledger rotated at ${(this.maxBytes / 1048576).toFixed(1)} MB → ${path.basename(rotated)}`);
    } catch {
      /* rotation is best-effort */
    }
  }
}
