import type { Pos, Stats } from './entity.js';

/** Per event type. Bump when a type's meaning changes, and write an upcaster. */
export const SCHEMA_VERSIONS = {
  WORLD_INIT: 1,
  MOVE: 1,
  MOVE_BLOCKED: 1,
  TURN_ADVANCED: 1,
} as const;

export type EventType = keyof typeof SCHEMA_VERSIONS;

export interface WorldInitPayload {
  width: number;
  height: number;
  tiles: number[];
  seed: number;
  counterAfter: number;
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

/** An event before it has been hashed and linked into a chain. */
export type DraftEvent =
  | { type: 'WORLD_INIT'; schemaVersion: number; rngCounter: number; payload: WorldInitPayload }
  | { type: 'MOVE'; schemaVersion: number; rngCounter: number; payload: MovePayload }
  | { type: 'MOVE_BLOCKED'; schemaVersion: number; rngCounter: number; payload: MoveBlockedPayload }
  | { type: 'TURN_ADVANCED'; schemaVersion: number; rngCounter: number; payload: TurnAdvancedPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
