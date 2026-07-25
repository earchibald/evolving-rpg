import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';
import type { GameEvent } from '../../src/core/events.js';

/** Builds a short but real run: a world, then a few steps. */
function build(): { log: EventLog; head: string } {
  let log = emptyLog();
  const first = append(log, null, createWorld(2026, 16, 12, 30));
  log = first.log;
  let head = first.event.id;

  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const state = fold(log, head);
    const moved = append(log, head, attemptMove(state, 'player', dx, dy));
    log = moved.log;
    head = moved.event.id;

    const turned = append(log, head, advanceTurn(fold(log, head)));
    log = turned.log;
    head = turned.event.id;
  }
  return { log, head };
}

describe('append', () => {
  it('links the first event to no parent at sequence zero', () => {
    const { event } = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    expect(event.parent).toBeNull();
    expect(event.seq).toBe(0);
    expect(event.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('increments the sequence and points at the previous head', () => {
    const first = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    const state = fold(first.log, first.event.id);
    const second = append(first.log, first.event.id, attemptMove(state, 'player', 1, 0));
    expect(second.event.seq).toBe(1);
    expect(second.event.parent).toBe(first.event.id);
  });

  it('does not mutate the log it was given', () => {
    // Starts from a log that already holds an event, so the assertion has
    // something to detect: against an empty log, a mutating append would look
    // identical to a copying one.
    const first = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    const sizeBefore = first.log.events.size;
    append(first.log, first.event.id, attemptMove(fold(first.log, first.event.id), 'player', 1, 0));
    expect(first.log.events.size).toBe(sizeBefore);
  });

  it('freezes the event it seals, so no holder can rewrite shared history', () => {
    // Log copies share event objects by reference, and fold does no hash check,
    // so an unfrozen event would let one holder silently derive a wrong state
    // for every fork descending from it.
    const { event } = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    if (event.type !== 'WORLD_INIT') throw new Error('fixture problem: expected WORLD_INIT');

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.player.pos)).toBe(true);
    expect(Object.isFrozen(event.payload.tiles)).toBe(true);

    // No cast: the payload's fields are not declared readonly, so the type
    // system permits this write and only the freeze refuses it. That is the
    // hazard being closed — a plain typed assignment, no cast required.
    expect(() => {
      event.payload.seed = 999;
    }).toThrow(TypeError);
  });

  it('rejects a head it has never seen', () => {
    expect(() => append(emptyLog(), 'nope', createWorld(1, 12, 8, 10))).toThrow(/unknown head/);
  });

  it('refuses the same draft twice at the same head', () => {
    // Same content plus same position means the same id, so this is a
    // double-append rather than a legitimate new event.
    const draft = createWorld(1, 12, 8, 10);
    const first = append(emptyLog(), null, draft);
    expect(() => append(first.log, null, draft)).toThrow(/duplicate event id/);
  });
});

describe('chain', () => {
  it('is empty for a null head', () => {
    expect(chain(emptyLog(), null)).toEqual([]);
  });

  it('returns events root-first with contiguous sequence numbers', () => {
    const { log, head } = build();
    const events = chain(log, head);
    expect(events).toHaveLength(9); // 1 world init + 4 moves + 4 turn advances
    expect(events[0]?.type).toBe('WORLD_INIT');
    events.forEach((e, i) => expect(e.seq).toBe(i));
  });

  it('reports a missing event rather than returning a short chain', () => {
    const { log, head } = build();
    const broken: EventLog = { events: new Map(log.events) };
    const victim = chain(log, head)[4];
    if (victim === undefined) throw new Error('fixture problem: no event at index 4');
    broken.events.delete(victim.id);
    expect(() => chain(broken, head)).toThrow(/missing event/);
  });

  it('refuses a cycle rather than walking forever', () => {
    // Content addressing makes a real cycle unreachable by appending, so this
    // is a hand-forged log: two events made to point at each other. Without the
    // guard the walk never terminates and the process dies on memory rather
    // than reporting a corrupt log.
    const { log, head } = build();
    const events = chain(log, head);
    const earlier = events[1];
    const later = events[2];
    if (earlier === undefined || later === undefined) throw new Error('fixture problem');

    const looped: EventLog = { events: new Map(log.events) };
    looped.events.set(earlier.id, { ...earlier, parent: later.id } as GameEvent);

    expect(() => chain(looped, later.id)).toThrow(/cycle/);
  });
});

describe('fold', () => {
  it('gives the empty state for a null head', () => {
    expect(fold(emptyLog(), null)).toEqual(EMPTY_STATE);
  });

  it('is deterministic — two folds of one chain are identical', () => {
    const { log, head } = build();
    expect(JSON.stringify(fold(log, head))).toBe(JSON.stringify(fold(log, head)));
  });

  it('reaches a state where the player exists and turns have passed', () => {
    const { log, head } = build();
    const state = fold(log, head);
    expect(state.entities).toHaveLength(1);
    expect(state.turn).toBeGreaterThanOrEqual(2);
    expect(state.rngCounter).toBeGreaterThan(0);
  });

  it('folding a prefix gives the state as it was then', () => {
    const { log, head } = build();
    const events = chain(log, head);
    const third = events[2];
    if (third === undefined) throw new Error('fixture problem: no event at index 2');
    expect(fold(log, third.id).turn).toBeLessThanOrEqual(fold(log, head).turn);
  });
});

describe('verifyChain', () => {
  it('passes a chain built honestly', () => {
    const { log, head } = build();
    expect(verifyChain(log, head)).toBeNull();
  });

  it('passes an empty chain', () => {
    expect(verifyChain(emptyLog(), null)).toBeNull();
  });

  it('catches a tampered payload', () => {
    const { log, head } = build();
    const tampered: EventLog = { events: new Map(log.events) };
    const target = chain(log, head).find((e) => e.type === 'MOVE');
    if (target === undefined) throw new Error('fixture problem: no MOVE event');
    const forged = {
      ...target,
      payload: { ...target.payload, to: { x: 99, y: 99 } },
    } as GameEvent;
    tampered.events.set(target.id, forged);

    const divergence = verifyChain(tampered, head);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/hash mismatch/);
    expect(divergence?.seq).toBe(target.seq);
  });

  it('catches an rng counter that does not line up with the state', () => {
    // Built honestly, so every hash is valid and the counter check is the only
    // thing that can fire. The move claims a counter the state never reached.
    const first = append(emptyLog(), null, createWorld(555, 12, 8, 10));
    const state = fold(first.log, first.event.id);
    const player = state.entities[0];
    if (player === undefined) throw new Error('fixture problem: no player');

    const second = append(first.log, first.event.id, {
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: state.rngCounter + 999,
      payload: { entityId: 'player', from: { ...player.pos }, to: { ...player.pos } },
    });

    const divergence = verifyChain(second.log, second.event.id);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/rng counter/);
    expect(divergence?.seq).toBe(1);
  });
});
