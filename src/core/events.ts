import type { Rule, MotifName } from '../canon/rule.js';
import type { Bible } from '../canon/bible.js';
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
  WORLD_INIT: 8,
  WORLD_BIBLE: 1,
  WORLD_BODIES: 1,
  MOVE: 2,
  MOVE_BLOCKED: 2,
  TURN_ADVANCED: 2,
  STRIKE: 3,
  WAIT: 1,
  ITEM_TAKEN: 3,
  ITEM_USED: 1,
  RULE_RATIFIED: 1,
  RULE_FIRED: 1,
  VIGIL_KEPT: 1,
  WORLD_STIRRED: 1,
  SHOVE: 1,
  BRACED: 1,
  CALLED: 1,
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
  /** v8. What rides in the satchel across the stairs — same reason as gear:
   *  a floor is new, what you carry is not. */
  playerSatchel?: { kind: string };
  width: number;
  height: number;
  tiles: number[];
  seed: number;
  /** v6. The generator's account of what it built, in plain words — covenant
   *  L1. Recorded rather than derived, because "what generation decided" is a
   *  fact about this world's birth and the log is where facts live. */
  story?: string;
  /** v7. The cut this floor was shaped to — same philosophy as `story`: the
   *  motif is what generation decided, so the log says it. Older floors never
   *  said, and stay unsaid; `motifIs` reads absence as false, not as door. */
  motif?: MotifName;
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
  /** v3. This item rides in the satchel rather than being worn — and if a
   *  kind is named here, that is what was carried BEFORE, now set down on
   *  the tile the new thing was lifted from (the walk-over swap). Recorded
   *  rather than derived because the swap invents a floor item, and replay
   *  must mint the same one forever. */
  satchel?: { swappedOut: string | null };
}

/**
 * The satchel spent: one carried thing, used up, its effects resolved at
 * command time and applied verbatim forever after. The two shapes are the
 * two provisions — a draught's mend-and-raise, a smoke's stale scent. One
 * payload with a kind discriminant rather than two event types, because
 * "the satchel was spent" is one fact about the turn whichever it held.
 */
export interface ItemUsedPayload {
  entityId: string;
  kind: string;
  effect:
    | { kind: 'draught'; healedTo: number; ceilingTo: number }
    | { kind: 'smoke'; until: number; at: Pos; unfooled: string[] };
}

/** A rule entering play. The rule is carried whole rather than by reference,
 *  because the log is the only store — there is nowhere else to look it up, and
 *  a world's ruleset must be reconstructible from its chain alone. */
export interface RuleRatifiedPayload {
  rule: Rule;
}

/** The world's identity, decided whole (GESTALT.md). Carried whole for the
 *  same reason a rule is: the log is the only store. Validated hard before
 *  it is ever appended — this is model output headed for permanent history. */
export interface WorldBiblePayload {
  bible: Bible;
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
  /** v3, the verbs. Movement that is part of the blow itself, resolved at
   *  command time and recorded so replay applies rather than re-decides:
   *  a lunge carries the attacker to `attackerTo` before the blow lands; a
   *  trample shoves the target to `targetTo` with the attacker advancing
   *  into the vacated tile (`attackerTo` again) — atomic, so there is no
   *  in-between turn to kite through. Absent on ordinary blows. */
  attackerTo?: Pos;
  targetTo?: Pos;
  /** v3. This blow was the coiled spring released — damage rolled one band
   *  harder, and the reducer uncoils the attacker (removes the ambush tag).
   *  Recorded so the journal can say so and replay agrees forever. */
  ambush?: boolean;
}

/**
 * The player's shove: position as a weapon, dice not invited.
 *
 * Fully deterministic — displacement never misses (Into the Breach's rule:
 * a tool you reason with cannot be a tool that gambles). Three endings,
 * resolved at command time and recorded whole: driven into open ground
 * (`to`), driven into a wall or the door frame (`slammed` — SLAM_DAMAGE and
 * a stagger; the wall is the argument), or driven into another body
 * (`struckId` — both reel, nobody moves). Consumes zero draws.
 */
export interface ShovePayload {
  shoverId: string;
  targetId: string;
  /** Where the target ends up, or null when something denied the ground. */
  to: Pos | null;
  /** The wall (or the door frame) stopped them: SLAM_DAMAGE, staggered. */
  slammed: boolean;
  /** The body they were driven into, staggered along with them. */
  struckId: string | null;
}

/** The player set against the coming round. The stance is a tag the reducer
 *  writes and the player's next action of any kind removes — recorded as an
 *  event because standing guard is a decision that spends the turn, and the
 *  chronicle should tell it apart from simply standing. */
export interface BracedPayload {
  entityId: string;
}

/** A caller crying out, once, and the floor answering. The risers are fully
 *  resolved at command time (kinds, stats, tiles all drawn and recorded), so
 *  replay wakes the same things in the same places forever. The reducer
 *  spends the caller's voice — one call per life. */
export interface CalledPayload {
  callerId: string;
  opponents: EntitySeed[];
}

/** A warden back at its post with the intruder gone, knitting shut. The heal
 *  is an event because hit points may only change on the chain — and it is
 *  its own type rather than a STRIKE special case because "the fight reset"
 *  is a fact the journal, the lenses and a replay all deserve to read
 *  plainly. Fires only when the wound and the empty leash coincide, which
 *  makes it once per disengagement by construction. */
export interface VigilKeptPayload {
  entityId: string;
}

/** The seized world answering back: while the heart is carried across the
 *  bottom floor, the world stirs — new hostiles rise, fully resolved here
 *  (kind, stats, tile all drawn at command time) so replay raises the same
 *  dead the same way forever. The first stir may include echoes: the
 *  player's own past falls, standing up where the bodies lie. */
export interface WorldStirredPayload {
  opponents: EntitySeed[];
}

/** Where this world's dead lie on the floor a run is entering. Appended in
 *  the rebirth and descent ceremonies (identity, then the dead, then law) —
 *  never by WORLD_INIT itself, because the bodies are the graveyard's fact,
 *  not generation's: the same floor is born empty the first time and haunted
 *  the next, and the *world* did not change — the world's history did. */
export interface WorldBodiesPayload {
  bodies: Pos[];
}

/** An event before it has been hashed and linked into a chain.
 *
 *  `rngCounter` is the generator's counter *before* the command ran.
 *  `rngDraws` is how many draws it consumed. `apply` advances the stored
 *  counter by exactly that, for every type without exception — so an event
 *  that consumes nothing says so explicitly rather than by omission. */
export type DraftEvent =
  | { type: 'WORLD_INIT'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldInitPayload }
  | { type: 'WORLD_BIBLE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldBiblePayload }
  | { type: 'WORLD_BODIES'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldBodiesPayload }
  | { type: 'MOVE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: MovePayload }
  | { type: 'MOVE_BLOCKED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: MoveBlockedPayload }
  | { type: 'TURN_ADVANCED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: TurnAdvancedPayload }
  | { type: 'STRIKE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: StrikePayload }
  | { type: 'WAIT'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WaitPayload }
  | { type: 'ITEM_TAKEN'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: ItemTakenPayload }
  | { type: 'ITEM_USED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: ItemUsedPayload }
  | { type: 'RULE_RATIFIED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: RuleRatifiedPayload }
  | { type: 'RULE_FIRED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: RuleFiredPayload }
  | { type: 'VIGIL_KEPT'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: VigilKeptPayload }
  | { type: 'WORLD_STIRRED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldStirredPayload }
  | { type: 'SHOVE'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: ShovePayload }
  | { type: 'BRACED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: BracedPayload }
  | { type: 'CALLED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: CalledPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
