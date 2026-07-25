import { createWorld, attemptMove, advanceTurn, endsTurn } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { generateMap } from '../../src/core/mapgen.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import type { GameEvent } from '../../src/core/events.js';
import type { GameState } from '../../src/core/state.js';
import type { Entity } from '../../src/core/entity.js';

function seal(draft: ReturnType<typeof createWorld>): GameEvent {
  return { ...draft, id: 'x', parent: null, seq: 0 } as GameEvent;
}

describe('createWorld', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(createWorld(4242, 24, 16, 60)))
      .toBe(JSON.stringify(createWorld(4242, 24, 16, 60)));
  });

  it('starts from counter zero and records the counter generation actually reached', () => {
    const draft = createWorld(4242, 24, 16, 60);
    expect(draft.rngCounter).toBe(0);
    // Tied to the generator's real output rather than merely positive: a
    // hardcoded constant satisfies a > 0 check while silently breaking replay.
    // Draws now live on the envelope, not in the payload. Generation begins at
    // counter 0, so the counter it finished on is exactly the draw count.
    expect(draft.rngDraws).toBe(generateMap(4242, 0, 24, 16, 60).counterAfter);
  });

  it('gives the player the four stats', () => {
    const { player } = createWorld(1, 12, 8, 10).payload;
    expect(player.stats).toEqual({ hp: 10, might: 3, wits: 3, speed: 4 });
  });

  it('folds into a state whose player stands on the recorded start', () => {
    const draft = createWorld(77, 24, 16, 60);
    const state = apply(EMPTY_STATE, seal(draft));
    expect(state.entities[0]?.pos).toEqual(draft.payload.player.pos);
  });
});

// A hand-built 3x2 world: floor everywhere except (2,0). Extra entities are
// passed in rather than pushed afterwards, because GameState.entities is
// readonly — the type refuses in-place mutation on purpose.
function fixture(extra: Entity[] = []): GameState {
  return {
    grid: makeGrid(3, 2, [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR]),
    entities: [
      { id: 'player', kind: 'you', pos: { x: 1, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      ...extra,
    ],
    turn: 1,
    activeEntityId: 'player',
    seed: 5,
    rngCounter: 40,
  };
}

describe('attemptMove', () => {
  it('produces a MOVE into open floor', () => {
    const draft = attemptMove(fixture(), 'player', -1, 0);
    expect(draft.type).toBe('MOVE');
    expect(draft.payload).toMatchObject({ entityId: 'player', from: { x: 1, y: 0 }, to: { x: 0, y: 0 } });
  });

  it('blocks on a wall and says so', () => {
    const draft = attemptMove(fixture(), 'player', 1, 0);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ attempted: { x: 2, y: 0 }, reason: 'wall' });
  });

  it('blocks at the edge of the grid', () => {
    const draft = attemptMove(fixture(), 'player', 0, -1);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ reason: 'out-of-bounds' });
  });

  it('blocks on another living entity', () => {
    const state = fixture([
      { id: 'other', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    const draft = attemptMove(state, 'player', -1, 0);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ reason: 'occupied' });
  });

  it('walks through the dead', () => {
    const state = fixture([
      { id: 'corpse', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 0, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    expect(attemptMove(state, 'player', -1, 0).type).toBe('MOVE');
  });

  it('carries the current rng counter without advancing it', () => {
    expect(attemptMove(fixture(), 'player', -1, 0).rngCounter).toBe(40);
  });

  it('rejects anything but a single orthogonal step', () => {
    expect(() => attemptMove(fixture(), 'player', 1, 1)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 2, 0)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 0, 0)).toThrow(/single orthogonal step/);
  });

  it('rejects a fractional half-step that happens to sum to one', () => {
    // Both of these pass a magnitude-only check: 0.5 + 0.5 and 0.25 + 0.75 are
    // each exactly 1. Without an integer guard the player ends up between tiles.
    expect(() => attemptMove(fixture(), 'player', 0.5, 0.5)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 0.25, -0.75)).toThrow(/single orthogonal step/);
  });

  it('carries the counter unchanged on every branch, not just the successful one', () => {
    // The fixture sits at counter 40. A hardcoded 0 in any one blocked branch
    // would otherwise pass unnoticed, and replay verification would then fail
    // far from the cause.
    const occupied = fixture([
      { id: 'other', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    expect(attemptMove(fixture(), 'player', -1, 0).rngCounter).toBe(40);
    expect(attemptMove(fixture(), 'player', 1, 0).rngCounter).toBe(40);
    expect(attemptMove(fixture(), 'player', 0, -1).rngCounter).toBe(40);
    expect(attemptMove(occupied, 'player', -1, 0).rngCounter).toBe(40);
    expect(advanceTurn(fixture()).rngCounter).toBe(40);
  });

  it('rejects an unknown entity', () => {
    expect(() => attemptMove(fixture(), 'nobody', 1, 0)).toThrow(/no entity/);
  });
});

describe('advanceTurn', () => {
  it('keeps the turn number when the round has not wrapped', () => {
    const state = fixture([
      { id: 'zzz', kind: 'thing', pos: { x: 2, y: 1 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    const draft = advanceTurn(state);
    expect(draft.payload).toEqual({ activeEntityId: 'zzz', turn: 1 });
  });

  it('increments the turn when the order wraps', () => {
    const draft = advanceTurn(fixture());
    expect(draft.payload).toEqual({ activeEntityId: 'player', turn: 2 });
  });
});

describe('endsTurn', () => {
  it('charges a turn for an action that happened', () => {
    const state = fixture();
    expect(endsTurn(attemptMove(state, 'player', -1, 0))).toBe(true);
    expect(endsTurn(advanceTurn(state))).toBe(true);
  });

  it('charges nothing for a refused one', () => {
    // Walking into a wall is a mispress, not a decision. Charging a turn for it
    // hands a free hit to whatever is standing next to you — which is why this
    // is a rule of the game and not a detail of the view. Found by playing, not
    // by testing.
    const state = fixture();
    expect(endsTurn(attemptMove(state, 'player', 1, 0))).toBe(false);
    expect(endsTurn(attemptMove(state, 'player', 0, -1))).toBe(false);
  });
});
