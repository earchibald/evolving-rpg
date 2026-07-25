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
    payload: {
      width,
      height,
      tiles: [...generated.grid.tiles],
      seed,
      counterAfter: generated.counterAfter,
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
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    throw new Error(`attemptMove: expected a single step, got (${dx}, ${dy})`);
  }
  const mover = findEntity(state.entities, entityId);
  if (mover === undefined) throw new Error(`attemptMove: no entity ${entityId}`);

  const to = { x: mover.pos.x + dx, y: mover.pos.y + dy };

  if (!inBounds(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      payload: { entityId, attempted: to, reason: 'out-of-bounds' },
    };
  }
  if (!isPassable(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
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
      payload: { entityId, attempted: to, reason: 'occupied' },
    };
  }

  return {
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: state.rngCounter,
    payload: { entityId, from: { x: mover.pos.x, y: mover.pos.y }, to },
  };
}

export function advanceTurn(state: GameState): Extract<DraftEvent, { type: 'TURN_ADVANCED' }> {
  const { activeEntityId, wrapped } = nextActive(state.entities, state.activeEntityId);
  return {
    type: 'TURN_ADVANCED',
    schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
    rngCounter: state.rngCounter,
    payload: { activeEntityId, turn: wrapped ? state.turn + 1 : state.turn },
  };
}
