import { findEntity, isAlive } from '../../src/core/entity.js';
import type { Entity } from '../../src/core/entity.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { isPassable } from '../../src/core/grid.js';

function entity(id: string, hp: number): Entity {
  return { id, kind: 'test', pos: { x: 0, y: 0 }, stats: { hp, might: 1, wits: 1, speed: 1 }, tags: [], maxHp: hp };
}

describe('findEntity', () => {
  it('finds by id', () => {
    const list = [entity('a', 5), entity('b', 5)];
    expect(findEntity(list, 'b')?.id).toBe('b');
  });

  it('returns undefined for an unknown id', () => {
    expect(findEntity([entity('a', 5)], 'zz')).toBeUndefined();
  });
});

describe('isAlive', () => {
  it('is true above zero hp and false at or below', () => {
    expect(isAlive(entity('a', 1))).toBe(true);
    expect(isAlive(entity('a', 0))).toBe(false);
    expect(isAlive(entity('a', -3))).toBe(false);
  });
});

describe('EMPTY_STATE', () => {
  it('has no entities and no active turn', () => {
    expect(EMPTY_STATE.entities).toEqual([]);
    expect(EMPTY_STATE.activeEntityId).toBeNull();
    expect(EMPTY_STATE.turn).toBe(0);
    expect(EMPTY_STATE.rngCounter).toBe(0);
  });

  it('is a solid one-tile grid, so nothing is walkable before a world exists', () => {
    expect(isPassable(EMPTY_STATE.grid, 0, 0)).toBe(false);
  });

  it('is frozen, so a reducer mutating its accumulator fails loudly instead of corrupting every later replay', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.entities)).toBe(true);
    // The grid too: it is a separate object, and freezing the state around it
    // leaves it writable. Every fold in the process shares this one grid.
    expect(Object.isFrozen(EMPTY_STATE.grid)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.grid.tiles)).toBe(true);
  });
});
