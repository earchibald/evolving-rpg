import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { playerStep, playerWait, runWorldTurns } from '../../src/play/session.js';
import { createWorld, outcome } from '../../src/core/commands.js';
import { farthestFrom } from '../../src/core/mapgen.js';
import { EXIT, FLOOR } from '../../src/core/grid.js';
import { reachableFrom } from '../../src/core/reachability.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';

const SEED = 20260724;

function opening(): { log: ReturnType<typeof emptyLog>; head: string } {
  const first = append(emptyLog(), null, createWorld(SEED, 24, 16));
  return { log: first.log, head: first.event.id };
}

describe('the world a run starts in', () => {
  const state = fold(opening().log, opening().head);

  it('has exactly one way out', () => {
    const exits = state.grid.tiles.filter((t) => t === EXIT);
    expect(exits).toHaveLength(1);
  });

  it('puts the way out where you can actually walk to it, for any seed', () => {
    // An unreachable exit is a run that cannot be finished, and nothing else in
    // the engine would notice.
    //
    // Checked across many worlds rather than the one this suite happens to use.
    // A single-seed version of this could not fail: placing the exit anywhere at
    // all still lands on a reachable tile often enough to pass by luck, which is
    // exactly what happened when the placement was mutated to a fixed corner.
    for (let seed = 0; seed < 30; seed += 1) {
      const built = fold(
        append(emptyLog(), null, createWorld(seed, 24, 16)).log,
        append(emptyLog(), null, createWorld(seed, 24, 16)).event.id,
      );
      const you = built.entities[0];
      if (you === undefined) throw new Error(`no player for seed ${seed}`);

      const reachable = reachableFrom(built.grid, you.pos.x, you.pos.y);
      const exitIndex = built.grid.tiles.findIndex((t) => t === EXIT);
      expect(exitIndex).toBeGreaterThanOrEqual(0);
      expect(reachable.has(exitIndex)).toBe(true);
    }
  });

  it('puts the way out at the far end, not next to you', () => {
    const player = state.entities[0];
    if (player === undefined) throw new Error('no player');
    const exitIndex = state.grid.tiles.findIndex((t) => t === EXIT);
    const exit = { x: exitIndex % state.grid.width, y: Math.floor(exitIndex / state.grid.width) };
    expect(farthestFrom(state.grid, player.pos)).toEqual(exit);
  });

  it('leaves something worth having, guarded', () => {
    expect(state.items).toHaveLength(1);
    const item = state.items[0];
    if (item === undefined) throw new Error('no item');

    // On a creature's tile: taking it means going through something. An item
    // you can pick up for free is not a choice.
    // Population is the budget's business; guarding is this test's.
    const guards = state.entities.filter((e) => e.kind !== 'you');
    expect(guards.length).toBeGreaterThanOrEqual(1);
    expect(guards.some((g) => g.pos.x === item.pos.x && g.pos.y === item.pos.y)).toBe(true);
  });
});

describe('holding position', () => {
  it('spends a turn without moving you', () => {
    const start = opening();
    const before = fold(start.log, start.head);

    const waited = playerWait(start, 'player');
    const after = fold(waited.position.log, waited.position.head);

    expect(after.entities[0]?.pos).toEqual(before.entities[0]?.pos);
    expect(waited.draft?.type).toBe('WAIT');
  });

  it('draws nothing', () => {
    const start = opening();
    const before = fold(start.log, start.head);
    const waited = playerWait(start, 'player');
    const after = fold(waited.position.log, waited.position.head);
    expect(after.rngCounter).toBe(before.rngCounter);
  });

  it('lets the world come to you, which is the entire reason it exists', () => {
    // Built with a creature already within awareness. Waiting at the *start* of a
    // run does nothing at all — creatures spawn at least as far off as they can
    // see — so the key is inert until you have closed some distance yourself.
    // That is correct, and worth knowing.
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 9, height: 1, tiles: new Array<number>(9).fill(FLOOR), seed: 3, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [{ id: 'thing-1', kind: 'thing', pos: { x: 5, y: 0 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] }],
      },
    };
    const seeded = append(emptyLog(), null, world);
    let position = { log: seeded.log, head: seeded.event.id };

    const gap = (): number => {
      const st = fold(position.log, position.head);
      const you = st.entities[0];
      const it = st.entities[1];
      return Math.abs((it?.pos.x ?? 0) - (you?.pos.x ?? 0));
    };

    const before = gap();
    for (let i = 0; i < 3; i += 1) {
      const waited = playerWait(position, 'player');
      position = runWorldTurns(waited.position, 'player');
    }
    expect(gap()).toBeLessThan(before);
  });
});

describe('a finished run', () => {
  /** A three-tile corridor with the way out at the end. Purpose-built rather
   *  than walked to on a generated map: this is a test of what reaching the exit
   *  means, not of whether a crude walker can navigate. */
  function corridor(): { log: ReturnType<typeof emptyLog>; head: string } {
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 3, height: 1, tiles: [FLOOR, FLOOR, EXIT], seed: 1, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    };
    const seeded = append(emptyLog(), null, world);
    return { log: seeded.log, head: seeded.event.id };
  }

  it('is still running while you are short of the way out', () => {
    const one = playerStep(corridor(), 'player', 1, 0);
    expect(outcome(fold(one.position.log, one.position.head))).toBe('playing');
  });

  it('is escaped the moment you stand on it', () => {
    let position = corridor();
    position = playerStep(position, 'player', 1, 0).position;
    position = playerStep(position, 'player', 1, 0).position;
    expect(outcome(fold(position.log, position.head))).toBe('escaped');
  });

  it('takes no further input once it is over', () => {
    let position = corridor();
    position = playerStep(position, 'player', 1, 0).position;
    position = playerStep(position, 'player', 1, 0).position;

    const before = chain(position.log, position.head).length;
    const again = playerStep(position, 'player', -1, 0);

    expect(again.draft).toBeNull();
    expect(chain(again.position.log, again.position.head).length).toBe(before);
  });

  it('refuses to let you wait it out either', () => {
    let position = corridor();
    position = playerStep(position, 'player', 1, 0).position;
    position = playerStep(position, 'player', 1, 0).position;
    expect(playerWait(position, 'player').draft).toBeNull();
  });

  it('is dead, not playing, at no hit points', () => {
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 3, height: 1, tiles: [FLOOR, FLOOR, EXIT], seed: 1, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 0, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    };
    const seeded = append(emptyLog(), null, world);
    expect(outcome(fold(seeded.log, seeded.event.id))).toBe('dead');
  });
});

describe('taking what is underfoot', () => {
  it('grants its stats, removes it, and costs no extra turn', () => {
    // Built directly rather than walked to: the item sits behind a creature by
    // design, and this is a test of picking up, not of fighting.
    const tiles = new Array<number>(9).fill(FLOOR);
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT',
      schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
      rngCounter: 0,
      rngDraws: 0,
      payload: {
        width: 3, height: 3, tiles, seed: 1,
        items: [{
          id: 'keen-edge', kind: 'a keen edge',
          pos: { x: 1, y: 0 },
          grants: { hp: 0, might: 2, wits: 0, speed: 0 },
        }],
        player: {
          id: 'player', kind: 'you', pos: { x: 0, y: 0 },
          stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [],
        },
        opponents: [],
      },
    };

    const seeded = append(emptyLog(), null, world);
    const before = fold(seeded.log, seeded.event.id);
    expect(before.entities[0]?.stats.might).toBe(3);

    const stepped = playerStep({ log: seeded.log, head: seeded.event.id }, 'player', 1, 0);
    const after = fold(stepped.position.log, stepped.position.head);

    expect(after.entities[0]?.stats.might).toBe(5);
    expect(after.items).toHaveLength(0);
    // One turn for the walk, none for the stooping.
    expect(after.turn).toBe(before.turn + 1);
  });
});

describe('a pocketed creature cannot freeze the world', () => {
  it('keeps the turn counter moving when a creature is walled in', () => {
    // Found by the rule assay, not by play: a TURN_PASSED rule read as
    // unexploitable because the round never wrapped. A creature stuck behind a
    // wall kept walking into it, its blocked move earned no turn, and the
    // round-robin hung on it for the rest of the run.
    const world: GameEvent = {
      id: 'w', parent: null, seq: 0,
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 5, height: 1,
        tiles: [FLOOR, FLOOR, 1, FLOOR, FLOOR], seed: 3, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        // Within awareness, behind the wall: it will approach, and be blocked.
        opponents: [{ id: 'thing-1', kind: 'thing', pos: { x: 3, y: 0 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] }],
      },
    };
    const seeded = append(emptyLog(), null, world);
    let position = { log: seeded.log, head: seeded.event.id };

    for (let i = 0; i < 5; i += 1) {
      position = playerWait(position, 'player').position;
      position = runWorldTurns(position, 'player');
    }

    const state = fold(position.log, position.head);
    expect(state.turn).toBeGreaterThanOrEqual(5);
    expect(state.activeEntityId).toBe('player');
  });
});
