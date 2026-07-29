import { apply } from '../../src/core/apply.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR } from '../../src/core/grid.js';
import type { GameState } from '../../src/core/state.js';

/**
 * The stance law — covenant M8's reducer half. One stance per body; waiting
 * holds a draw; everything else the holder does — and everything that lands
 * on them — shakes it loose.
 */

let seq = 0;
function ev(type: GameEvent['type'], payload: unknown, extra: Partial<GameEvent> = {}): GameEvent {
  seq += 1;
  return {
    id: `t${String(seq)}`, parent: null, seq,
    type,
    schemaVersion: SCHEMA_VERSIONS[type],
    rngCounter: 0, rngDraws: 0,
    payload,
    ...extra,
  } as GameEvent;
}

function world(tags: { player?: string[]; foe?: string[] } = {}): GameState {
  return apply(EMPTY_STATE, ev('WORLD_INIT', {
    width: 6, height: 1,
    tiles: [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR],
    seed: 7,
    items: [],
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: tags.player ?? [] },
    opponents: [
      { id: 'foe-1', kind: 'slinger', pos: { x: 3, y: 0 }, stats: { hp: 3, might: 2, wits: 2, speed: 2 }, tags: tags.foe ?? [] },
    ],
  }, { rngDraws: 0 }));
}

const tagsOf = (s: GameState, id: string): string[] => s.entities.find((e) => e.id === id)!.tags;

const drawn = (id: string): GameEvent => ev('DRAWN', { entityId: id });
const braced = (id: string): GameEvent => ev('BRACED', { entityId: id });

function strike(attackerId: string, targetId: string, over: Partial<{
  roll: number; needed: number; hit: boolean; crit: boolean; damage: number; mode: 'melee' | 'ranged';
}> = {}, version: number = SCHEMA_VERSIONS.STRIKE): GameEvent {
  const p = { attackerId, targetId, roll: 10, needed: 8, hit: true, crit: false, damage: 1, ...over };
  return ev('STRIKE', p, { schemaVersion: version });
}

describe('one stance per body', () => {
  it('DRAWN writes the tag and evicts a brace', () => {
    const s = apply(world({ foe: ['braced'] }), drawn('foe-1'));
    expect(tagsOf(s, 'foe-1')).toContain('drawn');
    expect(tagsOf(s, 'foe-1')).not.toContain('braced');
  });

  it('BRACED evicts a draw', () => {
    const s = apply(world({ player: ['drawn'] }), braced('player'));
    expect(tagsOf(s, 'player')).toContain('braced');
    expect(tagsOf(s, 'player')).not.toContain('drawn');
  });
});

describe('what the holder does', () => {
  it('a move drops the draw', () => {
    const s = apply(world({ player: ['drawn'] }), ev('MOVE', {
      entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
    }));
    expect(tagsOf(s, 'player')).not.toContain('drawn');
  });

  it('a wait holds the draw — the archer may stand at full draw', () => {
    const s = apply(world({ player: ['drawn'] }), ev('WAIT', { entityId: 'player' }));
    expect(tagsOf(s, 'player')).toContain('drawn');
    // ...while the same wait still spends a brace, the old law untouched.
    const b = apply(world({ player: ['braced'] }), ev('WAIT', { entityId: 'player' }));
    expect(tagsOf(b, 'player')).not.toContain('braced');
  });

  it('a melee swing drops the attacker\'s draw', () => {
    const s = apply(world({ player: ['drawn'] }), strike('player', 'foe-1', { mode: 'melee', damage: 0, hit: false, roll: 2, needed: 8 }));
    expect(tagsOf(s, 'player')).not.toContain('drawn');
  });
});

describe('what lands on the holder', () => {
  it('a landed, damaging blow shakes the target\'s draw loose', () => {
    const s = apply(world({ foe: ['drawn'] }), strike('player', 'foe-1', { mode: 'melee', damage: 1 }));
    expect(tagsOf(s, 'foe-1')).not.toContain('drawn');
  });

  it('a miss leaves the draw standing', () => {
    const s = apply(world({ foe: ['drawn'] }), strike('player', 'foe-1', { mode: 'melee', hit: false, damage: 0, roll: 2 }));
    expect(tagsOf(s, 'foe-1')).toContain('drawn');
  });

  it('a shove\'s slam staggers, and the reel shakes the draw loose', () => {
    const s = apply(world({ foe: ['drawn'] }), ev('SHOVE', {
      shoverId: 'player', targetId: 'foe-1', to: null, slammed: true, struckId: null,
    }));
    expect(tagsOf(s, 'foe-1')).toContain('staggered');
    expect(tagsOf(s, 'foe-1')).not.toContain('drawn');
  });
});

describe('the mode gates', () => {
  it('a ranged miss against a set guard does not stagger the far shooter', () => {
    const s = apply(world({ player: ['braced'] }), strike('foe-1', 'player', { mode: 'ranged', hit: false, damage: 0, roll: 2, needed: 14 }));
    expect(tagsOf(s, 'foe-1')).not.toContain('staggered');
  });

  it('a melee miss against a set guard still staggers — overcommitment is a fact about bodies', () => {
    const s = apply(world({ player: ['braced'] }), strike('foe-1', 'player', { mode: 'melee', hit: false, damage: 0, roll: 2, needed: 14 }));
    expect(tagsOf(s, 'foe-1')).toContain('staggered');
  });

  it('a v3 strike without a mode folds as melee — old chains read unchanged', () => {
    const s = apply(world({ player: ['braced'] }), strike('foe-1', 'player', { hit: false, damage: 0, roll: 2, needed: 14 }, 3));
    expect(tagsOf(s, 'foe-1')).toContain('staggered');
  });
});

describe('the shot is still a blow', () => {
  it('reduces hit points, and a killing shot pays XP like any kill', () => {
    const before = world();
    const s = apply(before, strike('player', 'foe-1', { mode: 'ranged', damage: 3 }));
    expect(s.entities.find((e) => e.id === 'foe-1')!.stats.hp).toBe(0);
    expect(s.xp).toBeGreaterThan(before.xp);
  });
});
