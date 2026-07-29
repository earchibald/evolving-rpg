import { decide } from '../../src/core/ai.js';
import { attemptMove, shoveAt, braceSelf } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { intBetween } from '../../src/core/rng.js';
import { braceWall, SLAM_DAMAGE, threatOf } from '../../src/core/tables.js';
import { draftFor } from '../../src/play/session.js';
import { FLOOR, WALL, EXIT, makeGrid } from '../../src/core/grid.js';
import type { GameEvent, StrikePayload } from '../../src/core/events.js';
import type { Entity, Pos } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/**
 * The player's verbs: shove and brace. The monsters got verbs and the player
 * had none — these are the answer, and like the bestiary's they are tested
 * against the real command layer and the real reducer.
 */

const SEED = 5;

function room(entities: Entity[], opts: { walls?: Array<[number, number]>; exit?: [number, number]; counter?: number } = {}): GameState {
  const width = 20;
  const height = 12;
  const tiles = new Array<number>(width * height).fill(FLOOR);
  for (const [x, y] of opts.walls ?? []) tiles[y * width + x] = WALL;
  if (opts.exit !== undefined) tiles[opts.exit[1] * width + opts.exit[0]] = EXIT;
  return {
    grid: makeGrid(width, height, tiles),
    entities,
    items: [],
    turn: 1,
    activeEntityId: entities[0]?.id ?? null,
    seed: SEED,
    rngCounter: opts.counter ?? 0,
    rules: [],
    xp: 0,
    level: 1,
    depth: 3,
    story: '', motif: null, bodies: [], bible: null, smoke: null, traps: [], alarm: null, unveiled: [],
  };
}

interface BeingOpts { hp?: number; might?: number; speed?: number; tags?: string[]; post?: Pos; maxHp?: number }

function being(id: string, kind: string, x: number, y: number, o: BeingOpts = {}): Entity {
  const hp = o.hp ?? 5;
  return {
    id, kind,
    pos: { x, y },
    stats: { hp, might: o.might ?? 4, wits: 1, speed: o.speed ?? 3 },
    tags: o.tags ?? [],
    maxHp: o.maxHp ?? hp,
    ...(o.post === undefined ? {} : { post: o.post }),
  };
}

const you = (x: number, y: number, hp = 10, tags: string[] = []): Entity =>
  ({ id: 'player', kind: 'you', pos: { x, y }, stats: { hp, might: 3, wits: 3, speed: 4 }, tags, maxHp: hp });

function counterRolling(predicate: (roll: number) => boolean): number {
  for (let c = 0; c < 5000; c += 1) if (predicate(intBetween(SEED, c, 1, 20))) return c;
  throw new Error('no counter found — the generator or the range changed');
}

const asEvent = (draft: object): GameEvent => ({ ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

describe('the shove', () => {
  it('drives an adjacent hostile one pace, spends no dice, hurts nobody', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 7, 5)]);
    const draft = shoveAt(state, 'player', 1, 0);
    expect(draft).not.toBeNull();
    expect(draft!.rngDraws).toBe(0);
    const p = draft!.payload;
    expect(p.to).toEqual({ x: 8, y: 5 });
    expect(p.slammed).toBe(false);
    expect(p.struckId).toBeNull();

    const after = apply(state, asEvent(draft!));
    const foe = after.entities.find((e) => e.id === 'foe-1')!;
    expect(foe.pos).toEqual({ x: 8, y: 5 });
    expect(foe.stats.hp).toBe(5);
    expect(foe.tags).not.toContain('staggered');
  });

  it('slams a body into a wall: a point of harm and a reel, no ground gained', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 7, 5)], { walls: [[8, 5]] });
    const draft = shoveAt(state, 'player', 1, 0)!;
    const p = draft.payload;
    expect(p.slammed).toBe(true);
    expect(p.to).toBeNull();

    const after = apply(state, asEvent(draft));
    const foe = after.entities.find((e) => e.id === 'foe-1')!;
    expect(foe.pos).toEqual({ x: 7, y: 5 });
    expect(foe.stats.hp).toBe(5 - SLAM_DAMAGE);
    expect(foe.tags).toContain('staggered');
  });

  it('treats the way out as a door frame, not a door', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 7, 5)], { exit: [8, 5] });
    expect(shoveAt(state, 'player', 1, 0)!.payload.slammed).toBe(true);
  });

  it('tangles two bodies: both reel, nobody moves', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 7, 5), being('foe-2', 'skirmisher', 8, 5)]);
    const draft = shoveAt(state, 'player', 1, 0)!;
    const p = draft.payload;
    expect(p.struckId).toBe('foe-2');
    expect(p.to).toBeNull();
    expect(p.slammed).toBe(false);

    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).toContain('staggered');
    expect(after.entities.find((e) => e.id === 'foe-2')!.tags).toContain('staggered');
    expect(after.entities.find((e) => e.id === 'foe-1')!.pos).toEqual({ x: 7, y: 5 });
    expect(after.entities.find((e) => e.id === 'foe-2')!.pos).toEqual({ x: 8, y: 5 });
  });

  it('refuses thin air without spending the turn', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 9, 9)]);
    expect(shoveAt(state, 'player', 1, 0)).toBeNull();
  });

  it('pays for a slam kill like any other kill', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 7, 5, { hp: 1 })], { walls: [[8, 5]] });
    const after = apply(state, asEvent(shoveAt(state, 'player', 1, 0)!));
    expect(after.entities.find((e) => e.id === 'foe-1')!.stats.hp).toBe(0);
    expect(after.xp).toBe(threatOf({ hp: 1, might: 4, wits: 1, speed: 3 }, 'bruiser'));
  });
});

describe('the stagger', () => {
  it('spends the creature\'s next action, as a recorded wait', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 8, 5, { tags: ['staggered'] })]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'wait' });

    const draft = draftFor(state, 'foe-1', decide(state, 'foe-1'));
    expect(draft?.type).toBe('WAIT');

    const after = apply(state, asEvent(draft!));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).not.toContain('staggered');
    // Recovered: the next decision hunts again.
    expect(decide(after, 'foe-1').kind).not.toBe('wait');
  });

  it('stays silence for an ordinary creature wait', () => {
    // A wall pins the hunter in place beside its prey... there is no such
    // case in the open — so assert the contract directly: unstaggered wait
    // drafts to nothing.
    const state = room([you(6, 5), being('foe-1', 'bruiser', 8, 5)]);
    expect(draftFor(state, 'foe-1', { kind: 'wait' })).toBeNull();
  });
});

describe('the brace', () => {
  const wall = braceWall(3);

  /** The bar a foe faces against the unbraced player, read off a real draft. */
  function baseNeeded(): number {
    const probe = room([being('foe-1', 'bruiser', 5, 5), you(6, 5)], { counter: 0 });
    const draft = attemptMove(probe, 'foe-1', 1, 0);
    return (draft.payload as StrikePayload).needed;
  }

  it('raises the bar by 2 + wits/2, and the recorded event says so', () => {
    const needed = baseNeeded();
    // A roll that lands on the open player but breaks on the set guard.
    const counter = counterRolling((r) => r >= needed && r < needed + wall && r < 20);

    const open = room([being('foe-1', 'bruiser', 5, 5), you(6, 5)], { counter });
    const openBlow = attemptMove(open, 'foe-1', 1, 0).payload as StrikePayload;
    expect(openBlow.hit).toBe(true);

    const set = room([being('foe-1', 'bruiser', 5, 5), you(6, 5, 10, ['braced'])], { counter });
    const setBlow = attemptMove(set, 'foe-1', 1, 0).payload as StrikePayload;
    expect(setBlow.needed).toBe(needed + wall);
    expect(setBlow.hit).toBe(false);
  });

  it('staggers whatever misses the set guard', () => {
    const needed = baseNeeded();
    const counter = counterRolling((r) => r >= needed && r < needed + wall && r < 20);
    const state = room([being('foe-1', 'bruiser', 5, 5), you(6, 5, 10, ['braced'])], { counter });
    const after = apply(state, asEvent(attemptMove(state, 'foe-1', 1, 0)));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).toContain('staggered');
  });

  it('holds the ground against a trample', () => {
    const needed = baseNeeded();
    // A blow that lands even against the guard — and still cannot shove.
    const counter = counterRolling((r) => r >= needed + wall && r < 20);
    const state = room([being('foe-1', 'bruiser', 5, 5), you(6, 5, 10, ['braced'])], { counter });
    const blow = attemptMove(state, 'foe-1', 1, 0).payload as StrikePayload;
    expect(blow.hit).toBe(true);
    expect(blow.targetTo).toBeUndefined();
  });

  it('breaks the coiled spring: the bonus is absorbed, the coil still spends', () => {
    const needed = baseNeeded();
    const counter = counterRolling((r) => r >= needed + wall && r < 20);
    const might = 4;

    const sprung = room([being('foe-1', 'stalker', 5, 5, { tags: ['ambush'], might }), you(6, 5, 20)], { counter });
    const set = room([being('foe-1', 'stalker', 5, 5, { tags: ['ambush'], might }), you(6, 5, 20, ['braced'])], { counter });

    const openBlow = attemptMove(sprung, 'foe-1', 1, 0).payload as StrikePayload;
    const setBlow = attemptMove(set, 'foe-1', 1, 0).payload as StrikePayload;
    expect(openBlow.hit).toBe(true);
    expect(setBlow.hit).toBe(true);
    // Same dice, one band apart: the guard ate exactly the spring's bonus.
    expect(setBlow.damage).toBeLessThan(openBlow.damage);
    // The coil is spent either way — no second spring against bare skin.
    expect(setBlow.ambush).toBe(true);
    const after = apply(set, asEvent(attemptMove(set, 'foe-1', 1, 0)));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).not.toContain('ambush');
  });

  it('is set by its event and drops the moment its holder acts', () => {
    const state = room([you(6, 5), being('foe-1', 'bruiser', 9, 9)]);
    const braced = apply(state, asEvent(braceSelf(state, 'player')));
    expect(braced.entities.find((e) => e.id === 'player')!.tags).toContain('braced');

    const moved = apply(braced, asEvent(attemptMove(braced, 'player', 0, 1)));
    expect(moved.entities.find((e) => e.id === 'player')!.tags).not.toContain('braced');
  });

  it('drops when the holder strikes out of it', () => {
    const state = room([you(6, 5, 10, ['braced']), being('foe-1', 'bruiser', 7, 5)]);
    const after = apply(state, asEvent(attemptMove(state, 'player', 1, 0)));
    expect(after.entities.find((e) => e.id === 'player')!.tags).not.toContain('braced');
  });
});
