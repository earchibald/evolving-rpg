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

  it('preserves meaning: the migrated chain folds to exactly the state v1 folded to', () => {
    // This is the only thing a migration can honestly promise, and the whole
    // reason the v1 fixture was kept. v1 set the counter from payload.counterAfter
    // and never moved it again; v2 sets it from rngCounter + rngDraws and adds
    // zero thereafter. Different mechanism, identical result — byte for byte.
    const state = fold(migrated.log, migrated.head);
    const digest = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(state))));
    expect(digest).toBe(v1.finalStateHash);
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
