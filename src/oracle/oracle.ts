import { canonicalJson } from '../log/canonical.js';
import type { Answer, Call, Intent, Question, Transport } from './types.js';

/**
 * The Oracle.
 *
 * Three rules, and they are the reason this is a module rather than a function
 * call scattered through the game:
 *
 * 1. **It never blocks a turn.** `ask` answers instantly from canon or hands
 *    back a fallback and raises the real question in the background. Mechanics
 *    resolve now; prose arrives late, or never, and the game does not care.
 *
 * 2. **The cache is the canon.** A question is keyed by its content, so the
 *    same question is never asked twice — and promoting an improvisation to
 *    permanent is naming a cache entry rather than copying it somewhere else.
 *    One store, so the fast path and the true path cannot disagree.
 *
 * 3. **Every intent has a deterministic fallback.** The transport is missing,
 *    the network is gone, the call times out: the world still has a name for
 *    the thing, derived from what it already knows. A degraded world is a game;
 *    a hung one is not.
 *
 * The queue is observable because the model's work should be visible rather
 * than magical — you can see what is being asked and what is waiting.
 */

function keyOf(question: Question): string {
  return canonicalJson({
    intent: question.intent,
    subject: question.subject,
    context: question.context,
  });
}

/**
 * A name derived from the subject itself.
 *
 * Deterministic on purpose: the same unanswered subject reads the same way
 * every time, so a world with no transport is still coherent rather than
 * randomly renamed on each reload.
 */
export function fallbackFor(question: Question): Answer {
  const bare = question.subject.includes(':')
    ? question.subject.slice(question.subject.indexOf(':') + 1)
    : question.subject;
  return {
    name: bare,
    line: '',
    source: 'fallback',
    model: null,
    ms: 0,
    costUsd: 0,
  };
}

export interface OracleOptions {
  transport: Transport | null;
  /** Called whenever the queue or canon changes, so a view can re-render. */
  onChange?: () => void;
  /** Injected so tests are not at the mercy of a clock. */
  now?: () => number;
  /** Canon recovered from a previous session. */
  known?: Record<string, Answer>;
}

export class Oracle {
  private readonly transport: Transport | null;
  private readonly onChange: () => void;
  private readonly now: () => number;
  private readonly canon = new Map<string, Answer>();
  private readonly calls = new Map<string, Call>();
  private readonly raisedAt = new Map<string, number>();
  private nextId = 1;

  constructor(options: OracleOptions) {
    this.transport = options.transport;
    this.onChange = options.onChange ?? ((): void => {});
    this.now = options.now ?? ((): number => Date.now());
    for (const [key, answer] of Object.entries(options.known ?? {})) {
      this.canon.set(key, answer);
    }
  }

  /** What the world already knows, for saving. */
  known(): Record<string, Answer> {
    return Object.fromEntries(this.canon);
  }

  /** Everything in flight or waiting, oldest first, for showing. */
  queue(): Call[] {
    const at = this.now();
    return [...this.calls.values()]
      .map((call) => ({ ...call, ms: at - (this.raisedAt.get(call.id) ?? at) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** True once this subject has a settled name, from any source. */
  settled(question: Question): boolean {
    return this.canon.has(keyOf(question));
  }

  /**
   * Answers now, and asks properly in the background if it does not yet know.
   *
   * Always returns something. A caller never has to handle "not yet".
   */
  ask(question: Question): Answer {
    const key = keyOf(question);

    const remembered = this.canon.get(key);
    if (remembered !== undefined) return { ...remembered, source: 'cache' };

    // Commit the fallback immediately so the world is never nameless, and so a
    // second ask for the same subject does not raise a second call.
    const fallback = fallbackFor(question);
    this.canon.set(key, fallback);

    if (this.transport !== null) void this.raise(key, question);

    return fallback;
  }

  private async raise(key: string, question: Question): Promise<void> {
    if (this.transport === null) return;

    const id = String(this.nextId).padStart(4, '0');
    this.nextId += 1;

    const call: Call = {
      id,
      intent: question.intent,
      subject: question.subject,
      state: 'asking',
      ms: 0,
      detail: this.transport.name,
    };
    this.calls.set(id, call);
    this.raisedAt.set(id, this.now());
    this.onChange();

    const started = this.now();
    try {
      const said = await this.transport.ask(question);
      const answer: Answer = {
        name: said.name,
        line: said.line,
        source: 'model',
        model: said.model,
        ms: this.now() - started,
        costUsd: said.costUsd,
      };
      // A name, once spoken, is permanent. This overwrites the fallback that
      // was standing in for it — the only time canon is ever rewritten, and
      // only from a placeholder to the real thing.
      this.canon.set(key, answer);
      this.calls.set(id, {
        ...call,
        state: 'answered',
        detail: `${answer.name}${answer.model === null ? '' : ` · ${answer.model}`}`,
      });
    } catch (error) {
      // The fallback already committed, so the world keeps its name and play
      // continues. Only the queue records that the world tried and could not.
      this.calls.set(id, { ...call, state: 'failed', detail: String(error).slice(0, 80) });
    }
    this.onChange();
  }

  /** Drops finished entries, so the queue shows work rather than history. */
  forget(): void {
    for (const [id, call] of this.calls) {
      if (call.state === 'answered' || call.state === 'failed') {
        this.calls.delete(id);
        this.raisedAt.delete(id);
      }
    }
    this.onChange();
  }
}

export function describeQuestion(kind: string, what: string, context: Record<string, unknown>): Question {
  return { intent: 'describe' as Intent, subject: `${kind}:${what}`, context };
}
