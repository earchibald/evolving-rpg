import { generateMap, pickSpawnPoints, farthestFrom, withExit } from './mapgen.js';
import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { intBetween } from './rng.js';
import { neededToHit, chanceIn20, damageDice, critFloor, WHIFF, BESTIARY, creatureStats, threatOf, spawnBudget, depthBands, wardenAt, ARMORY, relicGrant } from './tables.js';
import type { Entity, Stats } from './entity.js';
import { itemAt } from './item.js';
import { EXIT, tileAt } from './grid.js';
import { nextActive } from './turns.js';
import { MAX_RULES } from '../canon/rule.js';
import type { Rule } from '../canon/rule.js';
import { SCHEMA_VERSIONS } from './events.js';
import type { DraftEvent } from './events.js';
import type { GameState } from './state.js';

const STARTING_STATS = { hp: 10, might: 3, wits: 3, speed: 4 } as const;

/** Fewer hit points than you, and it hits harder. One is a fight you win while
 *  losing blood; two at once is a fight you lose. That gap is the whole reason
 *  avoiding something, or detouring for an edge, can be the better move. */


/** Far enough that nothing is already on top of you when the world opens. */
export const OPPONENT_MIN_DISTANCE = 8;

/** A strike always consumes two draws — the roll, then the damage — whether or
 *  not it lands. Spending the same count either way keeps the counter's
 *  progress independent of the outcome, so a replay lands on identical draws
 *  without needing to know what happened. */
export const STRIKE_DRAWS = 2;

/**
 * Whether one creature will attack another: the world against you, never
 * against itself. The old rule — different kinds fight — was written when
 * every creature was a 'thing'; a mixed bestiary under it would brawl among
 * itself on the way to the player, and a dungeon that clears its own floors
 * is a hallway.
 */
export function isHostile(a: Entity, b: Entity): boolean {
  return (a.kind === 'you') !== (b.kind === 'you');
}

/**
 * Resolves a blow. Legible on purpose: you need `10 + their speed - your might`
 * or better on a d20, and deal 1 to your might. A player can hold that in their
 * head and decide whether a fight is worth taking, which is what makes avoiding
 * one a decision rather than a coin toss.
 */
/**
 * What `attacker` needs on a d20 to land a blow on `target`.
 *
 * Exported because a number you decide on has to be a number you can see. The
 * stat block says `might 3`; it does not say "you hit on 10+ and deal 1 to 3",
 * and the second is the one a player actually weighs. Playing found this: a +2
 * might item raises damage per turn by about three quarters and read as having
 * done nothing at all, because nothing ever said so.
 */
export function toHit(attacker: Entity, target: Entity): number {
  return neededToHit(attacker.stats.might, target.stats.speed);
}

/** The chance, out of 20, that the blow lands. */
export function hitChance(attacker: Entity, target: Entity): number {
  return chanceIn20(toHit(attacker, target));
}

function resolveStrike(
  seed: number,
  counter: number,
  attacker: Entity,
  target: Entity,
): { roll: number; needed: number; hit: boolean; damage: number; crit: boolean } {
  const roll = intBetween(seed, counter, 1, 20);
  const needed = toHit(attacker, target);

  // The naturals outrank the arithmetic: the crit band always lands and
  // doubles, a 1 always misses. Wits widens the band — the one mechanical job
  // wits has, so a rule granting it grants something real.
  const crit = roll >= critFloor(attacker.stats.wits);
  const hit = crit || (roll !== WHIFF && roll >= needed);

  // Drawn either way, so the draw count never depends on the outcome. The
  // crit doubles this same draw rather than taking another.
  const { die, flat } = damageDice(attacker.stats.might);
  const rolledDamage = intBetween(seed, counter + 1, 1, die) + flat;
  return { roll, needed, hit, crit, damage: hit ? (crit ? rolledDamage * 2 : rolledDamage) : 0 };
}

/** The player as a floor receives them: stats, ceiling and progress carried
 *  whole from the floor above. */
export interface CarriedPlayer {
  stats: Stats;
  maxHp: number;
  xp: number;
  level: number;
}

/**
 * Chooses this floor's population from the bestiary, spending the depth's
 * threat budget. Every choice is a counted draw, so generation stays inside
 * the draw protocol.
 *
 * Two-stage pick per creature: a depth band (mostly here, sometimes one up,
 * rarely one down — the Brogue blur), then an archetype by weight. Spending
 * stops when the budget cannot afford the cheapest thing left, so a floor is
 * always as full as its budget allows. The warden joins on its floors without
 * consuming budget: a boss is the floor's *feature*, not part of its rent.
 */
function chooseSpawns(seed: number, counter: number, depth: number): {
  chosen: { kind: string; level: number; stats: Stats }[];
  counterAfter: number;
} {
  const chosen: { kind: string; level: number; stats: Stats }[] = [];
  const spawnable = BESTIARY.filter((a) => a.weight > 0);
  let budget = spawnBudget(depth);
  let c = counter;

  // A boss floor is a peak, not a double peak: the warden pays half its own
  // threat out of the floor's budget, so its minions thin out around it and
  // the fight is about the warden rather than the crowd it stands in.
  if (wardenAt(depth)) {
    const level = Math.max(1, Math.floor(depth / 3));
    budget -= Math.floor(threatOf(creatureStats('warden', level)!) / 2);
  }

  const cheapest = (): number => Math.min(
    ...spawnable.map((a) => threatOf(creatureStats(a.kind, Math.max(1, depth - 1))!)),
  );

  for (let guard = 0; guard < 32 && budget >= cheapest(); guard += 1) {
    const bands = depthBands(depth);
    const bandTotal = bands.reduce((n, b) => n + b.weight, 0);
    let roll = intBetween(seed, c, 1, bandTotal); c += 1;
    let level = bands[0]!.level;
    for (const band of bands) {
      roll -= band.weight;
      if (roll <= 0) { level = band.level; break; }
    }

    const archTotal = spawnable.reduce((n, a) => n + a.weight, 0);
    let pick = intBetween(seed, c, 1, archTotal); c += 1;
    let arch = spawnable[0]!;
    for (const a of spawnable) {
      pick -= a.weight;
      if (pick <= 0) { arch = a; break; }
    }

    const stats = creatureStats(arch.kind, level)!;
    const price = threatOf(stats);
    if (price > budget) continue; // rolled above our means; roll again
    budget -= price;
    chosen.push({ kind: level === 1 ? arch.kind : `${arch.kind}-${String(level)}`, level, stats });
  }

  if (wardenAt(depth)) {
    const level = Math.max(1, Math.floor(depth / 3));
    chosen.push({ kind: level === 1 ? 'warden' : `warden-${String(level)}`, level, stats: creatureStats('warden', level)! });
  }

  return { chosen, counterAfter: c };
}

export function createWorld(
  seed: number,
  width: number,
  height: number,
  wallCount: number,
  playerId = 'player',
  depth = 1,
  carried?: CarriedPlayer,
): Extract<DraftEvent, { type: 'WORLD_INIT' }> {
  const generated = generateMap(seed, 0, width, height, wallCount);

  // The way out sits at the far end of the map, so a run has a direction and
  // the journey is the longest one this world affords rather than an accident.
  const exit = farthestFrom(generated.grid, generated.start);
  const grid = withExit(generated.grid, exit);

  const population = chooseSpawns(seed, generated.counterAfter, depth);

  // The floor's prize, drawn from the armory by weight — a counted draw like
  // every other choice generation makes.
  const armoryTotal = ARMORY.reduce((n, r) => n + r.weight, 0);
  let relicRoll = intBetween(seed, population.counterAfter, 1, armoryTotal);
  let relic = ARMORY[0]!;
  for (const r of ARMORY) {
    relicRoll -= r.weight;
    if (relicRoll <= 0) { relic = r; break; }
  }

  const spawned = pickSpawnPoints(
    seed,
    population.counterAfter + 1,
    grid,
    generated.start,
    population.chosen.length,
    OPPONENT_MIN_DISTANCE,
  );

  // Placed on the last creature's tile: the edge is guarded, so taking it means
  // going through something. An item you can pick up for free is not a choice.
  const guarded = spawned.points[spawned.points.length - 1] ?? exit;

  return {
    type: 'WORLD_INIT',
    schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0,
    // Generation started from counter 0, so the counter it finished on after
    // placing inhabitants is exactly the number of draws it consumed.
    rngDraws: spawned.counterAfter,
    payload: {
      width,
      height,
      tiles: [...grid.tiles],
      seed,
      depth,
      xp: carried?.xp ?? 0,
      level: carried?.level ?? 1,
      ...(carried === undefined ? {} : { playerMaxHp: carried.maxHp }),
      items: [{
        id: 'relic-1',
        kind: relic.kind,
        pos: { x: guarded.x, y: guarded.y },
        grants: relicGrant(relic, depth),
      }],
      player: {
        id: playerId,
        kind: 'you',
        pos: { x: generated.start.x, y: generated.start.y },
        stats: carried === undefined ? { ...STARTING_STATS } : { ...carried.stats },
        tags: [],
      },
      opponents: population.chosen.map((c, i) => ({
        id: `foe-${String(i + 1)}`,
        kind: c.kind,
        pos: { x: spawned.points[i]?.x ?? exit.x, y: spawned.points[i]?.y ?? exit.y },
        stats: { ...c.stats },
        tags: [],
      })),
    },
  };
}

export function attemptMove(state: GameState, entityId: string, dx: number, dy: number): DraftEvent {
  // Integers as well as magnitude: (0.5, 0.5) sums to exactly 1, so a
  // magnitude-only guard would land the player between tiles — and from a
  // fractional position every later move reads as blocked, because a
  // non-integer array index resolves to undefined.
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) {
    throw new Error(`attemptMove: expected a single orthogonal step, got (${dx}, ${dy})`);
  }
  const mover = findEntity(state.entities, entityId);
  if (mover === undefined) throw new Error(`attemptMove: no entity ${entityId}`);

  const to = { x: mover.pos.x + dx, y: mover.pos.y + dy };

  if (!inBounds(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, attempted: to, reason: 'out-of-bounds' },
    };
  }
  if (!isPassable(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, attempted: to, reason: 'wall' },
    };
  }
  const occupant = state.entities.find(
    (o) => o.id !== entityId && isAlive(o) && o.pos.x === to.x && o.pos.y === to.y,
  );
  if (occupant !== undefined) {
    // Bump to attack — no separate key. Walking into something hostile is the
    // attack, which keeps the whole game on four inputs.
    if (!isHostile(mover, occupant)) {
      return {
        type: 'MOVE_BLOCKED',
        schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
        rngCounter: state.rngCounter,
        rngDraws: 0,
        payload: { entityId, attempted: to, reason: 'occupied' },
      };
    }

    const outcome = resolveStrike(state.seed, state.rngCounter, mover, occupant);
    return {
      type: 'STRIKE',
      schemaVersion: SCHEMA_VERSIONS.STRIKE,
      rngCounter: state.rngCounter,
      rngDraws: STRIKE_DRAWS,
      payload: { attackerId: entityId, targetId: occupant.id, ...outcome },
    };
  }

  return {
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId, from: { x: mover.pos.x, y: mover.pos.y }, to },
  };
}

/**
 * Whether an action ends the actor's turn.
 *
 * A refused action costs nothing: walking into a wall is a mispress, not a
 * decision, and charging a turn for it hands a free hit to whatever is standing
 * next to you. The rule lives here rather than in the view because the view is
 * a throwaway harness and this is a rule of the game — the next caller would
 * otherwise reproduce the bug, and this is exactly the kind of statement that
 * later becomes a declarative rule rather than a function.
 */
export function endsTurn(draft: DraftEvent): boolean {
  // ITEM_TAKEN rides along with the move that reached it, so it must not spend
  // a second turn of its own.
  return draft.type !== 'MOVE_BLOCKED' && draft.type !== 'ITEM_TAKEN';
}

/**
 * Holding position.
 *
 * Without this, time passes only when you move — so a player could never let
 * something come to them and had to walk into its reach instead. Found by
 * playing: blocked moves correctly cost no turn, which left no way at all to
 * spend one deliberately.
 */
export function wait(state: GameState, entityId: string): Extract<DraftEvent, { type: 'WAIT' }> {
  return {
    type: 'WAIT',
    schemaVersion: SCHEMA_VERSIONS.WAIT,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId },
  };
}

/** What is underfoot, if anything worth having. */
export function takeUnderfoot(
  state: GameState,
  entityId: string,
): Extract<DraftEvent, { type: 'ITEM_TAKEN' }> | null {
  const taker = findEntity(state.entities, entityId);
  if (taker === undefined) return null;

  const item = itemAt(state.items, taker.pos.x, taker.pos.y);
  if (item === undefined) return null;

  return {
    type: 'ITEM_TAKEN',
    schemaVersion: SCHEMA_VERSIONS.ITEM_TAKEN,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId, itemId: item.id, grants: { ...item.grants } },
  };
}

export type Outcome = 'playing' | 'escaped' | 'dead';

/**
 * How the run stands.
 *
 * Derived rather than stored, and no event records it. Standing on the exit is
 * escaping and no hit points is dying — both already true in the state, and a
 * second recording of a fact is a second thing that can disagree with the
 * first. The same reason canon is folded rather than kept.
 */
export function outcome(state: GameState, playerId = 'player'): Outcome {
  const player = findEntity(state.entities, playerId);
  if (player === undefined || !isAlive(player)) return 'dead';
  if (tileAt(state.grid, player.pos.x, player.pos.y) === EXIT) return 'escaped';
  return 'playing';
}

/**
 * Puts a rule into play.
 *
 * The cap is enforced here rather than at validation because it is a property
 * of a *world*, not of a rule: the same rule may be perfectly ratifiable in a
 * fork that has room for it. Throwing rather than returning a rejection is
 * deliberate — by this point the player has already said yes, so a full
 * ruleset is a bug in whatever offered the choice, not a routine outcome.
 */
export function ratifyRule(state: GameState, rule: Rule): Extract<DraftEvent, { type: 'RULE_RATIFIED' }> {
  if (state.rules.length >= MAX_RULES) {
    throw new Error(`ratify: this world already holds the limit of ${MAX_RULES} rules`);
  }
  return {
    type: 'RULE_RATIFIED',
    schemaVersion: SCHEMA_VERSIONS.RULE_RATIFIED,
    rngCounter: state.rngCounter,
    // Rules never consume randomness. See the interpreter for why that is a
    // load-bearing guarantee rather than an accident.
    rngDraws: 0,
    payload: { rule },
  };
}

export function advanceTurn(state: GameState): Extract<DraftEvent, { type: 'TURN_ADVANCED' }> {
  const { activeEntityId, wrapped } = nextActive(state.entities, state.activeEntityId);
  return {
    type: 'TURN_ADVANCED',
    schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { activeEntityId, turn: wrapped ? state.turn + 1 : state.turn },
  };
}
