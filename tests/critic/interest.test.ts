import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { interestOf, HURT_WEIGHT, NEAR_WEIGHT } from '../../src/critic/interest.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * Lens #61, the Interest Curve.
 *
 * Tension is a heuristic and the code says so. What is *not* a heuristic is the
 * shape reading: where the curve peaks as a fraction of the run, and how long
 * it goes without changing. Those are the two things Schell's lens actually
 * asks — does interest rise, and is there dead air — and they are answerable
 * from any chain.
 */

const WIDE = 12;

function world(beastAt: number, hp = 10): DraftEvent {
  return {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: WIDE, height: 1, tiles: new Array<number>(WIDE).fill(FLOOR), seed: 1, items: [],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp, might: 3, wits: 1, speed: 3 }, tags: [] },
      opponents: [{ id: 'thing-1', kind: 'thing', pos: { x: beastAt, y: 0 }, stats: { hp: 99, might: 3, wits: 1, speed: 2 }, tags: [] }],
    },
  } as DraftEvent;
}

const moveTo = (x: number): DraftEvent => ({
  type: 'MOVE', schemaVersion: 2, rngCounter: 0, rngDraws: 0,
  payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x, y: 0 } },
} as DraftEvent);

const turn = (n: number): DraftEvent => ({
  type: 'TURN_ADVANCED', schemaVersion: 2, rngCounter: 0, rngDraws: 0,
  payload: { activeEntityId: 'player', turn: n },
} as DraftEvent);

const wound = (damage: number): DraftEvent => ({
  type: 'STRIKE', schemaVersion: 1, rngCounter: 0, rngDraws: 2,
  payload: { attackerId: 'thing-1', targetId: 'player', hit: true, damage, roll: 15, needed: 10 },
} as DraftEvent);

function built(drafts: DraftEvent[]): { log: EventLog; head: string } {
  let out = append(emptyLog(), null, drafts[0]!);
  for (const d of drafts.slice(1)) out = append(out.log, out.event.id, d);
  return { log: out.log, head: out.event.id };
}

const read = (drafts: DraftEvent[]) => {
  const b = built(drafts);
  return interestOf(b.log, b.head);
};

describe('what tension is made of', () => {
  it('states its weights rather than burying them', () => {
    // A heuristic that cannot be inspected is indistinguishable from a number
    // someone made up.
    expect(HURT_WEIGHT + NEAR_WEIGHT).toBeCloseTo(1, 5);
  });

  it('rises as you get hurt', () => {
    const healthy = read([world(11), turn(2)]);
    const hurt = read([world(11), wound(7), turn(2)]);
    expect(hurt.mean).toBeGreaterThan(healthy.mean);
  });

  it('rises as something gets closer', () => {
    // Same health throughout. If proximity were ignored these would match.
    const far = read([world(11), turn(2)]);
    const near = read([world(11), moveTo(10), turn(2)]);
    expect(near.mean).toBeGreaterThan(far.mean);
  });

  it('stays inside nought and one, whatever the state', () => {
    const cases = [
      [world(11), turn(2)],
      [world(1), wound(10), turn(2)],           // dead, and something adjacent
      [world(1), wound(99), turn(2)],           // overkill
      [world(11, 1), wound(1), turn(2)],
    ];
    for (const drafts of cases) {
      for (const v of read(drafts).curve) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reads a ceiling of nothing as fully hurt, not as no tension at all', () => {
    // Written first as "the figures stay finite", which could not fail: the
    // clamp already turns NaN into 0, so a missing guard produced a finite and
    // completely wrong answer. The observable difference is the meaning — a
    // thing at zero health is maximally hurt, and 0/0 must not read as calm.
    const odd = read([world(11, 0), turn(2)]);
    for (const v of odd.curve) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(HURT_WEIGHT - 1e-9);
    }
  });
});

describe('the shape it reports', () => {
  it('puts a late peak near one and an early peak near nought', () => {
    // Schell's curve wants rising interest with the peak late. A run that
    // peaked at 0.1 was most interesting before you understood it.
    const late = read([
      world(11), turn(2), turn(3), turn(4), moveTo(10), wound(8), turn(5),
    ]);
    expect(late.peakAt).toBeGreaterThan(0.6);

    const early = read([
      world(1), turn(2), moveTo(11), turn(3), turn(4), turn(5),
    ]);
    expect(early.peakAt).toBeLessThan(0.5);
  });

  it('reports the peak as a fraction of the run, not a turn number', () => {
    // Otherwise a long run and a short one cannot be compared, and the figure
    // silently means something different in each.
    const short = read([world(11), turn(2), moveTo(10), turn(3)]);
    const long = read([world(11), turn(2), turn(3), turn(4), turn(5), moveTo(10), turn(6)]);
    for (const r of [short, long]) {
      expect(r.peakAt).toBeGreaterThanOrEqual(0);
      expect(r.peakAt).toBeLessThanOrEqual(1);
    }
  });

  it('finds the longest stretch where nothing changed', () => {
    // Dead air, in turns. This is the finding that matters for a game whose
    // last recorded run was several hundred steps of walking.
    const flat = read([world(11), turn(2), turn(3), turn(4), turn(5), turn(6)]);
    expect(flat.flattest).toBeGreaterThanOrEqual(4);

    const lively = read([
      world(11), moveTo(2), turn(2), moveTo(5), turn(3), moveTo(8), turn(4), wound(4), turn(5),
    ]);
    expect(lively.flattest).toBeLessThan(flat.flattest);
  });

  it('reports how varied it was', () => {
    const flat = read([world(11), turn(2), turn(3), turn(4)]);
    const varied = read([world(11), moveTo(10), turn(2), moveTo(1), turn(3), moveTo(10), turn(4)]);
    expect(varied.spread).toBeGreaterThan(flat.spread);
  });
});

describe('the awkward chains', () => {
  it('gives a defined report for a single turn', () => {
    const one = read([world(11)]);
    expect(one.turns).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(one.mean)).toBe(true);
    expect(Number.isFinite(one.spread)).toBe(true);
    expect(Number.isFinite(one.peakAt)).toBe(true);
  });

  it('gives a defined report for a head that is not in the log', () => {
    expect(() => interestOf(emptyLog(), 'nowhere')).not.toThrow();
    const none = interestOf(emptyLog(), 'nowhere');
    expect(none.curve).toEqual([]);
    expect(none.turns).toBe(0);
    expect(none.mean).toBe(0);
  });

  it('handles a world with nothing alive in it', () => {
    const alone: DraftEvent = {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: WIDE, height: 1, tiles: new Array<number>(WIDE).fill(FLOOR), seed: 1, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 1, speed: 3 }, tags: [] },
        opponents: [],
      },
    } as DraftEvent;
    const empty = read([alone, turn(2)]);
    // Nothing near means nothing to fear: tension is whatever your wounds say.
    for (const v of empty.curve) expect(v).toBeLessThanOrEqual(HURT_WEIGHT + 1e-9);
  });

  it('reads the same chain the same way, every time', () => {
    const drafts = [world(11), moveTo(4), turn(2), wound(3), turn(3), moveTo(9), turn(4)];
    expect(read(drafts)).toEqual(read(drafts));
  });
});

describe('the stairs cut the curve', () => {
  it('never lets a flat stretch span two floors', () => {
    // Two identical dead-calm floors, crossed mid-run. Measured as one curve
    // the flat stretch doubles; measured honestly it belongs to each floor
    // alone.
    const first: DraftEvent[] = [world(11)];
    for (let n = 2; n <= 8; n += 1) first.push(turn(n));
    const descentWorld: DraftEvent = {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: WIDE, height: 1, tiles: new Array<number>(WIDE).fill(FLOOR), seed: 2, depth: 2, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 1, speed: 3 }, tags: [] },
        opponents: [{ id: 'thing-2', kind: 'thing', pos: { x: 11, y: 0 }, stats: { hp: 99, might: 3, wits: 1, speed: 2 }, tags: [] }],
      },
    } as DraftEvent;
    const both = [...first, descentWorld];
    for (let n = 2; n <= 8; n += 1) both.push(turn(n));

    const oneFloor = read(first);
    const twoFloors = read(both);
    expect(twoFloors.flattest).toBeLessThanOrEqual(oneFloor.flattest + 1);
    expect(twoFloors.turns).toBeGreaterThan(oneFloor.turns);
  });
});
