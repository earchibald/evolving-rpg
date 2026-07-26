import { decide, AWARENESS } from '../../src/core/ai.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';

/** An open room, wide enough that awareness rather than geometry is what limits
 *  a creature. Walls are added per test where they matter. */
function room(entities: Entity[], walls: Array<[number, number]> = []): GameState {
  const width = 20;
  const height = 12;
  const tiles = new Array<number>(width * height).fill(FLOOR);
  for (const [x, y] of walls) tiles[y * width + x] = WALL;
  return {
    grid: makeGrid(width, height, tiles),
    entities,
    items: [],
    turn: 1,
    activeEntityId: entities[0]?.id ?? null,
    seed: 7,
    rngCounter: 0,
    rules: [],
    xp: 0,
    level: 1,
  };
}

function being(id: string, kind: string, x: number, y: number, hp = 5): Entity {
  return { id, kind, pos: { x, y }, stats: { hp, might: 4, wits: 1, speed: 3 }, tags: [], maxHp: hp };
}

const you = (x: number, y: number, hp = 10): Entity => being('player', 'you', x, y, hp);

describe('decide', () => {
  it('strikes what is next to it', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(6, 5)]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'strike', targetId: 'player' });
  });

  it('does not strike diagonally, because it cannot move that way either', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(6, 6)]);
    expect(decide(state, 'thing-1').kind).toBe('step');
  });

  it('closes the larger gap first', () => {
    // Six across, two down: it should move across, not down.
    const state = room([being('thing-1', 'thing', 5, 5), you(11, 7)]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('breaks an exact tie toward x, every time', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(8, 8)]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('decides the same thing regardless of where it sits in the entity list', () => {
    // The bug this guards is subtle and fatal to replay: if a decision depended
    // on array position, two folds of one log could disagree about what a
    // creature did.
    const creature = being('thing-1', 'thing', 5, 5);
    const player = you(11, 7);
    const forwards = decide(room([creature, player]), 'thing-1');
    const backwards = decide(room([player, creature]), 'thing-1');
    expect(forwards).toEqual(backwards);
  });

  it('takes the other axis when its first choice is walled', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(11, 7)], [[6, 5]]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 0, dy: 1 });
  });

  it('waits when both ways toward you are walled', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(11, 7)], [[6, 5], [5, 6]]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'wait' });
  });

  it('does not walk through another creature', () => {
    const state = room([
      being('thing-1', 'thing', 5, 5),
      being('thing-2', 'thing', 6, 5),
      you(11, 7),
    ]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 0, dy: 1 });
  });

  it('walks over the dead', () => {
    const state = room([
      being('thing-1', 'thing', 5, 5),
      being('corpse', 'thing', 6, 5, 0),
      you(11, 7),
    ]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('ignores you from beyond its awareness', () => {
    const far = you(5 + AWARENESS + 1, 5);
    expect(decide(room([being('thing-1', 'thing', 5, 5), far]), 'thing-1')).toEqual({ kind: 'wait' });
  });

  it('notices you at the very edge of it', () => {
    const edge = you(5 + AWARENESS, 5);
    expect(decide(room([being('thing-1', 'thing', 5, 5), edge]), 'thing-1').kind).toBe('step');
  });

  it('does nothing when dead', () => {
    const state = room([being('thing-1', 'thing', 5, 5, 0), you(6, 5)]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'wait' });
  });

  it('does nothing when there is no living quarry', () => {
    const state = room([being('thing-1', 'thing', 5, 5), you(6, 5, 0)]);
    expect(decide(state, 'thing-1')).toEqual({ kind: 'wait' });
  });

  it('draws no randomness at all, so the counter never moves for a decision', () => {
    // Stated as a property because it is the reason creatures decide this way:
    // randomness here would have to be threaded through the counter protocol on
    // every creature's every turn, and replay would then hinge on the order they
    // were asked in.
    const state = room([being('thing-1', 'thing', 5, 5), you(11, 7)]);
    const first = decide(state, 'thing-1');
    for (let i = 0; i < 50; i += 1) expect(decide(state, 'thing-1')).toEqual(first);
  });
});
