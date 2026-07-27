import { strikeLine, crossings } from '../../src/ui/words.js';
import { assayLine } from '../../src/assay/register.js';

const blow = (over: Partial<Parameters<typeof strikeLine>[0]> = {}): Parameters<typeof strikeLine>[0] => ({
  mine: false,
  attackerKind: 'bruiser',
  them: 'rust ox',
  damage: 3,
  roll: '(14 vs 10)',
  tier: 'hit',
  seq: 7,
  ...over,
});

describe('the combat voice', () => {
  it('keeps the dice on every line — legible numbers are words too', () => {
    for (const tier of ['miss', 'hit', 'crit', 'kill'] as const) {
      expect(strikeLine(blow({ tier, seq: 3 }))).toContain('(14 vs 10)');
      expect(strikeLine(blow({ tier, seq: 3, mine: true }))).toContain('(14 vs 10)');
    }
  });

  it('is deterministic in the event, not the clock', () => {
    expect(strikeLine(blow({ seq: 41 }))).toBe(strikeLine(blow({ seq: 41 })));
  });

  it('never says the same frequent line three times running', () => {
    const said: string[] = [];
    for (let seq = 0; seq < 30; seq += 1) said.push(strikeLine(blow({ seq, mine: true })));
    for (let i = 2; i < said.length; i += 1) {
      expect(said[i] === said[i - 1] && said[i - 1] === said[i - 2]).toBe(false);
    }
    // And the pool is actually a pool: variety showed up.
    expect(new Set(said).size).toBeGreaterThan(2);
  });

  it('swings by the verb: a bruiser slams where a stinger bites', () => {
    const slams: string[] = [];
    const bites: string[] = [];
    for (let seq = 0; seq < 12; seq += 1) {
      slams.push(strikeLine(blow({ seq, attackerKind: 'bruiser' })));
      bites.push(strikeLine(blow({ seq, attackerKind: 'stinger' })));
    }
    expect(slams.some((s) => s.includes('slams') || s.includes('batters'))).toBe(true);
    expect(bites.some((s) => s.includes('bites') || s.includes('stings'))).toBe(true);
    expect(slams.some((s) => s.includes('bites'))).toBe(false);
  });

  it('tells a kill apart from a wound', () => {
    const line = strikeLine(blow({ tier: 'kill', mine: true, seq: 5 }));
    expect(line).not.toContain('you hit');
    expect(['drops', 'finish', 'folds'].some((w) => line.includes(w))).toBe(true);
  });

  it('speaks the register — no shouting, ever', () => {
    for (let seq = 0; seq < 40; seq += 1) {
      for (const tier of ['miss', 'hit', 'crit', 'kill'] as const) {
        expect(assayLine(strikeLine(blow({ seq, tier }))).sound).toBe(true);
        expect(assayLine(strikeLine(blow({ seq, tier, mine: true }))).sound).toBe(true);
      }
    }
  });
});

describe('the thresholds', () => {
  it('says first blood exactly when the first blood is drawn', () => {
    expect(crossings(10, 8, 10)).toContain('first blood — yours');
    expect(crossings(8, 6, 10)).not.toContain('first blood — yours');
  });

  it('marks the half and the brink as they are crossed, not while below', () => {
    expect(crossings(6, 5, 10).some((s) => s.includes('below half'))).toBe(true);
    expect(crossings(5, 4, 10).some((s) => s.includes('below half'))).toBe(false);
    expect(crossings(3, 2, 10).some((s) => s.includes('nearly spent'))).toBe(true);
    expect(crossings(2, 1, 10).some((s) => s.includes('nearly spent'))).toBe(false);
  });

  it('lets one blow cross several lines at once', () => {
    const said = crossings(10, 1, 10);
    expect(said).toHaveLength(3);
  });

  it('stays silent for the fallen — the fall is its own story', () => {
    expect(crossings(5, 0, 10)).toEqual([]);
  });
});
