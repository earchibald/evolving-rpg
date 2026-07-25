import { Oracle, describeQuestion, fallbackFor } from '../../src/oracle/oracle.js';
import { stubTransport, brokenTransport } from '../../src/oracle/transports.js';
import type { Question, Transport } from '../../src/oracle/types.js';

const CREATURE: Question = describeQuestion('creature', 'thing', { might: 4, hp: 5 });

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
    expect(settled.name).toBe('the thing');
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
    expect(oracle.ask(CREATURE).name).toBe('the thing');
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
    expect(answer.name).toBe('the thing');
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
