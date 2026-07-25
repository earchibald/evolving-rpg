import { initiativeOrder, nextActive } from '../../src/core/turns.js';
import type { Entity } from '../../src/core/entity.js';

function entity(id: string, speed: number, hp = 5): Entity {
  return { id, kind: 'test', pos: { x: 0, y: 0 }, stats: { hp, might: 1, wits: 1, speed }, tags: [] };
}

describe('initiativeOrder', () => {
  it('orders by speed, fastest first', () => {
    const order = initiativeOrder([entity('slow', 1), entity('fast', 9), entity('mid', 5)]);
    expect(order).toEqual(['fast', 'mid', 'slow']);
  });

  it('breaks speed ties by ascending id, so order never depends on input order', () => {
    const forwards = initiativeOrder([entity('a', 4), entity('b', 4), entity('c', 4)]);
    const backwards = initiativeOrder([entity('c', 4), entity('b', 4), entity('a', 4)]);
    expect(forwards).toEqual(['a', 'b', 'c']);
    expect(backwards).toEqual(['a', 'b', 'c']);
  });

  it('leaves out the dead', () => {
    expect(initiativeOrder([entity('alive', 3), entity('dead', 9, 0)])).toEqual(['alive']);
  });

  it('does not mutate its input', () => {
    const list = [entity('slow', 1), entity('fast', 9)];
    initiativeOrder(list);
    expect(list.map((e) => e.id)).toEqual(['slow', 'fast']);
  });
});

describe('nextActive', () => {
  const roster = [entity('a', 9), entity('b', 5), entity('c', 1)];

  it('starts at the fastest when nobody is active', () => {
    expect(nextActive(roster, null)).toEqual({ activeEntityId: 'a', wrapped: false });
  });

  it('steps down the order without wrapping', () => {
    expect(nextActive(roster, 'a')).toEqual({ activeEntityId: 'b', wrapped: false });
    expect(nextActive(roster, 'b')).toEqual({ activeEntityId: 'c', wrapped: false });
  });

  it('wraps after the last, which is what ends a round', () => {
    expect(nextActive(roster, 'c')).toEqual({ activeEntityId: 'a', wrapped: true });
  });

  it('restarts the order and reports a wrap when the active entity has left', () => {
    expect(nextActive(roster, 'gone')).toEqual({ activeEntityId: 'a', wrapped: true });
  });

  it('has nobody active when everyone is dead', () => {
    expect(nextActive([entity('a', 9, 0)], 'a')).toEqual({ activeEntityId: null, wrapped: false });
  });

  it('stays on the only survivor and reports a wrap each time', () => {
    expect(nextActive([entity('solo', 4)], 'solo')).toEqual({ activeEntityId: 'solo', wrapped: true });
  });
});
