import { Oracle, describeQuestion, fallbackFor } from '../../src/oracle/oracle.js';
import { stubTransport, brokenTransport } from '../../src/oracle/transports.js';
import type { Question, Transport } from '../../src/oracle/types.js';

// Scoped, because production always scopes a describe — a name is a fact
// about one world. Unscoped describe canon is the legacy shape the
// constructor deliberately drops on load.
const CREATURE: Question = describeQuestion('creature', 'thing', { might: 4, hp: 5 }, 'root-test');

/** Lets a test decide when an answer arrives, so "never blocks" can be checked
 *  rather than assumed from a promise that happened to be fast. */
function heldTransport(): Transport & { release: (name: string) => void; fail: (why: string) => void } {
  let settle: ((value: { name: string; line: string; model: string | null; costUsd: number }) => void) | null = null;
  let reject: ((reason: Error) => void) | null = null;

  return {
    name: 'held',
    ask() {
      return new Promise((resolve, rejectIt) => {
        settle = resolve;
        reject = rejectIt;
      });
    },
    release(name: string) {
      settle?.({ name, line: 'it is here', model: 'held-model', costUsd: 0.01 });
    },
    fail(why: string) {
      reject?.(new Error(why));
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

describe('asking', () => {
  it('answers immediately, before anything has been asked', async () => {
    // The whole rule: mechanics resolve now, prose arrives later or never.
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });

    const answer = oracle.ask(CREATURE);
    expect(answer.name).toBe('thing');
    expect(answer.source).toBe('fallback');

    held.release('ash-crawler');
    await tick();
    expect(oracle.ask(CREATURE).name).toBe('ash-crawler');
  });

  it('replaces the stand-in once the world has spoken', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.ask(CREATURE);
    await tick();

    const settled = oracle.ask(CREATURE);
    expect(settled.name).toBe('pale thing');
    expect(settled.source).toBe('cache');
    expect(settled.model).toBe('stub');
  });

  it('never asks twice about the same thing', async () => {
    // This is the cost model, not an optimisation. A kind is named once, ever.
    let asked = 0;
    const counting: Transport = {
      name: 'counting',
      ask() {
        asked += 1;
        return Promise.resolve({ name: 'ash-crawler', line: '', model: 'm', costUsd: 0 });
      },
    };
    const oracle = new Oracle({ transport: counting });

    oracle.ask(CREATURE);
    await tick();
    for (let i = 0; i < 20; i += 1) oracle.ask(CREATURE);
    await tick();

    expect(asked).toBe(1);
  });

  it('treats a different subject as a different question', async () => {
    let asked = 0;
    const counting: Transport = {
      name: 'counting',
      ask() {
        asked += 1;
        return Promise.resolve({ name: 'x', line: '', model: 'm', costUsd: 0 });
      },
    };
    const oracle = new Oracle({ transport: counting });
    oracle.ask(describeQuestion('creature', 'thing', {}));
    oracle.ask(describeQuestion('item', 'a keen edge', {}));
    await tick();
    expect(asked).toBe(2);
  });

  it('keeps playing when the transport is broken', async () => {
    const oracle = new Oracle({ transport: brokenTransport('the world is silent') });
    const answer = oracle.ask(CREATURE);
    await tick();

    expect(answer.name).toBe('thing');
    // Still named after the failure — degraded, not stuck.
    expect(oracle.ask(CREATURE).name).toBe('thing');
    expect(oracle.queue().some((c) => c.state === 'failed')).toBe(true);
  });

  it('works with no transport at all', () => {
    const oracle = new Oracle({ transport: null });
    expect(oracle.ask(CREATURE).name).toBe('thing');
    expect(oracle.queue()).toHaveLength(0);
  });

  it('gives the same fallback every time, so a silent world is still coherent', () => {
    expect(fallbackFor(CREATURE).name).toBe(fallbackFor(CREATURE).name);
  });
});

describe('the queue a player can see', () => {
  it('shows a question while it is being asked', () => {
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });
    oracle.ask(CREATURE);

    const [call] = oracle.queue();
    expect(call?.state).toBe('asking');
    expect(call?.subject).toBe('creature:thing');
    expect(call?.intent).toBe('describe');
  });

  it('reports how long something has been waiting', () => {
    let clock = 1000;
    const held = heldTransport();
    const oracle = new Oracle({ transport: held, now: () => clock });
    oracle.ask(CREATURE);

    clock = 3500;
    expect(oracle.queue()[0]?.ms).toBe(2500);
  });

  it('records what answered, and what it cost', async () => {
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });
    oracle.ask(CREATURE);
    held.release('ash-crawler');
    await tick();

    expect(oracle.queue()[0]?.state).toBe('answered');
    expect(oracle.queue()[0]?.detail).toContain('held-model');
    expect(oracle.ask(CREATURE).costUsd).toBe(0.01);
  });

  it('says when something failed, and why', async () => {
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });
    oracle.ask(CREATURE);
    held.fail('cli not found');
    await tick();

    const [call] = oracle.queue();
    expect(call?.state).toBe('failed');
    expect(call?.detail).toContain('cli not found');
  });

  it('tells a watcher whenever anything changes', async () => {
    let changes = 0;
    const oracle = new Oracle({ transport: stubTransport(), onChange: () => { changes += 1; } });
    oracle.ask(CREATURE);
    await tick();
    // Once when the question was raised, once when it was answered.
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it('can be cleared of finished work without losing canon', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.ask(CREATURE);
    await tick();
    oracle.forget();

    expect(oracle.queue()).toHaveLength(0);
    expect(oracle.ask(CREATURE).name).toBe('pale thing');
  });
});

describe('what the world remembers', () => {
  it('comes back knowing what it was told', async () => {
    const first = new Oracle({ transport: stubTransport() });
    first.ask(CREATURE);
    await tick();

    // A second session, no transport at all, restored from the first.
    const second = new Oracle({ transport: null, known: first.known() });
    const answer = second.ask(CREATURE);
    expect(answer.name).toBe('pale thing');
    expect(answer.source).toBe('cache');
  });

  it('asks nothing it already knows, even with a transport available', async () => {
    let asked = 0;
    const counting: Transport = {
      name: 'counting',
      ask() {
        asked += 1;
        return Promise.resolve({ name: 'x', line: '', model: 'm', costUsd: 0 });
      },
    };
    const first = new Oracle({ transport: stubTransport() });
    first.ask(CREATURE);
    await tick();

    const second = new Oracle({ transport: counting, known: first.known() });
    second.ask(CREATURE);
    await tick();
    expect(asked).toBe(0);
  });
});

describe('when the world cannot answer', () => {
  /** Fails a stated number of times, then succeeds. */
  function flaky(failures: number): Transport & { asked: () => number } {
    let asked = 0;
    return {
      name: 'flaky',
      asked: () => asked,
      ask() {
        asked += 1;
        return asked <= failures
          ? Promise.reject(new Error('dropped'))
          : Promise.resolve({ name: 'ash-crawler', line: 'it is here', model: 'm', costUsd: 0 });
      },
    };
  }

  it('does not turn one dropped call into a permanent name', async () => {
    // The bug this exists for: the fallback used to be written into canon
    // immediately, so a failed call was indistinguishable from a settled name.
    // The next ask found it cached, returned it as final, and never tried
    // again — a thing kept its placeholder for the life of the save.
    const transport = flaky(1);
    const oracle = new Oracle({ transport });

    expect(oracle.ask(CREATURE).name).toBe('thing');
    await tick();

    // Still a placeholder, but crucially not remembered as one.
    expect(oracle.ask(CREATURE).name).toBe('thing');
    await tick();

    expect(transport.asked()).toBe(2);
    expect(oracle.ask(CREATURE).name).toBe('ash-crawler');
  });

  it('never writes a placeholder into canon', async () => {
    const oracle = new Oracle({ transport: brokenTransport('gone') });
    oracle.ask(CREATURE);
    await tick();

    // Nothing to save, because the world never said anything.
    expect(Object.keys(oracle.known())).toHaveLength(0);
  });

  it('gives up after a few tries rather than billing you once per frame', async () => {
    const transport = flaky(99);
    const oracle = new Oracle({ transport });

    for (let i = 0; i < 30; i += 1) {
      oracle.ask(CREATURE);
      await tick();
    }
    expect(transport.asked()).toBeLessThanOrEqual(3);
    expect(oracle.unanswered()).toBe(1);
  });

  it('tries afresh when asked to', async () => {
    const transport = flaky(3);
    const oracle = new Oracle({ transport });

    for (let i = 0; i < 6; i += 1) { oracle.ask(CREATURE); await tick(); }
    expect(oracle.unanswered()).toBe(1);

    oracle.askAgain();
    oracle.ask(CREATURE);
    await tick();

    expect(oracle.ask(CREATURE).name).toBe('ash-crawler');
    expect(oracle.unanswered()).toBe(0);
  });

  it('heals a save that already holds a placeholder', async () => {
    // Older builds persisted fallbacks. Loading one should not inherit the
    // poisoning — it should ask properly and get a real answer.
    const poisoned = {
      '{"intent":"describe","subject":"creature:thing"}': {
        name: 'thing', line: '', source: 'fallback' as const, model: null, ms: 0, costUsd: 0,
      },
    };
    const oracle = new Oracle({ transport: stubTransport(), known: poisoned });

    expect(oracle.ask(CREATURE).name).toBe('thing');
    await tick();
    expect(oracle.ask(CREATURE).name).toBe('pale thing');
  });
});

describe('what makes two questions the same question', () => {
  it('ignores context, because a wounded thing is the same thing', async () => {
    // Keying on context meant a creature at five hit points and the same
    // creature at three were different questions: a fresh paid call every time
    // anything took damage, and a name that could change mid-fight.
    let asked = 0;
    const counting: Transport = {
      name: 'counting',
      ask() {
        asked += 1;
        return Promise.resolve({ name: 'ash-crawler', line: 'x', model: 'm', costUsd: 0 });
      },
    };
    const oracle = new Oracle({ transport: counting });

    oracle.ask(describeQuestion('creature', 'thing', { hitPoints: 5 }));
    await tick();
    const hurt = oracle.ask(describeQuestion('creature', 'thing', { hitPoints: 3 }));
    const dead = oracle.ask(describeQuestion('creature', 'thing', { hitPoints: 0 }));
    await tick();

    expect(asked).toBe(1);
    expect(hurt.name).toBe('ash-crawler');
    expect(dead.name).toBe('ash-crawler');
  });
});

describe('unlearning', () => {
  it('drops every name, so a wipe is actually a wipe', async () => {
    // The bug this exists for: "wipe everything" cleared the *stored* canon and
    // nothing else. The Oracle kept its names in memory, the next ask fired
    // onChange, and onChange wrote the whole lot straight back to storage. The
    // wipe looked like it had done nothing, because it had.
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.ask(CREATURE);
    await tick();
    expect(Object.keys(oracle.known())).toHaveLength(1);

    oracle.unlearn();

    expect(Object.keys(oracle.known())).toHaveLength(0);
    expect(oracle.queue()).toHaveLength(0);
    // And the very next ask must be a stand-in again, not the old name.
    expect(oracle.ask(CREATURE).source).toBe('fallback');
  });

  it('lets a name be learned afresh afterwards', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.ask(CREATURE);
    await tick();
    oracle.unlearn();

    oracle.ask(CREATURE);
    await tick();
    expect(oracle.ask(CREATURE).name).toBe('pale thing');
  });

  it('does not let an answer from before the wipe land after it', async () => {
    // The bug this exists for, reported from real play: names kept surviving a
    // wipe, and a *second* wipe appeared to fix it. The wipe's own re-render
    // starts fresh calls; those take tens of seconds; the wipe takes none. The
    // answers landed afterwards and wrote themselves straight into the canon
    // that had just been emptied. By the second wipe nothing was still in the
    // air, which is why it looked like it worked.
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });

    oracle.ask(CREATURE);          // in flight
    oracle.unlearn();              // wiped while it is still out there
    held.release('ash-crawler');   // and now it answers
    await tick();

    expect(Object.keys(oracle.known())).toHaveLength(0);
    expect(oracle.ask(CREATURE).source).toBe('fallback');
    expect(oracle.queue().some((c) => c.state === 'failed')).toBe(true);
  });

  it('lets a question asked after the wipe answer normally', () => {
    // The guard must not be a blanket refusal — the new world still needs names.
    const held = heldTransport();
    const oracle = new Oracle({ transport: held });
    oracle.ask(CREATURE);
    oracle.unlearn();

    // Not blocked by the stale in-flight entry for the same question.
    oracle.ask(CREATURE);
    expect(oracle.queue().some((c) => c.state === 'asking')).toBe(true);
  });

  it('is not what forget does — finished work goes, canon stays', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.ask(CREATURE);
    await tick();
    oracle.forget();
    expect(Object.keys(oracle.known())).toHaveLength(1);
  });
});

describe('the covenant guards the canon, live', () => {
  it('refuses a mood posing as a name, and leaves room to try again', async () => {
    // "small iron want" got into permanent canon once. Now the register assay
    // sits inside the ask path: a refused name is a failed call — visible in
    // the queue, retried later — never a fact.
    let calls = 0;
    const moody: Transport = {
      name: 'moody',
      ask() {
        calls += 1;
        return Promise.resolve({
          name: calls === 1 ? 'small iron want' : 'salt-knuckle crawler',
          line: 'x', model: 'm', costUsd: 0,
        });
      },
    };
    const oracle = new Oracle({ transport: moody });

    oracle.ask(CREATURE);
    await tick();
    expect(Object.keys(oracle.known())).toHaveLength(0);
    expect(oracle.queue().some((c) => c.state === 'failed' && c.detail.includes('covenant'))).toBe(true);

    // The second try lands a real name.
    oracle.ask(CREATURE);
    await tick();
    expect(oracle.ask(CREATURE).name).toBe('salt-knuckle crawler');
  });

  it('refuses a name already spent on another kind', async () => {
    const same: Transport = {
      name: 'same',
      ask() { return Promise.resolve({ name: 'chalk-hound', line: 'x', model: 'm', costUsd: 0 }); },
    };
    const oracle = new Oracle({ transport: same });
    oracle.ask(describeQuestion('creature', 'thing', {}));
    await tick();
    oracle.ask(describeQuestion('item', 'edge', {}));
    await tick();
    // One of the two got the name; the other was refused rather than doubled.
    const names = Object.values(oracle.known()).map((a) => a.name);
    expect(names.filter((n) => n === 'chalk-hound')).toHaveLength(1);
  });

  it('does not police the gamemaster\'s conversation', async () => {
    // Register checks are for canon. A chat reply is not a name.
    const chatty: Transport = {
      name: 'chatty',
      ask() { return Promise.resolve({ name: 'the quiet below!', line: 'a reply', model: 'm', costUsd: 0 }); },
    };
    const oracle = new Oracle({ transport: chatty });
    const answered = await oracle.consult({ intent: 'gamemaster', subject: 'x', context: {} });
    expect(answered.line).toBe('a reply');
  });
});

describe('asking for a whole floor at once', () => {
  const THREE: Question[] = [
    describeQuestion('creature', 'skirmisher', { might: 2 }, 'root-test'),
    describeQuestion('creature', 'bruiser', { might: 4 }, 'root-test'),
    describeQuestion('item', 'keen edge', { grants: { might: 2 } }, 'root-test'),
  ];

  it('settles every unnamed thing from one transport call', async () => {
    let calls = 0;
    let sawIntent = '';
    const counting: Transport = {
      name: 'counting',
      ask(question) {
        calls += 1;
        sawIntent = question.intent;
        return stubTransport().ask(question);
      },
    };
    const oracle = new Oracle({ transport: counting });
    oracle.askMany(THREE);
    await tick();

    expect(calls).toBe(1);
    expect(sawIntent).toBe('describe-batch');
    for (const q of THREE) {
      const a = oracle.ask(q);
      expect(a.source).toBe('cache');
      expect(a.name).toBe(`pale ${q.subject.slice(q.subject.indexOf(':') + 1)}`);
    }
  });

  it('asks nothing at all when everything is already settled', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    oracle.askMany(THREE);
    await tick();
    let calls = 0;
    const counting: Transport = { name: 'c', ask(q) { calls += 1; return stubTransport().ask(q); } };
    const again = new Oracle({ transport: counting, known: oracle.known() });
    again.askMany(THREE);
    await tick();
    expect(calls).toBe(0);
  });

  it('refuses a duplicate inside the batch and keeps the rest', async () => {
    // A batch that names two different things identically is a batch trying
    // to write a contradiction into canon. The first name lands; the second
    // faces the same duplicate check any single call would.
    const monotone: Transport = {
      name: 'monotone',
      ask(question) {
        const things = Array.isArray(question.context['things'])
          ? question.context['things'] as Array<{ subject?: unknown }>
          : [];
        return Promise.resolve({
          name: `${String(things.length)} named`, line: '', model: 'stub', costUsd: 0,
          data: things.map((t) => ({ subject: String(t.subject ?? ''), name: 'grey wolf', line: 'It watches.' })),
        });
      },
    };
    const oracle = new Oracle({ transport: monotone });
    const two = [THREE[0]!, THREE[1]!];
    oracle.askMany(two);
    await tick();

    expect(oracle.ask(two[0]!).name).toBe('grey wolf');
    expect(oracle.ask(two[1]!).source).toBe('fallback');
  });

  it('routes a batch of one through the ordinary single ask', async () => {
    let sawIntent = '';
    const watching: Transport = {
      name: 'w',
      ask(question) { sawIntent = question.intent; return stubTransport().ask(question); },
    };
    const oracle = new Oracle({ transport: watching });
    oracle.askMany([THREE[0]!]);
    await tick();
    expect(sawIntent).toBe('describe');
    expect(oracle.ask(THREE[0]!).source).toBe('cache');
  });
});

describe('the queue clock', () => {
  it('freezes an answered call at the moment it settled', async () => {
    // The gamemaster's screen showed answered calls still counting: the queue
    // recomputed elapsed time for every entry, settled or not, so the one
    // number whose job had ended was the one that never stopped changing.
    let at = 1000;
    const held = heldTransport();
    const oracle = new Oracle({ transport: held, now: () => at });

    oracle.ask(CREATURE);
    at += 5000;
    expect(oracle.queue()[0]?.ms).toBe(5000); // in flight: the clock runs

    held.release('ash-crawler');
    await tick();
    at += 60_000; // a minute of staring at the panel
    const settled = oracle.queue()[0];
    expect(settled?.state).toBe('answered');
    expect(settled?.ms).toBe(5000); // frozen where it finished
  });

  it('freezes a failed call too', async () => {
    let at = 0;
    const held = heldTransport();
    const oracle = new Oracle({ transport: held, now: () => at });
    oracle.ask(CREATURE);
    at += 3000;
    held.fail('the world is silent');
    await tick();
    at += 9000;
    const settled = oracle.queue()[0];
    expect(settled?.state).toBe('failed');
    expect(settled?.ms).toBe(3000);
  });
});

describe('the scope of a name', () => {
  it('keeps two worlds apart: one subject, two scopes, two questions', async () => {
    let asked = 0;
    const counting: Transport = {
      name: 'counting',
      ask() {
        asked += 1;
        return Promise.resolve({ name: `spoken-${String(asked)}`, line: '', model: 'm', costUsd: 0 });
      },
    };
    const oracle = new Oracle({ transport: counting });

    oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-a'));
    await tick();
    oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-b'));
    await tick();

    // Two different worlds, two different facts — the exact bleed this ends:
    // a second world used to inherit the first's name despite its own bible.
    expect(asked).toBe(2);
    expect(oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-a')).name).toBe('spoken-1');
    expect(oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-b')).name).toBe('spoken-2');
  });

  it('guards duplicates within a world, never across worlds', async () => {
    // The same name offered every time. Landing in two different worlds is
    // coincidence, not contradiction — they never meet. Landing twice in ONE
    // world is the contradiction the register refuses.
    const always: Transport = {
      name: 'always',
      ask: () => Promise.resolve({ name: 'slate otter', line: '', model: 'm', costUsd: 0 }),
    };
    const oracle = new Oracle({ transport: always });

    oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-a'));
    await tick();
    oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-b'));
    await tick();
    expect(oracle.ask(describeQuestion('creature', 'skirmisher', {}, 'root-b')).name).toBe('slate otter');

    oracle.ask(describeQuestion('creature', 'stalker', {}, 'root-a'));
    await tick();
    // Refused as a duplicate of root-a's own otter; the fallback stands in.
    expect(oracle.ask(describeQuestion('creature', 'stalker', {}, 'root-a')).name).toBe('stalker');
  });

  it('drops the unscoped era on load — those names belonged to every world at once', () => {
    const said = { line: 'x', source: 'model' as const, model: 'm', ms: 1, costUsd: 0 };
    const oracle = new Oracle({
      transport: null,
      known: {
        '{"intent":"describe","subject":"creature:thing"}': { ...said, name: 'old bleed' },
        '{"intent":"describe","scope":"root-1","subject":"creature:thing"}': { ...said, name: 'kept' },
      },
    });

    // The legacy trans-world name is gone (fallback answers); the scoped one survives.
    expect(oracle.ask(describeQuestion('creature', 'thing', {})).name).toBe('thing');
    expect(oracle.ask(describeQuestion('creature', 'thing', {}, 'root-1')).name).toBe('kept');
  });

  it('scopes the veto: refusing a name here says nothing about it there', () => {
    const said = { line: 'x', source: 'model' as const, model: 'm', ms: 1, costUsd: 0 };
    const oracle = new Oracle({
      transport: null,
      known: {
        '{"intent":"describe","scope":"root-a","subject":"creature:thing"}': { ...said, name: 'slate otter' },
        '{"intent":"describe","scope":"root-b","subject":"creature:thing"}': { ...said, name: 'slate otter' },
      },
    });

    expect(oracle.reject('slate otter', 'root-a')).toBe(true);
    expect(oracle.ask(describeQuestion('creature', 'thing', {}, 'root-a')).name).toBe('thing');
    expect(oracle.ask(describeQuestion('creature', 'thing', {}, 'root-b')).name).toBe('slate otter');
  });

  it('lists one world\'s names and no other\'s', () => {
    const said = { line: 'seen', source: 'model' as const, model: 'm', ms: 1, costUsd: 0 };
    const oracle = new Oracle({
      transport: null,
      known: {
        '{"intent":"describe","scope":"root-a","subject":"creature:thing"}': { ...said, name: 'ours' },
        '{"intent":"describe","scope":"root-b","subject":"creature:thing"}': { ...said, name: 'theirs' },
      },
    });
    expect(oracle.namesIn('root-a').map((a) => a.name)).toEqual(['ours']);
    expect(oracle.namesIn('root-b').map((a) => a.name)).toEqual(['theirs']);
  });
});
