import { decide } from '../../src/core/ai.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import { createWorld } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { GUARD_LEASH, ROUTE_STOPS } from '../../src/core/tables.js';
import type { Entity, Pos } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent } from '../../src/core/events.js';

/** One corridor, 26 tiles of walkable ground: distances are legible and a
 *  step is unambiguous. */
function corridor(entities: Entity[]): GameState {
  const width = 26;
  const height = 3;
  const tiles = new Array<number>(width * height).fill(WALL);
  for (let x = 1; x < width - 1; x += 1) tiles[width + x] = FLOOR;
  return {
    grid: makeGrid(width, height, tiles),
    entities,
    items: [],
    turn: 1,
    activeEntityId: entities[0]?.id ?? null,
    seed: 7,
    rngCounter: 0,
    rules: [],
    xp: 0,
    level: 1,
    depth: 3,
    story: '', motif: null, bodies: [], bible: null, smoke: null,
  };
}

function being(id: string, x: number, extra: Partial<Entity> = {}): Entity {
  return { id, kind: 'thing', pos: { x, y: 1 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [], maxHp: 5, ...extra };
}

const you = (x: number): Entity => ({ id: 'player', kind: 'you', pos: { x, y: 1 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 10 });

const moveTo = (state: GameState, id: string, to: Pos): GameEvent => ({
  type: 'MOVE',
  schemaVersion: SCHEMA_VERSIONS.MOVE,
  rngCounter: state.rngCounter,
  rngDraws: 0,
  payload: { entityId: id, from: { x: 0, y: 0 }, to },
  id: 'm', parent: null, seq: 1,
} as GameEvent);

describe('the guard', () => {
  it('ignores prey beyond the leash of its post — even prey at arm\'s reach — and walks home', () => {
    // Displaced to x=13 with its post at x=8; the player stands ADJACENT at
    // x=14, but the post reads the leash and the player is 6 from it. The
    // old stillness would have struck; the guard turns for home instead.
    const state = corridor([
      being('g', 13, { disposition: 'guard', post: { x: 8, y: 1 } }),
      you(14),
    ]);
    expect(14 - 8).toBeGreaterThan(GUARD_LEASH);
    expect(decide(state, 'g')).toEqual({ kind: 'step', dx: -1, dy: 0 });
  });

  it('hunts what comes inside the leash, and rests at its post when the floor is quiet', () => {
    // The player 3 from the post: inside the leash, ordinary hunt.
    const hunting = corridor([
      being('g', 8, { disposition: 'guard', post: { x: 8, y: 1 } }),
      you(11),
    ]);
    expect(decide(hunting, 'g')).toEqual({ kind: 'step', dx: 1, dy: 0 });

    // Home, leash empty: it stands. (The old behavior also stood here —
    // what changed is only ever the walk back.)
    const quiet = corridor([
      being('g', 8, { disposition: 'guard', post: { x: 8, y: 1 } }),
      you(24),
    ]);
    expect(decide(quiet, 'g')).toEqual({ kind: 'wait' });
  });
});

describe('the wanderer', () => {
  const round: Pos[] = [{ x: 4, y: 1 }, { x: 20, y: 1 }];

  it('walks its round when nothing is in reach to hunt', () => {
    const state = corridor([
      being('w', 12, { disposition: 'wander', route: round, leg: 0 }),
      you(24),
    ]);
    // Leg 0 points at x=4, west.
    expect(decide(state, 'w')).toEqual({ kind: 'step', dx: -1, dy: 0 });
  });

  it('the hunt interrupts the round', () => {
    const state = corridor([
      being('w', 12, { disposition: 'wander', route: round, leg: 0 }),
      you(17),
    ]);
    // The round says west; the prey at 5 steps says east. Teeth win.
    expect(decide(state, 'w')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('the reducer advances the leg when a step lands on a waypoint — any waypoint, forward only', () => {
    const threeStop = corridor([
      being('w', 7, { disposition: 'wander', route: [{ x: 4, y: 1 }, { x: 8, y: 1 }, { x: 20, y: 1 }], leg: 0 }),
      you(24),
    ]);
    const landed = apply(threeStop, moveTo(threeStop, 'w', { x: 8, y: 1 }));
    // Struck the SECOND stop while heading for the first: the round turns
    // to the third, never back to the one behind.
    expect(landed.entities.find((e) => e.id === 'w')?.leg).toBe(2);
  });

  it('standing on its own goal, it heads for the next stop rather than stalling', () => {
    const state = corridor([
      being('w', 4, { disposition: 'wander', route: round, leg: 0 }),
      you(24),
    ]);
    expect(decide(state, 'w')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('a goal another body is parked on yields to the next stop', () => {
    const state = corridor([
      being('w', 12, { disposition: 'wander', route: round, leg: 0 }),
      being('parked', 4),
      you(24),
    ]);
    // x=4 is taken; the round turns east for x=20 instead of jamming.
    expect(decide(state, 'w')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });
});

describe('generation deals the tempers', () => {
  const fold = (e: ReturnType<typeof createWorld>): GameState =>
    apply(EMPTY_STATE, { ...e, id: 'w', parent: null, seq: 0 } as GameEvent);

  it('the teaching floor stays still: no routes at depth 1, on any board', () => {
    for (const seed of [3, 15, 44]) {
      const born = createWorld(seed, 96, 64, 'player', 1);
      expect(born.payload.opponents.every((o) => o.route === undefined)).toBe(true);
    }
  });

  it('guards by role are drawless: the keeper and every relic guard own their posts', () => {
    const born = createWorld(21, 96, 64, 'player', 3);
    const warden = born.payload.opponents.find((o) => o.kind.startsWith('warden'));
    expect(warden?.disposition).toBe('guard');
    // Depth 1's one relic guard, same law, vale board — the pre-v10 world's
    // only disposition change.
    const vale = createWorld(15, 48, 32, 'player', 1);
    expect(vale.payload.opponents[0]?.disposition).toBe('guard');
  });

  it('past the teaching floor some of the floor walks rounds, recorded whole and bounded', () => {
    let wanderers = 0;
    for (const seed of [3, 7, 11, 21, 33, 44]) {
      const born = createWorld(seed, 96, 64, 'player', 3);
      for (const o of born.payload.opponents) {
        if (o.disposition !== 'wander') continue;
        wanderers += 1;
        expect(o.route).toBeDefined();
        expect(o.route!.length).toBeGreaterThanOrEqual(ROUTE_STOPS[0]);
        expect(o.route!.length).toBeLessThanOrEqual(ROUTE_STOPS[1]);
      }
    }
    expect(wanderers).toBeGreaterThan(0);
  });

  it('the temper crosses the fold: disposition, route and leg 0 stand in state', () => {
    for (const seed of [3, 7, 11, 21, 33, 44]) {
      const state = fold(createWorld(seed, 96, 64, 'player', 3));
      const walker = state.entities.find((e) => e.disposition === 'wander');
      if (walker === undefined) continue;
      expect(walker.route).toBeDefined();
      expect(walker.leg).toBe(0);
      return;
    }
    throw new Error('no seed produced a wanderer to fold');
  });

  it('routes replay identically: same seed, same rounds', () => {
    const a = createWorld(33, 96, 64, 'player', 4);
    const b = createWorld(33, 96, 64, 'player', 4);
    expect(a.payload.opponents.map((o) => o.route)).toEqual(b.payload.opponents.map((o) => o.route));
    expect(a.rngDraws).toBe(b.rngDraws);
  });
});
