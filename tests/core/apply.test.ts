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
  // Map generation consumed 128 draws. In v1 this lived in the payload as
  // `counterAfter`; it is now an ordinary envelope field like every other
  // event's, which is what lets a second consumer of randomness exist.
  rngDraws: 128,
  payload: {
    width: 3, height: 2,
    tiles: [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR],
    seed: 99,
    items: [],
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
    opponents: [
      { id: 'thing-1', kind: 'thing', pos: { x: 1, y: 1 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] },
    ],
  },
};

const started = apply(EMPTY_STATE, worldInit);

describe('apply WORLD_INIT', () => {
  it('installs the grid', () => {
    expect(started.grid.width).toBe(3);
    expect(tileAt(started.grid, 2, 0)).toBe(WALL);
  });

  it('seats the player first, then the world inhabitants, and starts on turn 1', () => {
    // Player first is load-bearing: several readouts and the AI's quarry lookup
    // assume entities[0] is you.
    expect(started.entities).toHaveLength(2);
    expect(started.entities[0]?.id).toBe('player');
    expect(started.entities[1]?.id).toBe('thing-1');
    expect(started.entities[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(started.activeEntityId).toBe('player');
    expect(started.turn).toBe(1);
  });

  it('records the seed, and a counter advanced by the draws generation made', () => {
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
    rngDraws: 0,
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

  it('advances the counter by the event own draws, and by nothing else', () => {
    // v1's rule was "only WORLD_INIT can move the counter", and that is exactly
    // what v2 replaced: every event declares its own draws and apply advances by
    // precisely that. So this is a test of the new rule rather than the old one
    // patched into passing — a distinction worth keeping, because a migration
    // that quietly rewrites its predecessor's tests has proved nothing.
    const drew = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 128,
      rngDraws: 3,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    });
    expect(drew.rngCounter).toBe(131);
  });

  it('leaves every entity alone when the id matches nobody', () => {
    const nobody = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 128,
      rngDraws: 0,
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
    rngDraws: 0,
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
      rngDraws: 0,
      payload: { activeEntityId: 'player', turn: 2 },
    });
    expect(advanced.turn).toBe(2);
    expect(advanced.activeEntityId).toBe('player');
  });
});

describe('apply with an event it cannot reduce', () => {
  it('throws rather than falling off the switch and returning undefined', () => {
    // The stand-in used to be 'STRIKE' — which then shipped as a real event
    // type in increment 2, quietly turning this into a test that an ordinary
    // event throws. An impossible case must be named something that will stay
    // impossible.
    // This is the only test that pins the default arm. verifyChain rejects
    // unknown types before apply ever sees them, so every other test passes
    // with the arm deleted — and then fold() silently returns undefined while
    // still typed GameState. Confirmed: with the arm removed, all 142 other
    // tests stay green.
    const alien = {
      id: 'x', parent: null, seq: 0,
      type: '__NEVER_AN_EVENT__',
      schemaVersion: 1,
      rngCounter: 0,
      rngDraws: 0,
      payload: { nonsense: true },
    } as unknown as GameEvent;

    expect(() => apply(EMPTY_STATE, alien)).toThrow(/unknown event type __NEVER_AN_EVENT__/);
  });
});

describe('apply', () => {
  it('is deterministic — same state and event give an identical result', () => {
    const a = apply(EMPTY_STATE, worldInit);
    const b = apply(EMPTY_STATE, worldInit);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
