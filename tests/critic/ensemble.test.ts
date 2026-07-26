import { triangularityOf, freedomOf, VIABLE_RATE, DISTINCT_GAP } from '../../src/critic/ensemble.js';
import type { ApproachOutcomes } from '../../src/critic/ensemble.js';

/**
 * The ensemble lenses answer with measured distributions, never counted
 * options — that distinction is the spec's own guard against a Freedom score
 * gamed by adding meaningless doors, and every test here leans on it.
 */

const a = (approach: string, escaped: number, dead: number, stalled = 0): ApproachOutcomes =>
  ({ approach, escaped, dead, stalled });

describe('#33 triangularity — approaches worth taking', () => {
  it('counts only what actually wins', () => {
    const got = triangularityOf([
      a('brawler', 12, 8),   // 60% — viable
      a('rusher', 8, 12),    // 40% — viable
      a('coward', 0, 2, 18), // never wins — not an approach, a refusal
    ]);
    expect(got.figure).toBe('2');
    expect(got.verdict).toContain('brawler');
    expect(got.verdict).not.toMatch(/coward.*worth taking/);
  });

  it('calls one viable path a corridor', () => {
    const got = triangularityOf([a('rusher', 14, 6), a('brawler', 2, 18)]);
    expect(got.figure).toBe('1');
    expect(got.verdict.toLowerCase()).toContain('corridor');
  });

  it('says plainly when nothing wins', () => {
    const got = triangularityOf([a('rusher', 1, 19), a('brawler', 0, 20)]);
    expect(got.figure).toBe('0');
    expect(got.verdict.toLowerCase()).toMatch(/cannot.*beaten|no approach/);
  });

  it('publishes its thresholds and its denominator', () => {
    expect(VIABLE_RATE).toBeGreaterThan(0);
    const got = triangularityOf([a('x', 10, 10)]);
    expect(got.confidence).toMatch(/20 runs/);
  });
});

describe('#71 freedom — where the choices actually lead', () => {
  it('collapses approaches that end the same way', () => {
    // Three names, one destiny: everything escapes ~everything. Doors, not
    // freedom.
    const got = freedomOf([a('rusher', 18, 2), a('brawler', 17, 3), a('shuffler', 19, 1)]);
    expect(got.figure).toBe('1');
    expect(got.verdict.toLowerCase()).toContain('decoration');
  });

  it('separates genuinely different fates', () => {
    const got = freedomOf([
      a('brawler', 12, 8),     // mostly wins
      a('rusher', 4, 16),      // mostly dies
      a('coward', 0, 1, 19),   // mostly declines
    ]);
    expect(got.figure).toBe('3');
    expect(got.verdict).toContain('meaningfully different');
  });

  it('is not fooled by adding another door to the same room', () => {
    const before = freedomOf([a('brawler', 12, 8), a('coward', 0, 0, 20)]);
    const after = freedomOf([
      a('brawler', 12, 8), a('coward', 0, 0, 20),
      a('brawler-with-a-hat', 12, 8), // same distribution, new name
    ]);
    expect(after.figure).toBe(before.figure);
  });

  it('publishes the gap that makes two outcomes different', () => {
    expect(DISTINCT_GAP).toBeGreaterThan(0);
    expect(DISTINCT_GAP).toBeLessThan(1);
  });
});
