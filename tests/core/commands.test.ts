import {
  createWorld, attemptMove, advanceTurn, endsTurn,
  OPPONENT_COUNT, OPPONENT_MIN_DISTANCE, toHit, hitChance,
} from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { generateMap, pickSpawnPoints } from '../../src/core/mapgen.js';
import { intBetween } from '../../src/core/rng.js';
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

  it('records every draw generation made, the map and its inhabitants alike', () => {
    const draft = createWorld(4242, 24, 16, 60);
    expect(draft.rngCounter).toBe(0);

    // Tied to the generators' real output rather than merely positive: a
    // hardcoded constant satisfies a `> 0` check while silently breaking replay.
    // Placing inhabitants draws too, so the total is the map's plus theirs —
    // which is the whole reason the draw count had to move onto the envelope.
    const map = generateMap(4242, 0, 24, 16, 60);
    const spawned = pickSpawnPoints(
      4242, map.counterAfter, map.grid, map.start, OPPONENT_COUNT, OPPONENT_MIN_DISTANCE,
    );
    expect(draft.rngDraws).toBe(spawned.counterAfter);
    expect(draft.rngDraws).toBeGreaterThan(map.counterAfter);
  });

  it('places its inhabitants reachable, apart, and clear of you', () => {
    const draft = createWorld(4242, 24, 16, 60);
    const { player, opponents } = draft.payload;
    expect(opponents).toHaveLength(OPPONENT_COUNT);

    const seen = new Set<string>();
    for (const o of opponents) {
      const distance = Math.abs(o.pos.x - player.pos.x) + Math.abs(o.pos.y - player.pos.y);
      expect(distance).toBeGreaterThanOrEqual(OPPONENT_MIN_DISTANCE);
      seen.add(`${o.pos.x},${o.pos.y}`);
    }
    // Distinct tiles: picking from a shrinking list is what guarantees this,
    // and two creatures on one square would be a state nothing else expects.
    expect(seen.size).toBe(OPPONENT_COUNT);
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
    items: [],
    turn: 1,
    activeEntityId: 'player',
    seed: 5,
    rngCounter: 40,
    rules: [],
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

  it('strikes a hostile occupant instead of moving into it', () => {
    // Bump to attack: walking into something hostile is the attack, which keeps
    // the entire game on four inputs.
    const state = fixture([
      { id: 'other', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    const draft = attemptMove(state, 'player', -1, 0);
    expect(draft.type).toBe('STRIKE');
    expect(draft.payload).toMatchObject({ attackerId: 'player', targetId: 'other' });
    // The literal 2, deliberately, not STRIKE_DRAWS: asserting a constant
    // against itself moves both sides together and can never fail. Caught by
    // mutating the constant and watching nothing here notice.
    expect(draft.rngDraws).toBe(2);
  });

  it('is merely blocked by something of its own kind', () => {
    // Alike kinds do not fight. Without this, a crowd of creatures would brawl
    // with each other on the way to you instead of arriving.
    const state = fixture([
      { id: 'twin', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
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

describe('striking', () => {
  // Two creatures a step apart, so a bump is an attack.
  function brawl(counter: number): GameState {
    return {
      grid: makeGrid(3, 1, [FLOOR, FLOOR, FLOOR]),
      entities: [
        { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        { id: 'thing-1', kind: 'thing', pos: { x: 1, y: 0 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] },
      ],
      items: [],
      turn: 1,
      activeEntityId: 'player',
      seed: 5,
      rngCounter: counter,
      rules: [],
    };
  }

  /** Searches for a counter that rolls under the target, rather than hardcoding
   *  one — a hardcoded counter would silently stop testing a miss the moment
   *  the RNG or the to-hit maths changed. */
  function counterRolling(predicate: (roll: number) => boolean): number {
    for (let c = 0; c < 5000; c += 1) if (predicate(intBetween(5, c, 1, 20))) return c;
    throw new Error('no counter found — the generator or the range changed');
  }

  it('records a miss as a miss, and still spends both draws', () => {
    const needed = 10 + 3 - 3;
    const draft = attemptMove(brawl(counterRolling((r) => r < needed)), 'player', 1, 0);
    expect(draft.type).toBe('STRIKE');
    expect(draft.payload).toMatchObject({ hit: false, damage: 0 });
    // Spending the same count either way is what keeps the counter's progress
    // independent of the outcome. Literal, not the constant — see above.
    expect(draft.rngDraws).toBe(2);
  });

  it('records the roll and the number it needed, not just the verdict', () => {
    const draft = attemptMove(brawl(counterRolling((r) => r >= 10)), 'player', 1, 0);
    expect(draft.payload).toMatchObject({ needed: 10, hit: true });
    expect((draft.payload as { roll: number }).roll).toBeGreaterThanOrEqual(1);
    expect((draft.payload as { roll: number }).roll).toBeLessThanOrEqual(20);
  });

  it('deals between one and the attacker might', () => {
    const draft = attemptMove(brawl(counterRolling((r) => r >= 10)), 'player', 1, 0);
    const { damage } = draft.payload as { damage: number };
    expect(damage).toBeGreaterThanOrEqual(1);
    expect(damage).toBeLessThanOrEqual(3);
  });

  it('takes hit points away on a hit', () => {
    const state = brawl(counterRolling((r) => r >= 10));
    const draft = attemptMove(state, 'player', 1, 0);
    const after = apply(state, { ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);
    const { damage } = draft.payload as { damage: number };
    expect(after.entities[1]?.stats.hp).toBe(5 - damage);
  });

  it('takes no hit points on a miss, but still spends the draws', () => {
    // Not object identity: a miss changes nobody, yet the counter still moves by
    // two, so the state genuinely differs. Distinguishing "no damage" from "no
    // draws" is the whole point — conflating them would hide a counter that
    // failed to advance, and that surfaces later as a replay divergence.
    const state = brawl(counterRolling((r) => r < 10));
    const draft = attemptMove(state, 'player', 1, 0);
    const after = apply(state, { ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

    expect(after.entities).toBe(state.entities);
    expect(after.rngCounter).toBe(state.rngCounter + 2);
  });

  it('clamps at zero rather than letting a corpse get deader', () => {
    const state = brawl(counterRolling((r) => r >= 10));
    const dying: GameState = {
      ...state,
      entities: [
        state.entities[0] as Entity,
        { ...(state.entities[1] as Entity), stats: { hp: 1, might: 4, wits: 1, speed: 3 } },
      ],
    };
    const draft = attemptMove(dying, 'player', 1, 0);
    const after = apply(dying, { ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);
    expect(after.entities[1]?.stats.hp).toBe(0);
  });
});

describe('the numbers a player decides on', () => {
  const you = (might: number): Entity =>
    ({ id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might, wits: 3, speed: 4 }, tags: [] });
  const thing: Entity =
    { id: 'thing-1', kind: 'thing', pos: { x: 1, y: 0 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] };

  it('states what you need to roll, from both sides', () => {
    expect(toHit(you(3), thing)).toBe(10);
    expect(toHit(thing, you(3))).toBe(10);
  });

  it('turns that into odds out of twenty', () => {
    expect(hitChance(you(3), thing)).toBe(11);
  });

  it('makes the keen edge worth taking, measurably', () => {
    // The item read as doing nothing when played, which was a legibility
    // failure rather than a balance one — so the effect is pinned here in the
    // terms a player would notice, not as a stat delta.
    const before = you(3);
    const after = you(5);

    expect(toHit(before, thing)).toBe(10);
    expect(toHit(after, thing)).toBe(8);
    expect(hitChance(before, thing)).toBe(11);
    expect(hitChance(after, thing)).toBe(13);

    // Damage per turn: odds times average damage. Roughly three quarters more.
    const perTurn = (e: Entity): number =>
      (hitChance(e, thing) / 20) * ((1 + e.stats.might) / 2);
    expect(perTurn(after) / perTurn(before)).toBeGreaterThan(1.7);
  });

  it('cannot promise a certainty or an impossibility', () => {
    const mighty = you(20);
    const feeble = you(-20);
    expect(hitChance(mighty, thing)).toBeLessThanOrEqual(20);
    expect(hitChance(feeble, thing)).toBeGreaterThanOrEqual(0);
  });
});
