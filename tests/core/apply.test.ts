import { apply } from '../../src/core/apply.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR, WALL, tileAt } from '../../src/core/grid.js';

const worldInit: GameEvent = {
  id: 'e0', parent: null, seq: 0,
  type: 'WORLD_INIT',
  schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
  rngCounter: 0,
  payload: {
    width: 3, height: 2,
    tiles: [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR],
    seed: 99,
    counterAfter: 128,
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
  },
};

const started = apply(EMPTY_STATE, worldInit);

describe('apply WORLD_INIT', () => {
  it('installs the grid', () => {
    expect(started.grid.width).toBe(3);
    expect(tileAt(started.grid, 2, 0)).toBe(WALL);
  });

  it('places the player and makes them active on turn 1', () => {
    expect(started.entities).toHaveLength(1);
    expect(started.entities[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(started.activeEntityId).toBe('player');
    expect(started.turn).toBe(1);
  });

  it('records the seed and the counter the generator finished on', () => {
    expect(started.seed).toBe(99);
    expect(started.rngCounter).toBe(128);
  });

  it('copies the player, so mutating the event payload cannot reach into state', () => {
    // Every nested part, not just position: stats and tags are separate objects
    // in the payload too, and aliasing any of them would let a later event
    // rewrite history that has already been folded.
    worldInit.payload.player.pos.x = 999;
    worldInit.payload.player.stats.hp = 999;
    worldInit.payload.player.tags.push('injected');

    expect(started.entities[0]?.pos.x).toBe(0);
    expect(started.entities[0]?.stats.hp).toBe(10);
    expect(started.entities[0]?.tags).toEqual([]);

    worldInit.payload.player.pos.x = 0;
    worldInit.payload.player.stats.hp = 10;
    worldInit.payload.player.tags.length = 0;
  });
});

describe('apply MOVE', () => {
  const moved = apply(started, {
    id: 'e1', parent: 'e0', seq: 1,
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: 128,
    payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
  });

  it('moves the named entity to the recorded destination', () => {
    expect(moved.entities[0]?.pos).toEqual({ x: 1, y: 0 });
  });

  it('leaves the previous state untouched', () => {
    expect(started.entities[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('does not advance the rng counter, because a move draws nothing', () => {
    expect(moved.rngCounter).toBe(128);
  });

  it('ignores the event own rngCounter, so only WORLD_INIT can move it', () => {
    // A deliberately mismatched counter. verifyChain would reject this event,
    // but apply must not read the field at all: if it copied the counter from
    // the event, the replay check that compares them would be circular and
    // would pass while proving nothing.
    const bogus = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 999999,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    });
    expect(bogus.rngCounter).toBe(128);
  });

  it('leaves every entity alone when the id matches nobody', () => {
    const nobody = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 128,
      payload: { entityId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    });
    expect(nobody.entities).toEqual(started.entities);
    expect(nobody.rngCounter).toBe(started.rngCounter);
  });
});

describe('apply MOVE_BLOCKED', () => {
  const blocked = apply(started, {
    id: 'e1', parent: 'e0', seq: 1,
    type: 'MOVE_BLOCKED',
    schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
    rngCounter: 128,
    payload: { entityId: 'player', attempted: { x: 2, y: 0 }, reason: 'wall' },
  });

  it('changes nothing but is still recorded as something that happened', () => {
    expect(blocked.entities[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(blocked.turn).toBe(started.turn);
  });

  it('returns the very same state object, not a copy of it', () => {
    // Identity, not equality: a rewrite that returned {...state} would still
    // pass a value check while quietly making every blocked move allocate.
    expect(blocked).toBe(started);
  });
});

describe('apply TURN_ADVANCED', () => {
  it('takes the turn number and active entity straight from the payload', () => {
    const advanced = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'TURN_ADVANCED',
      schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
      rngCounter: 128,
      payload: { activeEntityId: 'player', turn: 2 },
    });
    expect(advanced.turn).toBe(2);
    expect(advanced.activeEntityId).toBe('player');
  });
});

describe('apply', () => {
  it('is deterministic — same state and event give an identical result', () => {
    const a = apply(EMPTY_STATE, worldInit);
    const b = apply(EMPTY_STATE, worldInit);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
