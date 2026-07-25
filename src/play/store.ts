import { emptyLog, chain, verifyChain } from '../log/chain.js';
import { emptyRefs } from '../log/refs.js';
import { ENGINE_VERSION } from '../version.js';
import type { EventLog } from '../log/chain.js';
import type { Refs, Ref } from '../log/refs.js';
import type { GameEvent } from '../core/events.js';

/**
 * Saving and restoring a session.
 *
 * The log is append-only and content-addressed, which makes this simpler than
 * it looks: a save is the events plus the named refs, and restoring is
 * rebuilding the map from them. Nothing derived is stored, because everything
 * derived can be folded back.
 *
 * Loading verifies. A save that has been truncated, reordered or edited fails
 * `verifyChain` and is refused rather than folded — the same rule the engine
 * applies to any log it did not just write itself.
 */

const KEY = 'evolving-rpg/session/v1';

export interface Saved {
  engineVersion: string;
  savedAt: string;
  events: GameEvent[];
  refs: Ref[];
  active: string;
}

export interface Restored {
  log: EventLog;
  refs: Refs;
  active: string;
}

/** Everything reachable from any ref, root-first per world. */
export function serialise(log: EventLog, refs: Refs, active: string, savedAt: string): Saved {
  // Events are shared between worlds, so collect once by id rather than per ref.
  const seen = new Map<string, GameEvent>();
  for (const ref of refs.byName.values()) {
    for (const event of chain(log, ref.head)) seen.set(event.id, event);
  }

  return {
    engineVersion: ENGINE_VERSION,
    savedAt,
    // Ordered by seq so a reader gets history in the order it happened, which
    // matters because a human is one of the readers.
    events: [...seen.values()].sort((a, b) => a.seq - b.seq),
    refs: [...refs.byName.values()],
    active,
  };
}

export function deserialise(saved: Saved): Restored {
  const events = new Map<string, GameEvent>();
  for (const event of saved.events) events.set(event.id, event);
  const log: EventLog = { events };

  const byName = new Map<string, Ref>();
  for (const ref of saved.refs) byName.set(ref.name, ref);

  // Every world in the save must verify. A partial save is a corrupt save.
  for (const ref of byName.values()) {
    const divergence = verifyChain(log, ref.head);
    if (divergence !== null) {
      throw new Error(
        `restore: world "${ref.name}" diverges at seq ${divergence.seq} — ${divergence.reason}`,
      );
    }
  }

  return { log, refs: { byName }, active: saved.active };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Partitioned or blocked. Playing without a save is worse than not playing.
    return null;
  }
}

export function save(log: EventLog, refs: Refs, active: string, savedAt: string): Saved | null {
  const store = storage();
  const snapshot = serialise(log, refs, active, savedAt);
  if (store === null) return snapshot;

  try {
    store.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Quota, most likely. The spec already anticipates snapshot-and-truncate;
    // until that exists, losing the save is better than losing the turn.
  }
  return snapshot;
}

/** Returns null when there is nothing to restore, and throws when there is
 *  something that does not verify — the difference matters. */
export function load(): Restored | null {
  const store = storage();
  if (store === null) return null;

  const raw = store.getItem(KEY);
  if (raw === null) return null;

  return deserialise(JSON.parse(raw) as Saved);
}

export function clear(): void {
  storage()?.removeItem(KEY);
}

export function emptySession(active: string): Restored {
  return { log: emptyLog(), refs: emptyRefs(), active };
}
