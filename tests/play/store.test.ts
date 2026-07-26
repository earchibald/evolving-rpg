import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { emptyRefs, createRef, setHead, fork, getRef } from '../../src/log/refs.js';
import { createWorld } from '../../src/core/commands.js';
import { playerStep, runWorldTurns, descend } from '../../src/play/session.js';
import { outcome } from '../../src/core/commands.js';
import { firstStepToward } from '../../src/play/policies.js';
import { serialise, deserialise } from '../../src/play/store.js';
import { canonicalJson } from '../../src/log/canonical.js';
import type { EventLog } from '../../src/log/chain.js';
import type { Refs } from '../../src/log/refs.js';
import type { GameEvent } from '../../src/core/events.js';

const AT = '2026-07-25T00:00:00.000Z';

/** A short played session with two worlds, so the round trip has something with
 *  shape to it rather than a single event. */
function played(): { log: EventLog; refs: Refs } {
  const first = append(emptyLog(), null, createWorld(20260724, 24, 16));
  let log = first.log;
  let refs = createRef(emptyRefs(), 'main', first.event.id, 0, 'opening run');

  for (const [dx, dy] of [[1, 0], [0, 1], [1, 0], [0, -1], [1, 0]] as const) {
    const head = getRef(refs, 'main').head;
    if (head === null) break;
    const acted = playerStep({ log, head }, 'player', dx, dy);
    const after = runWorldTurns(acted.position, 'player');
    log = after.log;
    refs = setHead(refs, 'main', after.head);
  }

  refs = fork(log, refs, 'main', 'sidetrack', null, 'a second world');
  return { log, refs };
}

describe('a saved session', () => {
  const { log, refs } = played();
  const saved = serialise(log, refs, 'main', AT);

  it('keeps every event reachable from any world', () => {
    const reachable = new Set<string>();
    for (const ref of refs.byName.values()) {
      for (const e of chain(log, ref.head)) reachable.add(e.id);
    }
    expect(saved.events).toHaveLength(reachable.size);
    for (const e of saved.events) expect(reachable.has(e.id)).toBe(true);
  });

  it('stores each shared event once, not once per world', () => {
    // Two worlds share their whole prefix here. Saving per-ref would duplicate
    // it, and the log would grow with the number of forks rather than the
    // number of things that happened.
    const ids = new Set(saved.events.map((e) => e.id));
    expect(ids.size).toBe(saved.events.length);
  });

  it('orders history the way it happened, because a person reads this too', () => {
    const seqs = saved.events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('keeps the worlds and which one you were in', () => {
    expect(saved.refs.map((r) => r.name).sort()).toEqual(['main', 'sidetrack']);
    expect(saved.active).toBe('main');
  });

  it('is events and refs and nothing else', () => {
    // Asserted on the shape rather than by scanning for field names. The first
    // version of this searched the JSON for "activeEntityId" and failed —
    // because TURN_ADVANCED records it, and that is history, not derived state.
    // What matters is that no folded GameState is stored anywhere: positions,
    // hit points and turn numbers all come back out of the events, and a second
    // copy is a second thing that can disagree with the first.
    expect(Object.keys(saved).sort()).toEqual([
      'active', 'engineVersion', 'events', 'refs', 'savedAt',
    ]);
    for (const event of saved.events) {
      expect(Object.keys(event).sort()).toEqual([
        'id', 'parent', 'payload', 'rngCounter', 'rngDraws', 'schemaVersion', 'seq', 'type',
      ]);
    }
  });
});

describe('restoring', () => {
  const { log, refs } = played();
  const restored = deserialise(serialise(log, refs, 'main', AT));

  it('folds every world to exactly the state it was left in', () => {
    for (const ref of refs.byName.values()) {
      const before = fold(log, ref.head);
      const after = fold(restored.log, getRef(restored.refs, ref.name).head);
      expect(canonicalJson(after)).toBe(canonicalJson(before));
    }
  });

  it('comes back with the same event count', () => {
    expect(restored.log.events.size).toBe(
      new Set([...refs.byName.values()].flatMap((r) => chain(log, r.head).map((e) => e.id))).size,
    );
  });

  it('refuses a save whose events were tampered with', () => {
    // Loading verifies, deliberately. A save read off disk is exactly the
    // untrusted input verifyChain exists for, and folding a corrupted one would
    // produce a plausible wrong world rather than an error.
    const saved = serialise(log, refs, 'main', AT);
    const bent = {
      ...saved,
      events: saved.events.map((e, i) =>
        i === 3 ? ({ ...e, rngCounter: e.rngCounter + 1 } as GameEvent) : e,
      ),
    };
    expect(() => deserialise(bent)).toThrow(/diverges at seq/);
  });

  it('refuses a save with a hole in it', () => {
    const saved = serialise(log, refs, 'main', AT);
    const holed = { ...saved, events: saved.events.filter((_, i) => i !== 2) };
    expect(() => deserialise(holed)).toThrow();
  });

  it('names the world that failed, not just that something did', () => {
    const saved = serialise(log, refs, 'main', AT);
    const bent = {
      ...saved,
      events: saved.events.map((e, i) =>
        i === 3 ? ({ ...e, rngCounter: e.rngCounter + 1 } as GameEvent) : e,
      ),
    };
    expect(() => deserialise(bent)).toThrow(/main|sidetrack/);
  });
});

describe('a session that crossed the stairs', () => {
  it('survives the save/load round trip', () => {
    // The bug this pins: WORLD_INIT records rngCounter 0 (a new floor is a
    // new counter epoch), and restore's verification demanded continuity —
    // so every save made after a descent was refused on reload and the
    // session silently started over. Auto-descend made that every session.
    const first = append(emptyLog(), null, createWorld(31, 48, 32));
    let log = first.log;
    let refs = createRef(emptyRefs(), 'main', first.event.id, 0, 'opening');

    // Walk until escaped (rusher-style straight drive is not needed — descend
    // only requires standing on the exit; walk the exit's way via session).
    let position = { log, head: first.event.id };
    for (let i = 0; i < 400; i += 1) {
      const state = fold(position.log, position.head);
      if (outcome(state) !== 'playing') break;
      const me = state.entities[0]!;
      const exitAt = state.grid.tiles.indexOf(2);
      const ex = { x: exitAt % state.grid.width, y: Math.floor(exitAt / state.grid.width) };
      const wish = firstStepToward(state, me.pos, (p) => p.x === ex.x && p.y === ex.y);
      if (wish === null) break;
      const acted = playerStep(position, 'player', wish.dx, wish.dy);
      position = runWorldTurns(acted.position, 'player');
    }
    expect(outcome(fold(position.log, position.head))).toBe('escaped');
    log = position.log;
    refs = setHead(refs, 'main', position.head);

    const down = descend(log, refs, 'main', { width: 48, height: 32 });
    expect(down).not.toBeNull();

    const saved = serialise(down!.log, down!.refs, 'main', AT);
    expect(saved).not.toBeNull();
    const restored = deserialise(saved!);
    expect(fold(restored.log, getRef(restored.refs, 'main').head!).depth).toBe(2);
  });
});
