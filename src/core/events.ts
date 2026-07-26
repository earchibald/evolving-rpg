import type { Rule } from '../canon/rule.js';
import type { Resolved } from '../canon/interpret.js';
import type { Pos, Stats } from './entity.js';
import type { Item } from './item.js';

/** Per event type. Bump when a type's meaning changes, and write an upcaster.
 *
 *  v2 moved randomness accounting onto the envelope: every event now carries
 *  `rngDraws`, and `apply` advances the counter by it uniformly. Before this,
 *  only WORLD_INIT moved the counter, via a `counterAfter` field buried in its
 *  payload — a special case that could not survive any second consumer of
 *  randomness, and combat is one. */
export const SCHEMA_VERSIONS = {
  WORLD_INIT: 5,
  MOVE: 2,
  MOVE_BLOCKED: 2,
  TURN_ADVANCED: 2,
  STRIKE: 2,
  WAIT: 1,
  ITEM_TAKEN: 2,
  RULE_RATIFIED: 1,
  RULE_FIRED: 1,
} as const;

export type EventType = keyof typeof SCHEMA_VERSIONS;

export interface EntitySeed {
  id: string;
  kind: string;
  pos: Pos;
  stats: Stats;
  tags: string[];
}

export interface WorldInitPayload {
  /** How deep this floor lies. v5 always writes it; older events lack it and
   *  read as depth 1. */
  depth?: number;
  /** Carried progress, present on depth-crossing worlds (v5). A bare world
   *  omits them and starts at nothing. */
  xp?: number;
  level?: number;
  /** The carried health ceiling. Without it a wounded player descends with
   *  their maximum collapsed to their wound — the seed's hp is all a seed has. */
  playerMaxHp?: number;
  /** What the player wears, carried across the stairs. Without it the gear
   *  map resets each floor and the next identical relic stacks — the exact
   *  bug slots exist to prevent, reborn on every descent. */
  playerGear?: Record<string, { kind: string; grants: { hp: number; might: number; wits: number; speed: number } }>;
  width: number;
  height: number;
  tiles: number[];
  seed: number;
  player: EntitySeed;
  /** v4. What is worth a detour. The way out is not here — it is a tile, and
   *  recording a place twice gives two things that can disagree. */
  items: Item[];
  /** v3. A world arrives with its inhabitants rather than acquiring them
   *  through later events — they are part of what generation decided, and
   *  recording them here keeps that decision in one place. */
  opponents: EntitySeed[];
}

export interface MovePayload {
  entityId: string;
  from: Pos;
  to: Pos;
}

export interface MoveBlockedPayload {
  entityId: string;
  attempted: Pos;
  reason: 'wall' | 'out-of-bounds' | 'occupied';
}

export interface TurnAdvancedPayload {
  activeEntityId: string | null;
  turn: number;
}

/** The roll is recorded, not just the outcome. It costs one number and it is
 *  what lets a player — or a Critic reading the chronicle later — tell a narrow
 *  miss from a hopeless one. */
export interface WaitPayload {
  entityId: string;
}

export interface ItemTakenPayload {
  entityId: string;
  itemId: string;
  grants: Stats;
}

/** A rule entering play. The rule is carried whole rather than by reference,
 *  because the log is the only store — there is nowhere else to look it up, and
 *  a world's ruleset must be reconstructible from its chain alone. */
export interface RuleRatifiedPayload {
  rule: Rule;
}

/**
 * A rule that fired, and what it did.
 *
 * The effects are recorded rather than the conditions, deliberately. Replay
 * applies what happened; it never re-decides it. A reducer that re-evaluated
 * `require` would let a rule ratified today rewrite what a run did last week.
 */
export interface RuleFiredPayload {
  ruleId: string;
  actorId: string;
  /**
   * What the rule actually did, with every "who" and "where" already worked
   * out — "thing-1's health to 2", not "harm the other party by 3".
   *
   * Resolved rather than authored so the reducer never has to re-derive who
   * "the other party" was or where the walls are. Replay applies outcomes; it
   * never re-decides them, which is what keeps folded history stable as the
   * vocabulary grows.
   */
  outcomes: Resolved[];
}

export interface StrikePayload {
  attackerId: string;
  targetId: string;
  roll: number;
  needed: number;
  hit: boolean;
  /** A natural 20: always lands, damage already doubled in `damage`. Recorded
   *  so replay and the Surprise lens read the blow the way it happened. */
  crit: boolean;
  damage: number;
}

/** An event before it has been hashed and linked into a chain.
 *
 *  `rngCounter` is the generator's counter *before* the command ran.
 *  `rngDraws` is how many draws it consumed. `apply` advances the stored
 *  counter by exactly that, for every type without exception — so an event
 *  that consumes nothing says so explicitly rather than by omission. */
export type DraftEvent =
  | { type: 'WORLD_INIT'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldInitPayload }
  | { type: 'MOVE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: MovePayload }
  | { type: 'MOVE_BLOCKED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: MoveBlockedPayload }
  | { type: 'TURN_ADVANCED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: TurnAdvancedPayload }
  | { type: 'STRIKE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: StrikePayload }
  | { type: 'WAIT'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WaitPayload }
  | { type: 'ITEM_TAKEN'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: ItemTakenPayload }
  | { type: 'RULE_RATIFIED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: RuleRatifiedPayload }
  | { type: 'RULE_FIRED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: RuleFiredPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
