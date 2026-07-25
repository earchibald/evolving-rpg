import { generateMap } from './mapgen.js';
import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { nextActive } from './turns.js';
import { SCHEMA_VERSIONS } from './events.js';
import type { DraftEvent } from './events.js';
import type { GameState } from './state.js';

const STARTING_STATS = { hp: 10, might: 3, wits: 3, speed: 4 } as const;

export function createWorld(
  seed: number,
  width: number,
  height: number,
  wallCount: number,
  playerId = 'player',
): Extract<DraftEvent, { type: 'WORLD_INIT' }> {
  const generated = generateMap(seed, 0, width, height, wallCount);
  return {
    type: 'WORLD_INIT',
    schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0,
    // Generation started from counter 0, so the counter it finished on is
    // exactly the number of draws it consumed.
    rngDraws: generated.counterAfter,
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
  const occupied = state.entities.some(
    (o) => o.id !== entityId && isAlive(o) && o.pos.x === to.x && o.pos.y === to.y,
  );
  if (occupied) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, attempted: to, reason: 'occupied' },
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
