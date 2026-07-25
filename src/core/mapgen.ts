import { FLOOR, WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import { intBetween } from './rng.js';
import { reachableFrom } from './reachability.js';

export interface SpawnResult {
  points: Array<{ x: number; y: number }>;
  counterAfter: number;
}

/**
 * Chooses where a world's inhabitants stand.
 *
 * Candidates are the tiles genuinely reachable from the start and at least
 * `minDistance` away, so nothing is already breathing on you when the world
 * opens and nothing is sealed somewhere you can never reach. Picking by index
 * out of a shrinking list guarantees distinct tiles in exactly one draw each,
 * rather than rejection-sampling an unbounded number of times.
 *
 * Returns fewer points than asked for rather than looping forever if the
 * reachable area is too small — a cramped map is a reason to have fewer
 * creatures in it, not a reason to hang.
 */
export function pickSpawnPoints(
  seed: number,
  counter: number,
  grid: Grid,
  start: { x: number; y: number },
  count: number,
  minDistance: number,
): SpawnResult {
  const reachable = reachableFrom(grid, start.x, start.y);
  const candidates: Array<{ x: number; y: number }> = [];

  for (const index of reachable) {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (Math.abs(x - start.x) + Math.abs(y - start.y) >= minDistance) candidates.push({ x, y });
  }
  // Set iteration order is insertion order, which depends on the flood fill's
  // traversal — deterministic, but sort anyway so the choice never depends on
  // an implementation detail of reachableFrom.
  candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const points: Array<{ x: number; y: number }> = [];
  let c = counter;

  for (let i = 0; i < count && candidates.length > 0; i += 1) {
    const pick = intBetween(seed, c, 0, candidates.length - 1);
    c += 1;
    const chosen = candidates[pick];
    if (chosen === undefined) break;
    points.push(chosen);
    candidates.splice(pick, 1);
  }

  return { points, counterAfter: c };
}

export interface MapGenResult {
  grid: Grid;
  start: { x: number; y: number };
  counterAfter: number;
}

/** Share of the WHOLE grid that must be walkable and connected to the start.
 *  Measured against every tile rather than against surviving floor, because a
 *  fraction of floor is trivially satisfied by a map that is nearly all wall —
 *  one floor tile is 100% connected to itself and tells you nothing. */
const MIN_REACHABLE_FRACTION = 0.6;
const MAX_ATTEMPTS = 20;

/**
 * Scatters walls at random, then keeps the layout only if most of the grid can
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
    if (reachableFrom(grid, sx, sy).size >= width * height * MIN_REACHABLE_FRACTION) {
      return { grid, start: { x: sx, y: sy }, counterAfter: c };
    }
  }

  throw new Error(
    `generateMap: no acceptable layout in ${MAX_ATTEMPTS} attempts (seed ${seed}, ${width}x${height}, ${wallCount} walls)`,
  );
}
