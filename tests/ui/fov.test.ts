import { visibleFrom, fogAt, SIGHT } from '../../src/ui/fov.js';
import { FLOOR, WALL, makeGrid, idx } from '../../src/core/grid.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { DraftEvent } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * The fog is a play-view concern, but its logic is pure and pinned here: what
 * can be seen (shadowcasting) and what has been seen (the union along the
 * chain). The properties chosen are the ones a player would call cheating if
 * they broke: seeing through walls, remembering the unvisited, a rewind that
 * fails to un-know, a descent that arrives pre-mapped.
 */

const open = (w: number, h: number): number[] => new Array<number>(w * h).fill(FLOOR);

function grid(w: number, h: number, walls: Array<[number, number]> = []) {
  const tiles = open(w, h);
  for (const [x, y] of walls) tiles[y * w + x] = WALL;
  return makeGrid(w, h, tiles);
}

describe('visibleFrom (shadowcasting)', () => {
  it('always sees where it stands', () => {
    const g = grid(21, 21);
    expect(visibleFrom(g, 10, 10).has(idx(g, 10, 10))).toBe(true);
  });

  it('reaches its radius in the open and no further', () => {
    const g = grid(30, 21);
    const seen = visibleFrom(g, 10, 10);
    expect(seen.has(idx(g, 10 + SIGHT, 10))).toBe(true);
    expect(seen.has(idx(g, 10 + SIGHT + 2, 10))).toBe(false);
  });

  it('sees a wall but never through it', () => {
    const g = grid(21, 11, [[10, 5]]);
    const seen = visibleFrom(g, 7, 5);
    expect(seen.has(idx(g, 10, 5))).toBe(true);   // the wall itself
    expect(seen.has(idx(g, 12, 5))).toBe(false);  // directly behind it
    expect(seen.has(idx(g, 14, 5))).toBe(false);  // and further behind
  });

  it('never lights a tile past the map edge — indexes do not wrap', () => {
    // idx() is plain y*width+x, so a coordinate one past the east edge is a
    // real index on the NEXT row. Standing near the edge of an open grid, the
    // unfixed sweep recorded exactly those phantoms — a player found one as a
    // "discovered" square in the void beyond the border wall. Every lit tile
    // must decode to a coordinate genuinely within sight of the origin.
    const g = grid(24, 12);
    for (const [ox, oy] of [[23, 5], [0, 5], [12, 0], [12, 11], [23, 11]] as const) {
      for (const i of visibleFrom(g, ox, oy)) {
        const x = i % 24;
        const y = Math.floor(i / 24);
        expect(Math.abs(x - ox)).toBeLessThanOrEqual(SIGHT + 1);
        expect(Math.abs(y - oy)).toBeLessThanOrEqual(SIGHT + 1);
      }
    }
  });

  it('reads a corridor as a tunnel, not a window', () => {
    // A 1-wide corridor at y=5, solid rows above and below.
    const walls: Array<[number, number]> = [];
    for (let x = 0; x < 21; x += 1) { walls.push([x, 4], [x, 6]); }
    const g = grid(21, 11, walls);
    const seen = visibleFrom(g, 5, 5);
    expect(seen.has(idx(g, 9, 5))).toBe(true);    // along the corridor
    expect(seen.has(idx(g, 9, 3))).toBe(false);   // the far side of the wall
    expect(seen.has(idx(g, 9, 7))).toBe(false);
  });
});

/* ── the chain-derived memory ─────────────────────────────────────────── */

const gridOf = (p: { width: number; height: number; tiles: number[] }) =>
  makeGrid(p.width, p.height, p.tiles);

function world(w: number, h: number, at: { x: number; y: number }): DraftEvent {
  return {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: w, height: h, tiles: open(w, h), seed: 1, items: [],
      player: { id: 'player', kind: 'you', pos: at, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as DraftEvent;
}

function move(from: { x: number; y: number }, to: { x: number; y: number }): DraftEvent {
  return {
    type: 'MOVE', schemaVersion: SCHEMA_VERSIONS.MOVE, rngCounter: 0, rngDraws: 0,
    payload: { entityId: 'player', from, to },
  } as DraftEvent;
}

function walked(steps: number): { log: EventLog; heads: string[] } {
  let { log, event } = append(emptyLog(), null, world(40, 7, { x: 2, y: 3 }));
  const heads = [event.id];
  for (let i = 0; i < steps; i += 1) {
    const done = append(log, heads[heads.length - 1]!, move({ x: 2 + i, y: 3 }, { x: 3 + i, y: 3 }));
    log = done.log;
    heads.push(done.event.id);
  }
  return { log, heads };
}

describe('fogAt (what has been seen)', () => {
  it('knows the birth room and not the far end', () => {
    const { log, heads } = walked(0);
    const fog = fogAt(log, heads[0]!, gridOf);
    expect(fog.seen.has(3 * 40 + 2)).toBe(true);
    expect(fog.seen.has(3 * 40 + 30)).toBe(false);
  });

  it('accumulates as the player walks, and the walk is what accumulates it', () => {
    const { log, heads } = walked(18);
    const fog = fogAt(log, heads[heads.length - 1]!, gridOf);
    expect(fog.seen.has(3 * 40 + 28)).toBe(true);  // within sight of x=20
    expect(fog.visible.has(3 * 40 + 4)).toBe(false); // behind, out of view now
    expect(fog.seen.has(3 * 40 + 4)).toBe(true);     // but remembered
  });

  it('un-knows on rewind: an earlier head has seen less', () => {
    const { log, heads } = walked(18);
    const late = fogAt(log, heads[heads.length - 1]!, gridOf);
    const early = fogAt(log, heads[2]!, gridOf);
    expect(early.seen.size).toBeLessThan(late.seen.size);
    expect(early.seen.has(3 * 40 + 28)).toBe(false);
  });

  it('arrives dark on a new floor: WORLD_INIT resets the memory', () => {
    const { log, heads } = walked(18);
    const descended = append(log, heads[heads.length - 1]!, world(40, 7, { x: 2, y: 3 }));
    const below = fogAt(descended.log, descended.event.id, gridOf);

    const fresh = append(emptyLog(), null, world(40, 7, { x: 2, y: 3 }));
    const born = fogAt(fresh.log, fresh.event.id, gridOf);
    expect([...below.seen].sort()).toEqual([...born.seen].sort());
  });

  it('follows a rule\'s shove', () => {
    const start = append(emptyLog(), null, world(40, 7, { x: 2, y: 3 }));
    const shoved = append(start.log, start.event.id, {
      type: 'RULE_FIRED', schemaVersion: SCHEMA_VERSIONS.RULE_FIRED, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'move', entityId: 'player', to: { x: 30, y: 3 } }] },
    } as DraftEvent);
    const fog = fogAt(shoved.log, shoved.event.id, gridOf);
    expect(fog.seen.has(3 * 40 + 30)).toBe(true);
    expect(fog.seen.has(3 * 40 + 35)).toBe(true);
  });

  it('keeps visible a subset of seen', () => {
    const { log, heads } = walked(10);
    const fog = fogAt(log, heads[heads.length - 1]!, gridOf);
    for (const i of fog.visible) expect(fog.seen.has(i)).toBe(true);
  });
});
