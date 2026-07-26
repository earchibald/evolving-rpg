import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { emptyLog, append, fold } from '../../src/log/chain.js';
import { takeUnderfoot } from '../../src/core/commands.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent, GameEvent } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * Equipment, not accumulation. One slot, one item: a second sword replaces
 * the first, a lesser sword stays on the floor, and armor that comes off
 * takes its hit points with it.
 */

function world(items: { id: string; kind: string; x: number; grants: Partial<Record<'hp' | 'might' | 'wits' | 'speed', number>> }[]): GameEvent {
  return {
    id: 'w', parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 10, height: 1, tiles: new Array<number>(10).fill(FLOOR), seed: 1, depth: 1,
      items: items.map((i) => ({
        id: i.id, kind: i.kind, pos: { x: i.x, y: 0 },
        grants: { hp: 0, might: 0, wits: 0, speed: 0, ...i.grants },
      })),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as GameEvent;
}

const stepTo = (x: number): DraftEvent => ({
  type: 'MOVE', schemaVersion: 2, rngCounter: 0, rngDraws: 0,
  payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x, y: 0 } },
} as DraftEvent);

function play(w: GameEvent, moves: number[]): { log: EventLog; head: string } {
  let out = append(emptyLog(), null, w);
  let position = { log: out.log, head: out.event.id };
  for (const x of moves) {
    const moved = append(position.log, position.head, stepTo(x));
    position = { log: moved.log, head: moved.event.id };
    const taken = takeUnderfoot(fold(position.log, position.head), 'player');
    if (taken !== null) {
      const got = append(position.log, position.head, taken);
      position = { log: got.log, head: got.event.id };
    }
  }
  return position;
}

describe('one slot, one item', () => {
  it('equips the first weapon whole', () => {
    const p = play(world([{ id: 'a', kind: 'keen edge', x: 2, grants: { might: 2 } }]), [2]);
    const you = fold(p.log, p.head).entities[0]!;
    expect(you.stats.might).toBe(5);
    expect(you.gear?.['weapon']?.kind).toBe('keen edge');
  });

  it('replaces, never stacks: two swords are not twice as strong', () => {
    const p = play(world([
      { id: 'a', kind: 'keen edge', x: 2, grants: { might: 2 } },
      { id: 'b', kind: 'hewing axe', x: 4, grants: { might: 3 } },
    ]), [2, 4]);
    const you = fold(p.log, p.head).entities[0]!;
    // 3 base − 2 off + 3 on, not 3 + 2 + 3.
    expect(you.stats.might).toBe(6);
    expect(you.gear?.['weapon']?.kind).toBe('hewing axe');
  });

  it('leaves a lesser item on the floor', () => {
    const p = play(world([
      { id: 'a', kind: 'hewing axe', x: 2, grants: { might: 3 } },
      { id: 'b', kind: 'keen edge', x: 4, grants: { might: 2 } },
    ]), [2, 4]);
    const state = fold(p.log, p.head);
    expect(state.entities[0]!.stats.might).toBe(6);
    // The lesser edge is still there, untaken.
    expect(state.items.some((i) => i.id === 'b')).toBe(true);
  });

  it('ignores an equal item too — a sidegrade is not worth the stoop', () => {
    const p = play(world([
      { id: 'a', kind: 'keen edge', x: 2, grants: { might: 2 } },
      { id: 'b', kind: 'other edge', x: 4, grants: { might: 2 } },
    ]), [2, 4]);
    expect(fold(p.log, p.head).items.some((i) => i.id === 'b')).toBe(true);
  });

  it('swaps armor with its hit points, ceiling and all', () => {
    const p = play(world([
      { id: 'a', kind: 'iron charm', x: 2, grants: { hp: 3 } },
      { id: 'b', kind: 'oak charm', x: 4, grants: { hp: 5 } },
    ]), [2, 4]);
    const you = fold(p.log, p.head).entities[0]!;
    // 10 base + 5 from the better charm — the +3 came off with the old one.
    expect(you.maxHp).toBe(15);
    expect(you.stats.hp).toBeLessThanOrEqual(you.maxHp);
  });

  it('keeps different slots independent', () => {
    const p = play(world([
      { id: 'a', kind: 'keen edge', x: 2, grants: { might: 2 } },
      { id: 'b', kind: 'fleet boots', x: 4, grants: { speed: 1 } },
      { id: 'c', kind: 'grey lens', x: 6, grants: { wits: 1 } },
    ]), [2, 4, 6]);
    const you = fold(p.log, p.head).entities[0]!;
    expect(you.stats.might).toBe(5);
    expect(you.stats.speed).toBe(5);
    expect(you.stats.wits).toBe(4);
    expect(Object.keys(you.gear ?? {}).sort()).toEqual(['boots', 'trinket', 'weapon']);
  });
});
