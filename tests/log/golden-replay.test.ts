import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import fixture from '../fixtures/golden-run.json';
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { canonicalJson } from '../../src/log/canonical.js';
import type { EventLog } from '../../src/log/chain.js';
import type { GameEvent } from '../../src/core/events.js';

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
    expect(fixture.events).toHaveLength(201);
    expect(fixture.script).toHaveLength(100);
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

    for (const key of fixture.script) {
      const step = STEPS[key];
      if (step === undefined) throw new Error(`bad script character ${key}`);
      const moved = append(log, head, attemptMove(fold(log, head), 'player', step[0], step[1]));
      log = moved.log;
      head = moved.event.id;
      const turned = append(log, head, advanceTurn(fold(log, head)));
      log = turned.log;
      head = turned.event.id;
    }

    expect(head).toBe(fixture.head);
    const rebuilt = chain(log, head);
    const recorded = fixture.events as unknown as GameEvent[];
    expect(rebuilt).toHaveLength(recorded.length);
    rebuilt.forEach((event, i) => {
      expect(canonicalJson(event)).toBe(canonicalJson(recorded[i]));
    });
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
