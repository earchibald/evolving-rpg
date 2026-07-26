import { autoplay } from '../../src/play/autoplay.js';
import { POLICIES, rusher, brawler, sitter, bumper } from '../../src/play/policies.js';
import { emptyLog, append, chain } from '../../src/log/chain.js';
import { createWorld } from '../../src/core/commands.js';
import { FLOOR, EXIT } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';

/**
 * The harness has to be trustworthy before anything built on it is — the
 * assays will refuse rules on its word, and a driver that stalls, loops or
 * plays through a side door would refuse the wrong ones.
 */

function world(seed: number): Position {
  const born = append(emptyLog(), null, createWorld(seed, 24, 16, 60));
  return { log: born.log, head: born.event.id };
}

/** An empty corridor with an exit: escape depends on nothing but pathing.
 *  Written first against generated worlds, where the rusher DIED on the test
 *  seeds — which is a finding about the game (measured: 6 of 20 seeds kill a
 *  beeline rusher), not about the harness. A harness test must not assert a
 *  balance claim; balance claims belong to the playtest report. */
function emptyWorld(): Position {
  const tiles = new Array<number>(10).fill(FLOOR);
  tiles[9] = EXIT;
  const born = append(emptyLog(), null, {
    type: 'WORLD_INIT', schemaVersion: 5, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 10, height: 1, tiles, seed: 1, items: [],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 1, speed: 3 }, tags: [] },
      opponents: [],
    },
  } as DraftEvent);
  return { log: born.log, head: born.event.id };
}

describe('driving the real game', () => {
  it('lets the rusher escape a world with nothing in the way', () => {
    const done = autoplay(emptyWorld(), rusher, 40);
    expect(done.ended).toBe('escaped');
    expect(done.actions).toBeLessThanOrEqual(12);
  });

  it('ends every generated run in a legal outcome, across seeds', () => {
    for (const seed of [1, 2, 3, 5, 8, 11]) {
      const done = autoplay(world(seed), rusher, 500);
      expect(['escaped', 'dead']).toContain(done.ended);
    }
  });

  it('lets the brawler draw blood', () => {
    const done = autoplay(world(11), brawler, 400);
    const struck = chain(done.position.log, done.position.head)
      .filter((e) => e.type === 'STRIKE' && e.payload.attackerId === 'player');
    expect(struck.length).toBeGreaterThan(0);
  });

  it('always terminates, whatever the policy does', () => {
    // The bumper's blocked moves cost no turn — a turn-capped driver would
    // never come back from this one.
    for (const name of Object.keys(POLICIES)) {
      const done = autoplay(world(3), POLICIES[name]!, 60);
      expect(done.actions).toBeLessThanOrEqual(60);
    }
  });

  it('writes real history — a replayed chain, not a summary', () => {
    const done = autoplay(world(7), sitter, 10);
    const events = chain(done.position.log, done.position.head);
    expect(events.length).toBeGreaterThan(1);
    expect(events[0]?.type).toBe('WORLD_INIT');
  });

  it('stops the moment the run ends rather than playing a corpse', () => {
    const done = autoplay(emptyWorld(), rusher, 40);
    expect(done.ended).toBe('escaped');
    const after = autoplay(done.position, rusher, 50);
    expect(after.actions).toBe(0);
  });

  it('is deterministic: same seed, same policy, same run', () => {
    const a = autoplay(world(9), brawler, 120);
    const b = autoplay(world(9), brawler, 120);
    expect(a.position.head).toBe(b.position.head);
    expect(a.ended).toBe(b.ended);
  });

  it('bumper generates blocked moves without the world ever acting', () => {
    const done = autoplay(world(3), bumper, 30);
    const events = chain(done.position.log, done.position.head);
    expect(events.filter((e) => e.type === 'MOVE_BLOCKED').length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'TURN_ADVANCED').length).toBe(0);
  });
});
