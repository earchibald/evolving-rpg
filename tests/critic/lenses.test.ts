import { LENSES, lensById, computedLenses, deferredLenses, LENS_SOURCE } from '../../src/critic/lenses.js';

/**
 * The registry is what lets the Critic cite a real lens rather than a vibe.
 *
 * It is also where a copyright decision lives: this holds lens numbers, titles
 * and *our* statement of what this codebase measures. Schell's text stays in
 * Schell's book. The tests below check the shape of that decision, because
 * "someone will remember" is not a control.
 */

describe('what is in the registry', () => {
  it('holds the four lenses the spec named, with their real titles', () => {
    expect(lensById(2)?.title).toBe('The Lens of Surprise');
    expect(lensById(33)?.title).toBe('The Lens of Triangularity');
    expect(lensById(61)?.title).toBe('The Lens of the Interest Curve');
    expect(lensById(71)?.title).toBe('The Lens of Freedom');
  });

  it('says which two are measured and which two are not', () => {
    expect(computedLenses().map((l) => l.id).sort((a, b) => a - b)).toEqual([2, 61]);
    expect(deferredLenses().map((l) => l.id).sort((a, b) => a - b)).toEqual([33, 71]);
  });

  it('gives every deferred lens a reason, so it is not merely missing', () => {
    // A lens absent from the scorecard and a lens that passed look identical.
    // Only one of them is honest.
    for (const lens of deferredLenses()) {
      expect(lens.why.length).toBeGreaterThan(20);
    }
  });

  it('says what each computed lens actually measures here', () => {
    for (const lens of computedLenses()) {
      expect(lens.measures.length).toBeGreaterThan(20);
    }
  });

  it('points at where the lenses came from, for a human to consult', () => {
    expect(LENS_SOURCE).toContain('artOfGameDesign');
  });
});

describe('looking one up', () => {
  it('finds a lens by its number', () => {
    expect(lensById(61)?.id).toBe(61);
  });

  it('returns nothing rather than throwing for a number that is not a lens', () => {
    for (const n of [0, -1, 999, 1.5, NaN, Infinity]) {
      expect(() => lensById(n)).not.toThrow();
      expect(lensById(n)).toBeUndefined();
    }
  });

  it('has no duplicate ids, so a citation means one thing', () => {
    const ids = LENSES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('not carrying the book around', () => {
  // Not a style rule. Copying a hundred lenses and their question lists into
  // the repository would reproduce a substantial part of a copyrighted work;
  // citing numbers and titles is referencing one.
  it('keeps every description short enough to be a summary, not a passage', () => {
    for (const lens of LENSES) {
      expect((lens.measures + (lens.why ?? '')).length).toBeLessThan(400);
    }
  });

  it('carries none of the book\'s own formatting', () => {
    // The source marks its question lists with `●`. Finding one here would mean
    // a passage had been pasted in wholesale.
    const all = JSON.stringify(LENSES);
    expect(all).not.toContain('●');
    expect(all).not.toContain('> **Lens');
  });

  it('is frozen, because a registry something can edit is not a registry', () => {
    expect(Object.isFrozen(LENSES)).toBe(true);
    for (const lens of LENSES) expect(Object.isFrozen(lens)).toBe(true);
  });
});
