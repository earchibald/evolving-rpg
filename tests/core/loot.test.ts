import { attemptMove, takeUnderfoot, useCarried } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { intBetween } from '../../src/core/rng.js';
import { ARMORY, PROVISIONS, provisionsAt, relicGrant, dominates, wearsTrait, critFloor, FLARE_RADIUS } from '../../src/core/tables.js';
import { fogAt } from '../../src/ui/fov.js';
import { append, emptyLog } from '../../src/log/chain.js';
import { createWorld } from '../../src/core/commands.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import type { GameEvent, StrikePayload } from '../../src/core/events.js';
import type { Entity, Stats } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/**
 * Loot with choices in it: the dominance rule (walking takes only strict
 * upgrades), the deliberate take, the one iconic tradeoff, the two named
 * properties, and the flare.
 */

const SEED = 5;

function room(entities: Entity[], items: GameState['items'], opts: { walls?: Array<[number, number]>; counter?: number } = {}): GameState {
  const width = 20;
  const height = 12;
  const tiles = new Array<number>(width * height).fill(FLOOR);
  for (const [x, y] of opts.walls ?? []) tiles[y * width + x] = WALL;
  return {
    grid: makeGrid(width, height, tiles),
    entities,
    items,
    turn: 1,
    activeEntityId: entities[0]?.id ?? null,
    seed: SEED,
    rngCounter: opts.counter ?? 0,
    rules: [],
    xp: 0,
    level: 1,
    depth: 3,
    story: '', motif: null, bodies: [], bible: null, smoke: null, traps: [], alarm: null,
  };
}

const GRANTLESS: Stats = { hp: 0, might: 0, wits: 0, speed: 0 };

function you(x: number, y: number, o: { gear?: Entity['gear']; satchel?: { kind: string }[] } = {}): Entity {
  return {
    id: 'player', kind: 'you', pos: { x, y },
    stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 10,
    ...(o.gear === undefined ? {} : { gear: o.gear }),
    ...(o.satchel === undefined ? {} : { satchel: o.satchel }),
  };
}

function being(id: string, kind: string, x: number, y: number, o: { hp?: number; gear?: Entity['gear'] } = {}): Entity {
  const hp = o.hp ?? 8;
  return {
    id, kind, pos: { x, y }, stats: { hp, might: 4, wits: 1, speed: 3 }, tags: [], maxHp: hp,
    ...(o.gear === undefined ? {} : { gear: o.gear }),
  };
}

const relicItem = (kind: string, grants: Stats, x: number, y: number): GameState['items'][number] =>
  ({ id: `it-${kind}`, kind, pos: { x, y }, grants });

function counterRolling(predicate: (roll: number) => boolean): number {
  for (let c = 0; c < 5000; c += 1) if (predicate(intBetween(SEED, c, 1, 20))) return c;
  throw new Error('no counter found');
}

const asEvent = (draft: object): GameEvent => ({ ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

describe('the dominance rule', () => {
  it('takes a strict upgrade by walking, as ever', () => {
    const state = room([you(5, 5)], [relicItem('keen edge', { ...GRANTLESS, might: 2 }, 5, 5)]);
    expect(takeUnderfoot(state, 'player')).not.toBeNull();
  });

  it('refuses a tradeoff underfoot — the price is nobody\'s to pay unasked', () => {
    const heavy = relicGrant(ARMORY.find((r) => r.kind === 'heavy edge')!, 1);
    expect(heavy.speed).toBeLessThan(0);
    const state = room([you(5, 5)], [relicItem('heavy edge', heavy, 5, 5)]);
    expect(takeUnderfoot(state, 'player')).toBeNull();
  });

  it('takes the tradeoff deliberately, price and all', () => {
    const heavy = relicGrant(ARMORY.find((r) => r.kind === 'heavy edge')!, 1);
    const state = room([you(5, 5)], [relicItem('heavy edge', heavy, 5, 5)]);
    const draft = takeUnderfoot(state, 'player', true);
    expect(draft).not.toBeNull();
    const after = apply(state, asEvent(draft!));
    const me = after.entities.find((e) => e.id === 'player')!;
    expect(me.stats.might).toBe(3 + heavy.might);
    expect(me.stats.speed).toBe(4 + heavy.speed);
  });

  it('leaves a sidegrade lying until chosen', () => {
    const worn = { weapon: { kind: 'keen edge', grants: { ...GRANTLESS, might: 2 } } };
    const state = room([you(5, 5, { gear: worn })], [relicItem('sure edge', { ...GRANTLESS, might: 2 }, 5, 5)]);
    expect(takeUnderfoot(state, 'player')).toBeNull();
    expect(takeUnderfoot(state, 'player', true)).not.toBeNull();
  });

  it('is exactly “at least as good everywhere, better in total”', () => {
    expect(dominates({ ...GRANTLESS, might: 3 }, { ...GRANTLESS, might: 2 })).toBe(true);
    expect(dominates({ ...GRANTLESS, might: 3, speed: -1 }, GRANTLESS)).toBe(false);
    expect(dominates({ ...GRANTLESS, might: 2 }, { ...GRANTLESS, might: 2 })).toBe(false);
  });
});

describe('the named properties', () => {
  it('steady boots hold the ground a trample would take', () => {
    const boots = { boots: { kind: 'steady boots', grants: { ...GRANTLESS, speed: 1 } } };
    const counter = counterRolling((r) => r >= 12 && r < 20);
    const held = room([being('foe-1', 'bruiser', 5, 5), you(6, 5, { gear: boots })], [], { counter });
    const blow = attemptMove(held, 'foe-1', 1, 0).payload as StrikePayload;
    expect(blow.hit).toBe(true);
    expect(blow.targetTo).toBeUndefined();

    const bare = room([being('foe-1', 'bruiser', 5, 5), you(6, 5)], [], { counter });
    expect((attemptMove(bare, 'foe-1', 1, 0).payload as StrikePayload).targetTo).toBeDefined();
  });

  it('the sure edge sends a crit survivor reeling', () => {
    const sure = { weapon: { kind: 'sure edge', grants: { ...GRANTLESS, might: 2 } } };
    // A natural in the player's crit band (wits 3 leaves the floor at 20).
    const counter = counterRolling((r) => r >= critFloor(3));
    const state = room([you(5, 5, { gear: sure }), being('foe-1', 'bruiser', 6, 5, { hp: 30 })], [], { counter });
    const draft = attemptMove(state, 'player', 1, 0);
    expect((draft.payload as StrikePayload).crit).toBe(true);
    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).toContain('staggered');

    // The same crit bare-handed staggers nobody.
    const plain = room([you(5, 5), being('foe-1', 'bruiser', 6, 5, { hp: 30 })], [], { counter });
    const bare = apply(plain, asEvent(attemptMove(plain, 'player', 1, 0)));
    expect(bare.entities.find((e) => e.id === 'foe-1')!.tags).not.toContain('staggered');
  });

  it('reads traits off worn gear alone', () => {
    expect(wearsTrait({ weapon: { kind: 'sure edge' } }, 'stagger-crit')).toBe(true);
    expect(wearsTrait({ weapon: { kind: 'keen edge' } }, 'stagger-crit')).toBe(false);
    expect(wearsTrait(undefined, 'hold-ground')).toBe(false);
  });
});

describe('the flare', () => {
  it('records where it burst and how far', () => {
    const state = room([you(5, 5, { satchel: [{ kind: 'tallow flare' }] })], []);
    const used = useCarried(state, 'player');
    expect(used).not.toBeNull();
    expect(used!.rngDraws).toBe(0);
    expect(used!.payload.effect).toEqual({ kind: 'flare', at: { x: 5, y: 5 }, radius: FLARE_RADIUS });
    // Spent like any provision: hands empty after.
    const after = apply(state, asEvent(used!));
    expect(after.entities.find((e) => e.id === 'player')!.satchel).toBeUndefined();
  });

  it('is spent for knowledge: the fog admits the circle, walls included', () => {
    // A real chain, so the fog derivation reads a real event.
    const born = createWorld(SEED, 20, 12);
    const rooted = append(emptyLog(), null, born);
    const before = fogAt(rooted.log, rooted.event.id, (p) => makeGrid(p.width, p.height, p.tiles));

    const at = born.payload.player.pos;
    const lit = append(rooted.log, rooted.event.id, {
      type: 'ITEM_USED',
      schemaVersion: 1,
      rngCounter: born.rngCounter + born.rngDraws,
      rngDraws: 0,
      payload: { entityId: 'player', kind: 'tallow flare', effect: { kind: 'flare', at, radius: FLARE_RADIUS } },
    });
    const after = fogAt(lit.log, lit.event.id, (p) => makeGrid(p.width, p.height, p.tiles));

    // The circle joins the known; sight itself is unchanged.
    expect(after.seen.size).toBeGreaterThan(before.seen.size);
    expect(after.visible.size).toBe(before.visible.size);
  });

  it('stands third in the teaching trio, which still owns floor one', () => {
    // Re-pinned 2026-07-28: the designer widened the pantry after the
    // 929-second run filled both hands with phials. The trio still leads
    // the table, and the depth gate keeps floor one to exactly them.
    expect(PROVISIONS.slice(0, 3).map((p) => p.kind)).toEqual(['vital draught', 'still smoke', 'tallow flare']);
    expect(provisionsAt(1).map((p) => p.kind)).toEqual(['vital draught', 'still smoke', 'tallow flare']);
  });
});
