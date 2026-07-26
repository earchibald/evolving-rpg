import { CachedCritic } from '../../src/critic/memo.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';

/**
 * The Critic is called from the render loop, and the render loop runs on every
 * keypress. Reading a four-hundred-event chain per keypress is a real cost —
 * so the reading is memoised by head, which is exactly correct for an
 * append-only log: same head, same history, same report, always.
 */

const world = (): DraftEvent => ({
  type: 'WORLD_INIT', schemaVersion: 5, rngCounter: 0, rngDraws: 0,
  payload: {
    width: 4, height: 1, tiles: new Array<number>(4).fill(FLOOR), seed: 1, items: [],
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 1, speed: 3 }, tags: [] },
    opponents: [],
  },
} as DraftEvent);

const turn = (n: number): DraftEvent => ({
  type: 'TURN_ADVANCED', schemaVersion: 2, rngCounter: 0, rngDraws: 0,
  payload: { activeEntityId: 'player', turn: n },
} as DraftEvent);

describe('reading once per head', () => {
  it('computes once for repeated reads at the same head', () => {
    const a = append(emptyLog(), null, world());
    const critic = new CachedCritic();

    critic.read(a.log, a.event.id);
    critic.read(a.log, a.event.id);
    critic.read(a.log, a.event.id);

    expect(critic.computes).toBe(1);
  });

  it('computes again when the head moves', () => {
    const a = append(emptyLog(), null, world());
    const b = append(a.log, a.event.id, turn(2));
    const critic = new CachedCritic();

    critic.read(a.log, a.event.id);
    critic.read(b.log, b.event.id);
    critic.read(b.log, b.event.id);

    expect(critic.computes).toBe(2);
  });

  it('hands back the identical report object while the head holds still', () => {
    const a = append(emptyLog(), null, world());
    const critic = new CachedCritic();
    expect(critic.read(a.log, a.event.id)).toBe(critic.read(a.log, a.event.id));
  });

  it('treats different worlds as different readings, not one cache line', () => {
    // Switching between two refs must not thrash a single memo slot into
    // recomputing forever — both stay warm.
    const a = append(emptyLog(), null, world());
    const b = append(a.log, a.event.id, turn(2));
    const critic = new CachedCritic();

    critic.read(a.log, a.event.id);
    critic.read(b.log, b.event.id);
    critic.read(a.log, a.event.id);
    critic.read(b.log, b.event.id);

    expect(critic.computes).toBe(2);
  });

  it('survives a null head', () => {
    const critic = new CachedCritic();
    expect(() => critic.read(emptyLog(), null)).not.toThrow();
    critic.read(emptyLog(), null);
    expect(critic.computes).toBe(1);
  });
});
