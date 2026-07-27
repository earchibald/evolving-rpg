/**
 * R2 rules: the vocabulary, and the validator that makes it safe to let a model
 * write one.
 *
 * A rule is *data*, never code. Nothing here is ever evaluated, compiled or
 * executed — the interpreter walks a closed union of tags, so the worst a
 * malicious or confused proposal can do is be rejected. That is the entire
 * safety argument for the Ladder, and it lives or dies on this file.
 *
 * ## What the vocabulary covers, and why this much
 *
 * The first cut was deliberately tiny — four triggers, four conditions, three
 * effects — on the theory that play should show what was needed. Play showed
 * that it was below the floor. Two absences in particular were not minimalism
 * but missing furniture: nothing could react to *being hit* (only your own
 * blows triggered anything), and nothing could test proportional health, so
 * "when you are badly hurt" was inexpressible while "when you are at exactly 3"
 * was not. Those are table stakes in any grid RPG, not refinements.
 *
 * So this is sized to what a player would simply assume works: reacting to
 * being struck, to killing, to the passing of a turn; testing health as a
 * fraction, distance to the way out, how much is still alive, how far into the
 * run you are; and doing the things rules do — hurting back, buffing, draining,
 * shoving something away from you.
 *
 * It is still closed, still bounded, still drawless. Widening again is cheap.
 * Narrowing after a model has learned to reach for something is not.
 */

export const TRIGGERS = [
  'WAIT',          // you held still
  'MOVE',          // you took a step
  'MOVE_BLOCKED',  // you walked into something solid
  'STRIKE',        // you struck something
  'STRUCK',        // something struck you
  'KILLED',        // something died by your hand
  'ITEM_TAKEN',    // you picked something up
  'TURN_PASSED',   // a full round went by
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** The four stats, plus the health ceiling, since raising a maximum is a
 *  different thing from healing to it. */
export const STATS = ['might', 'speed', 'wits', 'maxHp'] as const;
export type StatName = (typeof STATS)[number];

/** The cuts a floor can be shaped to (tables.ts MOTIFS — a test pins the two
 *  lists together). Base cuts only: the deep is depth's business, said by
 *  composition (`motifIs warren` + `depthAtLeast 7`), not by a fourth name. */
export const MOTIF_NAMES = ['door', 'warren', 'halls'] as const;
export type MotifName = (typeof MOTIF_NAMES)[number];

export type Condition =
  | { readonly kind: 'hpAtMost'; readonly n: number }
  | { readonly kind: 'hpAtLeast'; readonly n: number }
  | { readonly kind: 'hpBelowPercent'; readonly n: number }
  | { readonly kind: 'hpAbovePercent'; readonly n: number }
  | { readonly kind: 'creatureWithin'; readonly n: number }
  | { readonly kind: 'noCreatureWithin'; readonly n: number }
  | { readonly kind: 'creaturesAtMost'; readonly n: number }
  | { readonly kind: 'creaturesAtLeast'; readonly n: number }
  | { readonly kind: 'exitWithin'; readonly n: number }
  | { readonly kind: 'exitBeyond'; readonly n: number }
  | { readonly kind: 'turnAtLeast'; readonly n: number }
  | { readonly kind: 'depthAtLeast'; readonly n: number }
  | { readonly kind: 'statAtLeast'; readonly stat: StatName; readonly n: number }
  | { readonly kind: 'motifIs'; readonly motif: MotifName }
  | { readonly kind: 'bodyHere' }
  | { readonly kind: 'blowLanded' }
  | { readonly kind: 'blowMissed' };

export type ConditionKind = Condition['kind'];

export type Effect =
  | { readonly kind: 'heal'; readonly n: number }
  | { readonly kind: 'harm'; readonly n: number }
  /** Hurts the other party in the exchange — what was struck, or what struck
   *  you. Thorns, retaliation, a blade that bites both ways. */
  | { readonly kind: 'harmOther'; readonly n: number }
  | { readonly kind: 'grant'; readonly stat: StatName; readonly n: number }
  | { readonly kind: 'drain'; readonly stat: StatName; readonly n: number }
  /** Shoves the other party directly away, stopping at anything solid. The one
   *  effect that makes position matter, which on a grid is the whole point. */
  | { readonly kind: 'push'; readonly n: number }
  | { readonly kind: 'speak'; readonly text: string };

export type EffectKind = Effect['kind'];

export interface Provenance {
  readonly events: readonly string[];
  readonly notes: readonly string[];
  /** Lens numbers from the Critic's reading, when a rule answers a
   *  measurement. Optional: not every rule is born from a lens. */
  readonly lenses: readonly number[];
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

/**
 * Bounds, per kind rather than one number for everything.
 *
 * A single global 1–9 was wrong once the vocabulary grew: a distance on a 24×16
 * grid runs to 38, a percentage to 99, a turn count into the hundreds, while a
 * permanent stat grant of 9 would be absurd. Each kind gets the range that is
 * meaningful for it, and the validator refuses anything outside.
 */
const RANGES: Record<string, readonly [number, number]> = {
  heal: [1, 20], harm: [1, 20], harmOther: [1, 20],
  grant: [1, 5], drain: [1, 5],
  push: [1, 3],
  hpAtMost: [1, 99], hpAtLeast: [1, 99],
  hpBelowPercent: [1, 99], hpAbovePercent: [1, 99],
  creatureWithin: [1, 40], noCreatureWithin: [1, 40],
  exitWithin: [1, 40], exitBeyond: [1, 40],
  creaturesAtMost: [0, 20], creaturesAtLeast: [0, 20],
  turnAtLeast: [1, 999],
  depthAtLeast: [1, 99],
  statAtLeast: [1, 20],
};

/** Conditions that test the blow that triggered the rule rather than the world.
 *  They carry no number, and only mean anything under STRIKE or STRUCK. */
export const BLOW_CONDITIONS = ['blowLanded', 'blowMissed'] as const;

/** Kinds that name a stat as well as a number. */
export const STAT_KINDS = ['statAtLeast', 'grant', 'drain'] as const;

/** Kinds that name a floor's cut, and nothing else. */
export const MOTIF_KINDS = ['motifIs'] as const;

/** The range a kind's `n` must fall in, or undefined for kinds that take none.
 *  Exported so the Forge's editor can build controls that cannot produce an
 *  invalid rule in the first place, rather than ones that get rejected after. */
export function rangeOf(kind: string): readonly [number, number] | undefined {
  return RANGES[kind];
}

export function takesStat(kind: string): boolean {
  return (STAT_KINDS as readonly string[]).includes(kind);
}

export function takesMotif(kind: string): boolean {
  return (MOTIF_KINDS as readonly string[]).includes(kind);
}

export function takesNumber(kind: string): boolean {
  return RANGES[kind] !== undefined;
}

/** Which triggers a kind is usable with, or undefined for "any". Mirrors the
 *  two coherence checks below, so the editor can grey out what would be
 *  refused instead of letting you build it and then be told no. */
export function needsTriggers(kind: string): readonly Trigger[] | undefined {
  if ((BLOW_CONDITIONS as readonly string[]).includes(kind)) return ['STRIKE', 'STRUCK'];
  if (kind === 'harmOther' || kind === 'push') return ['STRIKE', 'STRUCK', 'KILLED'];
  return undefined;
}

export const CONDITION_KINDS: readonly ConditionKind[] = [
  'hpAtMost', 'hpAtLeast', 'hpBelowPercent', 'hpAbovePercent',
  'creatureWithin', 'noCreatureWithin', 'creaturesAtMost', 'creaturesAtLeast',
  'exitWithin', 'exitBeyond', 'turnAtLeast', 'depthAtLeast', 'statAtLeast',
  'motifIs', 'bodyHere',
  'blowLanded', 'blowMissed',
];

export const EFFECT_KINDS: readonly EffectKind[] = [
  'heal', 'harm', 'harmOther', 'grant', 'drain', 'push', 'speak',
];

export const MAX_CONDITIONS = 4;
export const MAX_EFFECTS = 3;
export const MAX_TEXT = 120;
export const MAX_BECAUSE = 240;
export const MAX_RULES = 16;

/** Rejection messages go on screen, and what they describe is untrusted. */
const MAX_QUOTE = 40;

export function isRejected<T extends object>(r: T | Rejected): r is Rejected {
  return 'rejected' in r;
}

function reject(message: string): Rejected {
  return Object.freeze({ rejected: message.slice(0, 200) });
}

function show(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : typeof value === 'bigint' ? `${value}n` : String(value);
  } catch {
    s = '(unprintable)';
  }
  return s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE)}…` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Whole number inside this kind's own range. Rules out NaN and Infinity,
 *  which is the point: `heal Infinity` is a rule that ends the game. */
function inRange(kind: string, v: unknown): v is number {
  const range = RANGES[kind];
  if (range === undefined) return false;
  return typeof v === 'number' && Number.isInteger(v) && v >= range[0] && v <= range[1];
}

function rangeText(kind: string): string {
  const r = RANGES[kind];
  return r === undefined ? 'a whole number' : `a whole number ${r[0]}–${r[1]}`;
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

  const kind: unknown = raw['kind'];
  if (!oneOf(CONDITION_KINDS, kind)) return reject(`require: unknown condition "${show(kind)}"`);

  if (oneOf(BLOW_CONDITIONS, kind) || kind === 'bodyHere') return Object.freeze({ kind });

  if (kind === 'motifIs') {
    const motif: unknown = raw['motif'];
    if (!oneOf(MOTIF_NAMES, motif)) return reject(`require: unknown motif "${show(motif)}" — the cuts are ${MOTIF_NAMES.join(', ')}`);
    return Object.freeze({ kind, motif });
  }

  if (kind === 'statAtLeast') {
    const stat: unknown = raw['stat'];
    if (!oneOf(STATS, stat)) return reject(`require: unknown stat "${show(stat)}"`);
    if (!inRange(kind, raw['n'])) return reject(`require: n must be ${rangeText(kind)}, got ${show(raw['n'])}`);
    return Object.freeze({ kind, stat, n: raw['n'] });
  }

  if (!inRange(kind, raw['n'])) return reject(`require: n must be ${rangeText(kind)}, got ${show(raw['n'])}`);
  // Rebuilt field by field rather than spread, so extra keys are dropped rather
  // than riding along into the log, where they would be permanent.
  return Object.freeze({ kind, n: raw['n'] } as Condition);
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

  if (kind === 'grant' || kind === 'drain') {
    const stat: unknown = raw['stat'];
    if (!oneOf(STATS, stat)) return reject(`then: unknown stat "${show(stat)}"`);
    if (!inRange(kind, raw['n'])) return reject(`then: n must be ${rangeText(kind)}, got ${show(raw['n'])}`);
    return Object.freeze({ kind, stat, n: raw['n'] });
  }

  if (!inRange(kind, raw['n'])) return reject(`then: n must be ${rangeText(kind)}, got ${show(raw['n'])}`);
  return Object.freeze({ kind, n: raw['n'] } as Effect);
}

function validateProvenance(raw: unknown): Provenance | Rejected {
  if (!isPlainObject(raw)) return reject(`provenance: expected an object, got ${show(raw)}`);

  const events = stringsOnly(raw['events']);
  const notes = stringsOnly(raw['notes']);
  const rawLenses: unknown = raw['lenses'] ?? [];
  const lenses = Array.isArray(rawLenses)
    ? rawLenses.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)
    : null;
  if (lenses === null) return reject(`provenance: lenses must be a list of lens numbers, got ${show(rawLenses)}`);
  if (events === null) return reject(`provenance: events must be a list of ids, got ${show(raw['events'])}`);
  if (notes === null) return reject(`provenance: notes must be a list of timestamps, got ${show(raw['notes'])}`);

  const because: unknown = raw['because'];
  if (typeof because !== 'string' || because.trim() === '') {
    return reject(`provenance: because must say why this rule exists, got ${show(because)}`);
  }

  // A rule that cites nothing is precisely what the Ladder exists to prevent.
  if (events.length === 0 && notes.length === 0) {
    return reject('provenance: a rule must cite at least one event or note it is answering');
  }

  return Object.freeze({
    events: Object.freeze([...events]),
    notes: Object.freeze([...notes]),
    lenses: Object.freeze([...lenses]),
    because: because.slice(0, MAX_BECAUSE),
  });
}

/** Conditions about the blow only mean anything when a blow is what happened. */
function blowConditionsFit(when: Trigger, require: readonly Condition[]): string | null {
  const usesBlow = require.some((c) => oneOf(BLOW_CONDITIONS, c.kind));
  if (!usesBlow) return null;
  if (when === 'STRIKE' || when === 'STRUCK') return null;
  return `require: "${require.find((c) => oneOf(BLOW_CONDITIONS, c.kind))!.kind}" needs a blow — use it with STRIKE or STRUCK, not ${when}`;
}

/** A floor has one cut. Two different `motifIs` conditions validate cleanly,
 *  read plausibly, and can never both hold — a rule that looks ratifiable and
 *  then silently does nothing forever, which is the lie the validator exists
 *  to prevent (VOCABULARY.md: the unresolvable case gets its legal exit). */
function motifsFit(require: readonly Condition[]): string | null {
  const cuts = new Set(require.flatMap((c) => (c.kind === 'motifIs' ? [c.motif] : [])));
  if (cuts.size <= 1) return null;
  const [a, b] = [...cuts];
  return `require: the floor cannot be both "${a!}" and "${b!}" — a rule that can never fire is not a rule`;
}

/** Effects reaching for "the other party" need there to be one. */
function otherEffectsFit(when: Trigger, then: readonly Effect[]): string | null {
  const needsOther = then.find((e) => e.kind === 'harmOther' || e.kind === 'push');
  if (needsOther === undefined) return null;
  if (when === 'STRIKE' || when === 'STRUCK' || when === 'KILLED') return null;
  return `then: "${needsOther.kind}" needs something else in the exchange — use it with STRIKE, STRUCK or KILLED, not ${when}`;
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
  const when: Trigger = raw['when'];

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

  // A rule that can never fire, or can never do what it says, is worse than a
  // malformed one: it looks ratifiable and then silently does nothing.
  const blowProblem = blowConditionsFit(when, require);
  if (blowProblem !== null) return reject(blowProblem);
  const motifProblem = motifsFit(require);
  if (motifProblem !== null) return reject(motifProblem);
  const otherProblem = otherEffectsFit(when, then);
  if (otherProblem !== null) return reject(otherProblem);

  const provenance = validateProvenance(raw['provenance']);
  if (isRejected(provenance)) return provenance;

  const ratifiedAt: unknown = raw['ratifiedAt'];
  if (typeof ratifiedAt !== 'string' || ratifiedAt.trim() === '') {
    return reject(`ratifiedAt: expected a timestamp, got ${show(ratifiedAt)}`);
  }

  return Object.freeze({
    id,
    when,
    require: Object.freeze(require),
    then: Object.freeze(then),
    provenance,
    ratifiedAt,
  });
}

const TRIGGER_TEXT: Record<Trigger, string> = {
  WAIT: 'you hold still',
  MOVE: 'you take a step',
  MOVE_BLOCKED: 'you walk into something solid',
  STRIKE: 'you strike something',
  STRUCK: 'something strikes you',
  KILLED: 'something dies by your hand',
  ITEM_TAKEN: 'you pick something up',
  TURN_PASSED: 'a turn goes by',
};

const STAT_TEXT: Record<StatName, string> = {
  might: 'might', speed: 'speed', wits: 'wits', maxHp: 'your health ceiling',
};

const MOTIF_TEXT: Record<MotifName, string> = {
  door: 'the door', warren: 'the warren', halls: 'the halls',
};

/** What a rule says, in English. The Forge shows this and not the object: a
 *  player ratifying a rule they cannot read is not ratifying anything. */
export function readRule(rule: Rule): string {
  const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

  const conditions = rule.require.map((c) => {
    switch (c.kind) {
      case 'hpAtMost': return `your hit points at ${c.n} or below`;
      case 'hpAtLeast': return `your hit points at ${c.n} or above`;
      case 'hpBelowPercent': return `your health below ${c.n}%`;
      case 'hpAbovePercent': return `your health above ${c.n}%`;
      case 'creatureWithin': return `something living within ${plural(c.n, 'square')}`;
      case 'noCreatureWithin': return `nothing living within ${plural(c.n, 'square')}`;
      case 'creaturesAtMost': return `${plural(c.n, 'creature')} or fewer still alive`;
      case 'creaturesAtLeast': return `${plural(c.n, 'creature')} or more still alive`;
      case 'exitWithin': return `the way out within ${plural(c.n, 'square')}`;
      case 'exitBeyond': return `the way out more than ${plural(c.n, 'square')} off`;
      case 'turnAtLeast': return `turn ${c.n} or later`;
      case 'depthAtLeast': return `the run ${c.n === 1 ? `${c.n} floor` : `${c.n} floors`} deep or deeper`;
      case 'statAtLeast': return `your ${STAT_TEXT[c.stat]} at ${c.n} or above`;
      case 'motifIs': return `the floor cut as ${MOTIF_TEXT[c.motif]}`;
      case 'bodyHere': return 'your own body lying where you stand';
      case 'blowLanded': return 'the blow landing';
      case 'blowMissed': return 'the blow missing';
      default: {
        const unhandled: never = c;
        throw new Error(`unreadable condition ${JSON.stringify(unhandled)}`);
      }
    }
  });

  const effects = rule.then.map((e) => {
    switch (e.kind) {
      case 'heal': return `you recover ${plural(e.n, 'hit point')}`;
      case 'harm': return `you lose ${plural(e.n, 'hit point')}`;
      case 'harmOther': return `it loses ${plural(e.n, 'hit point')}`;
      case 'grant': return `your ${STAT_TEXT[e.stat]} rises by ${e.n}`;
      case 'drain': return `your ${STAT_TEXT[e.stat]} falls by ${e.n}`;
      case 'push': return `it is shoved back ${plural(e.n, 'square')}`;
      case 'speak': return `the world says: “${e.text}”`;
      default: {
        const unhandled: never = e;
        throw new Error(`unreadable effect ${JSON.stringify(unhandled)}`);
      }
    }
  });

  const when = TRIGGER_TEXT[rule.when];
  const clause = conditions.length === 0 ? when : `${when}, with ${conditions.join(' and ')}`;
  return `When ${clause} — ${effects.join(', and ')}.`;
}
