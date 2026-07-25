import { u32, float01, intBetween } from '../../src/core/rng.js';

describe('u32', () => {
  it('is deterministic for the same seed and counter', () => {
    expect(u32(42, 7)).toBe(u32(42, 7));
  });

  it('gives different values for adjacent counters', () => {
    expect(u32(42, 7)).not.toBe(u32(42, 8));
  });

  it('gives different values for different seeds at the same counter', () => {
    expect(u32(1, 0)).not.toBe(u32(2, 0));
  });

  it('stays inside unsigned 32-bit range', () => {
    for (let c = 0; c < 500; c++) {
      const v = u32(99, c);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('float01', () => {
  it('stays in [0, 1)', () => {
    for (let c = 0; c < 500; c++) {
      const v = float01(7, c);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('intBetween', () => {
  it('respects inclusive bounds', () => {
    for (let c = 0; c < 500; c++) {
      const v = intBetween(3, c, 5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('reaches every value in a small range', () => {
    const seen = new Set<number>();
    for (let c = 0; c < 2000; c++) seen.add(intBetween(11, c, 0, 9));
    expect(seen.size).toBe(10);
  });

  it('returns the only possible value when min equals max', () => {
    expect(intBetween(5, 0, 4, 4)).toBe(4);
  });

  it('throws when max is below min', () => {
    expect(() => intBetween(5, 0, 9, 2)).toThrow(/max/);
  });
});
