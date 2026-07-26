/**
 * R2 rules: the vocabulary, and the validator that makes it safe to let a model
 * write one.
 *
 * A rule is *data*, never code. Nothing here is ever evaluated, compiled or
 * executed — the interpreter walks a closed union of tags, so the worst a
 * malicious or confused proposal can do is be rejected. That is the entire
 * safety argument for the Ladder, and it lives or dies on this file.
 *
 * The vocabulary is small on purpose, and it is small in a specific direction:
 * it covers what play has actually shown a need for, not what a rules engine
 * usually has. `WAIT` and `MOVE_BLOCKED` are triggers because both are
 * currently inert — holding still does nothing, and walking into a wall only
 * scolds you — so they are where there is the most room to grow. There is no
 * `reveal` effect because nothing in this game is hidden; adding one would let
 * a player ratify a rule that visibly did nothing.
 *
 * Widening this later is cheap. Narrowing it after a model has learned to reach
 * for something is not.
 */

export const TRIGGERS = ['WAIT', 'STRIKE', 'MOVE_BLOCKED', 'ITEM_TAKEN'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const CONDITION_KINDS = ['noCreatureWithin', 'creatureWithin', 'hpAtMost', 'hpAtLeast'] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const EFFECT_KINDS = ['heal', 'harm', 'speak'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface Condition { readonly kind: ConditionKind; readonly n: number }

export type Effect =
  | { readonly kind: 'heal'; readonly n: number }
  | { readonly kind: 'harm'; readonly n: number }
  | { readonly kind: 'speak'; readonly text: string };

export interface Provenance {
  /** Event ids from the run that motivated this. */
  readonly events: readonly string[];
  /** `at` timestamps of the notes cited. Timestamps rather than ids because
   *  notes are a sidecar and have none. */
  readonly notes: readonly string[];
  /** One sentence, in the Rulesmith's own words, on why this rule. */
  readonly because: string;
}

export interface Rule {
  readonly id: string;
  readonly when: Trigger;
  readonly require: readonly Condition[];
  readonly then: readonly Effect[];
  readonly provenance: Provenance;
  readonly ratifiedAt: string;
}

export interface Rejected { readonly rejected: string }

/** Bounds. Every one of these exists so that a generated rule cannot crash the
 *  engine, hang it, or make the game unplayable in a way that is hard to undo. */
export const MIN_N = 1;
export const MAX_N = 9;
export const MAX_CONDITIONS = 3;
export const MAX_EFFECTS = 2;
export const MAX_TEXT = 120;
export const MAX_BECAUSE = 240;
export const MAX_RULES = 16;

/** Rejection messages go on screen, and the thing being described is untrusted.
 *  Nothing quoted from the input escapes this length. */
const MAX_QUOTE = 40;

/** Generic over what was being validated, because the same check narrows a
 *  condition, an effect, a provenance block and a whole rule. */
export function isRejected<T extends object>(r: T | Rejected): r is Rejected {
  return 'rejected' in r;
}

function reject(message: string): Rejected {
  return Object.freeze({ rejected: message.slice(0, 200) });
}

/** A short, safe rendering of whatever we were handed, for the message. Never
 *  the value itself: a 50,000-character `speak` would otherwise flood the UI. */
function show(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : typeof value === 'bigint' ? `${value}n` : String(value);
  } catch {
    // Objects with a throwing toString exist, and a validator that dies while
    // composing its own error message is not total.
    s = '(unprintable)';
  }
  return s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE)}…` : s;
}

/** Plain object, and not one carrying a smuggled prototype. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Whole number inside the bounds. Rules out NaN and Infinity, which is the
 *  point: `heal Infinity` is a rule that ends the game. */
function inRange(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_N && v <= MAX_N;
}

function oneOf<T extends string>(allowed: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}

function stringsOnly(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

function validateCondition(raw: unknown): Condition | Rejected {
  if (!isPlainObject(raw)) return reject(`require: expected an object, got ${show(raw)}`);
  if (!oneOf(CONDITION_KINDS, raw['kind'])) {
    return reject(`require: unknown condition "${show(raw['kind'])}"`);
  }
  if (!inRange(raw['n'])) {
    return reject(`require: n must be a whole number ${MIN_N}–${MAX_N}, got ${show(raw['n'])}`);
  }
  // Rebuilt field by field rather than spread, so extra keys are dropped rather
  // than riding along into the log, where they would be permanent.
  return Object.freeze({ kind: raw['kind'], n: raw['n'] });
}

function validateEffect(raw: unknown): Effect | Rejected {
  if (!isPlainObject(raw)) return reject(`then: expected an object, got ${show(raw)}`);
  const kind: unknown = raw['kind'];
  if (!oneOf(EFFECT_KINDS, kind)) return reject(`then: unknown effect "${show(kind)}"`);

  if (kind === 'speak') {
    const text: unknown = raw['text'];
    if (typeof text !== 'string' || text.trim() === '') {
      return reject(`then: speak needs text, got ${show(text)}`);
    }
    if (text.length > MAX_TEXT) {
      return reject(`then: speak text is ${text.length} characters, the limit is ${MAX_TEXT}`);
    }
    return Object.freeze({ kind, text });
  }

  if (!inRange(raw['n'])) {
    return reject(`then: n must be a whole number ${MIN_N}–${MAX_N}, got ${show(raw['n'])}`);
  }
  return Object.freeze({ kind, n: raw['n'] });
}

function validateProvenance(raw: unknown): Provenance | Rejected {
  if (!isPlainObject(raw)) return reject(`provenance: expected an object, got ${show(raw)}`);

  const events = stringsOnly(raw['events']);
  const notes = stringsOnly(raw['notes']);
  if (events === null) return reject(`provenance: events must be a list of ids, got ${show(raw['events'])}`);
  if (notes === null) return reject(`provenance: notes must be a list of timestamps, got ${show(raw['notes'])}`);

  const because: unknown = raw['because'];
  if (typeof because !== 'string' || because.trim() === '') {
    return reject(`provenance: because must say why this rule exists, got ${show(because)}`);
  }

  // A rule that cites nothing is precisely what the Ladder exists to prevent.
  // "The world felt like it" is how a game evolves into noise.
  if (events.length === 0 && notes.length === 0) {
    return reject('provenance: a rule must cite at least one event or note it is answering');
  }

  return Object.freeze({
    events: Object.freeze([...events]),
    notes: Object.freeze([...notes]),
    because: because.slice(0, MAX_BECAUSE),
  });
}

/**
 * Total over every possible input. Returns a `Rule` or a `Rejected`; never
 * throws, for any value whatsoever — including cyclic objects, absent
 * prototypes, bigints, and things whose `toString` throws.
 *
 * The result shares no structure with the input. The caller's object may be a
 * model response that something else still holds a reference to, and a rule is
 * about to be written into an append-only log.
 */
export function validateRule(raw: unknown): Rule | Rejected {
  if (!isPlainObject(raw)) return reject(`expected a rule object, got ${show(raw)}`);

  const id: unknown = raw['id'];
  if (typeof id !== 'string' || id.trim() === '') return reject(`id: expected a name, got ${show(id)}`);

  if (!oneOf(TRIGGERS, raw['when'])) {
    return reject(`when: "${show(raw['when'])}" is not a trigger — expected one of ${TRIGGERS.join(', ')}`);
  }

  const rawRequire: unknown = raw['require'];
  if (!Array.isArray(rawRequire)) return reject(`require: expected a list, got ${show(rawRequire)}`);
  if (rawRequire.length > MAX_CONDITIONS) {
    return reject(`require: ${rawRequire.length} conditions, the limit is ${MAX_CONDITIONS}`);
  }

  const rawThen: unknown = raw['then'];
  if (!Array.isArray(rawThen)) return reject(`then: expected a list, got ${show(rawThen)}`);
  if (rawThen.length === 0) return reject('then: a rule that does nothing is not a rule');
  if (rawThen.length > MAX_EFFECTS) {
    return reject(`then: ${rawThen.length} effects, the limit is ${MAX_EFFECTS}`);
  }

  const require: Condition[] = [];
  for (const c of rawRequire) {
    const checked = validateCondition(c);
    if (isRejected(checked)) return checked;
    require.push(checked);
  }

  const then: Effect[] = [];
  for (const e of rawThen) {
    const checked = validateEffect(e);
    if (isRejected(checked)) return checked;
    then.push(checked);
  }

  const provenance = validateProvenance(raw['provenance']);
  if (isRejected(provenance)) return provenance;

  const ratifiedAt: unknown = raw['ratifiedAt'];
  if (typeof ratifiedAt !== 'string' || ratifiedAt.trim() === '') {
    return reject(`ratifiedAt: expected a timestamp, got ${show(ratifiedAt)}`);
  }

  return Object.freeze({
    id,
    when: raw['when'],
    require: Object.freeze(require),
    then: Object.freeze(then),
    provenance,
    ratifiedAt,
  });
}

/** What a rule says, in English. The Forge shows this and not the object: a
 *  player ratifying a rule they cannot read is not ratifying anything. */
export function readRule(rule: Rule): string {
  const when = {
    WAIT: 'you hold still',
    STRIKE: 'a blow is struck',
    MOVE_BLOCKED: 'you walk into something solid',
    ITEM_TAKEN: 'you pick something up',
  }[rule.when];

  const conditions = rule.require.map((c) => ({
    noCreatureWithin: `nothing living within ${c.n} squares`,
    creatureWithin: `something living within ${c.n} squares`,
    hpAtMost: `your hit points at ${c.n} or below`,
    hpAtLeast: `your hit points at ${c.n} or above`,
  }[c.kind]));

  const effects = rule.then.map((e) => (
    e.kind === 'speak' ? `the world says: “${e.text}”`
      : e.kind === 'heal' ? `you recover ${e.n} hit point${e.n === 1 ? '' : 's'}`
        : `you lose ${e.n} hit point${e.n === 1 ? '' : 's'}`
  ));

  const clause = conditions.length === 0 ? when : `${when}, with ${conditions.join(' and ')}`;
  return `When ${clause} — ${effects.join(', and ')}.`;
}
