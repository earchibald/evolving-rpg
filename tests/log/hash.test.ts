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
