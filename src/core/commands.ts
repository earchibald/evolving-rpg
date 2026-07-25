import { generateMap, pickSpawnPoints } from './mapgen.js';
import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { intBetween } from './rng.js';
import type { Entity } from './entity.js';
import { nextActive } from './turns.js';
import { SCHEMA_VERSIONS } from './events.js';
import type { DraftEvent } from './events.js';
import type { GameState } from './state.js';

const STARTING_STATS = { hp: 10, might: 3, wits: 3, speed: 4 } as const;

/** Fewer hit points than you, and it hits harder. One is a fight you win while
 *  losing blood; two at once is a fight you lose. That gap is the whole reason
 *  avoiding something, or detouring for an edge, can be the better move. */
const OPPONENT_STATS = { hp: 5, might: 4, wits: 1, speed: 3 } as const;

export const OPPONENT_COUNT = 3;

/** Far enough that nothing is already on top of you when the world opens. */
export const OPPONENT_MIN_DISTANCE = 8;

/** A strike always consumes two draws — the roll, then the damage — whether or
 *  not it lands. Spending the same count either way keeps the counter's
 *  progress independent of the outcome, so a replay lands on identical draws
 *  without needing to know what happened. */
export const STRIKE_DRAWS = 2;

/**
 * Whether one creature will attack another. Different kinds are hostile; alike
 * kinds are not, which is what stops a crowd of them from brawling with each
 * other on the way to you.
 */
export function isHostile(a: Entity, b: Entity): boolean {
  return a.kind !== b.kind;
}

/**
 * Resolves a blow. Legible on purpose: you need `10 + their speed - your might`
 * or better on a d20, and deal 1 to your might. A player can hold that in their
 * head and decide whether a fight is worth taking, which is what makes avoiding
 * one a decision rather than a coin toss.
 */
function resolveStrike(
  seed: number,
  counter: number,
  attacker: Entity,
  target: Entity,
): { roll: number; needed: number; hit: boolean; damage: number } {
  const roll = intBetween(seed, counter, 1, 20);
  const needed = 10 + target.stats.speed - attacker.stats.might;
  const hit = roll >= needed;
  // Drawn either way, so the count does not depend on the outcome.
  const rolledDamage = intBetween(seed, counter + 1, 1, attacker.stats.might);
  return { roll, needed, hit, damage: hit ? rolledDamage : 0 };
}

export function createWorld(
  seed: number,
  width: number,
  height: number,
  wallCount: number,
  playerId = 'player',
): Extract<DraftEvent, { type: 'WORLD_INIT' }> {
  const generated = generateMap(seed, 0, width, height, wallCount);
  const spawned = pickSpawnPoints(
    seed,
    generated.counterAfter,
    generated.grid,
    generated.start,
    OPPONENT_COUNT,
    OPPONENT_MIN_DISTANCE,
  );

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
      tiles: [...generated.grid.tiles],
      seed,
      player: {
        id: playerId,
        kind: 'you',
        pos: { x: generated.start.x, y: generated.start.y },
        stats: { ...STARTING_STATS },
        tags: [],
      },
      opponents: spawned.points.map((p, i) => ({
        id: `thing-${i + 1}`,
        kind: 'thing',
        pos: { x: p.x, y: p.y },
        stats: { ...OPPONENT_STATS },
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
  return draft.type !== 'MOVE_BLOCKED';
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
