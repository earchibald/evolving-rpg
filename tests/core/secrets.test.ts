import { FLOOR, WALL, EXIT, SECRET, makeGrid, isPassable, idx, tileAt } from '../../src/core/grid.js';
import { repairWithSecret, sealSecretRoom } from '../../src/core/mapgen.js';
import { createWorld } from '../../src/core/commands.js';
import { reachableFrom } from '../../src/core/reachability.js';
import { visibleFrom, fogAt } from '../../src/ui/fov.js';
import { decide } from '../../src/core/ai.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { playerStep } from '../../src/play/session.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Grid } from '../../src/core/grid.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/**
 * Secret passages: illusory walls. Mechanically floor, visually wall, and
 * only the PLAY view is ever fooled. The properties pinned here are the
 * deal's terms: passable always; occluding until trodden and never after;
 * creatures never fooled; a sealed room never strands the floor; and the
 * designer's repair rule — a stranded map gets a hidden way cut in.
 */

describe('the tile itself', () => {
  it('is passable — an illusory wall was always walkable', () => {
    const g = makeGrid(3, 1, [FLOOR, SECRET, FLOOR]);
    expect(isPassable(g, 1, 0)).toBe(true);
  });
});

describe('what the fog believes', () => {
  // A corridor with a secret door in the middle: . . S . .
  const corridor = (): Grid => makeGrid(9, 1, [FLOOR, FLOOR, FLOOR, FLOOR, SECRET, FLOOR, FLOOR, FLOOR, FLOOR]);

  it('occludes like wall until trodden', () => {
    const g = corridor();
    const seen = visibleFrom(g, 0, 0);
    expect(seen.has(idx(g, 4, 0))).toBe(true);   // the "wall" itself is seen
    expect(seen.has(idx(g, 5, 0))).toBe(false);  // nothing beyond it
    expect(seen.has(idx(g, 8, 0))).toBe(false);
  });

  it('never occludes again once trodden', () => {
    const g = corridor();
    const seen = visibleFrom(g, 0, 0, 8, new Set([idx(g, 4, 0)]));
    expect(seen.has(idx(g, 5, 0))).toBe(true);
    expect(seen.has(idx(g, 8, 0))).toBe(true);
  });

  it('reveals through play: walk into the wall that is not one, and the far side opens', () => {
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 9, height: 1, tiles: [FLOOR, FLOOR, FLOOR, FLOOR, SECRET, FLOOR, FLOOR, FLOOR, EXIT],
        seed: 3, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 3, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    } as GameEvent;
    const born = append(emptyLog(), null, world);
    const gridOf = (p: { width: number; height: number; tiles: number[] }): Grid => makeGrid(p.width, p.height, p.tiles);

    const before = fogAt(born.log, born.event.id, gridOf);
    expect(before.seen.has(5)).toBe(false);

    // One step east: onto the secret. The move succeeds — it was never wall.
    const stepped = playerStep({ log: born.log, head: born.event.id }, 'player', 1, 0);
    const after = fogAt(stepped.position.log, stepped.position.head, gridOf);
    expect(after.revealed.has(4)).toBe(true);
    expect(after.seen.has(5)).toBe(true);
    expect(after.seen.has(8)).toBe(true);
  });
});

describe('what creatures believe', () => {
  it('nothing — they path straight through a secret door', () => {
    // A wall bars the row except one SECRET tile; the quarry stands beyond.
    // The creature must set off toward the door it was never fooled by.
    const width = 12;
    const height = 3;
    const tiles = new Array<number>(width * height).fill(FLOOR);
    for (let y = 0; y < height; y += 1) tiles[y * width + 6] = WALL;
    tiles[1 * width + 6] = SECRET;
    const beast: Entity = { id: 'thing-1', kind: 'thing', pos: { x: 4, y: 1 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [], maxHp: 5 };
    const you: Entity = { id: 'player', kind: 'you', pos: { x: 8, y: 1 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 10 };
    const state: GameState = {
      grid: makeGrid(width, height, tiles),
      entities: [beast, you], items: [], turn: 1, activeEntityId: 'thing-1',
      seed: 7, rngCounter: 0, rules: [], xp: 0, level: 1, depth: 1, story: '', motif: null, bodies: [], bible: null, smoke: null,
    };
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });
});

describe('sealed rooms, generated', () => {
  // The honest flood: what a player who knows no secrets can walk to.
  function floodHonest(grid: Grid, sx: number, sy: number): Set<number> {
    const seen = new Set<number>([idx(grid, sx, sy)]);
    const stack: Array<[number, number]> = [[sx, sy]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
        const t = tileAt(grid, nx, ny);
        if (t === WALL || t === SECRET) continue;
        const i = idx(grid, nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        stack.push([nx, ny]);
      }
    }
    return seen;
  }

  it('seals some floors, not most; never strands the way out; truth stays whole', () => {
    let sealed = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { payload } = createWorld(seed, 48, 32);
      const grid = makeGrid(payload.width, payload.height, payload.tiles);
      const start = payload.player.pos;
      const exitAt = payload.tiles.indexOf(EXIT);
      const hasSecrets = payload.tiles.includes(SECRET);
      if (payload.story?.includes('keeps itself secret')) {
        sealed += 1;
        expect(hasSecrets).toBe(true);
      }
      // Whether sealed or not: the exit is reachable by someone who knows no
      // secrets, and every walkable tile is reachable by the truth.
      const honest = floodHonest(grid, start.x, start.y);
      expect(honest.has(exitAt)).toBe(true);
      const truth = reachableFrom(grid, start.x, start.y);
      for (let i = 0; i < payload.tiles.length; i += 1) {
        if (payload.tiles[i] !== WALL) expect(truth.has(i)).toBe(true);
      }
    }
    // Roughly one floor in three — the draw is 1-in-3 and some picks abort.
    expect(sealed).toBeGreaterThanOrEqual(4);
    expect(sealed).toBeLessThanOrEqual(20);
  });
});

describe('what may keep itself secret', () => {
  // One floor, three rooms: A and B share an open edge — the generator lets
  // rooms run together — and C stands apart behind a wall with one door.
  //   y1  #........#...##
  //   y3  #............##   ← the lone gap at (9,3) is C's door
  // The 929-second run found floor 7 sealing a merged room: the whole shared
  // edge became illusory wall, two "walls" of the neighbor were secrets.
  const rows = [
    '###############',
    '#........#...##',
    '#........#...##',
    '#............##',
    '#........#...##',
    '#........#...##',
    '###############',
  ];
  const tiles = (): number[] => rows.join('').split('').map((c) => (c === '#' ? WALL : FLOOR));
  const roomA = { x: 1, y: 1, w: 4, h: 5 };
  const roomB = { x: 5, y: 1, w: 4, h: 5 };
  const roomC = { x: 10, y: 1, w: 3, h: 5 };
  const width = 15;

  it('refuses a room merged into its neighbor — there is no wall to hide behind', () => {
    const grid = makeGrid(width, 7, tiles());
    // Start in C, exit in B: only A is eligible, and A's right edge is open
    // floor shared with B. Sealing it would turn B's own column into fake wall.
    const { grid: after, sealed } = sealSecretRoom(
      7, 0, grid, [roomA, roomB, roomC], { x: 11, y: 2 }, { x: 7, y: 4 }, 1);
    expect(sealed).toBe(false);
    expect(after.tiles).toEqual(grid.tiles);
  });

  it('seals a walled room at its narrow door, and nowhere else', () => {
    const grid = makeGrid(width, 7, tiles());
    // Start and exit in the merged blob: only C is eligible, and C is honest —
    // walls all around, one gap. That gap and only that gap becomes secret.
    const { grid: after, sealed } = sealSecretRoom(
      7, 0, grid, [roomA, roomB, roomC], { x: 2, y: 2 }, { x: 7, y: 4 }, 1);
    expect(sealed).toBe(true);
    expect(tileAt(after, 9, 3)).toBe(SECRET);
    const changed = after.tiles.filter((t, i) => t !== grid.tiles[i]);
    expect(changed).toEqual([SECRET]);
  });
});

describe('the repair rule', () => {
  it('cuts a hidden way into a truly stranded chamber', () => {
    // Two chambers, a solid bar between: the designer's case, hand-built.
    const width = 7;
    const tiles = [
      FLOOR, FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR,
      FLOOR, FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR,
      FLOOR, FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR,
    ];
    const broken = makeGrid(width, 3, tiles);
    const { grid, punched } = repairWithSecret(broken, { x: 0, y: 0 });
    expect(punched).toBe(1);
    const truth = reachableFrom(grid, 0, 0);
    for (let i = 0; i < grid.tiles.length; i += 1) {
      if (grid.tiles[i] !== WALL) expect(truth.has(i)).toBe(true);
    }
    expect(grid.tiles.filter((t) => t === SECRET)).toHaveLength(1);
  });

  it('touches nothing on a whole floor', () => {
    const fine = makeGrid(3, 1, [FLOOR, FLOOR, FLOOR]);
    const { grid, punched } = repairWithSecret(fine, { x: 0, y: 0 });
    expect(punched).toBe(0);
    expect(grid.tiles).toEqual(fine.tiles);
  });
});
