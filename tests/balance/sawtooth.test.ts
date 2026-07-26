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

const DIMS = { width: 24, height: 16, walls: 60 };

function world(seed: number): Position {
  const born = append(emptyLog(), null, createWorld(seed, DIMS.width, DIMS.height, DIMS.walls));
  return { log: born.log, head: born.event.id };
}

function floors(seed: number, policy: Policy, count: number): 'escaped' | 'dead' | 'playing' {
  let done = autoplay(world(seed), policy, 600);
  for (let floor = 2; floor <= count && done.ended === 'escaped'; floor += 1) {
    const refs = createRef(emptyRefs(), 'run', done.position.head, 0, 'balance');
    const down = descend(done.position.log, refs, 'run', DIMS);
    if (down === null) break;
    const head = getRef(down.refs, 'run').head;
    if (head === null) break;
    done = autoplay({ log: down.log, head }, policy, 600);
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

  it('pays the fighter: from the depths on, brawling out-survives running', () => {
    // The inversion this increment exists for. Before it, the rusher escaped
    // 70% and the brawler died 90% — ignoring the game was the best strategy.
    expect(survived(brawler, 3)).toBeGreaterThan(survived(rusher, 3));
  });

  it('makes the deep rare but reachable', () => {
    const d5 = survived(brawler, 5);
    expect(d5).toBeGreaterThanOrEqual(1);
    expect(d5).toBeLessThanOrEqual(10);
  });
});
