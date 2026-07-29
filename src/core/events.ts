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
  WORLD_INIT: 11,
  WORLD_BIBLE: 1,
  WORLD_BODIES: 1,
  MOVE: 2,
  MOVE_BLOCKED: 2,
  TURN_ADVANCED: 2,
  STRIKE: 5,
  WAIT: 1,
  DRAWN: 1,
  ITEM_TAKEN: 4,
  ITEM_USED: 2,
  RULE_RATIFIED: 1,
  RULE_FIRED: 1,
  VIGIL_KEPT: 1,
  WORLD_STIRRED: 1,
  SHOVE: 1,
  BRACED: 1,
  CALLED: 1,
  WORLD_REMEMBERED: 1,
  UNMASKED: 1,
} as const;

export type EventType = keyof typeof SCHEMA_VERSIONS;

export interface EntitySeed {
  id: string;
  kind: string;
  pos: Pos;
  stats: Stats;
  tags: string[];
  /** v10, the dispositions (the living-dungeon pass): how this creature
   *  holds its ground when nothing is hunted. A `guard` owns a place — it
   *  hunts only within GUARD_LEASH of its post and walks home when the
   *  leash empties; a `wander` walks its recorded route. Absence reads
   *  exactly the old way: stand, hunt within awareness, freeze where the
   *  scent went cold. */
  disposition?: 'guard' | 'wander';
  /** v10. The wanderer's round: waypoints drawn at generation (room
   *  centers — counted draws like every birth choice), walked in a cycle.
   *  Recorded rather than derived because the route is a fact about this
   *  creature's birth, and replay must walk the same round forever. */
  route?: Pos[];
  /** v11, the mimic: the item kind this creature wears on the map until
   *  it is unmasked. The lie lives entirely on the render side (the
   *  sibling engine's lesson) — dispatch, combat and replay all read the
   *  creature that was always here. Born with the `hidden` tag; the
   *  UNMASKED event strips it. */
  guise?: string;
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
  /** v8 carried one kind; v9 carries the ordered list (the second slot) —
   *  same reason as gear: a floor is new, what you carry is not. */
  playerSatchel?: { kinds: readonly string[] };
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
   *  must mint the same one forever. v4 adds `slot`: which of the two
   *  slots the take filled (absence reads the first — old chains carried
   *  one thing and it lived there). */
  satchel?: { swappedOut: string | null; slot?: number };
  /** v4, gear takes: the slot this relic was resolved into at command time
   *  (trait routing — a sling to the sling hand), and what came off it —
   *  kind AND grants, so the shed relic lands on the floor still worth
   *  wearing. Absence on either reads the legacy way: slot re-derived
   *  from grants, nothing minted — old chains refold exactly as they
   *  always did (M4: replay applies, never re-decides). */
  gearSlot?: string;
  shed?: { kind: string; grants: Stats } | null;
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
  /** v2. Which slot was spent (absence reads the first). Recorded so replay
   *  empties the same hand forever; what remains compacts forward. */
  slot?: number;
  effect:
    | { kind: 'draught'; healedTo: number; ceilingTo: number }
    | { kind: 'smoke'; until: number; at: Pos; unfooled: string[] }
    // The flare: knowledge, not power. Where it burst and how far light
    // reached — the fog derivation reads this straight off the chain, so a
    // rewind un-knows it exactly.
    | { kind: 'flare'; at: Pos; radius: number }
    // The wider pantry (designer's word after the 929-second run). New
    // VALUES in an existing field, never new machinery — the magic-modes
    // doctrine — so the version holds at 2 and old chains fold unchanged.
    // The ward is worn until a blow spends it (the tag is the state; the
    // spending is recorded on the STRIKE that paid it).
    | { kind: 'ward' }
    // Who staggered, resolved at command time: replay applies the list.
    | { kind: 'burr'; staggered: string[] }
    // Knowledge, never power: where the way out stands and where the
    // unfound prizes lie. The fog reads it straight off the chain.
    | { kind: 'bell'; exit: Pos; prizes: Pos[] };
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
  /** v4, the modes: how far the blow flew. Absent reads melee (the motif
   *  precedent — old chains fold unchanged, no upcaster). An open door on
   *  purpose: later modes (a bolt, a blast) are new values here plus their
   *  own eligibility gates at command time, never new machinery — the
   *  reducer applies recorded outcomes whatever the mode says. */
  mode?: 'melee' | 'ranged';
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
  /** v5. The target's ward drank this blow whole: damage recorded 0, no
   *  venom, no flinch, and the reducer spends the warding (strips the tag).
   *  Absent reads unwarded — the mode precedent, no upcaster. */
  warded?: boolean;
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

/** The drawn stance — covenant M8's warning, on the chain. Anyone's: the
 *  slinger's and the player's draws are one event, because the discipline
 *  is one discipline. The reducer writes the tag; waiting alone preserves
 *  it; every other act by the holder — and any blow or reel that finds
 *  them — shakes the shot loose unfired. */
export interface DrawnPayload {
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

/**
 * The world setting a run down in words — the Chronicler's remembrance,
 * written by a model that read the whole chain and validated hard before it
 * touched the log (the WORLD_BIBLE precedent: model text may enter history
 * only through a gate). Appended once at a run's end, after the last turn:
 * it changes no state and no draw, so replay is untouched — it is the one
 * event that exists purely to be read.
 */
export interface WorldRememberedPayload {
  /** The remembrance itself, in the world's voice. */
  text: string;
  occasion: 'fallen' | 'won';
}

/** The reach for a prize that was never a prize. Walking onto a hidden
 *  mimic resolves to this instead of a move or a blow: the guise drops
 *  (the reducer strips `hidden`) and the spring loads (`ambush` written —
 *  the stalker's own machinery, so the mimic's first landed blow rolls
 *  one band harder with no new combat code). The move is spent; you got
 *  close enough to touch it. Draws nothing — the reveal is a fact, not
 *  a roll. */
export interface UnmaskedPayload {
  mimicId: string;
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
  | { type: 'DRAWN'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: DrawnPayload }
  | { type: 'CALLED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: CalledPayload }
  | { type: 'WORLD_REMEMBERED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: WorldRememberedPayload }
  | { type: 'UNMASKED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: UnmaskedPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
