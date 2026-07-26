/**
 * The one place the model may touch the game.
 *
 * An intent is a role, not a separate system: the Worldmaster, the Chronicler
 * and the rest are all questions asked through this single door, which is what
 * keeps their answers cacheable, replaceable and countable in one place.
 *
 * `propose` is the Rulesmith: it reads a finished run and drafts one R2 rule.
 * Unlike `describe` it is never cached and never becomes canon — a proposal is
 * a conversation, and asking twice may reasonably give two different answers.
 */
export type Intent = 'describe' | 'gamemaster' | 'propose';

/**
 * What is being asked about.
 *
 * `subject` is a stable key for a *kind* rather than an instance — every
 * `thing` on the map shares one name, because a name is a fact about the world
 * and not about one creature. It is also the cost model: a kind is named once,
 * ever, and never asked about again.
 */
export interface Question {
  intent: Intent;
  subject: string;
  context: Record<string, unknown>;
}

export interface Answer {
  name: string;
  line: string;
  /** Where this came from. Recorded because a name produced by the fallback is
   *  not the same kind of fact as one the world actually chose, and a later
   *  Critic reading canon deserves to know which it is looking at. */
  source: 'model' | 'fallback' | 'cache';
  /** The model that actually ran, which is not always the one requested — fast
   *  mode and tier gating can substitute a smaller one. Recorded because a run
   *  half-served by a different model is a determinism problem, not a billing
   *  one. Null when no model ran. */
  model: string | null;
  ms: number;
  costUsd: number;
  /** Structure, for the intents that answer with an object rather than prose.
   *  Deliberately `unknown`: it is a model's output and has to be validated
   *  before anything looks at it, so a type here would only be a lie. */
  data?: unknown;
}

export type CallState = 'waiting' | 'asking' | 'answered' | 'failed';

/** One entry in the queue the interface shows. Deliberately a plain record: the
 *  point is that a person can see what the world is thinking about. */
export interface Call {
  id: string;
  intent: Intent;
  subject: string;
  state: CallState;
  /** Milliseconds since the call was raised, filled in as it goes. */
  ms: number;
  detail: string;
}

export interface Transport {
  readonly name: string;
  ask(question: Question): Promise<{ name: string; line: string; model: string | null; costUsd: number; data?: unknown }>;
}
