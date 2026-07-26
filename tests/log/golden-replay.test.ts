import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import fixture from '../fixtures/golden-run.json';
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, outcome } from '../../src/core/commands.js';
import { playerStep, playerWait, runWorldTurns } from '../../src/play/session.js';
import { POLICIES } from '../../src/play/policies.js';
import { canonicalJson } from '../../src/log/canonical.js';
import { hashEvent } from '../../src/log/hash.js';
import type { EventLog } from '../../src/log/chain.js';
import type { DraftEvent, GameEvent } from '../../src/core/events.js';

function logFromFixture(): EventLog {
  const events = new Map<string, GameEvent>();
  for (const event of fixture.events as unknown as GameEvent[]) events.set(event.id, event);
  return { events };
}

describe('golden replay', () => {
  it('has the expected shape', () => {
    expect(fixture.policy in POLICIES).toBe(true);
    // The run may end before the action cap — a policy can die or escape
    // under real combat, and a fixture that fought exercised the sharpest code.
    expect(fixture.actions).toBeGreaterThan(10);
    expect(['dead', 'escaped', 'playing']).toContain(fixture.outcome);

    type Recorded = { type: string; rngDraws: number; payload: Record<string, unknown> };
    const events = fixture.events as unknown as ReadonlyArray<Recorded>;
    const count = (t: string): number => events.filter((e) => e.type === t).length;

    // The run is a real playthrough: the world takes its turns too, so the
    // totals are not derivable from the policy alone. What *is* fixed is that
    // every action produces exactly one player event — a move, a hold, a
    // refusal, or a blow — plus a pickup for each item walked over, which
    // rides along with the move that reached it.
    const byPlayer = events.filter(
      (e) => e.payload.entityId === 'player' || e.payload.attackerId === 'player',
    );
    expect(byPlayer).toHaveLength(fixture.actions + count('ITEM_TAKEN'));

    // Draw accounting, stated as the rule rather than as totals. This is the
    // assertion that makes verifyChain's counter check worth having: before
    // combat existed every event declared the same count, and the check could
    // be satisfied without ever noticing.
    for (const e of events) {
      if (e.type === 'STRIKE') expect(e.rngDraws).toBe(2);
      else if (e.type === 'WORLD_INIT') expect(e.rngDraws).toBeGreaterThan(0);
      else expect(e.rngDraws).toBe(0);
    }

    // A fixture with no fight in it would leave the newest and riskiest code
    // untouched by the strongest test in the repo.
    expect(count('STRIKE')).toBeGreaterThan(0);
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

  it('rebuilds byte-identically from the seed and the policy, so the whole pipeline is reproducible', () => {
    let log = emptyLog();
    const first = append(log, null, createWorld(fixture.seed, fixture.width, fixture.height));
    log = first.log;
    let head = first.event.id;

    // Deliberately a restatement of autoplay's drive loop, not an import of it
    // — sharing the code would make a bug in the loop invisible to the very
    // test meant to catch it. It has already drifted once, and the test
    // caught it, which is the argument for keeping the duplication. The
    // policy itself is imported: it is the fixture's *input*, as the key
    // script used to be.
    const policy = POLICIES[fixture.policy]!;
    for (let action = 0; action < fixture.maxActions; action += 1) {
      const state = fold(log, head);
      if (outcome(state, 'player') !== 'playing') break;
      const wish = policy(state, 'player');
      const acted = wish.kind === 'wait'
        ? playerWait({ log, head }, 'player')
        : playerStep({ log, head }, 'player', wish.dx, wish.dy);
      const after = runWorldTurns(acted.position, 'player');
      log = after.log;
      head = after.head;
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
