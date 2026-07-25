import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import v1 from '../fixtures/golden-run-v1.json';
import { upcastEvent, upcastChain } from '../../src/log/upcast.js';
import { fold, verifyChain, chain } from '../../src/log/chain.js';
import { canonicalJson } from '../../src/log/canonical.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';

/** The v1 fixture is the only log in existence written before the draw
 *  protocol. It is kept precisely so this migration has something real to
 *  migrate, rather than a synthetic log shaped to make the test pass. */

describe('upcastEvent', () => {
  it('derives draws from where v1 buried them, and drops the payload field', () => {
    const root = v1.events[0];
    if (root === undefined) throw new Error('fixture problem: empty chain');
    expect(root.schemaVersion).toBe(1);
    expect(root.payload.counterAfter).toBe(122);

    const upcast = upcastEvent(root);
    expect(upcast.schemaVersion).toBe(SCHEMA_VERSIONS.WORLD_INIT);
    expect(upcast.rngDraws).toBe(122);
    expect(upcast.payload).not.toHaveProperty('counterAfter');
  });

  it('declares zero draws for the v1 events that consumed none', () => {
    const move = v1.events.find((e) => e.type === 'MOVE');
    if (move === undefined) throw new Error('fixture problem: no MOVE');
    expect(upcastEvent(move).rngDraws).toBe(0);
  });

  it('passes a current-version event through untouched', () => {
    const already = {
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 5,
      rngDraws: 2,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    };
    expect(upcastEvent(already)).toBe(already);
  });

  it('refuses a log from the future rather than guessing', () => {
    const future = {
      type: 'MOVE',
      schemaVersion: 99,
      rngCounter: 0,
      rngDraws: 0,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    };
    expect(() => upcastEvent(future)).toThrow(/cannot be downcast/);
  });

  it('refuses an event type it has no upcaster for', () => {
    expect(() => upcastEvent({ type: '__NEVER_AN_EVENT__', schemaVersion: 1, rngCounter: 0, payload: {} }))
      .toThrow(/unknown event type __NEVER_AN_EVENT__/);
  });
});

describe('upcastChain', () => {
  const migrated = upcastChain(v1.events);

  it('produces a chain the current engine verifies', () => {
    expect(verifyChain(migrated.log, migrated.head)).toBeNull();
  });

  it('keeps every event', () => {
    expect(chain(migrated.log, migrated.head)).toHaveLength(v1.events.length);
  });

  it('does not preserve ids, because identity is content plus position', () => {
    // Upcasting changes content, so the hashes must change. A migration that
    // kept its ids would mean the new content was never hashed — which would be
    // the real bug. Asserting the change makes that explicit rather than
    // leaving it as a surprise later.
    expect(migrated.head).not.toBe(v1.head);
  });

  it('preserves meaning: every field v1 had folds to the value v1 folded to', () => {
    // Compared field by field rather than by digest, and the reason is worth
    // recording. This test began as a hash comparison against v1's recorded
    // finalStateHash, and that held exactly as long as GameState's *shape* did.
    // The moment state gained an `items` field, an old log's fold necessarily
    // hashed differently while meaning precisely the same thing.
    //
    // So the honest invariant is not "identical bytes" but "identical meaning in
    // every field that existed at the time, and empty in the ones that did not".
    // A migration cannot promise that a container it never saw stays the same
    // size.
    const state = fold(migrated.log, migrated.head);

    expect(state.turn).toBe(101);
    expect(state.seed).toBe(12345);
    expect(state.rngCounter).toBe(122);
    expect(state.grid.width).toBe(24);
    expect(state.grid.height).toBe(16);
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0]?.id).toBe('player');

    // Fields that did not exist when the log was written are empty, not invented.
    expect(state.items).toEqual([]);
  });

  it('folds to a state that still hashes stably, just not to v1 digest', () => {
    // Determinism itself is unaffected by the shape change: two folds of the
    // migrated chain agree with each other, which is the property replay needs.
    const a = fold(migrated.log, migrated.head);
    const b = fold(migrated.log, migrated.head);
    const digest = (s: unknown): string =>
      bytesToHex(sha256(new TextEncoder().encode(canonicalJson(s))));
    expect(digest(a)).toBe(digest(b));
    expect(digest(a)).not.toBe(v1.finalStateHash);
  });

  it('does not retroactively change what an old log meant', () => {
    // Blocked moves no longer cost a turn, but a v1 log recorded the turn
    // advances it made under the old rule and still contains them. Migrating
    // must replay history as it was lived, not as the current rules would have
    // produced it — so the turn count matches v1's, not what a fresh run gives.
    const state = fold(migrated.log, migrated.head);
    expect(state.turn).toBe(101);
  });
});
