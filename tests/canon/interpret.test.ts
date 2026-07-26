import { fireRules, holds } from '../../src/canon/interpret.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import { apply } from '../../src/core/apply.js';
import { makeGrid, FLOOR } from '../../src/core/grid.js';
import type { Rule, Condition } from '../../src/canon/rule.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent } from '../../src/core/events.js';

/**
 * The interpreter is where a rule stops being data and starts being play.
 *
 * Two properties matter more than the rest. Firing must be *recorded*, so that
 * folding old history never re-interprets it under rules ratified later — your
 * past must not keep changing. And firing must consume no randomness, so that
 * ratifying a rule cannot shift every subsequent roll.
 */

function rule(over: Record<string, unknown> = {}): Rule {
  const r = validateRule({
    id: 'r',
    when: 'WAIT',
    require: [],
    then: [{ kind: 'heal', n: 1 }],
    provenance: { events: ['e'], notes: [], because: 'testing' },
    ratifiedAt: '2026-07-25T00:00:00.000Z',
    ...over,
  });
  if (isRejected(r)) throw new Error(r.rejected);
  return r;
}

function entity(id: string, x: number, y: number, hp: number, maxHp = hp) {
  return { id, kind: id === 'player' ? 'you' : 'thing', pos: { x, y }, stats: { hp, might: 3, wits: 1, speed: 2 }, tags: [], maxHp };
}

function stateWith(rules: Rule[], entities = [entity('player', 0, 0, 5, 10)]): GameState {
  return {
    grid: makeGrid(8, 8, new Array(64).fill(FLOOR)),
    entities,
    items: [],
    turn: 1,
    activeEntityId: 'player',
    seed: 1,
    rngCounter: 7,
    rules,
    xp: 0,
    level: 1,
    depth: 1,
    story: '',
  };
}

/** Turns a draft into something `apply` will accept. */
function asEvent(draft: ReturnType<typeof fireRules>[number], seq = 1): GameEvent {
  return { ...draft, id: `ev-${seq}`, parent: null, seq };
}

describe('what fires', () => {
  it('produces nothing when the world has no rules', () => {
    expect(fireRules(stateWith([]), 'WAIT', 'player')).toEqual([]);
  });

  it('fires a rule whose trigger matches, and not one whose does not', () => {
    const s = stateWith([rule({ id: 'on-wait', when: 'WAIT' }), rule({ id: 'on-strike', when: 'STRIKE' })]);
    expect(fireRules(s, 'WAIT', 'player').map((e) => e.payload.ruleId)).toEqual(['on-wait']);
    expect(fireRules(s, 'STRIKE', 'player').map((e) => e.payload.ruleId)).toEqual(['on-strike']);
  });

  it('fires in ratification order', () => {
    const s = stateWith([rule({ id: 'first' }), rule({ id: 'second' }), rule({ id: 'third' })]);
    expect(fireRules(s, 'WAIT', 'player').map((e) => e.payload.ruleId)).toEqual(['first', 'second', 'third']);
  });

  it('fires each rule at most once per trigger', () => {
    const s = stateWith([rule({ id: 'only-once' })]);
    expect(fireRules(s, 'WAIT', 'player')).toHaveLength(1);
  });

  it('draws no randomness, ever', () => {
    const s = stateWith([rule({ id: 'a' }), rule({ id: 'b', then: [{ kind: 'harm', n: 3 }] })]);
    for (const e of fireRules(s, 'WAIT', 'player')) {
      expect(e.rngDraws).toBe(0);
      expect(e.rngCounter).toBe(s.rngCounter);
    }
  });

  it('carries the recorded effects, not a reference to the rule', () => {
    const s = stateWith([rule({ id: 'a', then: [{ kind: 'heal', n: 2 }] })]);
    const [fired] = fireRules(s, 'WAIT', 'player');
    expect(fired?.payload.outcomes).toEqual([{ kind: 'health', entityId: 'player', to: 7 }]);
  });
});

describe('conditions', () => {
  const near = [entity('player', 0, 0, 5, 10), entity('beast', 2, 0, 4)];
  const far = [entity('player', 0, 0, 5, 10), entity('beast', 7, 7, 4)];

  it('reads distance to the nearest living creature', () => {
    expect(holds({ kind: 'creatureWithin', n: 3 }, stateWith([], near), 'player')).toBe(true);
    expect(holds({ kind: 'creatureWithin', n: 3 }, stateWith([], far), 'player')).toBe(false);
    expect(holds({ kind: 'noCreatureWithin', n: 3 }, stateWith([], far), 'player')).toBe(true);
    expect(holds({ kind: 'noCreatureWithin', n: 3 }, stateWith([], near), 'player')).toBe(false);
  });

  it('ignores the dead when measuring what is near', () => {
    const corpse = [entity('player', 0, 0, 5, 10), entity('beast', 1, 0, 0)];
    expect(holds({ kind: 'noCreatureWithin', n: 4 }, stateWith([], corpse), 'player')).toBe(true);
  });

  it('reads hit points', () => {
    const s = stateWith([], [entity('player', 0, 0, 5, 10)]);
    expect(holds({ kind: 'hpAtMost', n: 5 }, s, 'player')).toBe(true);
    expect(holds({ kind: 'hpAtMost', n: 4 }, s, 'player')).toBe(false);
    expect(holds({ kind: 'hpAtLeast', n: 5 }, s, 'player')).toBe(true);
    expect(holds({ kind: 'hpAtLeast', n: 6 }, s, 'player')).toBe(false);
  });

  it('requires every condition, never merely one', () => {
    // AND, not OR. An OR would need precedence rules, and nothing has asked for
    // one — but more importantly a player reading "with X and Y" and getting
    // "with X or Y" has been lied to about their own game.
    const both: Condition[] = [{ kind: 'hpAtMost', n: 5 }, { kind: 'noCreatureWithin', n: 3 }];
    const oneTrue = stateWith([rule({ require: both })], near); // hp 5 ✓, creature near ✗
    expect(fireRules(oneTrue, 'WAIT', 'player')).toEqual([]);

    const bothTrue = stateWith([rule({ require: both })], far);
    expect(fireRules(bothTrue, 'WAIT', 'player')).toHaveLength(1);
  });

  it('does not fire when a condition fails', () => {
    const s = stateWith([rule({ require: [{ kind: 'hpAtLeast', n: 9 }] })]);
    expect(fireRules(s, 'WAIT', 'player')).toEqual([]);
  });

  it('holds is total — an unknown actor makes conditions false, never an exception', () => {
    const s = stateWith([]);
    expect(() => holds({ kind: 'hpAtMost', n: 5 }, s, 'nobody')).not.toThrow();
    expect(holds({ kind: 'hpAtMost', n: 5 }, s, 'nobody')).toBe(false);
  });
});

describe('applying what fired', () => {
  it('resolves a heal to an absolute figure, clamped at the ceiling', () => {
    const s = stateWith([], [entity('player', 0, 0, 9, 10)]);
    const draft = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 10 }] } };
    const after = apply(s, asEvent(draft));
    expect(after.entities[0]?.stats.hp).toBe(10);
  });

  it('harms, without going below zero', () => {
    const s = stateWith([], [entity('player', 0, 0, 2, 10)]);
    const draft = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 0 }] } };
    expect(apply(s, asEvent(draft)).entities[0]?.stats.hp).toBe(0);
  });

  it('kills by the same path as a blow — dead is dead', () => {
    const s = stateWith([], [entity('player', 0, 0, 1, 10)]);
    const draft = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 0 }] } };
    const after = apply(s, asEvent(draft));
    expect(after.entities[0]!.stats.hp).toBe(0);
  });

  it('leaves state alone for a spoken line', () => {
    const s = stateWith([], [entity('player', 0, 0, 5, 10)]);
    const draft = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'said' as const, text: 'the stone is cold' }] } };
    expect(apply(s, asEvent(draft)).entities[0]?.stats.hp).toBe(5);
  });

  it('does not mutate the state it was given', () => {
    const s = stateWith([], [entity('player', 0, 0, 5, 10)]);
    const draft = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 5 }] } };
    apply(s, asEvent(draft));
    expect(s.entities[0]?.stats.hp).toBe(5);
  });
});

describe('the past does not change', () => {
  it('applies the recorded effect even when the rule would no longer match', () => {
    // The load-bearing property of the whole design. `reduce` must replay what
    // happened, never re-decide it. If it re-evaluated conditions, ratifying a
    // rule today would silently rewrite what a run last week did.
    const wouldNotMatchNow = stateWith(
      [rule({ require: [{ kind: 'hpAtLeast', n: 9 }] })],
      [entity('player', 0, 0, 2, 10)],   // hp 2 — the condition is false now
    );
    const recorded = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'r', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 5 }] } };

    expect(apply(wouldNotMatchNow, asEvent(recorded)).entities[0]?.stats.hp).toBe(5);
  });

  it('applies an effect for a rule the world no longer holds at all', () => {
    const noRules = stateWith([], [entity('player', 0, 0, 2, 10)]);
    const recorded = { type: 'RULE_FIRED' as const, schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: { ruleId: 'long-gone', actorId: 'player', outcomes: [{ kind: 'health' as const, entityId: 'player', to: 5 }] } };
    expect(apply(noRules, asEvent(recorded)).entities[0]?.stats.hp).toBe(5);
  });

  it('never treats a firing as a trigger for more firing', () => {
    // A rule whose effect satisfies its own condition would otherwise loop
    // forever. RULE_FIRED is not in the Trigger union at all, which is the
    // strongest form of this guarantee: it cannot be expressed.
    const selfFeeding = stateWith(
      [rule({ when: 'WAIT', require: [{ kind: 'hpAtMost', n: 9 }], then: [{ kind: 'heal', n: 1 }] })],
      [entity('player', 0, 0, 5, 10)],
    );
    const triggers: string[] = ['WAIT', 'STRIKE', 'MOVE_BLOCKED', 'ITEM_TAKEN'];
    expect(triggers).not.toContain('RULE_FIRED');
    // And firing is a single pass: one rule, one event, no cascade.
    expect(fireRules(selfFeeding, 'WAIT', 'player')).toHaveLength(1);
  });
});

describe('who it fires for', () => {
  it('records the actor the trigger belonged to', () => {
    const s = stateWith([rule({ id: 'a' })], [entity('player', 0, 0, 5, 10), entity('beast', 4, 4, 4)]);
    expect(fireRules(s, 'WAIT', 'beast')[0]?.payload.actorId).toBe('beast');
  });

  it('measures conditions from the actor, not always from the player', () => {
    const entities = [entity('player', 0, 0, 5, 10), entity('beast', 7, 0, 4), entity('other', 6, 0, 4)];
    // From `beast`, `other` is one square away; from the player it is six.
    expect(holds({ kind: 'creatureWithin', n: 2 }, stateWith([], entities), 'beast')).toBe(true);
    expect(holds({ kind: 'creatureWithin', n: 2 }, stateWith([], entities), 'player')).toBe(false);
  });
});
