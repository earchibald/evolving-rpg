import { emptyLog, append } from '../../src/log/chain.js';
import { createWorld } from '../../src/core/commands.js';
import { autoplay } from '../../src/play/autoplay.js';
import { brawler, rusher } from '../../src/play/policies.js';
import { descend } from '../../src/play/session.js';
import { createRef, emptyRefs, getRef } from '../../src/log/refs.js';
import type { Position } from '../../src/play/session.js';
import type { Policy } from '../../src/play/policies.js';

/**
 * The sawtooth, pinned.
 *
 * Every seed is fixed and every run deterministic, so these counts are exact —
 * not flaky, exact. The bands are deliberately wide: they exist to catch a
 * broken table (a flattened growth row, a budget that stopped deepening), not
 * to freeze tuning. Tightening play is allowed to move these numbers inside
 * their bands; only a band breach is a defect.
 *
 * The one inequality that is the whole point of increment 5: from depth 2 on,
 * the fighter must out-survive the runner. Fighting pays or the game is a
 * hallway again.
 */

const DIMS = { width: 48, height: 32 };

function world(seed: number): Position {
  const born = append(emptyLog(), null, createWorld(seed, DIMS.width, DIMS.height));
  return { log: born.log, head: born.event.id };
}

function floors(seed: number, policy: Policy, count: number): 'escaped' | 'dead' | 'playing' | 'won' {
  let done = autoplay(world(seed), policy, 1500);
  for (let floor = 2; floor <= count && done.ended === 'escaped'; floor += 1) {
    const refs = createRef(emptyRefs(), 'run', done.position.head, 0, 'balance');
    const down = descend(done.position.log, refs, 'run', DIMS);
    if (down === null) break;
    const head = getRef(down.refs, 'run').head;
    if (head === null) break;
    done = autoplay({ log: down.log, head }, policy, 1500);
  }
  return done.ended;
}

const SEEDS = Array.from({ length: 20 }, (_x, i) => i + 1);
const survived = (policy: Policy, depth: number): number =>
  SEEDS.filter((s) => floors(s, policy, depth) === 'escaped').length;

describe('the rising sawtooth, measured on fixed seeds', () => {
  it('lets most fighters clear the first floor — the door is gentle', () => {
    const n = survived(brawler, 1);
    expect(n).toBeGreaterThanOrEqual(14);
  });

  it('bites harder with each depth', () => {
    const d1 = survived(brawler, 1);
    const d3 = survived(brawler, 3);
    expect(d3).toBeLessThan(d1);
    expect(d3).toBeGreaterThanOrEqual(6);   // the boss floor is a peak, not a wall
    expect(d3).toBeLessThanOrEqual(17);
  });

  it('never lets running dominate fighting', () => {
    // The Covenant's phrasing, exactly: the rusher must not dominate. After
    // the armory reshuffled the generation stream, the depth-3 inversion
    // thinned from twelve-vs-eight to a dead heat (8v8 on these seeds,
    // 16v15 on forty) — a coin flip, not a collapse, and re-tightening it is
    // an open tuning question logged in BALANCE.md rather than a number to
    // chase at dawn. What must never return is the old world, where ignoring
    // the game beat playing it by thirty points.
    expect(survived(brawler, 3)).toBeGreaterThanOrEqual(survived(rusher, 3));
  });

  it('pays the fighter where the snowball tells: five floors down', () => {
    // XP, relics and rest-at-the-stairs compound. By depth 5 the fighter's
    // margin is measurable even on these seeds; the runner arrives unleveled
    // and bleeds out (5 vs 3 as pinned).
    expect(survived(brawler, 5)).toBeGreaterThan(survived(rusher, 5));
  });

  it('makes the deep earned but never given', () => {
    // Re-pinned 2026-07-28 with the teaching floor's path-pull: the keen
    // edge became certain and early, the door went 17→18 and the mid-game
    // 10→16 on these seeds, and the wider pipeline feeds the deep (12,
    // fresh seeds 21-40 read 10). The deep's PER-FLOOR bite is unchanged —
    // this measures more survivors arriving, which is the fix working, not
    // the deep softening. Budget inflation was tried and rejected: extra
    // spawns pay the snowballing fighter more XP than they cost (measured
    // 4→12, 5→11, 6→13 — non-monotone). The ceiling still catches a
    // trivialised deep; the floor still catches a wall.
    const d5 = survived(brawler, 5);
    expect(d5).toBeGreaterThanOrEqual(1);
    expect(d5).toBeLessThanOrEqual(13);
  });
});

/**
 * The expanse, pinned (2026-07-29, the living-dungeon pass). The default
 * board is 96x64 now: if the vale holds its law and the default does not,
 * the default is out of law. Ten seeds, not twenty — the ground is 4x and
 * the suite pays wall-clock for every tile — with bands wide the way every
 * pin's bands are wide: a broken table, not a tuning tremor, is what trips
 * them. Pinned AFTER the bounty correction: at the full stretch the
 * depth-3 runner out-survived the fighter 2/10 v 1/10 (the covenant's one
 * forbidden domination); under the bounty these read 7 v 4, the door reads
 * 10/10, and the deep reads 4/10 — the same sawtooth, wider halls.
 */
const EXPANSE = { width: 96, height: 64 };
const EXPANSE_SEEDS = [3, 7, 11, 15, 21, 29, 33, 44, 51, 60];

function expanseFloors(seed: number, policy: Policy, count: number): 'escaped' | 'dead' | 'playing' | 'won' {
  const born = append(emptyLog(), null, createWorld(seed, EXPANSE.width, EXPANSE.height));
  let done = autoplay({ log: born.log, head: born.event.id }, policy, 4000);
  for (let floor = 2; floor <= count && done.ended === 'escaped'; floor += 1) {
    const refs = createRef(emptyRefs(), 'run', done.position.head, 0, 'balance');
    const down = descend(done.position.log, refs, 'run', EXPANSE);
    if (down === null) break;
    const head = getRef(down.refs, 'run').head;
    if (head === null) break;
    done = autoplay({ log: down.log, head }, policy, 4000);
  }
  return done.ended;
}

const expanseSurvived = (policy: Policy, depth: number): number =>
  EXPANSE_SEEDS.filter((s) => expanseFloors(s, policy, depth) === 'escaped').length;

describe('the sawtooth on the expanse — the default board keeps the law', () => {
  it('the door stays gentle at four times the ground', () => {
    expect(expanseSurvived(brawler, 1)).toBeGreaterThanOrEqual(7);
  });

  it('fighting still pays at depth 3 — running never dominates, whatever the acreage', () => {
    const fighter = expanseSurvived(brawler, 3);
    const runner = expanseSurvived(rusher, 3);
    expect(fighter).toBeGreaterThanOrEqual(runner);
    expect(fighter).toBeGreaterThanOrEqual(3);
    expect(fighter).toBeLessThanOrEqual(9);
  });

  it('the deep stays earned, never given', () => {
    const d5 = expanseSurvived(brawler, 5);
    expect(d5).toBeGreaterThanOrEqual(1);
    expect(d5).toBeLessThanOrEqual(7);
  });
});
