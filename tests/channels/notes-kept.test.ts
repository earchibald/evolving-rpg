import { send, readNote, notesFor, saveNotes, loadNotes, NOTES_KEY } from '../../src/channels/channels.js';
import { clear } from '../../src/play/store.js';
import { Oracle } from '../../src/oracle/oracle.js';
import type { Note } from '../../src/channels/channels.js';

/**
 * Notes have to survive, and they have to say who wrote them.
 *
 * The author field is not bookkeeping. The Rulesmith reads these as "what the
 * designer thinks", and `runs/notes.jsonl` already holds five notes of which
 * several were written by an agent while testing — indistinguishable from the
 * player's. Feeding those back as the designer's intent would mean the game
 * evolves towards whatever a test fixture happened to say.
 */

const WHERE = { world: 'main', head: 'abc123', turn: 7, scene: {}, status: null };
const AT = '2026-07-25T00:00:00.000Z';

function sink(): { post: (n: Note) => Promise<void>; written: Note[] } {
  const written: Note[] = [];
  return { written, post: (n) => { written.push(n); return Promise.resolve(); } };
}

/** A localStorage good enough to test persistence against. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeStorage() });
});

describe('who wrote it', () => {
  it('records the author on every note', async () => {
    const s = sink();
    const note = await send(new Oracle({ transport: null }), 'designer', 'the wall bump feels bad', WHERE, AT, s.post, 'player');
    expect(note.author).toBe('player');
    expect(s.written[0]?.author).toBe('player');
  });

  it('keeps an agent\'s note distinguishable from the player\'s', async () => {
    const s = sink();
    await send(new Oracle({ transport: null }), 'designer', 'mine', WHERE, AT, s.post, 'player');
    await send(new Oracle({ transport: null }), 'gamemaster', 'a test fixture', WHERE, AT, s.post, 'agent');
    expect(s.written.map((n) => n.author)).toEqual(['player', 'agent']);
  });

  it('reads an unmarked note as an agent\'s, never the player\'s', () => {
    // Every note written before this existed is unmarked, and at least two of
    // them were mine. Guessing "player" would feed my own test writing back as
    // the designer's intent; guessing "agent" merely ignores a real note.
    // Those failures are not symmetrical.
    const legacy = JSON.parse('{"channel":"designer","said":"u there?","reply":null,"trouble":null,"world":"world-2","head":"da80","turn":68,"at":"2026-07-25T23:30:30.880Z"}');
    expect(readNote(legacy).author).toBe('agent');
  });

  it('keeps an author that is already there', () => {
    const marked = { ...JSON.parse('{"channel":"designer","said":"x","reply":null,"trouble":null,"world":"w","head":null,"turn":1,"at":"t"}'), author: 'player' };
    expect(readNote(marked).author).toBe('player');
  });

  it('refuses to read an author it does not recognise', () => {
    const odd = { ...JSON.parse('{"channel":"designer","said":"x","reply":null,"trouble":null,"world":"w","head":null,"turn":1,"at":"t"}'), author: 'the-management' };
    expect(readNote(odd).author).toBe('agent');
  });
});

describe('surviving a reload', () => {
  const note = (over: Partial<Note> = {}): Note => ({
    channel: 'designer', said: 'something', reply: null, trouble: null,
    world: 'main', head: 'h', turn: 1, at: AT, author: 'player', status: null, ...over,
  });

  it('comes back after the page is closed', () => {
    saveNotes([note({ said: 'first' }), note({ said: 'second' })]);
    expect(loadNotes().map((n) => n.said)).toEqual(['first', 'second']);
  });

  it('returns nothing rather than throwing when there is nothing stored', () => {
    expect(loadNotes()).toEqual([]);
  });

  it('returns nothing rather than throwing on a corrupt store', () => {
    // A note is a convenience, not the game. Refusing to start because one is
    // malformed would be the wrong trade — unlike the event log, which must
    // refuse.
    window.localStorage.setItem(NOTES_KEY, '{not json');
    expect(loadNotes()).toEqual([]);
  });

  it('marks unmarked notes on the way in', () => {
    window.localStorage.setItem(NOTES_KEY, JSON.stringify([
      { channel: 'designer', said: 'old', reply: null, trouble: null, world: 'main', head: null, turn: 1, at: AT },
    ]));
    expect(loadNotes()[0]?.author).toBe('agent');
  });
});

describe('which world a note belongs to', () => {
  const note = (world: string, said: string, author: 'player' | 'agent' = 'player'): Note => ({
    channel: 'designer', said, reply: null, trouble: null,
    world, head: 'h', turn: 1, at: AT, author, status: null,
  });

  it('picks out one world\'s notes, in the order they were written', () => {
    const all = [note('main', 'a'), note('world-2', 'b'), note('main', 'c')];
    expect(notesFor(all, 'main').map((n) => n.said)).toEqual(['a', 'c']);
  });

  it('can be narrowed to the player\'s own', () => {
    const all = [note('main', 'mine'), note('main', 'a fixture', 'agent')];
    expect(notesFor(all, 'main', 'player').map((n) => n.said)).toEqual(['mine']);
    expect(notesFor(all, 'main').map((n) => n.said)).toEqual(['mine', 'a fixture']);
  });
});

describe('wiping', () => {
  it('takes the notes with everything else', () => {
    // "Wipe everything" that leaves notes behind is not a wipe. This is the
    // same bug that once let a poisoned name survive the one action meant to
    // clear it.
    saveNotes([{
      channel: 'designer', said: 'still here?', reply: null, trouble: null,
      world: 'main', head: null, turn: 1, at: AT, author: 'player', status: null,
    }]);
    expect(loadNotes()).toHaveLength(1);

    clear(NOTES_KEY);
    expect(loadNotes()).toEqual([]);
  });
});

describe('what must not change', () => {
  it('still records a note when nothing is listening', async () => {
    const s = sink();
    const note = await send(new Oracle({ transport: null }), 'designer', 'kept anyway', WHERE, AT, s.post, 'player');
    expect(s.written).toHaveLength(1);
    expect(note.trouble).toBeNull();
  });

  it('still records a note when the sidecar itself fails', async () => {
    const note = await send(
      new Oracle({ transport: null }), 'designer', 'kept anyway', WHERE, AT,
      () => Promise.reject(new Error('disk gone')), 'player',
    );
    expect(note.said).toBe('kept anyway');
    expect(note.author).toBe('player');
  });
});
