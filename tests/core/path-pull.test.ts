import { createWorld, OPPONENT_MIN_DISTANCE } from '../../src/core/commands.js';
import { walkPath, walkDistance } from '../../src/core/mapgen.js';
import { makeGrid, EXIT, tileAt } from '../../src/core/grid.js';
import type { Grid } from '../../src/core/grid.js';

/**
 * The teaching floor reaches the player (baseline-balance ruling): depth 1's
 * one relic — the fighter's whole early curve — stands ON the walked path,
 * eight steps in, so a human who simply walks the floor meets its guard
 * early and its prize on the way. Deeper floors keep the detour economy.
 */

const DIMS = { width: 48, height: 32 };

function worldGrid(payload: { width: number; height: number; tiles: number[] }): Grid {
  return makeGrid(payload.width, payload.height, payload.tiles);
}

function exitOf(grid: Grid): { x: number; y: number } {
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (tileAt(grid, x, y) === EXIT) return { x, y };
    }
  }
  throw new Error('no exit');
}

describe('walkPath — the road, root-first', () => {
  it('walks a shortest path whose length is the walk distance', () => {
    const p = createWorld(3, DIMS.width, DIMS.height).payload;
    const grid = worldGrid(p);
    const path = walkPath(grid, p.player.pos, exitOf(grid));
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toEqual({ x: p.player.pos.x, y: p.player.pos.y });
    expect(path.length - 1).toBe(walkDistance(grid, p.player.pos, exitOf(grid)));
    // Every step is a step: orthogonal, adjacent.
    for (let i = 1; i < path.length; i += 1) {
      const dx = Math.abs(path[i]!.x - path[i - 1]!.x);
      const dy = Math.abs(path[i]!.y - path[i - 1]!.y);
      expect(dx + dy).toBe(1);
    }
  });

  it('returns nothing when there is no walk at all', () => {
    const walled = makeGrid(3, 1, [0, 1, 0]);
    expect(walkPath(walled, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([]);
  });
});

describe('the teaching floor reaches the player', () => {
  it('lays the keen edge on the path, eight steps of walking in, on every seed', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const p = createWorld(seed, DIMS.width, DIMS.height).payload;
      const grid = worldGrid(p);
      const path = walkPath(grid, p.player.pos, exitOf(grid));
      const edge = p.items.find((i) => i.kind === 'keen edge');
      expect(edge).toBeDefined();
      const at = Math.min(OPPONENT_MIN_DISTANCE, path.length - 2);
      expect(edge!.pos).toEqual({ x: path[at]!.x, y: path[at]!.y });
      // Its guard stands on it — the fight is on the road too.
      expect(p.opponents.some((o) => o.pos.x === edge!.pos.x && o.pos.y === edge!.pos.y)).toBe(true);
    }
  });

  it('leaves the deep floors\' detour economy alone', () => {
    // Depth 2+ relics stay where the draws put them: across seeds, at least
    // one first relic lies OFF the path — the pull is the teaching floor's
    // rule, not the game's.
    let offPath = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const p = createWorld(seed, DIMS.width, DIMS.height, 'player', 2).payload;
      const grid = worldGrid(p);
      const path = walkPath(grid, p.player.pos, exitOf(grid));
      const first = p.items[0]!;
      if (!path.some((t) => t.x === first.pos.x && t.y === first.pos.y)) offPath += 1;
    }
    expect(offPath).toBeGreaterThan(0);
  });

  it('keeps the provision off the path — the satchel still pays for scouting', () => {
    let off = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const p = createWorld(seed, DIMS.width, DIMS.height).payload;
      const grid = worldGrid(p);
      const path = walkPath(grid, p.player.pos, exitOf(grid));
      const provision = p.items.find((i) => i.kind !== 'keen edge');
      expect(provision).toBeDefined();
      if (!path.some((t) => t.x === provision!.pos.x && t.y === provision!.pos.y)) off += 1;
    }
    expect(off).toBeGreaterThan(5);
  });
});
