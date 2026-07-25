import { WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import type { Entity } from './entity.js';

export interface GameState {
  grid: Grid;
  entities: Entity[];
  turn: number;
  activeEntityId: string | null;
  seed: number;
  rngCounter: number;
}

/** What a fold starts from. A WORLD_INIT event replaces it wholesale. */
export const EMPTY_STATE: GameState = {
  grid: makeGrid(1, 1, [WALL]),
  entities: [],
  turn: 0,
  activeEntityId: null,
  seed: 0,
  rngCounter: 0,
};
