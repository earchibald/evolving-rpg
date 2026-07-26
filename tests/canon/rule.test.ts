import { validateRule, isRejected, MAX_RULES } from '../../src/canon/rule.js';

/**
 * The validator is the guard on letting a model author rules at all.
 *
 * Everything downstream — the log, the interpreter, the Forge — trusts that a
 * `Rule` which got past here is inside the vocabulary and inside its bounds. So
 * the thing under test is not really "does it accept a good rule". It is "is
 * there any input at all that gets through, or gets it to throw".
 */

const GOOD = {
  id: 'rule-1',
  when: 'WAIT',
  require: [{ kind: 'noCreatureWithin', n: 6 }],
  then: [{ kind: 'heal', n: 1 }],
  provenance: {
    events: ['0a1b2c'],
    notes: ['2026-07-25T23:09:26.121Z'],
    because: 'waiting did nothing at all, and you said so',
  },
  ratifiedAt: '2026-07-25T00:00:00.000Z',
};

/** A copy with one field replaced, so each case starts from something valid and
 *  differs in exactly the way under test. */
function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...structuredClone(GOOD), [key]: value };
}

describe('accepting a rule', () => {
  it('takes a well-formed one', () => {
    const r = validateRule(GOOD);
    expect(isRejected(r)).toBe(false);
    if (isRejected(r)) return;
    expect(r.when).toBe('WAIT');
    expect(r.then).toEqual([{ kind: 'heal', n: 1 }]);
    expect(r.provenance.because).toContain('waiting');
  });

  it('accepts every trigger in the vocabulary', () => {
    for (const when of ['WAIT', 'STRIKE', 'MOVE_BLOCKED', 'ITEM_TAKEN']) {
      expect(isRejected(validateRule(withField('when', when)))).toBe(false);
    }
  });

  it('accepts every condition and effect in the vocabulary', () => {
    for (const kind of ['noCreatureWithin', 'creatureWithin', 'hpAtMost', 'hpAtLeast']) {
      expect(isRejected(validateRule(withField('require', [{ kind, n: 3 }])))).toBe(false);
    }
    for (const kind of ['heal', 'harm']) {
      expect(isRejected(validateRule(withField('then', [{ kind, n: 2 }])))).toBe(false);
    }
    expect(isRejected(validateRule(withField('then', [{ kind: 'speak', text: 'the stone is cold' }])))).toBe(false);
  });

  it('allows no conditions at all — a rule that always fires is legal', () => {
    expect(isRejected(validateRule(withField('require', [])))).toBe(false);
  });
});

describe('being total', () => {
  // The property is "returns a value", not "returns a rejection". A validator
  // that throws on one input in a thousand is a validator the Forge can crash
  // on, and the input here is written by a model.
  const JUNK: unknown[] = [
    null, undefined, 0, 1, -1, NaN, Infinity, '', 'rule', true, false,
    [], [1, 2, 3], {}, { when: 'WAIT' }, Symbol('x'), 9007199254740993n,
    () => 'hi', new Date(), new Map(), new Set(), /regex/,
    { ...GOOD, require: null }, { ...GOOD, then: 'heal' }, { ...GOOD, provenance: 7 },
    JSON.parse('{"__proto__": {"polluted": true}}'),
  ];

  it.each(JUNK.map((v, i) => [i, v]))('returns rather than throws on junk #%i', (_i, value) => {
    expect(() => validateRule(value)).not.toThrow();
    expect(isRejected(validateRule(value))).toBe(true);
  });

  it('survives something deeply nested without blowing the stack', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 5000; i += 1) { deep['next'] = {}; deep = deep['next'] as Record<string, unknown>; }
    expect(() => validateRule(root)).not.toThrow();
  });

  it('survives a cycle', () => {
    const cyclic: Record<string, unknown> = { ...structuredClone(GOOD) };
    cyclic['self'] = cyclic;
    expect(() => validateRule(cyclic)).not.toThrow();
  });

  it('does not let a prototype-polluting payload through', () => {
    validateRule(JSON.parse('{"__proto__":{"pwned":true}}'));
    expect(({} as Record<string, unknown>)['pwned']).toBeUndefined();
  });
});

describe('the bounds, which are what make a generated rule safe', () => {
  it('refuses a number outside 1–9, naming the field', () => {
    for (const n of [0, -1, 10, 9999, 1.5, NaN, Infinity]) {
      const r = validateRule(withField('then', [{ kind: 'heal', n }]));
      expect(isRejected(r)).toBe(true);
      if (isRejected(r)) expect(r.rejected).toMatch(/n\b/);
    }
  });

  it('refuses more than three conditions', () => {
    const four = Array.from({ length: 4 }, () => ({ kind: 'hpAtMost', n: 5 }));
    const r = validateRule(withField('require', four));
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) expect(r.rejected).toMatch(/require/);
  });

  it('refuses more than two effects', () => {
    const three = Array.from({ length: 3 }, () => ({ kind: 'heal', n: 1 }));
    const r = validateRule(withField('then', three));
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) expect(r.rejected).toMatch(/then/);
  });

  it('refuses spoken text over 120 characters', () => {
    const r = validateRule(withField('then', [{ kind: 'speak', text: 'x'.repeat(121) }]));
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) expect(r.rejected).toMatch(/text/);
  });

  it('refuses a trigger, condition or effect outside the vocabulary', () => {
    expect(isRejected(validateRule(withField('when', 'EXPLODE')))).toBe(true);
    expect(isRejected(validateRule(withField('require', [{ kind: 'isTuesday', n: 1 }])))).toBe(true);
    expect(isRejected(validateRule(withField('then', [{ kind: 'summon', n: 1 }])))).toBe(true);
  });

  it('refuses a rule with no stated reason', () => {
    for (const because of ['', '   ', undefined, null, 42]) {
      const r = validateRule(withField('provenance', { events: ['a'], notes: [], because }));
      expect(isRejected(r)).toBe(true);
      if (isRejected(r)) expect(r.rejected).toMatch(/because/);
    }
  });

  it('refuses a rule with no provenance at all', () => {
    // The Ladder exists to stop rules appearing without reasons. A rule that
    // cites nothing is the exact thing it is guarding against.
    const r = validateRule(withField('provenance', { events: [], notes: [], because: 'felt right' }));
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) expect(r.rejected).toMatch(/provenance|events|notes/);
  });

  it('keeps a rejection short even when the offending value is enormous', () => {
    // The message goes on screen. Untrusted input must not be able to flood it.
    const r = validateRule(withField('then', [{ kind: 'speak', text: 'y'.repeat(50_000) }]));
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) {
      expect(r.rejected.length).toBeLessThanOrEqual(200);
      expect(r.rejected).not.toContain('y'.repeat(200));
    }
  });

  it('publishes the per-world rule cap', () => {
    expect(MAX_RULES).toBe(16);
  });
});

describe('not handing back the caller\'s object', () => {
  // This project has found shared-mutable-state bugs three separate times. The
  // stored rule must not be reachable from whatever the model's response was
  // parsed into.
  it('does not mutate what it was given', () => {
    const input = structuredClone(GOOD);
    const before = JSON.stringify(input);
    validateRule(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns something that shares no structure with the input', () => {
    const input = structuredClone(GOOD);
    const r = validateRule(input);
    if (isRejected(r)) throw new Error('should have accepted');

    expect(r).not.toBe(input);
    expect(r.require).not.toBe(input.require);
    expect(r.then).not.toBe(input.then);
    expect(r.provenance).not.toBe(input.provenance);
    expect(r.provenance.events).not.toBe(input.provenance.events);
    expect(r.require[0]).not.toBe(input.require[0]);

    // And mutating the input afterwards must not reach into the stored rule.
    input.require[0]!.n = 999;
    input.provenance.events.push('smuggled');
    expect(r.require[0]).toEqual({ kind: 'noCreatureWithin', n: 6 });
    expect(r.provenance.events).toEqual(['0a1b2c']);
  });

  it('is frozen all the way down', () => {
    const r = validateRule(GOOD);
    if (isRejected(r)) throw new Error('should have accepted');
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.require)).toBe(true);
    expect(Object.isFrozen(r.then)).toBe(true);
    expect(Object.isFrozen(r.provenance)).toBe(true);
    expect(Object.isFrozen(r.require[0])).toBe(true);
  });
});

describe('what gets stored is exactly the vocabulary', () => {
  it('drops extra keys rather than keeping or refusing them', () => {
    // Refusing would make the validator brittle against a chatty model. Keeping
    // would let one smuggle arbitrary data into the append-only log, where it
    // is permanent.
    const chatty = {
      ...structuredClone(GOOD),
      confidence: 0.92,
      script: '<img onerror=alert(1)>',
      then: [{ kind: 'heal', n: 1, andAlso: 'delete everything' }],
    };
    const r = validateRule(chatty);
    if (isRejected(r)) throw new Error('should have accepted');

    expect(Object.keys(r).sort()).toEqual(
      ['id', 'provenance', 'ratifiedAt', 'require', 'then', 'when'],
    );
    expect(Object.keys(r.then[0]!).sort()).toEqual(['kind', 'n']);
    expect(Object.keys(r.provenance).sort()).toEqual(['because', 'events', 'notes']);
    expect(JSON.stringify(r)).not.toContain('onerror');
  });
});
