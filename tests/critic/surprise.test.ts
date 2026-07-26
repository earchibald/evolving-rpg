import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { surpriseOf, SURPRISE_THRESHOLD } from '../../src/critic/surprise.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { FLOOR } from '../../src/core/grid.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * Lens #2, and the trap it sets.
 *
 * On the combat maths as they stand this metric reads 0.00, because
 * `needed = 10 + speed - might` and every real to-hit target sits at 8 or 10 —
 * rarest outcomes of 0.35 and 0.45, nowhere near the threshold. That is the
 * correct answer.
 *
 * Which is exactly the problem. A metric whose right answer is zero invites an
 * implementation that returns zero, and a suite that only ever checks the zero
 * case would never notice. So every "reads zero" test here is paired with a
 * lopsided case that must read above zero.
 */

function strike(needed: number, hit: boolean, damage = 1, roll = 10): DraftEvent {
  return {
    type: 'STRIKE', schemaVersion: 1, rngCounter: 0, rngDraws: 2,
    payload: { attackerId: 'player', targetId: 'thing-1', hit, damage, roll, needed },
  } as DraftEvent;
}

const other = (): DraftEvent => ({
  type: 'WAIT', schemaVersion: 1, rngCounter: 0, rngDraws: 0,
  payload: { entityId: 'player' },
} as DraftEvent);

/** A world whose player has a stated might, so the damage range is exact
 *  rather than guessed from what happened to be rolled. */
function world(might: number): DraftEvent {
  return {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 4, height: 1, tiles: new Array<number>(4).fill(FLOOR), seed: 1, items: [],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might, wits: 1, speed: 3 }, tags: [] },
      opponents: [{ id: 'thing-1', kind: 'thing', pos: { x: 2, y: 0 }, stats: { hp: 40, might: 3, wits: 1, speed: 3 }, tags: [] }],
    },
  } as DraftEvent;
}

/** Builds a chain and hands back what the Critic reads. */
function played(might: number, drafts: DraftEvent[]): { log: EventLog; head: string } {
  let out = append(emptyLog(), null, world(might));
  for (const draft of drafts) out = append(out.log, out.event.id, draft);
  return { log: out.log, head: out.event.id };
}

const read = (might: number, drafts: DraftEvent[]) => {
  const p = played(might, drafts);
  return surpriseOf(p.log, p.head);
};

describe('what counts as surprising', () => {
  it('uses the threshold the lens is defined by', () => {
    expect(SURPRISE_THRESHOLD).toBe(0.15);
  });

  it('reads zero across ordinary blows — which is the true answer, not a stub', () => {
    // needed 8 and 10: the only targets the game actually produces.
    const got = read(3, [strike(8, true), strike(8, false), strike(10, true), strike(10, false)]);
    expect(got.rate).toBe(0);
    expect(got.modelled).toBeGreaterThan(0);
  });

  it('reads above zero when something genuinely unlikely happens', () => {
    // This is the test that makes the one above mean something.
    // needed 19 is a 10% chance to hit; landing it is a surprise.
    const got = read(3, [strike(19, true)]);
    expect(got.rate).toBeGreaterThan(0);
    expect(got.surprising).toBeGreaterThan(0);
  });

  it('treats the threshold as strictly below, not at', () => {
    // needed 18 is exactly 3/20 — 0.15 on the nose. Worth pinning, because
    // "unlikely" and "at the edge of unlikely" differing by one point of a
    // to-hit target is precisely the kind of boundary that drifts.
    expect(read(3, [strike(18, true)]).surprising).toBe(0);
    expect(read(3, [strike(19, true)]).surprising).toBe(1);
  });

  it('counts an improbable miss, not only an improbable hit', () => {
    // needed 3 hits 90% of the time. Missing is the surprise, and a metric that
    // only looked at hits would call this unremarkable.
    const got = read(3, [strike(3, false)]);
    expect(got.surprising).toBe(1);
  });

  it('does not call a likely outcome surprising', () => {
    expect(read(3, [strike(3, true)]).surprising).toBe(0);
    expect(read(3, [strike(19, false)]).surprising).toBe(0);
  });

  it('counts the damage roll as well as the blow, using the real range', () => {
    // Damage is uniform over 1..might, so a specific value is 1/might. The
    // range comes from folding the chain — the attacker's actual might at the
    // moment they swung. Estimating it from the biggest damage ever seen would
    // be circular for exactly the rolls that ought to register.
    const wide = read(9, [strike(10, true, 7)]);   // 1/9 ≈ 0.11 — under the line
    const narrow = read(2, [strike(10, true, 2)]); // 1/2 — nowhere near it
    expect(wide.surprising).toBeGreaterThan(narrow.surprising);
  });

  it('follows might upward, so a sharper blade makes each exact roll rarer', () => {
    expect(read(3, [strike(10, true, 3)]).surprising).toBe(0);
    expect(read(12, [strike(10, true, 3)]).surprising).toBe(1);
  });
});

describe('saying how much it looked at', () => {
  it('distinguishes "nothing was surprising" from "nothing was measured"', () => {
    // 0.00 across four blows and 0.00 across four thousand are different
    // claims, and a bare rate renders them identically.
    expect(read(3, []).modelled).toBe(0);
    expect(read(3, [other(), other()]).modelled).toBe(0);
    expect(read(3, [strike(10, true)]).modelled).toBeGreaterThan(0);
  });

  it('reports zero rate rather than dividing by nothing', () => {
    const got = read(3, []);
    expect(got.rate).toBe(0);
    expect(Number.isNaN(got.rate)).toBe(false);
  });
});

describe('reading history it did not write', () => {
  it('skips a malformed payload rather than throwing', () => {
    // Older engines wrote different shapes, and this reads whatever is on disk.
    const p = played(3, [strike(10, true)]);
    const broken = new Map(p.log.events);
    for (const [id, e] of broken) {
      if (e.type === 'STRIKE') broken.set(id, { ...e, payload: { needed: 'ten' } } as unknown as GameEvent);
    }
    expect(() => surpriseOf({ events: broken }, p.head)).not.toThrow();
  });

  it('returns a reading for a head that is not in the log at all', () => {
    expect(() => surpriseOf(emptyLog(), 'nowhere')).not.toThrow();
    expect(surpriseOf(emptyLog(), 'nowhere').modelled).toBe(0);
  });

  it('clamps an impossible to-hit target instead of producing a negative chance', () => {
    // needed 25 cannot be met on a d20; needed 0 cannot be failed. Neither
    // outcome that actually occurred should read as a shock.
    const got = read(3, [strike(25, false), strike(0, true)]);
    expect(got.surprising).toBe(0);
  });
});

describe('crits are the surprises', () => {
  it('counts a realized natural 20 as an unlikely outcome', () => {
    // p = 1/20 = 0.05, under the threshold — the first event this lens has
    // ever had to count in ordinary play.
    const crit = { ...strike(9, true, 6, 20), payload: undefined } as unknown as { payload: unknown };
    void crit;
    const p = played(3, [{
      type: 'STRIKE', schemaVersion: 2, rngCounter: 0, rngDraws: 2,
      payload: { attackerId: 'player', targetId: 'thing-1', hit: true, crit: true, damage: 6, roll: 20, needed: 9 },
    } as DraftEvent]);
    expect(surpriseOf(p.log, p.head).surprising).toBeGreaterThanOrEqual(1);
  });

  it('still reads an ordinary even-money blow as unremarkable', () => {
    const p = played(3, [{
      type: 'STRIKE', schemaVersion: 2, rngCounter: 0, rngDraws: 2,
      payload: { attackerId: 'player', targetId: 'thing-1', hit: true, crit: false, damage: 2, roll: 12, needed: 9 },
    } as DraftEvent]);
    // The damage-roll term may still register; the to-hit outcome must not.
    const got = surpriseOf(p.log, p.head);
    expect(got.modelled).toBeGreaterThan(0);
  });
});
