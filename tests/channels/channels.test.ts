import { send, statusOf, statusLine, readNote } from '../../src/channels/channels.js';
import { Oracle } from '../../src/oracle/oracle.js';
import { stubTransport, brokenTransport } from '../../src/oracle/transports.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { Note, Status } from '../../src/channels/channels.js';

const AT = '2026-07-25T00:00:00.000Z';
const STANDING: Status = { floor: 3, turn: 7, level: 2, hitPoints: 5, fullHealth: 12, carrying: 'still smoke' };
const WHERE = { world: 'main', head: 'abc123', turn: 7, scene: { turn: 7 }, status: STANDING };

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

    const note = await send(oracle, 'designer', 'the wall bump feels bad', WHERE, AT, sink.post, 'player');

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

    const note = await send(oracle, 'designer', 'more of this', WHERE, AT, sink.post, 'player');

    expect(sink.written).toHaveLength(1);
    expect(note.said).toBe('more of this');
    expect(note.trouble).toBeNull();
  });

  it('survives the sidecar itself failing', async () => {
    const oracle = new Oracle({ transport: null });
    const note = await send(oracle, 'designer', 'kept anyway', WHERE, AT, () => Promise.reject(new Error('disk gone')), 'player');
    expect(note.said).toBe('kept anyway');
  });
});

describe('speaking to the gamemaster', () => {
  it('gets an answer, in the fiction', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    const sink = recorder();

    const note = await send(oracle, 'gamemaster', 'what does the ash smell like?', WHERE, AT, sink.post, 'player');

    expect(note.reply).not.toBeNull();
    expect(sink.written[0]?.reply).toBe(note.reply);
  });

  it('is queued where a player can see it', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    await send(oracle, 'gamemaster', 'i search the wall', WHERE, AT, recorder().post, 'player');

    const call = oracle.queue().find((c) => c.intent === 'gamemaster');
    expect(call).toBeDefined();
    expect(call?.state).toBe('answered');
  });

  it('is never remembered as canon, because a conversation is not a fact', async () => {
    // Caching this would mean asking the same thing twice returns the same
    // words, which is the opposite of what a conversation is for.
    const oracle = new Oracle({ transport: stubTransport() });
    await send(oracle, 'gamemaster', 'i search the wall', WHERE, AT, recorder().post, 'player');
    expect(Object.keys(oracle.known())).toHaveLength(0);
  });

  it('records the question even when the answer fails', async () => {
    const oracle = new Oracle({ transport: brokenTransport('the world is silent') });
    const sink = recorder();

    const note = await send(oracle, 'gamemaster', 'is anyone there?', WHERE, AT, sink.post, 'player');

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
    await send(oracle, 'designer', 'here', WHERE, AT, sink.post, 'player');

    const written = sink.written[0];
    expect(written?.world).toBe('main');
    expect(written?.head).toBe('abc123');
    expect(written?.turn).toBe(7);
    expect(written?.at).toBe(AT);
    // The lining-up the head always promised, carried in the note itself.
    expect(written?.status).toEqual(STANDING);
  });

  it('keeps the two channels apart', async () => {
    const oracle = new Oracle({ transport: stubTransport() });
    const sink = recorder();
    await send(oracle, 'designer', 'out here', WHERE, AT, sink.post, 'player');
    await send(oracle, 'gamemaster', 'in there', WHERE, AT, sink.post, 'player');

    expect(sink.written.map((n) => n.channel)).toEqual(['designer', 'gamemaster']);
  });
});

describe('the stamp — how you stood when you said it', () => {
  const you = {
    id: 'player', kind: 'you', pos: { x: 0, y: 0 },
    stats: { hp: 5, might: 1, wits: 1, speed: 1 }, tags: [], maxHp: 12,
  };

  it('reads the player out of the state', () => {
    const state = {
      ...EMPTY_STATE, depth: 3, turn: 41, level: 2,
      entities: [{ ...you, satchel: [{ kind: 'still smoke' }] }],
    };
    expect(statusOf(state)).toEqual({
      floor: 3, turn: 41, level: 2, hitPoints: 5, fullHealth: 12, carrying: 'still smoke',
    });
  });

  it('reads null where there is no player to read', () => {
    expect(statusOf(EMPTY_STATE)).toBeNull();
  });

  it('says it in plain words, burden and all', () => {
    expect(statusLine(STANDING)).toBe('floor 3 · turn 7 · level 2 · 5/12 health · carrying the still smoke');
    expect(statusLine({ ...STANDING, carrying: null })).toBe('floor 3 · turn 7 · level 2 · 5/12 health');
    expect(statusLine({ ...STANDING, carrying: 'heart' })).toContain('the heart in hand');
    expect(statusLine({ ...STANDING, hitPoints: 0 })).toContain('fallen');
  });

  it('is told to the gamemaster in the same words the player reads', async () => {
    const asked: Array<Record<string, unknown>> = [];
    const oracle = new Oracle({
      transport: {
        name: 'capturing',
        ask(q: { context?: Record<string, unknown> }) {
          asked.push(q.context ?? {});
          return Promise.resolve({ name: 'noted', line: 'the ash is cold', model: null, costUsd: 0 });
        },
      },
    });

    await send(oracle, 'gamemaster', 'what does the ash smell like?', WHERE, AT, recorder().post, 'player');

    expect(asked[0]?.standing).toBe(statusLine(STANDING));
  });

  it('carries the founding to the gamemaster when the world has one', async () => {
    // The comment always said "the bible is which world" — but the ride-along
    // was dropped on the floor between where and the consult. Pinned now.
    const asked: Array<Record<string, unknown>> = [];
    const oracle = new Oracle({
      transport: {
        name: 'capturing',
        ask(q: { context?: Record<string, unknown> }) {
          asked.push(q.context ?? {});
          return Promise.resolve({ name: 'noted', line: 'so it is', model: null, costUsd: 0 });
        },
      },
    });
    const bible = { anchor: 'a drowned mine', register: ['cold'], promises: ['something counts'] };

    await send(oracle, 'gamemaster', 'who dug this?', { ...WHERE, bible }, AT, recorder().post, 'player');
    await send(oracle, 'gamemaster', 'who dug this?', WHERE, AT, recorder().post, 'player');

    expect(asked[0]?.bible).toEqual(bible);
    expect('bible' in (asked[1] ?? {})).toBe(false);
  });

  it('reads back whole or not at all', () => {
    // A half status would stamp numbers that were never true together.
    const base = { channel: 'designer', said: 'x', world: 'main', at: AT, turn: 1 };
    expect(readNote({ ...base, status: STANDING }).status).toEqual(STANDING);
    expect(readNote({ ...base }).status).toBeNull();
    expect(readNote({ ...base, status: { floor: 3, turn: 7 } }).status).toBeNull();
  });
});
