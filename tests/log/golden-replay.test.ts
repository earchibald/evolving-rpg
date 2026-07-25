import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import fixture from '../fixtures/golden-run.json';
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn, endsTurn } from '../../src/core/commands.js';
import { canonicalJson } from '../../src/log/canonical.js';
import { hashEvent } from '../../src/log/hash.js';
import type { EventLog } from '../../src/log/chain.js';
import type { DraftEvent, GameEvent } from '../../src/core/events.js';

const STEPS: Record<string, readonly [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
};

function logFromFixture(): EventLog {
  const events = new Map<string, GameEvent>();
  for (const event of fixture.events as unknown as GameEvent[]) events.set(event.id, event);
  return { events };
}

describe('golden replay', () => {
  it('has the expected shape', () => {
    expect(fixture.script).toHaveLength(100);

    // Encoded as the rule rather than a magic total: one world init, one event
    // per script input, and a turn advance only for inputs that actually
    // happened. A blocked move is recorded but costs no turn — so if that
    // regressed, this fails, where a bare `toHaveLength(170)` would only say
    // the number moved without saying why.
    const count = (t: string): number =>
      (fixture.events as ReadonlyArray<{ type: string }>).filter((e) => e.type === t).length;

    expect(count('MOVE') + count('MOVE_BLOCKED')).toBe(100);
    expect(count('TURN_ADVANCED')).toBe(count('MOVE'));
    expect(fixture.events).toHaveLength(1 + 100 + count('MOVE'));
  });

  it('verifies: every hash recomputes and every rng counter lines up', () => {
    expect(verifyChain(logFromFixture(), fixture.head)).toBeNull();
  });

  it('folds to a state whose canonical hash matches the recorded one', () => {
    const state = fold(logFromFixture(), fixture.head);
    const digest = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(state))));
    expect(digest).toBe(fixture.finalStateHash);
  });

  it('folds identically twice', () => {
    const log = logFromFixture();
    expect(canonicalJson(fold(log, fixture.head))).toBe(canonicalJson(fold(log, fixture.head)));
  });

  it('rebuilds byte-identically from the seed and the script, so the whole pipeline is reproducible', () => {
    let log = emptyLog();
    const first = append(log, null, createWorld(fixture.seed, fixture.width, fixture.height, fixture.walls));
    log = first.log;
    let head = first.event.id;

    // This loop is deliberately a restatement of the generator's, not an import
    // of it: sharing the code would make a bug in the loop invisible to the very
    // test meant to catch it. The cost is that the two can drift — and they just
    // did, when blocked moves stopped ending a turn and only the generator was
    // updated. That drift is the test doing its job, so the fix is to restate
    // the rule here rather than to collapse the duplication.
    for (const key of fixture.script) {
      const step = STEPS[key];
      if (step === undefined) throw new Error(`bad script character ${key}`);

      const draft = attemptMove(fold(log, head), 'player', step[0], step[1]);
      const moved = append(log, head, draft);
      log = moved.log;
      head = moved.event.id;

      if (endsTurn(draft)) {
        const turned = append(log, head, advanceTurn(fold(log, head)));
        log = turned.log;
        head = turned.event.id;
      }
    }

    expect(head).toBe(fixture.head);
    const rebuilt = chain(log, head);
    const recorded = fixture.events as unknown as GameEvent[];
    expect(rebuilt).toHaveLength(recorded.length);
    rebuilt.forEach((event, i) => {
      expect(canonicalJson(event)).toBe(canonicalJson(recorded[i]));
    });
  });

  it('detects a counter that disagrees with the state, even when the event hashes correctly', () => {
    // The flipped-tile case below can only ever fire the hash check, because
    // rngCounter is itself hashed — so no payload tamper can reach the counter
    // comparison, and deleting that whole branch would break nothing. This
    // forges the case the counter check actually exists for: an event that is
    // internally self-consistent but disagrees with the state the events before
    // it produce. A spliced or regrafted event looks exactly like this.
    const log = logFromFixture();
    const events = chain(log, fixture.head);
    const last = events[events.length - 1];
    if (last === undefined) throw new Error('fixture problem: empty chain');

    const drifted = { ...last, rngCounter: last.rngCounter + 1 };
    const reHashed = {
      ...drifted,
      id: hashEvent(
        {
          type: drifted.type,
          schemaVersion: drifted.schemaVersion,
          rngCounter: drifted.rngCounter,
          rngDraws: 0,
          payload: drifted.payload,
        } as DraftEvent,
        drifted.parent,
        drifted.seq,
      ),
    } as GameEvent;
    log.events.set(reHashed.id, reHashed);

    const divergence = verifyChain(log, reHashed.id);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/rng counter/);
    expect(divergence?.seq).toBe(last.seq);
  });

  it('detects a single flipped tile in the recorded world', () => {
    const log = logFromFixture();
    const root = chain(log, fixture.head)[0];
    if (root === undefined || root.type !== 'WORLD_INIT') throw new Error('fixture problem: bad root');
    const tiles = [...root.payload.tiles];
    tiles[0] = tiles[0] === 0 ? 1 : 0;
    log.events.set(root.id, { ...root, payload: { ...root.payload, tiles } } as GameEvent);

    expect(verifyChain(log, fixture.head)).not.toBeNull();
  });
});
