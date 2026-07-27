export const FLOOR = 0;
export const WALL = 1;
/** The way out. Walkable like floor — it is a place, not an object, which is
 *  why it lives in the tiles rather than in a list of things. */
export const EXIT = 2;
/** An illusory wall: LOOKS like wall and blocks sight until the player has
 *  trodden it, but was always walkable — walking into it is how it is found.
 *  Mechanically floor, visually wall, and only the PLAY view is ever fooled:
 *  creatures and bots path by passability, so everything that lives here
 *  knows every secret door by construction. */
export const SECRET = 3;

export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

export function makeGrid(width: number, height: number, tiles: readonly number[]): Grid {
  if (width <= 0 || height <= 0) throw new Error(`makeGrid: bad size ${width}x${height}`);
  if (tiles.length !== width * height) {
    throw new Error(`makeGrid: expected ${width * height} tiles, got ${tiles.length}`);
  }
  // Frozen as well as copied. EMPTY_STATE.grid is the one grid every fold in
  // the process shares as its baseline, and `readonly` alone stops nothing at
  // runtime — a cast, or JSON-sourced data, writes straight through it.
  return Object.freeze({ width, height, tiles: Object.freeze([...tiles]) });
}

export function idx(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** Outside the grid reads as solid, so callers never need a bounds check first. */
export function tileAt(grid: Grid, x: number, y: number): number {
  if (!inBounds(grid, x, y)) return WALL;
  return grid.tiles[idx(grid, x, y)] ?? WALL;
}

/** Anything that is not wall. Stated as a negative on purpose: every tile kind
 *  added from here — exit, and whatever comes after — is walkable unless it
 *  says otherwise, so a new kind cannot become accidentally impassable by
 *  nobody remembering to add it to a list. */
export function isPassable(grid: Grid, x: number, y: number): boolean {
  return tileAt(grid, x, y) !== WALL;
}
