import { hashEvent } from '../../src/log/hash.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { DraftEvent } from '../../src/core/events.js';

const draft: DraftEvent = {
  type: 'MOVE',
  schemaVersion: SCHEMA_VERSIONS.MOVE,
  rngCounter: 12,
  payload: { entityId: 'player', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
};

describe('hashEvent', () => {
  it('returns a 64-character lowercase hex digest', () => {
    expect(hashEvent(draft, null, 0)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical inputs', () => {
    expect(hashEvent(draft, 'abc', 3)).toBe(hashEvent(draft, 'abc', 3));
  });

  it('changes when the parent changes, which is what links the chain', () => {
    expect(hashEvent(draft, 'aaa', 3)).not.toBe(hashEvent(draft, 'bbb', 3));
  });

  it('changes when the sequence number changes', () => {
    expect(hashEvent(draft, 'aaa', 3)).not.toBe(hashEvent(draft, 'aaa', 4));
  });

  it('changes when the payload changes', () => {
    const other: DraftEvent = {
      ...draft,
      payload: { entityId: 'player', from: { x: 1, y: 1 }, to: { x: 1, y: 2 } },
    };
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent(other, null, 0));
  });

  it('changes when the schema version changes', () => {
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent({ ...draft, schemaVersion: 2 }, null, 0));
  });

  it('changes when only the type changes', () => {
    // Built with a cast on purpose. The discriminated union forbids a type that
    // disagrees with its payload, so this value cannot arise in play — the test
    // is checking hashEvent's field coverage, not a reachable event. Without it,
    // dropping `type` from the hashed material passes every other case here,
    // and a future event type reusing an existing payload shape would hash
    // identically to the event it was meant to be distinct from.
    const retyped = { ...draft, type: 'MOVE_BLOCKED' } as unknown as DraftEvent;
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent(retyped, null, 0));
  });

  it('changes when only the rng counter changes', () => {
    // Guards against rngCounter being left out of the hashed material. Without
    // this test, dropping the field entirely still passes every other case here
    // — and then a counter could be altered without altering the event id,
    // costing verifyChain half its teeth.
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent({ ...draft, rngCounter: 13 }, null, 0));
  });

  it('does not depend on the key order of the payload object', () => {
    const reordered: DraftEvent = {
      payload: { to: { y: 1, x: 2 }, from: { y: 1, x: 1 }, entityId: 'player' },
      rngCounter: 12,
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      type: 'MOVE',
    };
    expect(hashEvent(reordered, null, 0)).toBe(hashEvent(draft, null, 0));
  });
});
