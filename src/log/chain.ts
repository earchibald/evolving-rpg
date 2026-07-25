import { apply } from '../core/apply.js';
import { EMPTY_STATE } from '../core/state.js';
import type { GameState } from '../core/state.js';
import type { DraftEvent, GameEvent } from '../core/events.js';
import { hashEvent } from './hash.js';

export interface EventLog {
  events: Map<string, GameEvent>;
}

export function emptyLog(): EventLog {
  return { events: new Map() };
}

/**
 * Freezes an event and everything reachable inside it.
 *
 * A log copy shares its event objects by reference — `new Map(log.events)`
 * duplicates the structure, not the values. Without this, one holder could
 * write `chain(log, head)[2].payload.to.x = 999` with no cast and silently
 * rewrite history for every fork sharing that event. `fold` performs no hash
 * check, so the result would be a different, plausible, wrong state rather
 * than an error, and `verifyChain` would only catch it if someone re-ran it.
 *
 * Note this reaches the caller's draft as well: `{ ...draft }` is a shallow
 * spread, so `event.payload` and `draft.payload` are one object. A caller that
 * keeps a draft and edits it after appending gets a TypeError thrown far from
 * its cause. Build a fresh draft per append instead of reusing one.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** Appends without mutating: returns a new log alongside the sealed event. */
export function append(
  log: EventLog,
  head: string | null,
  draft: DraftEvent,
): { log: EventLog; event: GameEvent } {
  let seq = 0;
  if (head !== null) {
    const parent = log.events.get(head);
    if (parent === undefined) throw new Error(`append: unknown head ${head}`);
    seq = parent.seq + 1;
  }

  const id = hashEvent(draft, head, seq);
  if (log.events.has(id)) throw new Error(`append: duplicate event id ${id}`);

  const event = deepFreeze({ ...draft, id, parent: head, seq } as GameEvent);
  const events = new Map(log.events);
  events.set(id, event);
  return { log: { events }, event };
}

/** Ordered root first. Walks parent links backwards, then reverses. */
export function chain(log: EventLog, head: string | null): GameEvent[] {
  const out: GameEvent[] = [];
  const seen = new Set<string>();
  let cursor = head;

  while (cursor !== null) {
    if (seen.has(cursor)) throw new Error(`chain: cycle at ${cursor}`);
    seen.add(cursor);
    const event = log.events.get(cursor);
    if (event === undefined) throw new Error(`chain: missing event ${cursor}`);
    out.push(event);
    cursor = event.parent;
  }

  return out.reverse();
}

export function fold(log: EventLog, head: string | null): GameState {
  return chain(log, head).reduce(apply, EMPTY_STATE);
}

export interface Divergence {
  seq: number;
  eventId: string;
  reason: string;
}

/**
 * Recomputes every hash and checks each event's recorded counter against the
 * state it is about to be applied to. Returns null when the chain is sound.
 * Never repairs anything — a divergence is a fact to report, not to smooth over.
 */
export function verifyChain(log: EventLog, head: string | null): Divergence | null {
  let state = EMPTY_STATE;

  for (const event of chain(log, head)) {
    const draft = {
      type: event.type,
      schemaVersion: event.schemaVersion,
      rngCounter: event.rngCounter,
      payload: event.payload,
    } as DraftEvent;

    const recomputed = hashEvent(draft, event.parent, event.seq);
    if (recomputed !== event.id) {
      return { seq: event.seq, eventId: event.id, reason: `hash mismatch, recomputed ${recomputed}` };
    }
    if (state.rngCounter !== event.rngCounter) {
      return {
        seq: event.seq,
        eventId: event.id,
        reason: `rng counter recorded as ${event.rngCounter} but state is at ${state.rngCounter}`,
      };
    }

    state = apply(state, event);
  }

  return null;
}
