import { FLOOR, WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import { intBetween } from './rng.js';
import { reachableFrom, floorCount } from './reachability.js';

export interface MapGenResult {
  grid: Grid;
  start: { x: number; y: number };
  counterAfter: number;
}

const MIN_REACHABLE_FRACTION = 0.6;
const MAX_ATTEMPTS = 20;

/**
 * Scatters walls at random, then keeps the layout only if most of the floor can
 * be walked to from the start. Deliberately crude — better generation is a
 * later increment. Retries consume extra counters, which is wanted.
 */
export function generateMap(
  seed: number,
  counter: number,
  width: number,
  height: number,
  wallCount: number,
): MapGenResult {
  let c = counter;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const tiles = new Array<number>(width * height).fill(FLOOR);

    for (let i = 0; i < wallCount; i += 1) {
      const wx = intBetween(seed, c, 0, width - 1); c += 1;
      const wy = intBetween(seed, c, 0, height - 1); c += 1;
      tiles[wy * width + wx] = WALL;
    }

    const sx = intBetween(seed, c, 0, width - 1); c += 1;
    const sy = intBetween(seed, c, 0, height - 1); c += 1;
    tiles[sy * width + sx] = FLOOR;

    const grid = makeGrid(width, height, tiles);
    if (reachableFrom(grid, sx, sy).size >= floorCount(grid) * MIN_REACHABLE_FRACTION) {
      return { grid, start: { x: sx, y: sy }, counterAfter: c };
    }
  }

  throw new Error(
    `generateMap: no acceptable layout in ${MAX_ATTEMPTS} attempts (seed ${seed}, ${width}x${height}, ${wallCount} walls)`,
  );
}
