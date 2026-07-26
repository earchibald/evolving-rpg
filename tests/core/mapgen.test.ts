import { generateMap, walkDistance } from '../../src/core/mapgen.js';
import { FLOOR, WALL, isPassable, tileAt, makeGrid } from '../../src/core/grid.js';
import { reachableFrom } from '../../src/core/reachability.js';

describe('generateMap: rooms and corridors', () => {
  it('is deterministic for the same seed and counter', () => {
    const a = generateMap(1234, 0, 48, 32);
    const b = generateMap(1234, 0, 48, 32);
    expect(a.grid.tiles).toEqual(b.grid.tiles);
    expect(a.start).toEqual(b.start);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.counterAfter).toBe(b.counterAfter);
  });

  it('produces different maps for different seeds', () => {
    const a = generateMap(1, 0, 48, 32);
    const b = generateMap(2, 0, 48, 32);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('respects a non-zero starting counter', () => {
    const a = generateMap(7, 0, 48, 32);
    const b = generateMap(7, 500, 48, 32);
    expect(b.counterAfter).toBeGreaterThan(500);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('connects every floor tile to the start — the whole map, not most of it', () => {
    // Covenant M5's teeth. The old scatter generator promised 60% reachable;
    // rooms and corridors promise there is no sealed room at all, because a
    // relic behind a wall with no way in is a lie the map tells.
    for (let seed = 0; seed < 50; seed += 1) {
      const { grid, start } = generateMap(seed, 0, 48, 32);
      const reachable = reachableFrom(grid, start.x, start.y);
      for (let i = 0; i < grid.tiles.length; i += 1) {
        if (grid.tiles[i] === FLOOR) expect(reachable.has(i)).toBe(true);
      }
    }
  });

  it('starts you standing inside a room, not inside a wall', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const { grid, start, rooms } = generateMap(seed, 0, 48, 32);
      expect(isPassable(grid, start.x, start.y)).toBe(true);
      expect(rooms.some((r) =>
        start.x >= r.x && start.x < r.x + r.w && start.y >= r.y && start.y < r.y + r.h,
      )).toBe(true);
    }
  });

  it('keeps the border solid, so the world has an inside', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { grid } = generateMap(seed, 0, 48, 32);
      for (let x = 0; x < grid.width; x += 1) {
        expect(tileAt(grid, x, 0)).toBe(WALL);
        expect(tileAt(grid, x, grid.height - 1)).toBe(WALL);
      }
      for (let y = 0; y < grid.height; y += 1) {
        expect(tileAt(grid, 0, y)).toBe(WALL);
        expect(tileAt(grid, grid.width - 1, y)).toBe(WALL);
      }
    }
  });

  it('carves several genuine rooms on a full-size board, every room all floor', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { grid, rooms } = generateMap(seed, 0, 48, 32);
      expect(rooms.length).toBeGreaterThanOrEqual(3);
      expect(rooms.length).toBeLessThanOrEqual(13);
      for (const r of rooms) {
        for (let y = r.y; y < r.y + r.h; y += 1) {
          for (let x = r.x; x < r.x + r.w; x += 1) {
            expect(tileAt(grid, x, y)).toBe(FLOOR);
          }
        }
      }
    }
  });

  it('tells its story with the real numbers in it', () => {
    const { rooms, story } = generateMap(11, 0, 48, 32);
    expect(story).toContain(`${rooms.length} rooms`);
    expect(story).toMatch(/loops?/u);
  });

  it('degrades a tiny board to one open chamber through the same front door', () => {
    // Trial worlds and 12x8 test boards flow through this generator too —
    // one model for every consumer, no fossil generator kept alive for tests.
    const { grid, rooms, story, start } = generateMap(5, 0, 12, 8);
    expect(rooms).toEqual([{ x: 1, y: 1, w: 10, h: 6 }]);
    expect(story).toBe('one open chamber');
    expect(isPassable(grid, start.x, start.y)).toBe(true);
    for (let y = 1; y < 7; y += 1) {
      for (let x = 1; x < 11; x += 1) expect(tileAt(grid, x, y)).toBe(FLOOR);
    }
  });

  it('refuses a board too small to hold an interior', () => {
    expect(() => generateMap(3, 0, 2, 2)).toThrow(/cannot hold an interior/u);
  });
});

describe('walkDistance', () => {
  it('measures steps of walking, and calls the unreachable unreachable', () => {
    // 3x3 with a wall bar down the middle: around is the only way, and there
    // is none — the far column must read as unreachable, not as "3 away".
    const grid = makeGrid(3, 3, [
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
    ]);
    expect(walkDistance(grid, { x: 0, y: 0 }, { x: 0, y: 2 })).toBe(2);
    expect(walkDistance(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(walkDistance(grid, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});
