import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs, isAncestor } from '../../src/log/refs.js';
import { ENGINE_VERSION } from '../../src/version.js';
import type { EventLog } from '../../src/log/chain.js';

function build(): { log: EventLog; head: string } {
  let log = emptyLog();
  const first = append(log, null, createWorld(31337, 16, 12, 30));
  log = first.log;
  let head = first.event.id;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 0], [0, 1]] as const) {
    const moved = append(log, head, attemptMove(fold(log, head), 'player', dx, dy));
    log = moved.log; head = moved.event.id;
    const turned = append(log, head, advanceTurn(fold(log, head)));
    log = turned.log; head = turned.event.id;
  }
  return { log, head };
}

describe('createRef and getRef', () => {
  it('stores a named ref stamped with the engine version', () => {
    const { head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, 'first run');
    const ref = getRef(refs, 'Ashfall');
    expect(ref.head).toBe(head);
    expect(ref.engineVersion).toBe(ENGINE_VERSION);
    expect(ref.note).toBe('first run');
  });

  it('refuses to overwrite an existing name', () => {
    const refs = createRef(emptyRefs(), 'Ashfall', null, 0, '');
    expect(() => createRef(refs, 'Ashfall', null, 0, '')).toThrow(/already exists/);
  });

  it('throws for a name it does not know', () => {
    expect(() => getRef(emptyRefs(), 'nowhere')).toThrow(/unknown ref/);
  });

  it('does not mutate the refs it was given', () => {
    const refs = emptyRefs();
    createRef(refs, 'Ashfall', null, 0, '');
    expect(refs.byName.size).toBe(0);
  });
});

describe('isAncestor', () => {
  it('is true for any event on the chain, including the head itself', () => {
    const { log, head } = build();
    const events = chain(log, head);
    const root = events[0];
    const middle = events[3];
    if (root === undefined || middle === undefined) throw new Error('fixture problem');
    expect(isAncestor(log, head, root.id)).toBe(true);
    expect(isAncestor(log, head, middle.id)).toBe(true);
    expect(isAncestor(log, head, head)).toBe(true);
  });

  it('is false for something not on the chain', () => {
    const { log, head } = build();
    expect(isAncestor(log, head, 'f'.repeat(64))).toBe(false);
  });
});

describe('fork', () => {
  it('creates a second world sharing the prefix, with no events copied', () => {
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem');

    const before = log.events.size;
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', at.id, 'what if');

    expect(log.events.size).toBe(before);
    expect(getRef(refs, 'Ashfall').head).toBe(head);
    expect(getRef(refs, 'Ashfall-b').head).toBe(at.id);
  });

  it('forks at the current head when no hash is given', () => {
    const { log, head } = build();
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', null, '');
    expect(getRef(refs, 'Ashfall-b').head).toBe(head);
  });

  it('the two worlds then diverge independently', () => {
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem');
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', at.id, '');

    const forkHead = getRef(refs, 'Ashfall-b').head;
    const grown = append(log, forkHead, attemptMove(fold(log, forkHead), 'player', 0, 1));
    refs = setHead(refs, 'Ashfall-b', grown.event.id);

    expect(getRef(refs, 'Ashfall-b').head).not.toBe(getRef(refs, 'Ashfall').head);
    expect(fold(grown.log, getRef(refs, 'Ashfall').head).turn).toBeGreaterThanOrEqual(1);
  });

  it('rejects a fork point absent from the log', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => fork(log, refs, 'Ashfall', 'Ashfall-b', 'a'.repeat(64), '')).toThrow(/not on the chain/);
  });

  it('rejects a fork point that is in the log but on another branch', () => {
    // The case above proves less than it appears to: a hash absent from the log
    // is refused by chain()'s missing-event guard even with the ancestry check
    // removed, so it never exercises that check. This one uses a hash that is
    // genuinely in the log, just not an ancestor of the ref being forked.
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem: no event at index 4');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Sidetrack', at.id, '');

    // Grow the fork so it holds an event Ashfall's own chain does not.
    const sideHead = getRef(refs, 'Sidetrack').head;
    const grown = append(log, sideHead, attemptMove(fold(log, sideHead), 'player', 0, 1));
    refs = setHead(refs, 'Sidetrack', grown.event.id);

    expect(() => fork(grown.log, refs, 'Ashfall', 'Bogus', grown.event.id, ''))
      .toThrow(/not on the chain/);
  });

  it('rejects a name already in use', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => fork(log, refs, 'Ashfall', 'Ashfall', null, '')).toThrow(/already exists/);
  });
});

describe('reset', () => {
  it('moves a head backwards without destroying anything', () => {
    const { log, head } = build();
    const target = chain(log, head)[2];
    if (target === undefined) throw new Error('fixture problem');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    const sizeBefore = log.events.size;
    refs = reset(log, refs, 'Ashfall', target.id);

    expect(getRef(refs, 'Ashfall').head).toBe(target.id);
    expect(log.events.size).toBe(sizeBefore);
  });

  it('can be undone, because the abandoned events are still there', () => {
    const { log, head } = build();
    const target = chain(log, head)[2];
    if (target === undefined) throw new Error('fixture problem');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = reset(log, refs, 'Ashfall', target.id);

    // The name of this test claims the events survive, so check that rather
    // than only that a pointer can be reassigned. Restoring a string would
    // pass even if reset had deleted everything it abandoned.
    expect(chain(log, head)).toHaveLength(9);
    expect(fold(log, head).turn).toBeGreaterThan(fold(log, target.id).turn);

    refs = setHead(refs, 'Ashfall', head);
    expect(getRef(refs, 'Ashfall').head).toBe(head);
    expect(fold(log, getRef(refs, 'Ashfall').head).turn).toBe(fold(log, head).turn);
  });

  it('refuses a target that is not an ancestor of the current head', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => reset(log, refs, 'Ashfall', 'b'.repeat(64))).toThrow(/not on the chain/);
  });
});

describe('listRefs', () => {
  it('lists by name, so display order never wobbles', () => {
    let refs = createRef(emptyRefs(), 'Zephyr', null, 0, '');
    refs = createRef(refs, 'Ashfall', null, 0, '');
    expect(listRefs(refs).map((r) => r.name)).toEqual(['Ashfall', 'Zephyr']);
  });
});
