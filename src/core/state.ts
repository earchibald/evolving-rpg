import { WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import type { Entity } from './entity.js';

/** `readonly` throughout, matching `Grid`'s convention, because `apply()` is
 *  required to be pure — the type should refuse in-place mutation rather than
 *  rely on every future reducer remembering not to. `readonly Entity[]` still
 *  permits `map`, `find` and spread; it removes only `push`, `splice` and
 *  index assignment. */
export interface GameState {
  readonly grid: Grid;
  readonly entities: readonly Entity[];
  readonly turn: number;
  readonly activeEntityId: string | null;
  readonly seed: number;
  readonly rngCounter: number;
}

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

/** What a fold starts from. A WORLD_INIT event replaces it wholesale.
 *  Frozen as well as typed readonly: every fold in the process shares this one
 *  object, so a reducer that mutated its accumulator in place would corrupt the
 *  baseline for every later replay and fail somewhere far from the cause. */
export const EMPTY_STATE: GameState = Object.freeze({
  grid: makeGrid(1, 1, [WALL]),
  entities: NO_ENTITIES,
  turn: 0,
  activeEntityId: null,
  seed: 0,
  rngCounter: 0,
});
