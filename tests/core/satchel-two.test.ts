import { apply } from '../../src/core/apply.js';
import { takeUnderfoot, useCarried, heartHeld } from '../../src/core/commands.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameState } from '../../src/core/state.js';
import { FLOOR } from '../../src/core/grid.js';
import { HEART_KIND } from '../../src/core/tables.js';
import { emptyLog, append, fold } from '../../src/log/chain.js';

/**
 * The satchel grows a second slot (the designer's ruling, voiced run
 * 2026-07-28): two carried things, q spends the first, Q the second,
 * duplicates welcome, full hands refuse the walk-over out loud, and the
 * heart still seals everything it rides with.
 */

interface Opt { satchel?: string[]; items?: { id: string; kind: string; x: number; y: number }[] }

let seq = 0;
function world(opt: Opt = {}): GameState {
  seq += 1;
  return apply(EMPTY_STATE, {
    id: `w${String(seq)}`, parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0, rngDraws: 0,
    payload: {
      width: 8, height: 1, tiles: Array.from({ length: 8 }, () => FLOOR), seed: 9,
      ...(opt.satchel === undefined ? {} : { playerSatchel: { kinds: opt.satchel } }),
      items: (opt.items ?? []).map((i) => ({ id: i.id, kind: i.kind, pos: { x: i.x, y: i.y }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } })),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as GameEvent);
}

const kinds = (s: GameState): string[] => (s.entities[0]!.satchel ?? []).map((c) => c.kind);
const commit = (s: GameState, d: DraftEvent | null): GameState => {
  expect(d).not.toBeNull();
  return apply(s, { ...d!, id: `e${String((seq += 1))}`, parent: null, seq } as GameEvent);
};

describe('two slots, filled in order', () => {
  it('takes into the first empty slot, then the second, recording which', () => {
    const bare = world({ items: [{ id: 'p1', kind: 'still smoke', x: 0, y: 0 }] });
    const first = takeUnderfoot(bare, 'player');
    expect(first!.payload.satchel).toEqual({ swappedOut: null, slot: 0 });
    const one = commit(bare, first);
    expect(kinds(one)).toEqual(['still smoke']);

    const oneItem = world({ satchel: ['still smoke'], items: [{ id: 'p2', kind: 'tallow flare', x: 0, y: 0 }] });
    const second = takeUnderfoot(oneItem, 'player');
    expect(second!.payload.satchel).toEqual({ swappedOut: null, slot: 1 });
    expect(kinds(commit(oneItem, second))).toEqual(['still smoke', 'tallow flare']);
  });

  it('welcomes duplicates — two flares are two flares', () => {
    const s = world({ satchel: ['tallow flare'], items: [{ id: 'p1', kind: 'tallow flare', x: 0, y: 0 }] });
    const took = takeUnderfoot(s, 'player');
    expect(took).not.toBeNull();
    expect(kinds(commit(s, took))).toEqual(['tallow flare', 'tallow flare']);
  });

  it('refuses the walk-over on full hands, and swaps the first slot deliberately', () => {
    const full = world({ satchel: ['still smoke', 'tallow flare'], items: [{ id: 'p1', kind: 'vital draught', x: 0, y: 0 }] });
    expect(takeUnderfoot(full, 'player')).toBeNull();
    const swapped = takeUnderfoot(full, 'player', true);
    expect(swapped!.payload.satchel).toEqual({ swappedOut: 'still smoke', slot: 0 });
    const after = commit(full, swapped);
    expect(kinds(after)).toEqual(['vital draught', 'tallow flare']);
    // The shed smoke lies where the draught lay.
    expect(after.items.some((i) => i.kind === 'still smoke' && i.pos.x === 0)).toBe(true);
  });
});

describe('q spends the first thing, Q the second', () => {
  it('spends the named slot and compacts what remains', () => {
    const s = world({ satchel: ['still smoke', 'vital draught'] });
    const second = useCarried(s, 'player', 1);
    expect(second!.payload.slot).toBe(1);
    expect(second!.payload.kind).toBe('vital draught');
    expect(kinds(commit(s, second))).toEqual(['still smoke']);

    const first = useCarried(s, 'player', 0);
    expect(first!.payload.kind).toBe('still smoke');
    expect(kinds(commit(s, first))).toEqual(['vital draught']);
  });

  it('refuses an empty slot quietly', () => {
    const s = world({ satchel: ['still smoke'] });
    expect(useCarried(s, 'player', 1)).toBeNull();
    expect(useCarried(world(), 'player', 0)).toBeNull();
  });
});

describe('the heart still seals everything', () => {
  it('rides a slot, seals both, and heartHeld sees it wherever it sits', () => {
    const s = world({ satchel: [HEART_KIND, 'tallow flare'] });
    expect(heartHeld(s)).toBe(true);
    // Sealed: no using the flare around the heart, no taking anything.
    expect(useCarried(s, 'player', 1)).toBeNull();
    const withItem = world({ satchel: [HEART_KIND], items: [{ id: 'p1', kind: 'still smoke', x: 0, y: 0 }] });
    expect(takeUnderfoot(withItem, 'player')).toBeNull();
    expect(takeUnderfoot(withItem, 'player', true)).toBeNull();
  });
});

describe('the chain agrees', () => {
  it('take-take-use folds exact through a real chain', () => {
    const born = append(emptyLog(), null, {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 8, height: 1, tiles: Array.from({ length: 8 }, () => FLOOR), seed: 9,
        items: [
          { id: 'p1', kind: 'still smoke', pos: { x: 0, y: 0 }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } },
          { id: 'p2', kind: 'vital draught', pos: { x: 0, y: 0 }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } },
        ],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    } as Extract<DraftEvent, { type: 'WORLD_INIT' }>);
    let log = born.log;
    let head = born.event.id;
    for (let i = 0; i < 2; i += 1) {
      const took = takeUnderfoot(fold(log, head), 'player');
      const done = append(log, head, took!);
      log = done.log; head = done.event.id;
    }
    expect(kinds(fold(log, head))).toEqual(['still smoke', 'vital draught']);
    const drink = useCarried(fold(log, head), 'player', 1);
    const done = append(log, head, drink!);
    const after = fold(done.log, done.event.id);
    expect(kinds(after)).toEqual(['still smoke']);
    expect(after.entities[0]!.stats.hp).toBeGreaterThan(4); // the draught mended
  });
});
