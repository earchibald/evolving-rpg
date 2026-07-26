import { summariseRun, proposeRule } from '../../src/canon/rulesmith.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import { Oracle } from '../../src/oracle/oracle.js';
import { brokenTransport } from '../../src/oracle/transports.js';
import { makeGrid, FLOOR } from '../../src/core/grid.js';
import type { Rule } from '../../src/canon/rule.js';
import type { Note } from '../../src/channels/channels.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Transport } from '../../src/oracle/types.js';

/**
 * The Rulesmith drafts; nothing it says is trusted.
 *
 * Everything here is really one property with several faces: a model's output
 * is untrusted input, and the only thing standing between it and an
 * append-only log is validation that happens before the proposal is even
 * *shown* — not merely before it is stored.
 */

const AT = '2026-07-25T12:00:00.000Z';

/** Answers with whatever rule object it is handed. */
function returning(rule: unknown): Transport {
  return {
    name: 'canned',
    ask() {
      return Promise.resolve({ name: 'a rule', line: 'because', model: 'm', costUsd: 0, data: rule });
    },
  };
}

/** Records what the model was actually shown. */
function spying(rule: unknown): Transport & { seen: () => Record<string, unknown> } {
  let seen: Record<string, unknown> = {};
  return {
    name: 'spy',
    seen: () => seen,
    ask(question) {
      seen = question.context;
      return Promise.resolve({ name: 'a rule', line: 'because', model: 'm', costUsd: 0, data: rule });
    },
  };
}

const WELL_FORMED = {
  when: 'WAIT',
  require: [{ kind: 'noCreatureWithin', n: 6 }],
  then: [{ kind: 'heal', n: 1 }],
  provenance: { events: ['ev-1'], notes: [], because: 'you held still eleven times and nothing happened' },
};

function note(over: Partial<Note> = {}): Note {
  return {
    channel: 'designer', said: 'something', reply: null, trouble: null,
    world: 'main', head: 'h', turn: 1, at: '2026-07-25T10:00:00.000Z', author: 'player', ...over,
  };
}

function events(): GameEvent[] {
  const base = { parent: null, seq: 0, schemaVersion: 1, rngCounter: 0, rngDraws: 0 };
  return [
    { ...base, id: 'ev-1', type: 'WAIT', payload: { entityId: 'player' } },
    { ...base, id: 'ev-2', type: 'WAIT', payload: { entityId: 'player' } },
    { ...base, id: 'ev-3', type: 'MOVE_BLOCKED', payload: { entityId: 'player', reason: 'a wall' } },
    { ...base, id: 'ev-4', type: 'STRIKE', payload: { attackerId: 'player', targetId: 'thing-1', hit: true, damage: 3, roll: 15, needed: 10 } },
    { ...base, id: 'ev-5', type: 'STRIKE', payload: { attackerId: 'thing-1', targetId: 'player', hit: true, damage: 2, roll: 14, needed: 10 } },
  ] as GameEvent[];
}

function state(rules: Rule[] = []): GameState {
  return {
    grid: makeGrid(4, 1, new Array<number>(4).fill(FLOOR)),
    entities: [
      { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 8, might: 3, wits: 1, speed: 4 }, tags: [], maxHp: 10 },
      { id: 'thing-1', kind: 'thing', pos: { x: 2, y: 0 }, stats: { hp: 2, might: 4, wits: 1, speed: 3 }, tags: [], maxHp: 5 },
    ],
    items: [], turn: 12, activeEntityId: 'player', seed: 1, rngCounter: 0, rules,
  };
}

describe('what the Rulesmith is shown', () => {
  it('reads the run as sentences rather than a log dump', () => {
    const s = summariseRun(events(), state(), [], 'main');
    expect(s.happened.join(' ')).toMatch(/held still 2 times/);
    expect(s.happened.join(' ')).toMatch(/walked into something solid 1 times/);
    expect(s.happened.join(' ')).toMatch(/swung 1 times, landing 1, dealing 3/);
    expect(s.happened.join(' ')).toMatch(/swung at 1 times, hit 1 times, taking 2/);
    expect(s.happened.join(' ')).toMatch(/No rule fired/);
  });

  it('never shows it an agent\'s notes', async () => {
    // runs/notes.jsonl already holds notes an agent wrote while testing. Read
    // back as the designer's intent, they would steer the whole game.
    const notes = [
      note({ said: 'the wait key does nothing', author: 'player' }),
      note({ said: 'i kneel and put my hand on the floor', author: 'agent', channel: 'gamemaster' }),
    ];
    const s = summariseRun(events(), state(), notes, 'main');

    expect(s.said.join(' ')).toContain('the wait key does nothing');
    expect(s.said.join(' ')).not.toContain('kneel');
    expect(s.citableNotes).toEqual([notes[0]!.at]);

    // And the same must be true of what actually crosses to the model.
    const transport = spying(WELL_FORMED);
    await proposeRule(new Oracle({ transport }), s, [], AT);
    expect(JSON.stringify(transport.seen())).not.toContain('kneel');
  });

  it('shows what was asked in the fiction, and how the world answered', () => {
    const notes = [note({ channel: 'gamemaster', said: 'i listen', reply: 'three pale shapes, far off' })];
    const s = summariseRun(events(), state(), notes, 'main');
    expect(s.said[0]).toContain('i listen');
    expect(s.said[0]).toContain('three pale shapes');
  });

  it('says when the world did not answer at all', () => {
    const notes = [note({ channel: 'gamemaster', said: 'is anyone there?', reply: null })];
    expect(summariseRun(events(), state(), notes, 'main').said[0]).toMatch(/did not answer/);
  });

  it('shows the rules already in force, in English', () => {
    const r = validateRule({
      id: 'r1', when: 'WAIT', require: [], then: [{ kind: 'heal', n: 1 }],
      provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: AT,
    });
    if (isRejected(r)) throw new Error(r.rejected);
    const s = summariseRun(events(), state([r]), [], 'main');
    expect(s.inForce[0]).toBe('When you hold still — you recover 1 hit point.');
  });

  it('keeps another world\'s notes out of this world\'s summary', () => {
    const notes = [note({ said: 'here', world: 'main' }), note({ said: 'elsewhere', world: 'world-2' })];
    expect(summariseRun(events(), state(), notes, 'main').said.join(' ')).not.toContain('elsewhere');
  });
});

describe('nothing it returns is trusted', () => {
  const run = () => summariseRun(events(), state(), [note()], 'main');

  it('accepts a well-formed proposal', async () => {
    const got = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), [], AT);
    expect(isRejected(got)).toBe(false);
    if (isRejected(got)) return;
    expect(got.when).toBe('WAIT');
    expect(got.ratifiedAt).toBe(AT);
  });

  it('refuses one outside the vocabulary', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, then: [{ kind: 'summonDragon', n: 1 }] }),
    }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
  });

  it('refuses one outside the bounds', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, then: [{ kind: 'heal', n: 9999 }] }),
    }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toMatch(/1–20/);
  });

  it('refuses a reply that is not an object at all', async () => {
    for (const junk of [null, 'a rule', 42, undefined]) {
      const got = await proposeRule(new Oracle({ transport: returning(junk) }), run(), [], AT);
      expect(isRejected(got)).toBe(true);
    }
  });

  it('names the rule itself, ignoring whatever the model called it', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, id: 'the-good-one' }),
    }), run(), [], AT);
    if (isRejected(got)) throw new Error(got.rejected);
    expect(got.id).toBe('rule-1');
  });

  it('numbers a rule after the ones already in force', async () => {
    const first = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), [], AT);
    if (isRejected(first)) throw new Error(first.rejected);
    const second = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, then: [{ kind: 'harm', n: 1 }] }),
    }), run(), [first], AT);
    if (isRejected(second)) throw new Error(second.rejected);
    expect(second.id).toBe('rule-2');
  });
});

describe('citing only what actually happened', () => {
  const run = () => summariseRun(events(), state(), [note()], 'main');

  it('strips an invented event id', async () => {
    // A fabricated hash would otherwise go into an append-only log as the
    // stated reason for a rule, and stay there for good.
    const got = await proposeRule(new Oracle({
      transport: returning({
        ...WELL_FORMED,
        provenance: { events: ['ev-1', 'deadbeef-i-made-this-up'], notes: [], because: 'y' },
      }),
    }), run(), [], AT);
    if (isRejected(got)) throw new Error(got.rejected);
    expect(got.provenance.events).toEqual(['ev-1']);
  });

  it('rejects a proposal whose every citation was invented', async () => {
    // Stripping leaves nothing, and a rule citing nothing is refused — so a
    // model that fabricates wholesale cannot get a rule through.
    const got = await proposeRule(new Oracle({
      transport: returning({
        ...WELL_FORMED,
        provenance: { events: ['nope', 'also-nope'], notes: ['never'], because: 'y' },
      }),
    }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toMatch(/cite/);
  });

  it('rejects a proposal with no stated reason', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, provenance: { events: ['ev-1'], notes: [], because: '' } }),
    }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toMatch(/because/);
  });

  it('keeps a citation to a real note', async () => {
    const n = note({ said: 'the wait key does nothing' });
    const summary = summariseRun(events(), state(), [n], 'main');
    const got = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, provenance: { events: [], notes: [n.at], because: 'you said so' } }),
    }), summary, [], AT);
    if (isRejected(got)) throw new Error(got.rejected);
    expect(got.provenance.notes).toEqual([n.at]);
  });
});

describe('not wasting the player\'s attention', () => {
  const run = () => summariseRun(events(), state(), [note()], 'main');

  it('refuses a rule the world already plays under', async () => {
    const existing = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), [], AT);
    if (isRejected(existing)) throw new Error(existing.rejected);

    // Same trigger, same effects, different conditions and reason.
    const again = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, require: [{ kind: 'hpAtMost', n: 4 }] }),
    }), run(), [existing], AT);
    expect(isRejected(again)).toBe(true);
    if (isRejected(again)) expect(again.rejected).toMatch(/already plays/);
  });

  it('allows a rule that differs in what it does', async () => {
    const existing = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), [], AT);
    if (isRejected(existing)) throw new Error(existing.rejected);
    const other = await proposeRule(new Oracle({
      transport: returning({ ...WELL_FORMED, then: [{ kind: 'harm', n: 2 }] }),
    }), run(), [existing], AT);
    expect(isRejected(other)).toBe(false);
  });

  it('stops proposing once the world is full', async () => {
    const full = Array.from({ length: 16 }, (_x, i) => {
      const r = validateRule({
        id: `r${i}`, when: 'WAIT', require: [], then: [{ kind: 'heal', n: 1 }],
        provenance: { events: ['e'], notes: [], because: 'y' }, ratifiedAt: AT,
      });
      if (isRejected(r)) throw new Error(r.rejected);
      return r;
    });
    const got = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), full, AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toMatch(/limit/);
  });
});

describe('never blocking, never canon', () => {
  const run = () => summariseRun(events(), state(), [note()], 'main');

  it('comes back readable when nothing is listening', async () => {
    const got = await proposeRule(new Oracle({ transport: null }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toMatch(/nothing to propose/);
  });

  it('comes back readable when the transport fails', async () => {
    const got = await proposeRule(new Oracle({ transport: brokenTransport('the cli is gone') }), run(), [], AT);
    expect(isRejected(got)).toBe(true);
    if (isRejected(got)) expect(got.rejected).toContain('the cli is gone');
  });

  it('never becomes canon, however many times it is asked', async () => {
    // A proposal is a conversation. Caching it would mean the world can only
    // ever have one idea about a given run.
    const oracle = new Oracle({ transport: returning(WELL_FORMED) });
    await proposeRule(oracle, run(), [], AT);
    await proposeRule(oracle, run(), [], AT);
    expect(Object.keys(oracle.known())).toHaveLength(0);
  });

  it('shows up in the queue a player can see', async () => {
    const oracle = new Oracle({ transport: returning(WELL_FORMED) });
    await proposeRule(oracle, run(), [], AT);
    const call = oracle.queue().find((c) => c.intent === 'propose');
    expect(call).toBeDefined();
    expect(call?.state).toBe('answered');
  });
});

describe('reading the Critic', () => {
  const run = () => summariseRun(events(), state(), [note()], 'main');

  it('carries the lens verdicts into the summary', () => {
    const s = run();
    expect(s.measured.length).toBeGreaterThan(0);
    expect(s.measured.join(' ')).toMatch(/#2|#61|surprise|tension|Lens/i);
  });

  it('sends the verdicts across the transport, not just into the summary', async () => {
    const transport = spying(WELL_FORMED);
    await proposeRule(new Oracle({ transport }), run(), [], AT);
    expect(JSON.stringify(transport.seen())).toMatch(/measured/);
  });

  it('keeps a citation to a lens that was actually read', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({
        ...WELL_FORMED,
        provenance: { events: ['ev-1'], notes: [], lenses: [2, 61], because: 'the dice never surprise you' },
      }),
    }), run(), [], AT);
    if (isRejected(got)) throw new Error(got.rejected);
    expect(got.provenance.lenses).toEqual([2, 61]);
  });

  it('strips an invented lens number, exactly as it strips an invented event id', async () => {
    const got = await proposeRule(new Oracle({
      transport: returning({
        ...WELL_FORMED,
        provenance: { events: ['ev-1'], notes: [], lenses: [2, 999, -1], because: 'y' },
      }),
    }), run(), [], AT);
    if (isRejected(got)) throw new Error(got.rejected);
    expect(got.provenance.lenses).toEqual([2]);
  });

  it('still accepts a rule that cites no lens at all', async () => {
    const got = await proposeRule(new Oracle({ transport: returning(WELL_FORMED) }), run(), [], AT);
    expect(isRejected(got)).toBe(false);
  });
});
