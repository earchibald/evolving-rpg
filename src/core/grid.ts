export const FLOOR = 0;
export const WALL = 1;

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
  return { width, height, tiles: [...tiles] };
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

export function isPassable(grid: Grid, x: number, y: number): boolean {
  return tileAt(grid, x, y) === FLOOR;
}
