import { assayRule, MAX_RULE_GAIN } from '../../src/assay/ruleAssay.js';
import { assayName, assayLine } from '../../src/assay/register.js';
import { COVENANT } from '../../src/assay/covenant.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import * as ruleAssayModule from '../../src/assay/ruleAssay.js';
import * as registerModule from '../../src/assay/register.js';
import type { Rule } from '../../src/canon/rule.js';

/**
 * The assay exists because the validator cannot see play. Every case here is a
 * rule that validates perfectly — the question is only ever whether it is
 * *sound*, and the answer comes from an exploiter actually playing it.
 */

function rule(over: Record<string, unknown>): Rule {
  const r = validateRule({
    id: 'candidate', when: 'WAIT', require: [], then: [{ kind: 'heal', n: 1 }],
    provenance: { events: ['e'], notes: [], because: 'testing' },
    ratifiedAt: '2026-07-26T00:00:00.000Z',
    ...over,
  });
  if (isRejected(r)) throw new Error(r.rejected);
  return r;
}

describe('trial of greed — unbounded growth by repetition (M2)', () => {
  it('refuses the founding case: a stat granted for holding still', () => {
    // The proposal the user was actually offered. Validates cleanly; fires
    // every wait; no ceiling anywhere. The exploiter just sits there and
    // becomes a god.
    const got = assayRule(rule({ then: [{ kind: 'grant', stat: 'wits', n: 1 }] }));
    expect(got.verdict).toBe('refused');
    expect(got.findings.join(' ')).toMatch(/M2/);
    expect(got.findings.join(' ')).toMatch(/wits/);
  });

  it('refuses it for every free trigger, not only WAIT', () => {
    for (const when of ['MOVE', 'MOVE_BLOCKED', 'TURN_PASSED']) {
      const got = assayRule(rule({ when, then: [{ kind: 'grant', stat: 'might', n: 2 }] }));
      expect(got.verdict).toBe('refused');
    }
  });

  it('allows a small grant on a kill, which the creatures themselves bound', () => {
    // Three creatures in the trial world, +1 each: the trigger dries up long
    // before the ceiling. Boundedness the game provides shows up on its own.
    const got = assayRule(rule({ when: 'KILLED', then: [{ kind: 'grant', stat: 'might', n: 1 }] }));
    expect(got.verdict).toBe('sound');
  });

  it('refuses a large grant even on a bounded trigger', () => {
    // Three kills at +3 is +9 might in a run — past the ceiling even though
    // the trigger is finite. The measure is achievable gain, not trigger type.
    const got = assayRule(rule({ when: 'KILLED', then: [{ kind: 'grant', stat: 'might', n: 3 }] }));
    expect(got.verdict).toBe('refused');
  });

  it('allows healing on wait, because the health ceiling bounds it', () => {
    const got = assayRule(rule({
      require: [{ kind: 'noCreatureWithin', n: 4 }],
      then: [{ kind: 'heal', n: 1 }],
    }));
    expect(got.verdict).toBe('sound');
  });

  it('refuses raising the ceiling itself for free', () => {
    // maxHp has no ceiling above it. Waiting into immortality, slowly.
    const got = assayRule(rule({ then: [{ kind: 'grant', stat: 'maxHp', n: 1 }] }));
    expect(got.verdict).toBe('refused');
  });

  it('publishes the ceiling it judges by', () => {
    expect(MAX_RULE_GAIN).toBe(6);
  });
});

describe('trial of the coward — death must remain possible (M1)', () => {
  it('refuses a heal no bruiser can burst through', () => {
    // The level-1 bruiser's heaviest crit is 8 against a 10-hp player, so
    // heal 8 on every wait means no sequence of blows can ever finish the
    // sitter. Provably unkillable — the exact degenerate M1 refuses.
    const got = assayRule(rule({ then: [{ kind: 'heal', n: 8 }] }));
    expect(got.verdict).toBe('refused');
    expect(got.findings.join(' ')).toMatch(/M1/);
  });

  it('allows a heal the brute out-damages', () => {
    const got = assayRule(rule({ then: [{ kind: 'heal', n: 1 }] }));
    // Fires every wait, but the brute still wins: death held.
    expect(got.findings.join(' ')).not.toMatch(/M1/);
  });

  it('allows the rule the player actually ratified', () => {
    // heal 1 on wait, nothing within 4, under 99% health — the conditions keep
    // it from firing in melee at all. This one earned its place; the assay
    // must not take it back.
    const got = assayRule(rule({
      require: [{ kind: 'noCreatureWithin', n: 4 }, { kind: 'hpBelowPercent', n: 99 }],
      then: [{ kind: 'heal', n: 1 }],
    }));
    expect(got.verdict).toBe('sound');
  });

  it('does not blame a rule for a world where nobody dies anyway', () => {
    // The M1 refusal requires the baseline to die. A speak-only rule changes
    // nothing; if the baseline survived, the refusal must not fire.
    const got = assayRule(rule({ then: [{ kind: 'speak', text: 'the stone holds its breath' }] }));
    expect(got.findings.join(' ')).not.toMatch(/M1/);
  });
});

describe('trial of proportion — the swing, measured and said (M6)', () => {
  it('cautions on a bounded rule that is still far too strong', () => {
    // Heals 3 on every kill: greed cannot refuse it (current hp is not a
    // watched stat and the kills run out), the coward never kills so M1
    // holds — and a fighter carries a relic's worth of extra blood out of
    // every fight. The founding case was a ratifier only feeling "far too
    // strong" after playing it; the trial says it beforehand.
    const got = assayRule(rule({ when: 'KILLED', then: [{ kind: 'heal', n: 3 }] }));
    expect(got.verdict).toBe('sound');
    expect(got.findings.join(' ')).toMatch(/M6/);
    expect(got.findings.join(' ')).toMatch(/swings hit points/);
  });

  it('stays silent about a rule with no mechanical weight at all', () => {
    const got = assayRule(rule({ when: 'KILLED', then: [{ kind: 'speak', text: 'the floor drinks what falls' }] }));
    expect(got.findings.join(' ')).not.toMatch(/M6/);
  });
});

describe('trial of function — cautions, not refusals (M3)', () => {
  it('cautions on a rule no trial can reach, and still calls it sound', () => {
    // turnAtLeast 900: legitimate late-game design the 120-action trials will
    // never see. A simulation cannot prove a universal negative, so this is a
    // caution for the Forge to show, not a verdict.
    const got = assayRule(rule({
      require: [{ kind: 'turnAtLeast', n: 900 }],
      then: [{ kind: 'heal', n: 1 }],
    }));
    expect(got.verdict).toBe('sound');
    expect(got.neverFired).toBe(true);
    expect(got.findings.join(' ')).toMatch(/M3|caution/);
  });

  it('does not caution a rule the trials saw fire', () => {
    const got = assayRule(rule({ then: [{ kind: 'heal', n: 1 }] }));
    expect(got.neverFired).toBe(false);
  });
});

describe('the thematic register rides along (T2)', () => {
  it('refuses a rule that shouts', () => {
    const got = assayRule(rule({ then: [{ kind: 'speak', text: 'YOU FEEL GREAT!' }] }));
    expect(got.verdict).toBe('refused');
  });

  it('accepts a line in the world\'s voice', () => {
    expect(assayLine('You stop. The room stays empty.').sound).toBe(true);
  });
});

describe('names against the covenant (T1, T3)', () => {
  it('refuses the founding failure', () => {
    const got = assayName('small iron want');
    expect(got.sound).toBe(false);
    expect(got.findings.join(' ')).toMatch(/mood/);
  });

  it('accepts the names the world has actually kept', () => {
    for (const name of ['salt-knuckle crawler', 'chalk-hound', 'keen edge', 'grey drift moth']) {
      expect(assayName(name).sound).toBe(true);
    }
  });

  it('refuses articles, shouting, and length', () => {
    expect(assayName('the pale king').sound).toBe(false);
    expect(assayName('BONE HOUND').sound).toBe(false);
    expect(assayName('cold iron blade of the deep').sound).toBe(false);
  });

  it('refuses a name already spent on another kind', () => {
    expect(assayName('chalk-hound', ['chalk-hound']).sound).toBe(false);
    expect(assayName('chalk-hound', ['keen edge']).sound).toBe(true);
  });
});

describe('the covenant is enforced, not aspirational', () => {
  it('names an enforcer for every invariant, and the named modules exist', () => {
    const surface = { ...ruleAssayModule, ...registerModule };
    for (const inv of COVENANT) {
      expect(inv.enforcedBy.length).toBeGreaterThan(5);
      const named = inv.enforcedBy.match(/assay\w+/u);
      if (named !== null) {
        expect(surface[named[0] as keyof typeof surface]).toBeDefined();
      }
    }
  });
});

describe('the function trial plays well before it cautions (M3)', () => {
  it('does not call a play-well rule dead weight', () => {
    // The dead-air rule's shape: fires only after the floor is cleared, far
    // from the exit, late, healthy. Exploiters never get there; a fighter
    // does. This exact shape drew the false caution that motivated the fix.
    const got = assayRule(rule({
      when: 'TURN_PASSED',
      require: [
        { kind: 'creaturesAtMost', n: 0 },
        { kind: 'exitBeyond', n: 4 },
        { kind: 'turnAtLeast', n: 10 },
      ],
      then: [{ kind: 'harm', n: 1 }],
    }));
    expect(got.neverFired).toBe(false);
    expect(got.findings.join(' ')).not.toMatch(/caution/);
  });

  it('still cautions on what genuinely cannot be reached', () => {
    const got = assayRule(rule({
      require: [{ kind: 'turnAtLeast', n: 900 }],
      then: [{ kind: 'heal', n: 1 }],
    }));
    expect(got.neverFired).toBe(true);
  });
});

describe('the trials meet the rule where it lives (VOCABULARY.md §2)', () => {
  it('lets a depth-gated rule fire instead of reading it as dead weight', () => {
    // Before the environment, this drew a false M3 caution: the trial worlds
    // were all depth 1, so `depthAtLeast 5` never held and a legitimate rule
    // read as dead. The trial is born at the depth the rule names.
    const got = assayRule(rule({ require: [{ kind: 'depthAtLeast', n: 5 }] }));
    expect(got.neverFired).toBe(false);
    expect(got.findings.join(' ')).not.toMatch(/M3/);
  });

  it('lets a cut-gated rule fire', () => {
    const got = assayRule(rule({ require: [{ kind: 'motifIs', motif: 'halls' }] }));
    expect(got.neverFired).toBe(false);
  });

  it('lets a body-gated rule fire, and still refuses the engine it gates', () => {
    // The gate opens (bodies lie on the trial floor) and then M2 does its
    // ordinary work: standing on your own grave minting wits is an engine,
    // however poetic the gate.
    const got = assayRule(rule({
      require: [{ kind: 'bodyHere' }],
      then: [{ kind: 'grant', stat: 'wits', n: 1 }],
    }));
    expect(got.neverFired).toBe(false);
    expect(got.verdict).toBe('refused');
    expect(got.findings.join(' ')).toMatch(/M2/);
  });

  it('allows a modest body-gated heal, the BONES option F shape', () => {
    // "When you stand where you fell, recover" — the kind of rule a death
    // proposal can now offer. Bounded by the health ceiling like any heal.
    const got = assayRule(rule({
      when: 'MOVE',
      require: [{ kind: 'bodyHere' }],
      then: [{ kind: 'heal', n: 2 }],
    }));
    expect(got.verdict).toBe('sound');
    expect(got.neverFired).toBe(false);
    // If proportion weighs it, the caution says the floor was strewn — the
    // ratifier must know the swing is the heaviest case, not the typical one.
    const m6 = got.findings.find((f) => f.includes('M6'));
    if (m6 !== undefined) expect(m6).toMatch(/strewn with bodies/);
  });

  it('still cautions honestly when the gate is one no trial can open', () => {
    // The environment unlocks world-shape, never time: turnAtLeast 999 stays
    // out of reach and the caution stays true.
    const got = assayRule(rule({ require: [{ kind: 'turnAtLeast', n: 999 }] }));
    expect(got.neverFired).toBe(true);
    expect(got.findings.join(' ')).toMatch(/M3/);
  });
});
