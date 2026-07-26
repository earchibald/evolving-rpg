import { assayName } from '../../src/assay/register.js';
import {
  neededToHit, chanceIn20, damageDice, meanDamage,
  XP_TO_REACH, levelForXp, growthAt,
  BESTIARY, creatureStats, threatOf, spawnBudget, depthBands, wardenAt,
  NEEDED_FLOOR, NEEDED_CEILING, CRIT, WHIFF,
  ARMORY, relicGrant, critFloor,
} from '../../src/core/tables.js';

/**
 * The tables are the balance. Most properties here are monotonicities — the
 * shape claims a designer relies on — because the exact numbers will be tuned
 * and the shapes must survive the tuning.
 */

describe('bounded accuracy', () => {
  it('keeps the needed roll inside the band, whatever the gap', () => {
    for (let might = -5; might <= 30; might += 1) {
      for (let speed = -5; speed <= 30; speed += 1) {
        const n = neededToHit(might, speed);
        expect(n).toBeGreaterThanOrEqual(NEEDED_FLOOR);
        expect(n).toBeLessThanOrEqual(NEEDED_CEILING);
      }
    }
  });

  it('anchors the starting fight at a 60% hit', () => {
    // Player might 3 vs skirmisher speed 2: the "fighting feels good" anchor.
    expect(neededToHit(3, 2)).toBe(9);
    expect(chanceIn20(9)).toBe(12);
  });

  it('never promises certainty in either direction', () => {
    // Nat-1 misses and nat-20 hits, so chance lives in [1..19] twentieths.
    expect(chanceIn20(NEEDED_FLOOR)).toBeLessThanOrEqual(19);
    expect(chanceIn20(NEEDED_CEILING)).toBeGreaterThanOrEqual(1);
    expect(CRIT).toBe(20);
    expect(WHIFF).toBe(1);
  });

  it('moves five points per point of stat gap', () => {
    expect(chanceIn20(neededToHit(4, 2)) - chanceIn20(neededToHit(3, 2))).toBe(1);
  });
});

describe('damage', () => {
  it('rises with might and never dips', () => {
    for (let m = 1; m < 15; m += 1) {
      expect(meanDamage(m + 1)).toBeGreaterThanOrEqual(meanDamage(m));
    }
  });

  it('always deals at least one', () => {
    for (let m = 0; m <= 15; m += 1) {
      const { flat } = damageDice(m);
      expect(1 + flat).toBeGreaterThanOrEqual(1);
    }
  });

  it('tames the low-end swing that made a third of blows deal 1', () => {
    // might 3 used to be uniform 1..3; now 1d3+1 — floor of 2.
    expect(damageDice(3)).toEqual({ die: 3, flat: 1 });
  });
});

describe('experience', () => {
  it('thresholds strictly rise', () => {
    for (let l = 2; l < XP_TO_REACH.length; l += 1) {
      expect(XP_TO_REACH[l]!).toBeGreaterThan(XP_TO_REACH[l - 1]!);
    }
  });

  it('maps xp to the highest level reached, totally', () => {
    // Derived from the table rather than hardcoded, so tuning the thresholds
    // does not break the mapping's contract.
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(XP_TO_REACH[2]! - 1)).toBe(1);
    expect(levelForXp(XP_TO_REACH[2]!)).toBe(2);
    expect(levelForXp(XP_TO_REACH[4]! - 1)).toBe(3);
    expect(levelForXp(XP_TO_REACH[4]!)).toBe(4);
    expect(levelForXp(99999)).toBe(XP_TO_REACH.length - 1);
    expect(levelForXp(-5)).toBe(1);
  });

  it('grows hp every level and alternates the sharp stats', () => {
    for (let l = 2; l <= 9; l += 1) expect(growthAt(l).hp).toBeGreaterThan(0);
    expect(growthAt(2).might + growthAt(2).speed).toBe(1);
    expect(growthAt(3).might + growthAt(3).speed).toBe(1);
    expect(growthAt(2).might).not.toBe(growthAt(3).might);
    expect(growthAt(3).wits + growthAt(6).wits + growthAt(9).wits).toBe(3);
  });
});

describe('the bestiary', () => {
  it('holds three spawnable archetypes and one boss that never rolls', () => {
    expect(BESTIARY.filter((a) => a.weight > 0)).toHaveLength(3);
    expect(BESTIARY.find((a) => a.kind === 'warden')?.weight).toBe(0);
  });

  it('scales every archetype upward with its level', () => {
    for (const a of BESTIARY) {
      const l1 = creatureStats(a.kind, 1)!;
      const l3 = creatureStats(a.kind, 3)!;
      expect(threatOf(l3)).toBeGreaterThan(threatOf(l1));
      expect(l3.hp).toBeGreaterThan(l1.hp);
    }
  });

  it('returns nothing for a kind that is not in the book', () => {
    expect(creatureStats('dragon', 1)).toBeUndefined();
  });

  it('prices the warden above everything of its level', () => {
    const warden = threatOf(creatureStats('warden', 1)!);
    for (const a of BESTIARY) {
      if (a.kind === 'warden') continue;
      expect(warden).toBeGreaterThan(threatOf(creatureStats(a.kind, 1)!));
    }
  });
});

describe('threat and budget — the sawtooth\'s teeth', () => {
  it('threat rises with any stat', () => {
    const base = { hp: 5, might: 3, wits: 1, speed: 2 };
    expect(threatOf({ ...base, might: 6 })).toBeGreaterThan(threatOf(base));
    expect(threatOf({ ...base, hp: 12 })).toBeGreaterThan(threatOf(base));
  });

  it('budget strictly deepens', () => {
    for (let d = 1; d < 8; d += 1) {
      expect(spawnBudget(d + 1)).toBeGreaterThan(spawnBudget(d));
    }
  });

  it('affords roughly three modest creatures at depth 1', () => {
    const skirmisher = threatOf(creatureStats('skirmisher', 1)!);
    const afford = Math.floor(spawnBudget(1) / skirmisher);
    expect(afford).toBeGreaterThanOrEqual(2);
    expect(afford).toBeLessThanOrEqual(4);
  });

  it('overlaps bands the Brogue way: mostly here, sometimes shallower, rarely deeper', () => {
    const bands = depthBands(3);
    expect(bands.map((b) => b.level).sort((a, b) => a - b)).toEqual([2, 3, 4]);
    const at = (l: number): number => bands.find((b) => b.level === l)?.weight ?? 0;
    expect(at(3)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(4));
    // Depth 1 has no shallower band and never rolls level 0.
    expect(depthBands(1).every((b) => b.level >= 1)).toBe(true);
  });

  it('guards every third floor', () => {
    expect([1, 2, 4, 5].map(wardenAt)).toEqual([false, false, false, false]);
    expect([3, 6, 9].map(wardenAt)).toEqual([true, true, true]);
  });
});

describe('the armory', () => {
  it('keeps every kind inside the covenant\'s name rules', () => {
    // The world's own data obeys the register before any model does. 'a keen
    // edge' — article and all — sat in createWorld for three increments.
    for (const r of ARMORY) {
      expect(assayName(r.kind).sound).toBe(true);
    }
  });

  it('always grants something, at any depth', () => {
    for (const r of ARMORY) {
      for (const d of [1, 2, 5, 9]) {
        const g = relicGrant(r, d);
        expect(g.hp + g.might + g.wits + g.speed).toBeGreaterThan(0);
      }
    }
  });

  it('scales with depth and never shrinks', () => {
    for (const r of ARMORY) {
      for (let d = 1; d < 8; d += 1) {
        const now = relicGrant(r, d);
        const deeper = relicGrant(r, d + 1);
        const sum = (g: { hp: number; might: number; wits: number; speed: number }): number => g.hp + g.might + g.wits + g.speed;
        expect(sum(deeper)).toBeGreaterThanOrEqual(sum(now));
      }
    }
  });

  it('grants exactly the stat it names', () => {
    for (const r of ARMORY) {
      const g = relicGrant(r, 4) as unknown as Record<string, number>;
      for (const stat of ['hp', 'might', 'wits', 'speed']) {
        if (stat === r.grants) expect(g[stat]).toBeGreaterThan(0);
        else expect(g[stat]).toBe(0);
      }
    }
  });

  it('lets might compound slowest, because the damage bands compound it again', () => {
    const edge = ARMORY.find((r) => r.grants === 'might')!;
    const charm = ARMORY.find((r) => r.grants === 'hp')!;
    expect(edge.per).toBeGreaterThan(charm.per);
  });
});

describe('wits and the crit band', () => {
  it('gives the starting player only the natural 20', () => {
    expect(critFloor(3)).toBe(20);
  });

  it('widens one step per four wits, and no further than the floor', () => {
    expect(critFloor(4)).toBe(19);
    expect(critFloor(8)).toBe(18);
    expect(critFloor(40)).toBe(18);
  });

  it('is total over nonsense', () => {
    expect(critFloor(-3)).toBe(20);
    expect(critFloor(0)).toBe(20);
  });
});
