import { MOTIFS, motifAt, sightAt } from '../../src/core/tables.js';
import { generateMap } from '../../src/core/mapgen.js';
import { createWorld } from '../../src/core/commands.js';
import { visibleFrom, fogAt } from '../../src/ui/fov.js';
import { FLOOR, makeGrid, idx } from '../../src/core/grid.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Grid } from '../../src/core/grid.js';

/**
 * Depth motifs: the floors change shape with intent (BALANCE.md pass 10,
 * MAPS.md §5 — Brogue's blends, Rogue/Moria's darkness, banded here). The
 * pins are the band boundaries, the structural difference the bands promise,
 * and the darkness ramp on the fog.
 */

describe('motifAt', () => {
  it('fixes the shallow bands and never draws for them', () => {
    for (const [depth, name] of [[1, 'the door'], [2, 'the door'], [3, 'the warren'], [4, 'the warren'], [5, 'the halls'], [6, 'the halls']] as const) {
      const { motif, counterAfter } = motifAt(9, 40, depth);
      expect(motif.name).toBe(name);
      expect(counterAfter).toBe(40);
    }
  });

  it('draws the deep, one counted draw, warren or halls with more secrets', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const { motif, counterAfter } = motifAt(seed, 40, 7);
      expect(counterAfter).toBe(41);
      expect(motif.name.startsWith('the deep')).toBe(true);
      expect(motif.secretIn).toBe(2);
      seen.add(motif.name);
    }
    // Both faces of the deep turn up across seeds.
    expect(seen.size).toBe(2);
  });
});

describe('sightAt — the darkness ramp', () => {
  it('closes in with depth and never goes black', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(sightAt)).toEqual([9, 9, 8, 8, 8, 8, 7, 7]);
  });
});

describe('the bands differ structurally', () => {
  const meanRoomArea = (motifKey: 'door' | 'warren' | 'halls'): number => {
    let area = 0;
    let count = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const { rooms } = generateMap(seed, 0, 48, 32, MOTIFS[motifKey]);
      for (const r of rooms) { area += r.w * r.h; count += 1; }
    }
    return area / count;
  };

  it('cuts the halls broad and the warren tight', () => {
    const door = meanRoomArea('door');
    const warren = meanRoomArea('warren');
    const halls = meanRoomArea('halls');
    expect(warren).toBeLessThan(door);
    expect(halls).toBeGreaterThan(door);
    expect(halls).toBeGreaterThan(warren * 1.8);
  });

  it('keeps the warren inside its caps', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const { rooms } = generateMap(seed, 0, 48, 32, MOTIFS.warren);
      for (const r of rooms) {
        expect(r.w).toBeLessThanOrEqual(6);
        expect(r.h).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('the floor says its motif', () => {
  it('names the band in the story, where the ledger reads it', () => {
    expect(createWorld(5, 48, 32).payload.story?.startsWith('the door')).toBe(true);
    expect(createWorld(5, 48, 32, 'player', 3).payload.story?.startsWith('the warren')).toBe(true);
    expect(createWorld(5, 48, 32, 'player', 5).payload.story?.startsWith('the halls')).toBe(true);
    expect(createWorld(5, 48, 32, 'player', 8).payload.story?.startsWith('the deep')).toBe(true);
  });
});

describe('the deep is darker', () => {
  const open = (w: number, h: number): number[] => new Array<number>(w * h).fill(FLOOR);
  const gridOf = (p: { width: number; height: number; tiles: number[] }): Grid => makeGrid(p.width, p.height, p.tiles);

  const bornAt = (depth: number): { log: ReturnType<typeof emptyLog>; head: string } => {
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 24, height: 3, tiles: open(24, 3), seed: 1, items: [], depth,
        player: { id: 'player', kind: 'you', pos: { x: 2, y: 1 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    } as GameEvent;
    const born = append(emptyLog(), null, world);
    return { log: born.log, head: born.event.id };
  };

  it('sees 9 on the first floor and 7 in the deep', () => {
    const shallow = fogAt(bornAt(1).log, bornAt(1).head, gridOf);
    const deep = fogAt(bornAt(7).log, bornAt(7).head, gridOf);
    const g = makeGrid(24, 3, open(24, 3));
    expect(shallow.visible.has(idx(g, 11, 1))).toBe(true);   // 9 away
    expect(deep.visible.has(idx(g, 9, 1))).toBe(true);       // 7 away
    expect(deep.visible.has(idx(g, 11, 1))).toBe(false);     // 9 away — dark now
  });

  it('the raw sweep honors a passed radius', () => {
    const g = makeGrid(24, 3, open(24, 3));
    expect(visibleFrom(g, 2, 1, 7).has(idx(g, 11, 1))).toBe(false);
    expect(visibleFrom(g, 2, 1, 9).has(idx(g, 11, 1))).toBe(true);
  });
});
