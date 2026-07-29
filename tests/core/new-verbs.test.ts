import { decide } from '../../src/core/ai.js';
import { attemptMove, callOut, createWorld } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { intBetween } from '../../src/core/rng.js';
import { threatOf, creatureStats, VENOM_TURNS, VENOM_HARM, CALL_DISTANCE, CALL_RISERS } from '../../src/core/tables.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Entity, Pos } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/**
 * The fifth and sixth verbs: venom (the bite that keeps costing) and the
 * call (the fight becomes the room, and the clock).
 */

const SEED = 5;

function room(entities: Entity[], opts: { walls?: Array<[number, number]>; counter?: number; depth?: number } = {}): GameState {
  const width = 24;
  const height = 16;
  const tiles = new Array<number>(width * height).fill(FLOOR);
  for (const [x, y] of opts.walls ?? []) tiles[y * width + x] = WALL;
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
    depth: opts.depth ?? 4,
    story: '', motif: null, bodies: [], bible: null, smoke: null, traps: [], alarm: null, unveiled: [],
  };
}

function being(id: string, kind: string, x: number, y: number, o: { hp?: number; tags?: string[]; post?: Pos } = {}): Entity {
  const hp = o.hp ?? 5;
  return {
    id, kind, pos: { x, y },
    stats: { hp, might: 4, wits: 1, speed: 3 },
    tags: o.tags ?? [], maxHp: hp,
    ...(o.post === undefined ? {} : { post: o.post }),
  };
}

const you = (x: number, y: number, hp = 12): Entity =>
  ({ id: 'player', kind: 'you', pos: { x, y }, stats: { hp, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: hp });

function counterRolling(predicate: (roll: number) => boolean): number {
  for (let c = 0; c < 5000; c += 1) if (predicate(intBetween(SEED, c, 1, 20))) return c;
  throw new Error('no counter found');
}

const asEvent = (draft: object): GameEvent => ({ ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

const wrap = (state: GameState): GameEvent => asEvent({
  type: 'TURN_ADVANCED', schemaVersion: 2, rngCounter: state.rngCounter, rngDraws: 0,
  payload: { activeEntityId: null, turn: state.turn + 1 },
});

describe('venom', () => {
  const bitten = (): GameState => {
    const state = room(
      [being('foe-1', 'stinger', 5, 5), you(6, 5)],
      { counter: counterRolling((r) => r >= 12 && r < 20) },
    );
    return apply(state, asEvent(attemptMove(state, 'foe-1', 1, 0)));
  };

  it('takes hold on a landed bite, whole and counted', () => {
    const after = bitten();
    expect(after.entities.find((e) => e.id === 'player')!.tags).toContain(`venom-${String(VENOM_TURNS)}`);
  });

  it('burns once per round until it spends itself', () => {
    let state = bitten();
    const start = state.entities.find((e) => e.id === 'player')!.stats.hp;
    for (let round = 1; round <= VENOM_TURNS; round += 1) {
      state = apply(state, wrap(state));
      const me = state.entities.find((e) => e.id === 'player')!;
      expect(me.stats.hp).toBe(start - VENOM_HARM * round);
    }
    const me = state.entities.find((e) => e.id === 'player')!;
    expect(me.tags.some((t) => t.startsWith('venom-'))).toBe(false);
    // Spent: further rounds cost nothing.
    const later = apply(state, wrap(state));
    expect(later.entities.find((e) => e.id === 'player')!.stats.hp).toBe(me.stats.hp);
  });

  it('re-opens rather than stacks on a second bite', () => {
    let state = bitten();
    state = apply(state, wrap(state));
    // Bite again: fresh venom replaces the half-spent wound.
    const again = { ...state, rngCounter: counterRolling((r) => r >= 12 && r < 20) };
    const after = apply(again, asEvent(attemptMove(again, 'foe-1', 1, 0)));
    const tags = after.entities.find((e) => e.id === 'player')!.tags.filter((t) => t.startsWith('venom-'));
    expect(tags).toEqual([`venom-${String(VENOM_TURNS)}`]);
  });

  it('does not haunt the dead', () => {
    const state = room([being('foe-1', 'stinger', 5, 5), you(6, 5, 1, )], { counter: counterRolling((r) => r >= 12 && r < 20) });
    const dead = apply(state, asEvent(attemptMove(state, 'foe-1', 1, 0)));
    const me = dead.entities.find((e) => e.id === 'player')!;
    expect(me.stats.hp).toBe(0);
    // A killing bite leaves no venom on a corpse, and rounds cost it nothing.
    expect(me.tags.some((t) => t.startsWith('venom-'))).toBe(false);
    expect(apply(dead, wrap(dead)).entities.find((e) => e.id === 'player')!.stats.hp).toBe(0);
  });

  it('is priced into the threat it spends and the XP it pays', () => {
    const stats = creatureStats('stinger', 2)!;
    expect(threatOf(stats, 'stinger')).toBeGreaterThan(threatOf(stats));
  });
});

describe('the call', () => {
  const meeting = (tags = ['call']): GameState =>
    room([being('caller-1', 'caller', 5, 5, { tags }), you(8, 5)], { depth: 4 });

  it('is the decision when prey is near and the voice unspent', () => {
    expect(decide(meeting(), 'caller-1')).toEqual({ kind: 'call' });
    // Spent voice: it hunts like anything else.
    expect(decide(meeting([]), 'caller-1').kind).not.toBe('call');
  });

  it('wakes the floor at a chase\'s distance, with every draw counted', () => {
    const state = meeting();
    const called = callOut(state, 'caller-1');
    expect(called).not.toBeNull();
    const p = called!.payload;
    expect(p.opponents.length).toBe(CALL_RISERS);
    expect(called!.rngDraws).toBe(CALL_RISERS * 2);
    for (const o of p.opponents) {
      const away = Math.abs(o.pos.x - 8) + Math.abs(o.pos.y - 5);
      expect(away).toBeGreaterThanOrEqual(CALL_DISTANCE);
      // A caller never calls callers — one voice is a clock, a chain is a
      // fork bomb.
      expect(o.kind.startsWith('caller')).toBe(false);
    }
  });

  it('spends the voice and raises exactly what was recorded', () => {
    const state = meeting();
    const called = callOut(state, 'caller-1')!;
    const after = apply(state, asEvent(called));

    expect(after.entities.find((e) => e.id === 'caller-1')!.tags).not.toContain('call');
    for (const o of called.payload.opponents) {
      const raised = after.entities.find((e) => e.id === o.id)!;
      expect(raised.pos).toEqual(o.pos);
      expect(raised.maxHp).toBe(o.stats.hp);
      expect(raised.post).toEqual(o.pos);
    }
    // Called once: the decision never comes back.
    expect(decide(after, 'caller-1').kind).not.toBe('call');
  });

  it('replays exactly — same world, same cry, same answers', () => {
    const state = meeting();
    expect(callOut(state, 'caller-1')).toEqual(callOut(state, 'caller-1'));
  });
});

describe('the teaching floor stays teachable', () => {
  it('never seats a stinger or a caller on depth 1', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const world = createWorld(seed, 48, 32);
      for (const e of world.payload.opponents) {
        expect(e.kind.startsWith('stinger')).toBe(false);
        expect(e.kind.startsWith('caller')).toBe(false);
      }
    }
  });

  it('lets them in once the lesson is over', () => {
    // Somewhere in twenty deep floors the new kinds appear at all — the
    // depth gate is a gate, not a wall.
    let seen = false;
    for (let seed = 1; seed <= 20 && !seen; seed += 1) {
      const world = createWorld(seed, 48, 32, 'player', 4);
      seen = world.payload.opponents.some(
        (e) => e.kind.startsWith('stinger') || e.kind.startsWith('caller'),
      );
    }
    expect(seen).toBe(true);
  });
});
