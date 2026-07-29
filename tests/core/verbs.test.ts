import { decide } from '../../src/core/ai.js';
import { attemptMove, lungeStrike, vigilKept, createWorld } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { intBetween } from '../../src/core/rng.js';
import { verbOf, LURK_RANGE, VIGIL_LEASH, AMBUSH_FROM_DEPTH } from '../../src/core/tables.js';
import { FLOOR, WALL, EXIT, makeGrid } from '../../src/core/grid.js';
import type { GameEvent, StrikePayload } from '../../src/core/events.js';
import type { Entity, Pos } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/**
 * The verbs: what makes a bruiser a bruiser rather than a stat row.
 *
 * Every test here drives the real command layer and the real reducer — the
 * mechanics the keyboard reaches — because a verb that only exists in the
 * brain (ai.ts) is a verb replay could disagree with.
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

const you = (x: number, y: number, hp = 10): Entity =>
  ({ id: 'player', kind: 'you', pos: { x, y }, stats: { hp, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: hp });

/** Searches for a counter whose d20 satisfies the predicate, rather than
 *  hardcoding one — a hardcoded counter silently stops testing the case the
 *  moment the RNG or the to-hit maths changes. */
function counterRolling(predicate: (roll: number) => boolean): number {
  for (let c = 0; c < 5000; c += 1) if (predicate(intBetween(SEED, c, 1, 20))) return c;
  throw new Error('no counter found — the generator or the range changed');
}

const asEvent = (draft: ReturnType<typeof attemptMove>): GameEvent =>
  ({ ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

describe('the trample (bruiser)', () => {
  // Bruiser at (5,5) striking east into the player at (6,5); (7,5) is open.
  const line = (playerHp = 10, opts: Parameters<typeof room>[1] = {}): GameState =>
    room([being('foe-1', 'bruiser', 5, 5), you(6, 5, playerHp)], { ...opts, counter: counterRolling((r) => r >= 10 && r < 20) });

  it('shoves the target back a pace and lumbers into the gap, in one event', () => {
    const state = line();
    const draft = attemptMove(state, 'foe-1', 1, 0);
    expect(draft.type).toBe('STRIKE');
    const p = draft.payload as StrikePayload;
    expect(p.hit).toBe(true);
    expect(p.targetTo).toEqual({ x: 7, y: 5 });
    expect(p.attackerTo).toEqual({ x: 6, y: 5 });

    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'player')?.pos).toEqual({ x: 7, y: 5 });
    expect(after.entities.find((e) => e.id === 'foe-1')?.pos).toEqual({ x: 6, y: 5 });
    // Still adjacent: the shove that opens a gap would be a self-defeating verb.
    expect(after.entities.find((e) => e.id === 'player')?.stats.hp).toBeLessThan(10);
  });

  it('does not shove into a wall — the blow lands plain', () => {
    const draft = attemptMove(line(10, { walls: [[7, 5]] }), 'foe-1', 1, 0);
    const p = draft.payload as StrikePayload;
    expect(p.hit).toBe(true);
    expect(p.targetTo).toBeUndefined();
    expect(p.attackerTo).toBeUndefined();
  });

  it('never shoves onto the way out — an exit you are knocked through is not an escape you chose', () => {
    const draft = attemptMove(line(10, { exit: [7, 5] }), 'foe-1', 1, 0);
    expect((draft.payload as StrikePayload).targetTo).toBeUndefined();
  });

  it('does not shove through another body', () => {
    const state = room(
      [being('foe-1', 'bruiser', 5, 5), you(6, 5), being('foe-2', 'skirmisher', 7, 5)],
      { counter: counterRolling((r) => r >= 10 && r < 20) },
    );
    expect((attemptMove(state, 'foe-1', 1, 0).payload as StrikePayload).targetTo).toBeUndefined();
  });

  it('does not drive the dead anywhere', () => {
    // One hit point: any landed blow kills, and a corpse stays where it fell.
    const draft = attemptMove(line(1), 'foe-1', 1, 0);
    const p = draft.payload as StrikePayload;
    expect(p.hit).toBe(true);
    expect(p.targetTo).toBeUndefined();
  });

  it('is the bruiser\'s verb, not the player\'s', () => {
    const state = room([you(5, 5), being('foe-1', 'bruiser', 6, 5)], { counter: counterRolling((r) => r >= 11 && r < 20) });
    expect((attemptMove(state, 'player', 1, 0).payload as StrikePayload).targetTo).toBeUndefined();
  });
});

describe('the lunge (skirmisher)', () => {
  it('decides to lunge at exactly two tiles of ground', () => {
    const state = room([being('foe-1', 'skirmisher', 5, 5), you(7, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'lunge', targetId: 'player' });
  });

  it('crosses the free tile and strikes in one event, east first on a tie', () => {
    const state = room([being('foe-1', 'skirmisher', 5, 5), you(6, 6)], { counter: counterRolling((r) => r >= 11 && r < 20) });
    const draft = lungeStrike(state, 'foe-1', 'player');
    expect(draft).not.toBeNull();
    const p = draft!.payload;
    expect(p.attackerTo).toEqual({ x: 6, y: 5 });
    expect(p.targetTo).toBeUndefined();

    const after = apply(state, asEvent(draft!));
    expect(after.entities.find((e) => e.id === 'foe-1')?.pos).toEqual({ x: 6, y: 5 });
    expect(after.entities.find((e) => e.id === 'player')?.stats.hp).toBeLessThan(10);
  });

  it('still crosses the ground when the blow misses', () => {
    const state = room([being('foe-1', 'skirmisher', 5, 5), you(7, 5)], { counter: counterRolling((r) => r > 1 && r < 11) });
    const draft = lungeStrike(state, 'foe-1', 'player');
    const p = draft!.payload;
    expect(p.hit).toBe(false);
    expect(p.attackerTo).toEqual({ x: 6, y: 5 });
    const after = apply(state, asEvent(draft!));
    expect(after.entities.find((e) => e.id === 'foe-1')?.pos).toEqual({ x: 6, y: 5 });
    expect(after.entities.find((e) => e.id === 'player')?.stats.hp).toBe(10);
  });

  it('refuses when no free tile lies on the way', () => {
    const state = room(
      [being('foe-1', 'skirmisher', 5, 5), you(7, 5)],
      { walls: [[6, 5]] },
    );
    // The straight tile is walled and no bent path closes to adjacency in two.
    expect(lungeStrike(state, 'foe-1', 'player')).toBeNull();
    expect(decide(state, 'foe-1').kind).toBe('step');
  });

  it('refuses at any distance but two', () => {
    const near = room([being('foe-1', 'skirmisher', 5, 5), you(6, 5)]);
    const far = room([being('foe-1', 'skirmisher', 5, 5), you(9, 5)]);
    expect(lungeStrike(near, 'foe-1', 'player')).toBeNull();
    expect(lungeStrike(far, 'foe-1', 'player')).toBeNull();
  });
});

describe('the ambush (stalker)', () => {
  it('holds perfectly still while the quarry is beyond its spring', () => {
    const state = room([being('foe-1', 'stalker', 5, 5, { tags: ['ambush'] }), you(5 + LURK_RANGE + 1, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'wait' });
  });

  it('commits when the quarry walks inside the spring', () => {
    const state = room([being('foe-1', 'stalker', 5, 5, { tags: ['ambush'] }), you(5 + LURK_RANGE, 5)]);
    expect(decide(state, 'foe-1').kind).toBe('step');
  });

  it('hunts plain once the spring is spent', () => {
    const state = room([being('foe-1', 'stalker', 5, 5), you(12, 5)]);
    expect(decide(state, 'foe-1').kind).toBe('step');
  });

  it('rolls its first landed blow one band harder, then uncoils', () => {
    // might 4 rolls 1d3+1 (2..4); the sprung blow rolls the might-6 band,
    // 1d4+2 (3..6). A non-crit landed roll keeps the bands tellable apart.
    const counter = counterRolling((r) => r >= 11 && r < 20);
    const state = room([being('foe-1', 'stalker', 5, 5, { tags: ['ambush'] }), you(6, 5)], { counter });
    const draft = attemptMove(state, 'foe-1', 1, 0);
    const p = draft.payload as StrikePayload;
    expect(p.hit).toBe(true);
    expect(p.ambush).toBe(true);
    expect(p.damage).toBeGreaterThanOrEqual(3);
    expect(p.damage).toBeLessThanOrEqual(6);

    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')?.tags).toEqual([]);

    // The next blow is an ordinary one: the spring spends exactly once.
    const again = attemptMove({ ...after, rngCounter: counter }, 'foe-1', 1, 0);
    const q = again.payload as StrikePayload;
    expect(q.ambush).toBeUndefined();
    expect(q.damage).toBeLessThanOrEqual(4);
  });

  it('keeps the spring coiled through a miss', () => {
    const state = room(
      [being('foe-1', 'stalker', 5, 5, { tags: ['ambush'] }), you(6, 5)],
      { counter: counterRolling((r) => r > 1 && r < 11) },
    );
    const draft = attemptMove(state, 'foe-1', 1, 0);
    expect((draft.payload as StrikePayload).ambush).toBeUndefined();
    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')?.tags).toEqual(['ambush']);
  });

  it('is born coiled below the teaching floor, and springless on it', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const depth of [1, AMBUSH_FROM_DEPTH]) {
        const born = createWorld(seed, 48, 32, 'player', depth);
        for (const foe of born.payload.opponents) {
          if (verbOf(foe.kind) !== 'ambush') continue;
          expect(foe.tags).toEqual(depth >= AMBUSH_FROM_DEPTH ? ['ambush'] : []);
        }
      }
    }
  });
});

describe('the vigil (warden)', () => {
  const POST: Pos = { x: 5, y: 5 };
  const warden = (x: number, y: number, hp: number): Entity =>
    being('foe-1', 'warden', x, y, { hp, maxHp: 16, post: POST, might: 5, speed: 2 });

  it('hunts what comes inside the leash', () => {
    const state = room([warden(5, 5, 16), you(5 + VIGIL_LEASH, 5)]);
    expect(decide(state, 'foe-1').kind).toBe('step');
  });

  it('will not be drawn past the leash — it turns for home', () => {
    // Dragged two tiles off its post, the intruder beyond the leash: the
    // warden walks back rather than chasing across the floor.
    const state = room([warden(7, 5, 16), you(5 + VIGIL_LEASH + 2, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'step', dx: -1, dy: 0 });
  });

  it('measures the leash from the post, not from wherever the chase dragged it', () => {
    // The intruder stands two tiles from the warden but seven of walking from
    // the post — outside the vigil's world. Home wins.
    const state = room([warden(10, 5, 16), you(12, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'step', dx: -1, dy: 0 });
  });

  it('stands its post, whole, when nothing intrudes', () => {
    const state = room([warden(5, 5, 16), you(15, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'wait' });
  });

  it('knits shut at its post once the intruder is gone', () => {
    const state = room([warden(5, 5, 6), you(15, 5)]);
    expect(decide(state, 'foe-1')).toEqual({ kind: 'mend' });

    const draft = vigilKept(state, 'foe-1');
    expect(draft.type).toBe('VIGIL_KEPT');
    expect(draft.rngDraws).toBe(0);
    const after = apply(state, asEvent(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')?.stats.hp).toBe(16);
  });

  it('does not mend while watched — poking a boss buys nothing, running buys less', () => {
    const state = room([warden(5, 5, 6), you(7, 5)]);
    // Intruder inside the leash: the warden fights; the wound stays open.
    expect(decide(state, 'foe-1').kind).toBe('step');
  });
});

describe('the verbs are the archetypes\'', () => {
  it('reads the verb through a level suffix', () => {
    expect(verbOf('bruiser-2')).toBe('trample');
    expect(verbOf('warden-3')).toBe('vigil');
    expect(verbOf('you')).toBeUndefined();
  });
});
