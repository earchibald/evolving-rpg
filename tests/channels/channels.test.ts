import { send } from '../../src/channels/channels.js';
import { Oracle } from '../../src/oracle/oracle.js';
import { stubTransport, brokenTransport } from '../../src/oracle/transports.js';
import type { Note } from '../../src/channels/channels.js';

const AT = '2026-07-25T00:00:00.000Z';
const WHERE = { world: 'main', head: 'abc123', turn: 7, scene: { turn: 7 } };

/** Captures what would have been written, so no test needs a server. */
function recorder(): { post: (n: Note) => Promise<void>; written: Note[] } {
  const written: Note[] = [];
  return {
    written,
    post: (n) => {
      written.push(n);
      return Promise.resolve();
    },
  };
}

describe('speaking as the designer', () => {
  it('records what you said, and asks nobody', async () => {
    // Out here, in your own voice, about the game. There is nothing for a model
    // to answer — the note *is* the signal.
    let asked = 0;
    const oracle = new Oracle({
      transport: { name: 'counting', ask() { asked += 1; return Promise.resolve({ name: '', line: '', model: null, costUsd: 0 }); } },
    });
    const sink = recorder();

    const note = await send(oracle, 'designer', 'the wall bump feels bad', WHERE, AT, sink.post);

    expect(asked).toBe(0);
    expect(note.reply).toBeNull();
    expect(note.said).toBe('the wall bump feels bad');
    expect(sink.written).toHaveLength(1);
  });

  it('is recorded even when nothing is listening at all', async () => {
    // The one thing here that cannot be regenerated is your own signal. Losing
    // it because a transport was down would be the worst possible trade.
    const oracle = new Oracle({ transport: null });
    const sink = recorder();

    const note = await send(oracle, 'designer', 'more of this', WHERE, AT, sink.post);

    expect(sink.written).toHaveLength(1);
    expect(note.said).toBe('more of this');
    expect(note.trouble).toBeNull();
  });

  it('survives the sidecar itself failing', async () => {
    const oracle = new Oracle({ transport: null });
    const note = await send(oracle, 'designer', 'kept anyway', WHERE, AT, () => Promise.reject(new Error('disk gone')));
    expect(note.said).toBe('kept anyway');
  });
});

describe('speaking to the gamemaster', () => {
  it('gets an answer, in the fiction', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    const sink = recorder();

    const note = await send(oracle, 'gamemaster', 'what does the ash smell like?', WHERE, AT, sink.post);

    expect(note.reply).not.toBeNull();
    expect(sink.written[0]?.reply).toBe(note.reply);
  });

  it('is queued where a player can see it', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    await send(oracle, 'gamemaster', 'i search the wall', WHERE, AT, recorder().post);

    const call = oracle.queue().find((c) => c.intent === 'gamemaster');
    expect(call).toBeDefined();
    expect(call?.state).toBe('answered');
  });

  it('is never remembered as canon, because a conversation is not a fact', async () => {
    // Caching this would mean asking the same thing twice returns the same
    // words, which is the opposite of what a conversation is for.
    const oracle = new Oracle({ transport: stubTransport() });
    await send(oracle, 'gamemaster', 'i search the wall', WHERE, AT, recorder().post);
    expect(Object.keys(oracle.known())).toHaveLength(0);
  });

  it('records the question even when the answer fails', async () => {
    const oracle = new Oracle({ transport: brokenTransport('the world is silent') });
    const sink = recorder();

    const note = await send(oracle, 'gamemaster', 'is anyone there?', WHERE, AT, sink.post);

    expect(note.reply).toBeNull();
    expect(note.trouble).toContain('the world is silent');
    expect(sink.written).toHaveLength(1);
  });
});

describe('what a note carries', () => {
  it('pins where you were standing when you said it', async () => {
    // Keyed to the world and the exact head, so notes can be lined up against
    // what was happening later — without ever having entered causal history.
    const oracle = new Oracle({ transport: null });
    const sink = recorder();
    await send(oracle, 'designer', 'here', WHERE, AT, sink.post);

    const written = sink.written[0];
    expect(written?.world).toBe('main');
    expect(written?.head).toBe('abc123');
    expect(written?.turn).toBe(7);
    expect(written?.at).toBe(AT);
  });

  it('keeps the two channels apart', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    const sink = recorder();
    await send(oracle, 'designer', 'out here', WHERE, AT, sink.post);
    await send(oracle, 'gamemaster', 'in there', WHERE, AT, sink.post);

    expect(sink.written.map((n) => n.channel)).toEqual(['designer', 'gamemaster']);
  });
});
