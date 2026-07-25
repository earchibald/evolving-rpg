import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import { reachableFrom, floorCount } from '../../src/core/reachability.js';

describe('reachableFrom', () => {
  it('finds the whole open grid', () => {
    const grid = makeGrid(3, 3, new Array(9).fill(FLOOR));
    expect(reachableFrom(grid, 1, 1).size).toBe(9);
  });

  it('does not cross a full wall, so a sealed room stays sealed', () => {
    // column x=1 is solid, splitting the grid in two
    const grid = makeGrid(3, 3, [
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
    ]);
    expect(reachableFrom(grid, 0, 0).size).toBe(3);
    expect(reachableFrom(grid, 2, 0).size).toBe(3);
  });

  it('does not move diagonally', () => {
    // (0,0) and (1,1) touch only at a corner
    const grid = makeGrid(2, 2, [
      FLOOR, WALL,
      WALL, FLOOR,
    ]);
    expect(reachableFrom(grid, 0, 0).size).toBe(1);
  });

  it('returns nothing when the start is not standable', () => {
    const grid = makeGrid(2, 1, [WALL, FLOOR]);
    expect(reachableFrom(grid, 0, 0).size).toBe(0);
  });
});

describe('floorCount', () => {
  it('counts only floor tiles', () => {
    const grid = makeGrid(2, 2, [FLOOR, WALL, FLOOR, FLOOR]);
    expect(floorCount(grid)).toBe(3);
  });
});
