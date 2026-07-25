import type { Pos, Stats } from './entity.js';

/** Per event type. Bump when a type's meaning changes, and write an upcaster.
 *
 *  v2 moved randomness accounting onto the envelope: every event now carries
 *  `rngDraws`, and `apply` advances the counter by it uniformly. Before this,
 *  only WORLD_INIT moved the counter, via a `counterAfter` field buried in its
 *  payload — a special case that could not survive any second consumer of
 *  randomness, and combat is one. */
export const SCHEMA_VERSIONS = {
  WORLD_INIT: 2,
  MOVE: 2,
  MOVE_BLOCKED: 2,
  TURN_ADVANCED: 2,
} as const;

export type EventType = keyof typeof SCHEMA_VERSIONS;

export interface WorldInitPayload {
  width: number;
  height: number;
  tiles: number[];
  seed: number;
  player: { id: string; kind: string; pos: Pos; stats: Stats; tags: string[] };
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
  | { type: 'TURN_ADVANCED'; schemaVersion: number; rngCounter: number; rngDraws: number; payload: TurnAdvancedPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
