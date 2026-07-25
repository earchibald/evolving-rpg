import { FLOOR, idx, isPassable } from './grid.js';
import type { Grid } from './grid.js';

/** Flood fill over passable tiles, 4-directional. Returns tile indices. */
export function reachableFrom(grid: Grid, x: number, y: number): Set<number> {
  const seen = new Set<number>();
  if (!isPassable(grid, x, y)) return seen;

  const stack: Array<readonly [number, number]> = [[x, y]];
  seen.add(idx(grid, x, y));

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const [cx, cy] = current;
    const neighbours: Array<readonly [number, number]> = [
      [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (!isPassable(grid, nx, ny)) continue;
      const i = idx(grid, nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export function floorCount(grid: Grid): number {
  let n = 0;
  for (const t of grid.tiles) if (t === FLOOR) n += 1;
  return n;
}
