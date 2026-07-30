import { validateRule, isRejected, readRule, TRIGGERS } from '../../src/canon/rule.js';
import { fireRules, holds, applyResolved } from '../../src/canon/interpret.js';
import { makeGrid, FLOOR, WALL, EXIT } from '../../src/core/grid.js';
import type { Rule, Condition } from '../../src/canon/rule.js';
import type { GameState } from '../../src/core/state.js';

/**
 * The widened vocabulary.
 *
 * The first cut could not express two things any grid RPG is assumed to have:
 * reacting to being hit, and testing health as a proportion. These cover what
 * arrived to fix that, and the shapes that must stay refused.
 */

function rule(over: Record<string, unknown> = {}): Rule {
  const r = validateRule({
    id: 'r', when: 'WAIT', require: [], then: [{ kind: 'heal', n: 1 }],
    provenance: { events: ['e'], notes: [], because: 'testing' },
    ratifiedAt: '2026-07-25T00:00:00.000Z',
    ...over,
  });
  if (isRejected(r)) throw new Error(r.rejected);
  return r;
}

function refused(over: Record<string, unknown>): string {
  const r = validateRule({
    id: 'r', when: 'WAIT', require: [], then: [{ kind: 'heal', n: 1 }],
    provenance: { events: ['e'], notes: [], because: 'testing' },
    ratifiedAt: '2026-07-25T00:00:00.000Z',
    ...over,
  });
  if (!isRejected(r)) throw new Error('expected a rejection');
  return r.rejected;
}

function being(id: string, x: number, y: number, hp: number, maxHp = hp) {
  return { id, kind: id === 'player' ? 'you' : 'thing', pos: { x, y },
    stats: { hp, might: 3, wits: 1, speed: 2 }, tags: [], maxHp };
}

/** An 8×1 corridor unless told otherwise, so pushing has room to run. */
function world(entities = [being('player', 0, 0, 5, 10)], opts: { exitAt?: number; wallAt?: number; turn?: number; rules?: Rule[]; depth?: number; motif?: GameState['motif']; bodies?: GameState['bodies'] } = {}): GameState {
  const tiles = new Array<number>(8).fill(FLOOR);
  if (opts.exitAt !== undefined) tiles[opts.exitAt] = EXIT;
  if (opts.wallAt !== undefined) tiles[opts.wallAt] = WALL;
  return {
    grid: makeGrid(8, 1, tiles), entities, items: [],
    turn: opts.turn ?? 1, activeEntityId: 'player', seed: 1, rngCounter: 0,
    rules: opts.rules ?? [],
    xp: 0,
    level: 1,
    depth: opts.depth ?? 1,
    gold: 0,
    story: '', bible: null, smoke: null, traps: [], alarm: null, unveiled: [],
    motif: opts.motif ?? null,
    bodies: opts.bodies ?? [],
  };
}

describe('the triggers a player expects', () => {
  it('covers being struck, killing, moving and the turn passing', () => {
    expect([...TRIGGERS].sort()).toEqual(
      ['ITEM_TAKEN', 'KILLED', 'MOVE', 'MOVE_BLOCKED', 'STRIKE', 'STRUCK', 'TURN_PASSED', 'WAIT'],
    );
  });

  it('accepts a rule on each of them', () => {
    for (const when of TRIGGERS) {
      expect(isRejected(validateRule({
        id: 'r', when, require: [], then: [{ kind: 'speak', text: 'so it goes' }],
        provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: 'now',
      }))).toBe(false);
    }
  });
});

describe('health as a proportion', () => {
  it('reads a fraction of the ceiling, not an absolute', () => {
    const half = world([being('player', 0, 0, 5, 10)]);
    expect(holds({ kind: 'hpBelowPercent', n: 60 }, half, 'player')).toBe(true);
    expect(holds({ kind: 'hpBelowPercent', n: 50 }, half, 'player')).toBe(false);
    expect(holds({ kind: 'hpAbovePercent', n: 40 }, half, 'player')).toBe(true);
    expect(holds({ kind: 'hpAbovePercent', n: 50 }, half, 'player')).toBe(false);
  });

  it('does not divide by a ceiling of zero', () => {
    // Written first with hp 0 and a ceiling of 0, this could not fail: the
    // division gives NaN, every NaN comparison is already false, and the
    // guarded answer is false too. The case that actually distinguishes them is
    // health *above* a zero ceiling, where the division gives Infinity and an
    // unguarded "above 50%" would come back true for a thing with no health at
    // all.
    const impossible = world([being('player', 0, 0, 3, 0)]);
    expect(holds({ kind: 'hpAbovePercent', n: 50 }, impossible, 'player')).toBe(false);
    expect(holds({ kind: 'hpBelowPercent', n: 50 }, impossible, 'player')).toBe(false);

    const empty = world([being('player', 0, 0, 0, 0)]);
    expect(holds({ kind: 'hpAbovePercent', n: 50 }, empty, 'player')).toBe(false);
    expect(holds({ kind: 'hpBelowPercent', n: 50 }, empty, 'player')).toBe(false);
  });
});

describe('reading the rest of the world', () => {
  it('counts what is still alive', () => {
    const busy = world([being('player', 0, 0, 5, 10), being('a', 3, 0, 4), being('b', 5, 0, 0)]);
    expect(holds({ kind: 'creaturesAtLeast', n: 1 }, busy, 'player')).toBe(true);
    expect(holds({ kind: 'creaturesAtLeast', n: 2 }, busy, 'player')).toBe(false);
    expect(holds({ kind: 'creaturesAtMost', n: 1 }, busy, 'player')).toBe(true);
  });

  it('measures the way out', () => {
    const w = world([being('player', 0, 0, 5, 10)], { exitAt: 6 });
    expect(holds({ kind: 'exitWithin', n: 6 }, w, 'player')).toBe(true);
    expect(holds({ kind: 'exitWithin', n: 5 }, w, 'player')).toBe(false);
    expect(holds({ kind: 'exitBeyond', n: 5 }, w, 'player')).toBe(true);
  });

  it('says the exit is unreachably far on a map without one', () => {
    const w = world([being('player', 0, 0, 5, 10)]);
    expect(holds({ kind: 'exitWithin', n: 40 }, w, 'player')).toBe(false);
    expect(holds({ kind: 'exitBeyond', n: 40 }, w, 'player')).toBe(true);
  });

  it('reads the turn count and the stats, including wits', () => {
    const late = world([being('player', 0, 0, 5, 10)], { turn: 30 });
    expect(holds({ kind: 'turnAtLeast', n: 30 }, late, 'player')).toBe(true);
    expect(holds({ kind: 'turnAtLeast', n: 31 }, late, 'player')).toBe(false);
    // wits had no job at all before this — now a rule can gate on it.
    expect(holds({ kind: 'statAtLeast', stat: 'wits', n: 1 }, late, 'player')).toBe(true);
    expect(holds({ kind: 'statAtLeast', stat: 'wits', n: 2 }, late, 'player')).toBe(false);
    expect(holds({ kind: 'statAtLeast', stat: 'maxHp', n: 10 }, late, 'player')).toBe(true);
  });

  it('reads whether the blow landed', () => {
    const w = world();
    expect(holds({ kind: 'blowLanded' }, w, 'player', { hit: true })).toBe(true);
    expect(holds({ kind: 'blowLanded' }, w, 'player', { hit: false })).toBe(false);
    expect(holds({ kind: 'blowMissed' }, w, 'player', { hit: false })).toBe(true);
    // No blow at all is neither landed nor missed.
    expect(holds({ kind: 'blowLanded' }, w, 'player', {})).toBe(false);
    expect(holds({ kind: 'blowMissed' }, w, 'player', {})).toBe(false);
  });
});

describe('effects that reach past the actor', () => {
  const pair = () => [being('player', 2, 0, 5, 10), being('beast', 3, 0, 6, 6)];

  it('hurts the other party', () => {
    const w = world(pair(), { rules: [rule({ when: 'STRIKE', then: [{ kind: 'harmOther', n: 4 }] })] });
    const [ev] = fireRules(w, 'STRIKE', 'player', { otherId: 'beast', hit: true });
    expect(ev?.payload.outcomes).toEqual([{ kind: 'health', entityId: 'beast', to: 2 }]);
  });

  it('shoves the other party directly away', () => {
    const w = world(pair(), { rules: [rule({ when: 'STRIKE', then: [{ kind: 'push', n: 2 }] })] });
    const [ev] = fireRules(w, 'STRIKE', 'player', { otherId: 'beast', hit: true });
    expect(ev?.payload.outcomes).toEqual([{ kind: 'move', entityId: 'beast', to: { x: 5, y: 0 } }]);
  });

  it('stops a shove at a wall rather than through it', () => {
    const w = world(pair(), { wallAt: 5, rules: [rule({ when: 'STRIKE', then: [{ kind: 'push', n: 3 }] })] });
    const [ev] = fireRules(w, 'STRIKE', 'player', { otherId: 'beast', hit: true });
    expect(ev?.payload.outcomes).toEqual([{ kind: 'move', entityId: 'beast', to: { x: 4, y: 0 } }]);
  });

  it('fires nothing when a shove has nowhere to go', () => {
    // Against a wall already. A rule that produces no outcome writes no event,
    // rather than an event recording that nothing happened.
    const w = world([being('player', 2, 0, 5, 10), being('beast', 3, 0, 6, 6)],
      { wallAt: 4, rules: [rule({ when: 'STRIKE', then: [{ kind: 'push', n: 2 }] })] });
    expect(fireRules(w, 'STRIKE', 'player', { otherId: 'beast', hit: true })).toHaveLength(0);
  });

  it('raises and lowers a stat, and never drains one to nothing', () => {
    const grant = world([being('player', 0, 0, 5, 10)], { rules: [rule({ then: [{ kind: 'grant', stat: 'might', n: 2 }] })] });
    expect(fireRules(grant, 'WAIT', 'player')[0]?.payload.outcomes)
      .toEqual([{ kind: 'stat', entityId: 'player', stat: 'might', to: 5 }]);

    // might is 3; draining 5 would leave 0 — never hitting anything again.
    const drain = world([being('player', 0, 0, 5, 10)], { rules: [rule({ then: [{ kind: 'drain', stat: 'might', n: 5 }] })] });
    expect(fireRules(drain, 'WAIT', 'player')[0]?.payload.outcomes)
      .toEqual([{ kind: 'stat', entityId: 'player', stat: 'might', to: 1 }]);
  });

  it('raises the ceiling without raising current health', () => {
    const w = world([being('player', 0, 0, 5, 10)], { rules: [rule({ then: [{ kind: 'grant', stat: 'maxHp', n: 3 }] })] });
    const after = applyResolved(w, fireRules(w, 'WAIT', 'player')[0]!.payload.outcomes);
    expect(after.entities[0]?.maxHp).toBe(13);
    expect(after.entities[0]?.stats.hp).toBe(5);
  });

  it('drops an effect that has nobody to act on', () => {
    const w = world([being('player', 0, 0, 5, 10)], { rules: [rule({ when: 'STRIKE', then: [{ kind: 'harmOther', n: 3 }] })] });
    expect(fireRules(w, 'STRIKE', 'player', { hit: true })).toHaveLength(0);
  });
});

describe('rules compose within one pass', () => {
  it('lets a second rule see what the first did', () => {
    // Both fire on the same trigger. If the second read the world as it was
    // before the first ran, the arithmetic would silently be wrong.
    const w = world([being('player', 0, 0, 4, 10)], {
      rules: [
        rule({ id: 'first', then: [{ kind: 'heal', n: 3 }] }),
        rule({ id: 'second', require: [{ kind: 'hpAtLeast', n: 7 }], then: [{ kind: 'heal', n: 2 }] }),
      ],
    });
    const events = fireRules(w, 'WAIT', 'player');
    expect(events.map((e) => e.payload.ruleId)).toEqual(['first', 'second']);
    expect(events[1]?.payload.outcomes).toEqual([{ kind: 'health', entityId: 'player', to: 9 }]);
  });
});

describe('shapes that must stay refused', () => {
  it('refuses a blow condition on a trigger with no blow', () => {
    expect(refused({ when: 'WAIT', require: [{ kind: 'blowLanded' }] })).toMatch(/blow/);
    expect(refused({ when: 'TURN_PASSED', require: [{ kind: 'blowMissed' }] })).toMatch(/blow/);
  });

  it('allows a blow condition where a blow exists', () => {
    expect(() => rule({ when: 'STRIKE', require: [{ kind: 'blowLanded' }] })).not.toThrow();
    expect(() => rule({ when: 'STRUCK', require: [{ kind: 'blowMissed' }] })).not.toThrow();
  });

  it('refuses reaching for "the other" when there is no other', () => {
    // Otherwise this ratifies cleanly, reads sensibly, and does nothing at all
    // forever — which is worse than being rejected.
    expect(refused({ when: 'WAIT', then: [{ kind: 'harmOther', n: 2 }] })).toMatch(/harmOther/);
    expect(refused({ when: 'TURN_PASSED', then: [{ kind: 'push', n: 1 }] })).toMatch(/push/);
    expect(() => rule({ when: 'STRUCK', then: [{ kind: 'harmOther', n: 2 }] })).not.toThrow();
  });

  it('holds each kind to its own range', () => {
    // One global 1–9 was wrong once distances ran to 40 and percentages to 99.
    expect(() => rule({ then: [{ kind: 'heal', n: 20 }] })).not.toThrow();
    expect(refused({ then: [{ kind: 'heal', n: 21 }] })).toMatch(/1–20/);
    expect(() => rule({ require: [{ kind: 'noCreatureWithin', n: 40 }] })).not.toThrow();
    expect(refused({ require: [{ kind: 'noCreatureWithin', n: 41 }] })).toMatch(/1–40/);
    expect(refused({ then: [{ kind: 'grant', stat: 'might', n: 6 }] })).toMatch(/1–5/);
    expect(refused({ then: [{ kind: 'push', n: 4 }] })).toMatch(/1–3/);
    expect(refused({ require: [{ kind: 'hpBelowPercent', n: 100 }] })).toMatch(/1–99/);
    expect(() => rule({ require: [{ kind: 'turnAtLeast', n: 999 }] })).not.toThrow();
  });

  it('refuses an unknown stat', () => {
    expect(refused({ then: [{ kind: 'grant', stat: 'charisma', n: 2 }] })).toMatch(/stat/);
    expect(refused({ require: [{ kind: 'statAtLeast', stat: 'luck', n: 2 }] })).toMatch(/stat/);
  });

  it('still drops extra keys on the new shapes', () => {
    const r = validateRule({
      id: 'r', when: 'STRIKE', require: [{ kind: 'blowLanded', sneaky: 1 }],
      then: [{ kind: 'grant', stat: 'might', n: 2, alsoDelete: 'everything' }],
      provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: 'now',
    });
    if (isRejected(r)) throw new Error(r.rejected);
    expect(Object.keys(r.require[0]!)).toEqual(['kind']);
    expect(Object.keys(r.then[0]!).sort()).toEqual(['kind', 'n', 'stat']);
    expect(JSON.stringify(r)).not.toContain('sneaky');
  });
});

describe('the world-shape words (VOCABULARY.md §3)', () => {
  it('reads the depth of the run', () => {
    const deep = world([being('player', 0, 0, 5, 10)], { depth: 5 });
    expect(holds({ kind: 'depthAtLeast', n: 5 }, deep, 'player')).toBe(true);
    expect(holds({ kind: 'depthAtLeast', n: 6 }, deep, 'player')).toBe(false);
    // The first floor is depth 1, so 1 holds everywhere — harmless, not wrong.
    expect(holds({ kind: 'depthAtLeast', n: 1 }, world(), 'player')).toBe(true);
  });

  it('reads the floor\'s cut, and an unrecorded cut as no cut at all', () => {
    const warren = world([being('player', 0, 0, 5, 10)], { motif: 'warren' });
    expect(holds({ kind: 'motifIs', motif: 'warren' }, warren, 'player')).toBe(true);
    expect(holds({ kind: 'motifIs', motif: 'halls' }, warren, 'player')).toBe(false);
    // Logs from before floors recorded their cut: the condition is false,
    // never a guess — old floors do not retroactively acquire a shape.
    expect(holds({ kind: 'motifIs', motif: 'door' }, world(), 'player')).toBe(false);
  });

  it('knows where you fell', () => {
    const haunted = world([being('player', 2, 0, 5, 10)], { bodies: [{ x: 2, y: 0 }, { x: 5, y: 0 }] });
    expect(holds({ kind: 'bodyHere' }, haunted, 'player')).toBe(true);
    const beside = world([being('player', 1, 0, 5, 10)], { bodies: [{ x: 2, y: 0 }] });
    expect(holds({ kind: 'bodyHere' }, beside, 'player')).toBe(false);
    expect(holds({ kind: 'bodyHere' }, world(), 'player')).toBe(false);
  });

  it('holds the new words to their shapes', () => {
    expect(() => rule({ require: [{ kind: 'depthAtLeast', n: 99 }] })).not.toThrow();
    expect(refused({ require: [{ kind: 'depthAtLeast', n: 0 }] })).toMatch(/1–99/);
    expect(refused({ require: [{ kind: 'depthAtLeast', n: 100 }] })).toMatch(/1–99/);
    expect(() => rule({ require: [{ kind: 'motifIs', motif: 'door' }] })).not.toThrow();
    expect(() => rule({ require: [{ kind: 'motifIs', motif: 'halls' }] })).not.toThrow();
    expect(refused({ require: [{ kind: 'motifIs', motif: 'cave' }] })).toMatch(/motif/);
    expect(refused({ require: [{ kind: 'motifIs' }] })).toMatch(/motif/);
    expect(() => rule({ require: [{ kind: 'bodyHere' }] })).not.toThrow();
  });

  it('works under any trigger, unlike the blow words', () => {
    for (const when of TRIGGERS) {
      expect(isRejected(validateRule({
        id: 'r', when,
        require: [{ kind: 'bodyHere' }, { kind: 'depthAtLeast', n: 2 }, { kind: 'motifIs', motif: 'warren' }],
        then: [{ kind: 'speak', text: 'so it goes' }],
        provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: 'now',
      }))).toBe(false);
    }
  });

  it('refuses a floor asked to be two shapes at once', () => {
    // Two different cuts can never both hold: the rule validates, reads
    // plausibly, and does nothing forever — the exact lie the validator
    // exists to prevent (VOCABULARY.md: the unresolvable case has its exit).
    expect(refused({ require: [{ kind: 'motifIs', motif: 'door' }, { kind: 'motifIs', motif: 'warren' }] }))
      .toMatch(/cannot .*both|never fire/);
    // The same cut twice is redundant, not contradictory.
    expect(() => rule({ require: [{ kind: 'motifIs', motif: 'door' }, { kind: 'motifIs', motif: 'door' }] })).not.toThrow();
  });

  it('drops extra keys on the new shapes', () => {
    const r = validateRule({
      id: 'r', when: 'MOVE',
      require: [{ kind: 'bodyHere', sneaky: 1 }, { kind: 'motifIs', motif: 'door', also: 2 }, { kind: 'depthAtLeast', n: 3, ride: 3 }],
      then: [{ kind: 'heal', n: 1 }],
      provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: 'now',
    });
    if (isRejected(r)) throw new Error(r.rejected);
    expect(Object.keys(r.require[0]!)).toEqual(['kind']);
    expect(Object.keys(r.require[1]!).sort()).toEqual(['kind', 'motif']);
    expect(Object.keys(r.require[2]!).sort()).toEqual(['kind', 'n']);
    expect(JSON.stringify(r)).not.toContain('sneaky');
  });

  it('fires through the interpreter, composed', () => {
    // The three words together, gating a heal on MOVE: the full path from
    // validated rule to RULE_FIRED, not just the predicate in isolation.
    const r = rule({ when: 'MOVE', require: [
      { kind: 'bodyHere' }, { kind: 'depthAtLeast', n: 3 }, { kind: 'motifIs', motif: 'warren' },
    ] });
    const fires = world([being('player', 2, 0, 5, 10)],
      { depth: 3, motif: 'warren', bodies: [{ x: 2, y: 0 }], rules: [r] });
    expect(fireRules(fires, 'MOVE', 'player')).toHaveLength(1);
    const wrongFloor = world([being('player', 2, 0, 5, 10)],
      { depth: 3, motif: 'halls', bodies: [{ x: 2, y: 0 }], rules: [r] });
    expect(fireRules(wrongFloor, 'MOVE', 'player')).toHaveLength(0);
  });
});

describe('every shape reads as English', () => {
  it('renders each trigger, condition and effect without falling over', () => {
    const conditions: Condition[] = [
      { kind: 'hpAtMost', n: 3 }, { kind: 'hpAtLeast', n: 3 },
      { kind: 'hpBelowPercent', n: 50 }, { kind: 'hpAbovePercent', n: 50 },
      { kind: 'creatureWithin', n: 1 }, { kind: 'noCreatureWithin', n: 6 },
      { kind: 'creaturesAtMost', n: 1 }, { kind: 'creaturesAtLeast', n: 2 },
      { kind: 'exitWithin', n: 4 }, { kind: 'exitBeyond', n: 20 },
      { kind: 'turnAtLeast', n: 30 }, { kind: 'statAtLeast', stat: 'wits', n: 2 },
      { kind: 'depthAtLeast', n: 3 }, { kind: 'motifIs', motif: 'warren' },
      { kind: 'bodyHere' },
    ];
    for (const c of conditions) {
      const said = readRule(rule({ require: [c] }));
      expect(said).toMatch(/^When .+ — .+\.$/);
      expect(said).not.toContain('undefined');
      expect(said).not.toContain('[object');
    }
    for (const when of TRIGGERS) {
      expect(readRule(rule({ when, then: [{ kind: 'speak', text: 'so it goes' }] }))).toMatch(/^When /);
    }
  });

  it('says the useful thing for the effects that reach past you', () => {
    expect(readRule(rule({ when: 'STRUCK', then: [{ kind: 'harmOther', n: 2 }] })))
      .toBe('When something strikes you — it loses 2 hit points.');
    expect(readRule(rule({ when: 'STRIKE', then: [{ kind: 'push', n: 1 }] })))
      .toBe('When you strike something — it is shoved back 1 square.');
    expect(readRule(rule({ when: 'KILLED', then: [{ kind: 'grant', stat: 'might', n: 1 }] })))
      .toBe('When something dies by your hand — your might rises by 1.');
    expect(readRule(rule({ when: 'TURN_PASSED', require: [{ kind: 'hpBelowPercent', n: 50 }], then: [{ kind: 'heal', n: 1 }] })))
      .toBe('When a turn goes by, with your health below 50% — you recover 1 hit point.');
  });
});
