import { canonicalJson } from '../log/canonical.js';
import { assayName } from '../assay/register.js';
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

/**
 * What identifies a question, which is not the same as what the model needs to
 * know in order to answer it.
 *
 * Only intent and subject. `context` is prompt material — a creature's current
 * hit points help the world describe it, but they do not make it a different
 * creature. Keying on context meant a thing at five hit points and the same
 * thing at three were separate questions: a fresh paid call every time anything
 * took damage, and a name that could change in the middle of a fight.
 */
/** Enough attempts to ride out a hiccup, few enough that a broken transport
 *  does not bill you once per frame. */
const MAX_TRIES = 3;

function keyOf(question: Question): string {
  return canonicalJson({ intent: question.intent, subject: question.subject });
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
  /** Keys with a question currently out, so a re-render does not ask again. */
  private readonly inFlight = new Set<string>();
  /** How many times each key has been tried, so a broken transport cannot
   *  become a storm of identical failing calls on every frame. */
  private readonly tries = new Map<string, number>();
  private nextId = 1;
  /** Bumped by `unlearn`, so answers cannot cross a wipe. */
  private epoch = 0;

  constructor(options: OracleOptions) {
    this.transport = options.transport;
    this.onChange = options.onChange ?? ((): void => {});
    this.now = options.now ?? ((): number => Date.now());
    for (const [key, answer] of Object.entries(options.known ?? {})) {
      // Placeholders are never canon. An older build stored them, and a failed
      // call then looked exactly like a settled name — permanently, because a
      // cache hit meant it was never asked again. Dropping them on load lets an
      // already-poisoned save heal itself.
      if (answer.source === 'fallback') continue;
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

    // The fallback is returned but NOT remembered. Storing it made a failed
    // call permanent: the next ask found it in canon, returned it as settled,
    // and never tried again — so one dropped call meant a thing kept its
    // placeholder name for the life of the save. Canon holds only what the
    // world actually said.
    const attempted = this.tries.get(key) ?? 0;
    if (this.transport !== null && !this.inFlight.has(key) && attempted < MAX_TRIES) {
      this.inFlight.add(key);
      this.tries.set(key, attempted + 1);
      void this.raise(key, question);
    }

    return fallbackFor(question);
  }

  /** Anything still wearing a placeholder, so a view can offer to try again. */
  unanswered(): number {
    let waiting = 0;
    for (const [key, count] of this.tries) {
      if (!this.canon.has(key) && !this.inFlight.has(key) && count >= MAX_TRIES) waiting += 1;
    }
    return waiting;
  }

  /**
   * Refuses a name the world gave.
   *
   * Canon is permanent by design, which is exactly why there has to be a way to
   * say no. The world offered "small iron want" for a blade — atmospheric, and
   * useless, because a player cannot tell what it is. Rejecting drops it and
   * lets the next ask try again.
   *
   * This is the veto the design always called for, arriving at the first moment
   * it was actually needed.
   */
  reject(name: string): boolean {
    for (const [key, answer] of this.canon) {
      if (answer.name !== name) continue;
      this.canon.delete(key);
      this.tries.delete(key);
      this.onChange();
      return true;
    }
    return false;
  }

  /** Forgets past failures so the next ask tries afresh. */
  askAgain(): void {
    for (const key of [...this.tries.keys()]) {
      if (!this.canon.has(key)) this.tries.delete(key);
    }
    this.onChange();
  }

  private async raise(key: string, question: Question): Promise<void> {
    if (this.transport === null) return;

    // Which era of the world this question belongs to. A call takes tens of
    // seconds; a wipe takes none. Without this the answer to a question asked
    // before the wipe lands afterwards and writes itself into the canon that
    // was just emptied — which is exactly why names kept coming back from a
    // wipe, and why a *second* wipe appeared to work: by then nothing was
    // still in the air.
    const era = this.epoch;

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

      // The register guard, live. A name outside the Covenant's shape — a mood
      // for a head word, an article, shouting, a name already spent — is
      // treated as a failed call rather than written into permanent canon.
      // The retry machinery already exists; the world simply tries again.
      if (question.intent === 'describe') {
        const taken = [...this.canon.values()].map((a) => a.name);
        const judged = assayName(said.name, taken);
        if (!judged.sound) {
          throw new Error(`the covenant refuses "${said.name}" — ${judged.findings.join('; ')}`);
        }
      }

      const answer: Answer = {
        name: said.name,
        line: said.line,
        source: 'model',
        model: said.model,
        ms: this.now() - started,
        costUsd: said.costUsd,
      };
      if (era !== this.epoch) {
        // The world it was about no longer exists. Said out loud rather than
        // dropped in silence, because a call that was paid for and discarded
        // is worth seeing.
        this.calls.set(id, { ...call, state: 'failed', detail: 'asked about a world that was wiped' });
      } else {
        // A name, once spoken, is permanent. This overwrites the fallback that
        // was standing in for it — the only time canon is ever rewritten, and
        // only from a placeholder to the real thing.
        this.canon.set(key, answer);
        this.calls.set(id, {
          ...call,
          state: 'answered',
          detail: `${answer.name}${answer.model === null ? '' : ` · ${answer.model}`}`,
        });
      }
    } catch (error) {
      // The fallback already committed, so the world keeps its name and play
      // continues. Only the queue records that the world tried and could not.
      this.calls.set(id, { ...call, state: 'failed', detail: String(error).slice(0, 80) });
    } finally {
      this.inFlight.delete(key);
    }
    this.onChange();
  }

  /**
   * Asks something that is not a fact about the world.
   *
   * Queued and visible like everything else, and never remembered. A question
   * put to the gamemaster is a conversation, not canon: caching it would mean
   * asking the same thing twice gives the same words back, which is the
   * opposite of what a conversation is for. The distinction is exactly why
   * canon is keyed by content — that key is only meaningful for things that
   * are true, rather than things that were said.
   *
   * Unlike `ask`, this can fail, and the caller has to cope. Nothing depends
   * on it, which is what makes that acceptable.
   */
  async consult(question: Question): Promise<Answer> {
    if (this.transport === null) throw new Error('nothing is listening');

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
      this.calls.set(id, { ...call, state: 'answered', detail: said.name.slice(0, 60) });
      this.onChange();
      return {
        name: said.name,
        line: said.line,
        source: 'model',
        model: said.model,
        ms: this.now() - started,
        costUsd: said.costUsd,
        data: said.data,
      };
    } catch (error) {
      this.calls.set(id, { ...call, state: 'failed', detail: String(error).slice(0, 80) });
      this.onChange();
      throw error;
    }
  }

  /**
   * Unlearns everything the world has ever said.
   *
   * Separate from `forget`, which deliberately keeps canon. This is what "wipe
   * everything" needs, and clearing the stored copy is not enough on its own:
   * the Oracle holds its names in memory, so the next `ask` fires `onChange`
   * and writes the whole lot straight back to storage. The wipe then appears to
   * have done nothing, which is exactly what it looked like.
   */
  unlearn(): void {
    // Bumped first: everything already in flight belongs to the old world and
    // must not be allowed to answer into the new one.
    this.epoch += 1;
    this.canon.clear();
    this.tries.clear();
    this.calls.clear();
    this.raisedAt.clear();
    this.inFlight.clear();
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
