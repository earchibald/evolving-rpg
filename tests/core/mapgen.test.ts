import { generateMap } from '../../src/core/mapgen.js';
import { isPassable, FLOOR } from '../../src/core/grid.js';
import { reachableFrom, floorCount } from '../../src/core/reachability.js';

describe('generateMap', () => {
  it('is deterministic for the same seed and counter', () => {
    const a = generateMap(1234, 0, 24, 16, 60);
    const b = generateMap(1234, 0, 24, 16, 60);
    expect(a.grid.tiles).toEqual(b.grid.tiles);
    expect(a.start).toEqual(b.start);
    expect(a.counterAfter).toBe(b.counterAfter);
  });

  it('produces different maps for different seeds', () => {
    const a = generateMap(1, 0, 24, 16, 60);
    const b = generateMap(2, 0, 24, 16, 60);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('always leaves the start standable', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, start } = generateMap(seed, 0, 24, 16, 60);
      expect(isPassable(grid, start.x, start.y)).toBe(true);
    }
  });

  it('keeps most of the floor reachable from the start', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, start } = generateMap(seed, 0, 24, 16, 60);
      const reachable = reachableFrom(grid, start.x, start.y);
      expect(reachable.size).toBeGreaterThanOrEqual(floorCount(grid) * 0.6);
    }
  });

  it('advances the counter past every draw it made', () => {
    const { counterAfter } = generateMap(7, 0, 24, 16, 60);
    // 2 draws per wall, plus 2 for the start, on at least one attempt
    expect(counterAfter).toBeGreaterThanOrEqual(60 * 2 + 2);
  });

  it('respects a non-zero starting counter', () => {
    const a = generateMap(7, 0, 24, 16, 60);
    const b = generateMap(7, 500, 24, 16, 60);
    expect(b.counterAfter).toBeGreaterThan(500);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('has the right tile count and only known tile values', () => {
    const { grid } = generateMap(9, 0, 12, 8, 20);
    expect(grid.tiles.length).toBe(96);
    for (const t of grid.tiles) expect([0, 1]).toContain(t);
  });

  it('gives up loudly rather than returning a map you cannot walk in', () => {
    // Every tile a wall request: no layout can satisfy the reachability bar.
    expect(() => generateMap(3, 0, 6, 6, 100000)).toThrow(/no acceptable layout/);
  });
});
