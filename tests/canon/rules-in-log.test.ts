import { emptyLog, append, fold, verifyChain } from '../../src/log/chain.js';
import { apply } from '../../src/core/apply.js';
import { emptyRefs, createRef, fork, getRef } from '../../src/log/refs.js';
import { createWorld, ratifyRule } from '../../src/core/commands.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { Rule } from '../../src/canon/rule.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * Rules live in the log and nowhere else.
 *
 * That is the whole design bet of this increment: a rule is an event, so it is
 * versioned, forkable and replayable for free, and a world's ruleset is
 * whatever its chain says it is. Every property here is really one property —
 * the log is the only source of truth about what rules a world plays under.
 */

function rule(id: string, over: Partial<Record<string, unknown>> = {}): Rule {
  const r = validateRule({
    id,
    when: 'WAIT',
    require: [{ kind: 'noCreatureWithin', n: 6 }],
    then: [{ kind: 'heal', n: 1 }],
    provenance: { events: ['seed-event'], notes: [], because: `because of ${id}` },
    ratifiedAt: '2026-07-25T00:00:00.000Z',
    ...over,
  });
  if (isRejected(r)) throw new Error(`test fixture is not a valid rule: ${r.rejected}`);
  return r;
}

/** A world with nothing in it but its opening event. */
function world(): { log: EventLog; head: string } {
  const { log, event } = append(emptyLog(), null, createWorld(1234, 12, 8, 10));
  return { log, head: event.id };
}

describe('a rule entering play', () => {
  it('arrives as an event and shows up in the folded state', () => {
    const w = world();
    const r = rule('rule-1');
    const { log, event } = append(w.log, w.head, ratifyRule(fold(w.log, w.head), r));

    expect(event.type).toBe('RULE_RATIFIED');
    expect(fold(log, event.id).rules).toHaveLength(1);
    expect(fold(log, event.id).rules[0]?.id).toBe('rule-1');
  });

  it('consumes no randomness, so ratifying cannot shift a later roll', () => {
    const w = world();
    const before = fold(w.log, w.head);
    const { log, event } = append(w.log, w.head, ratifyRule(before, rule('rule-1')));

    expect(event.rngDraws).toBe(0);
    expect(fold(log, event.id).rngCounter).toBe(before.rngCounter);
  });

  it('keeps them in the order they were ratified', () => {
    let w = world();
    let head = w.head;
    for (const id of ['first', 'second', 'third']) {
      const r = append(w.log, head, ratifyRule(fold(w.log, head), rule(id)));
      w = { log: r.log, head: r.event.id };
      head = r.event.id;
    }
    expect(fold(w.log, head).rules.map((x) => x.id)).toEqual(['first', 'second', 'third']);
  });

  it('still verifies as a chain', () => {
    const w = world();
    const { log, event } = append(w.log, w.head, ratifyRule(fold(w.log, w.head), rule('rule-1')));
    expect(verifyChain(log, event.id)).toBeNull();
  });
});

describe('not corrupting what came before', () => {
  it('does not touch the state it was handed', () => {
    // Written the obvious way first, this could not fail: comparing two
    // independent `fold`s proves nothing, because each rebuilds from
    // EMPTY_STATE and never shares an array to corrupt.
    //
    // The aliasing that can really happen is a caller holding a state across an
    // apply — which is exactly what session.ts and the view do. So drive
    // `apply` directly and check the input afterwards.
    const w = world();
    const before = fold(w.log, w.head);
    const { log, event } = append(w.log, w.head, ratifyRule(before, rule('rule-1')));
    const stored = log.events.get(event.id)!;

    const after = apply(before, stored);

    expect(before.rules).toHaveLength(0);
    expect(after.rules).toHaveLength(1);
    expect(after).not.toBe(before);
    expect(after.rules).not.toBe(before.rules);
  });

  it('does not let a second apply reach back into the first result', () => {
    const w = world();
    const s0 = fold(w.log, w.head);
    const a = append(w.log, w.head, ratifyRule(s0, rule('one')));
    const s1 = apply(s0, a.log.events.get(a.event.id)!);
    const b = append(a.log, a.event.id, ratifyRule(s1, rule('two')));
    const s2 = apply(s1, b.log.events.get(b.event.id)!);

    expect(s1.rules.map((r) => r.id)).toEqual(['one']);
    expect(s2.rules.map((r) => r.id)).toEqual(['one', 'two']);
  });

  it('leaves the shared empty baseline empty', () => {
    const w = world();
    append(w.log, w.head, ratifyRule(fold(w.log, w.head), rule('rule-1')));
    expect(EMPTY_STATE.rules).toHaveLength(0);
  });

  it('starts a fresh world with no rules, whatever came before it in the log', () => {
    const w = world();
    const ratified = append(w.log, w.head, ratifyRule(fold(w.log, w.head), rule('rule-1')));
    // A second world init on the same log replaces state wholesale.
    const second = append(ratified.log, ratified.event.id, createWorld(99, 12, 8, 10));
    expect(fold(second.log, second.event.id).rules).toHaveLength(0);
  });
});

describe('rules are a property of a world, not of the game', () => {
  it('gives a fork exactly the rules that existed when it forked', () => {
    // This is the property the entire increment rests on. If it fails, rules
    // are global and the log was pointless.
    // The fork point must be strictly *behind* main's head, or this proves
    // nothing: forking at the head makes "the fork point" and "the source head"
    // the same value, and an implementation that ignored the former entirely
    // would still pass.
    const w = world();
    const early = append(w.log, w.head, ratifyRule(fold(w.log, w.head), rule('shared')));
    const late = append(early.log, early.event.id, ratifyRule(fold(early.log, early.event.id), rule('main-only')));

    let refs = emptyRefs();
    refs = createRef(refs, 'main', late.event.id, 0, 'opening');
    refs = fork(late.log, refs, 'main', 'branch', early.event.id, 'a second timeline');

    const mainRules = fold(late.log, late.event.id).rules.map((r) => r.id);
    const branchRules = fold(late.log, getRef(refs, 'branch').head!).rules.map((r) => r.id);

    expect(mainRules).toEqual(['shared', 'main-only']);
    expect(branchRules).toEqual(['shared']);
  });

  it('lets two timelines hold genuinely different rulesets', () => {
    const w = world();
    let refs = emptyRefs();
    refs = createRef(refs, 'main', w.head, 0, 'opening');
    refs = fork(w.log, refs, 'main', 'other', w.head, 'divergence');

    const a = append(w.log, w.head, ratifyRule(fold(w.log, w.head), rule('gentle')));
    const b = append(a.log, w.head, ratifyRule(fold(a.log, w.head), rule('cruel', {
      then: [{ kind: 'harm', n: 2 }],
    })));

    expect(fold(b.log, a.event.id).rules.map((r) => r.id)).toEqual(['gentle']);
    expect(fold(b.log, b.event.id).rules.map((r) => r.id)).toEqual(['cruel']);
  });
});

describe('the cap', () => {
  it('refuses to ratify past the per-world limit', () => {
    let log = world().log;
    let head = world().head;
    const fresh = world();
    log = fresh.log; head = fresh.head;

    for (let i = 0; i < 16; i += 1) {
      const r = append(log, head, ratifyRule(fold(log, head), rule(`rule-${i}`)));
      log = r.log; head = r.event.id;
    }
    expect(fold(log, head).rules).toHaveLength(16);
    expect(() => ratifyRule(fold(log, head), rule('one-too-many'))).toThrow(/16|limit|cap/i);
  });
});
