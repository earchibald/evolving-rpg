/**
 * THE COVENANT
 *
 * The model this game is held to — every facility, not only the Forge. A rule
 * proposal, a name, a generated map and a combat table are all changes to the
 * same game, and they are all checked against the same stated invariants.
 * When a facility grows, its invariant is added here first; when an invariant
 * proves wrong, it is amended here, visibly, rather than eroding one exception
 * at a time.
 *
 * Two registers, deliberately:
 *
 * **Mechanical** — properties of play, checked by *playing*: the assays drive
 * exploit policies through the real session layer and refuse what breaks.
 * Refusals are reserved for what a trial can demonstrate; anything a
 * simulation cannot prove is a caution, never a silent pass.
 *
 * **Thematic** — properties of the voice. The world is cold, quiet and
 * attentive; things have names you can point at; nothing shouts. The checks
 * here are the structural half; judged passes (a model reading for register)
 * are the other half and are wired separately, because opinion must never
 * gate mechanics silently.
 *
 * **Legible** — properties of exposure. Every system must say what it decided
 * and why, in human-readable form, as part of the system rather than as an
 * afterthought. Stated by the player-owner directly: a game whose reasoning
 * cannot be read cannot be checked, and this game's whole premise is a player
 * ratifying what they understand.
 */

export interface Invariant {
  readonly id: string;
  readonly register: 'mechanical' | 'thematic' | 'legible';
  readonly statement: string;
  /** The function or practice that holds it. Named so a test can check the
   *  enforcer exists — an invariant with no enforcer is a wish. */
  readonly enforcedBy: string;
}

export const COVENANT: readonly Invariant[] = Object.freeze([
  Object.freeze({
    id: 'M1',
    register: 'mechanical' as const,
    statement: 'Death must remain possible. No ratified rule may make a player unkillable while holding still.',
    enforcedBy: 'assayRule: trial of the coward',
  }),
  Object.freeze({
    id: 'M2',
    register: 'mechanical' as const,
    statement: 'No unbounded growth by repetition. A repeatable action may not raise any stat past a stated ceiling in one exploited run.',
    enforcedBy: 'assayRule: trial of greed',
  }),
  Object.freeze({
    id: 'M3',
    register: 'mechanical' as const,
    statement: 'A rule that can never fire is refused before ratification when demonstrable, and cautioned when not.',
    enforcedBy: 'validateRule coherence checks; assayRule: trial of function',
  }),
  Object.freeze({
    id: 'M4',
    register: 'mechanical' as const,
    statement: 'Replay is exact. Nothing added to the game may re-decide recorded history or consume unrecorded randomness.',
    enforcedBy: 'apply/verifyChain; RULE_FIRED carries resolved outcomes; rngDraws protocol',
  }),
  Object.freeze({
    id: 'M5',
    register: 'mechanical' as const,
    statement: 'The way out must be reachable in every generated world.',
    enforcedBy: 'mapgen reachability guarantee and its tests',
  }),
  Object.freeze({
    id: 'T1',
    register: 'thematic' as const,
    statement: 'A name names a thing a player can point at: short, lowercase, concrete head word, no articles.',
    enforcedBy: 'assayName',
  }),
  Object.freeze({
    id: 'T2',
    register: 'thematic' as const,
    statement: 'One voice: cold, quiet, attentive. Nothing shouts, nothing exclaims, nothing breaks register to be helpful.',
    enforcedBy: 'assayLine',
  }),
  Object.freeze({
    id: 'T3',
    register: 'thematic' as const,
    statement: 'Canon does not contradict itself: one kind, one name, never two kinds sharing one.',
    enforcedBy: 'assayName duplicate check (structural half); judged canon pass (deferred)',
  }),
  Object.freeze({
    id: 'L1',
    register: 'legible' as const,
    statement: 'Every system exposes its mechanics human-readably: what it decided, with the real numbers, where a player will read it. A facility whose reasoning cannot be read cannot be checked, and ships unfinished.',
    enforcedBy: 'WORLD_INIT carries its generation story; narrate() names every change; the ledger holds every decision chain; tables.ts is one legible file',
  }),
]);

export function invariant(id: string): Invariant | undefined {
  return COVENANT.find((i) => i.id === id);
}
