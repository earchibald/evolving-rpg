import { FLOOR, WALL, makeGrid, idx, inBounds, tileAt, isPassable } from '../../src/core/grid.js';

const tiles = [
  FLOOR, FLOOR, WALL,
  FLOOR, WALL, FLOOR,
];
const grid = makeGrid(3, 2, tiles);

describe('makeGrid', () => {
  it('rejects a tile count that does not match the dimensions', () => {
    expect(() => makeGrid(3, 2, [FLOOR])).toThrow(/expected 6 tiles/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => makeGrid(0, 4, [])).toThrow(/bad size/);
  });

  it('copies the tiles so later mutation of the input cannot leak in', () => {
    const input = [FLOOR, FLOOR];
    const g = makeGrid(2, 1, input);
    input[0] = WALL;
    expect(tileAt(g, 0, 0)).toBe(FLOOR);
  });
});

describe('idx', () => {
  it('maps coordinates row-major', () => {
    expect(idx(grid, 0, 0)).toBe(0);
    expect(idx(grid, 2, 0)).toBe(2);
    expect(idx(grid, 0, 1)).toBe(3);
    expect(idx(grid, 2, 1)).toBe(5);
  });
});

describe('inBounds', () => {
  it('accepts inside and rejects outside', () => {
    expect(inBounds(grid, 0, 0)).toBe(true);
    expect(inBounds(grid, 2, 1)).toBe(true);
    expect(inBounds(grid, -1, 0)).toBe(false);
    expect(inBounds(grid, 3, 0)).toBe(false);
    expect(inBounds(grid, 0, 2)).toBe(false);
  });
});

describe('tileAt', () => {
  it('reads the stored tile', () => {
    expect(tileAt(grid, 1, 0)).toBe(FLOOR);
    expect(tileAt(grid, 2, 0)).toBe(WALL);
  });

  it('treats everything outside the grid as solid', () => {
    expect(tileAt(grid, -1, 0)).toBe(WALL);
    expect(tileAt(grid, 99, 99)).toBe(WALL);
  });
});

describe('isPassable', () => {
  it('is true only for floor inside the grid', () => {
    expect(isPassable(grid, 0, 0)).toBe(true);
    expect(isPassable(grid, 1, 1)).toBe(false);
    expect(isPassable(grid, -1, -1)).toBe(false);
  });
});
