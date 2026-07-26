import { apply } from '../core/apply.js';
import { EMPTY_STATE } from '../core/state.js';
import type { GameState } from '../core/state.js';
import type { DraftEvent, GameEvent } from '../core/events.js';
import { SCHEMA_VERSIONS } from '../core/events.js';
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

  // Idempotent, not fatal. Identity is content plus position, so an id already
  // present means this exact event at this exact point in history already
  // exists — which is a legitimate, ordinary occurrence once refs exist:
  // reset a world and redo the move you just undid, or make the same move in
  // two forks of one state. Convergent history is a feature of content
  // addressing, and returning the existing event keeps the log append-only
  // while letting all three work.
  const existing = log.events.get(id);
  if (existing !== undefined) return { log, event: existing };

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

/**
 * Folded states, memoised by event id — for the whole process, across logs.
 *
 * Sound because identity is content *plus position*: an event's id commits to
 * its entire ancestry through the parent hashes, so the state at a given id is
 * the same state in every log that contains it, forever. Apply is pure and
 * events are deep-frozen, so a cached state can never drift from a recomputed
 * one. This is the content-addressed design paying its way: without the memo,
 * every keypress refolds from the root and an autoplayed run is quadratic in
 * its own length — the 48x32 boards made that a minute per sweep.
 *
 * Cleared wholesale at the cap rather than evicted piecewise: correctness
 * never depends on an entry being present, so the worst case of clearing is
 * one refold from the root per chain.
 */
const FOLDED = new Map<string, GameState>();
const FOLD_CACHE_LIMIT = 200_000;

export function fold(log: EventLog, head: string | null): GameState {
  if (head === null) return EMPTY_STATE;
  const hit = FOLDED.get(head);
  if (hit !== undefined) return hit;

  // Walk back to the nearest already-folded ancestor, then apply forward from
  // it, caching every intermediate state on the way — so the next fold of any
  // prefix, sibling or extension of this chain starts warm.
  const pending: GameEvent[] = [];
  const seen = new Set<string>();
  let cursor: string | null = head;
  let state = EMPTY_STATE;
  while (cursor !== null) {
    if (seen.has(cursor)) throw new Error(`fold: cycle at ${cursor}`);
    seen.add(cursor);
    const cached = FOLDED.get(cursor);
    if (cached !== undefined) { state = cached; break; }
    const event = log.events.get(cursor);
    if (event === undefined) throw new Error(`fold: missing event ${cursor}`);
    pending.push(event);
    cursor = event.parent;
  }

  if (FOLDED.size + pending.length > FOLD_CACHE_LIMIT) FOLDED.clear();
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    state = apply(state, pending[i]!);
    FOLDED.set(pending[i]!.id, state);
  }
  return state;
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
  // Treated as a runtime lookup table rather than a typed record, because the
  // whole point here is that the input is untrusted: an event's `type` is
  // `EventType` to the compiler but an arbitrary string in a log read off disk.
  const known: Record<string, number> = SCHEMA_VERSIONS;

  let state = EMPTY_STATE;
  let expectedSeq = 0;

  for (const event of chain(log, head)) {
    // `hashEvent` reads only type, schemaVersion, rngCounter and payload, and
    // GameEvent is DraftEvent plus its position fields, so the event goes
    // straight in. A hand-rolled projection here would be a second encoding of
    // "what gets hashed" — and forgetting to update it after adding a hashed
    // field would make every honest chain start failing verification.
    const recomputed = hashEvent(event, event.parent, event.seq);
    if (recomputed !== event.id) {
      return { seq: event.seq, eventId: event.id, reason: `hash mismatch, recomputed ${recomputed}` };
    }

    // Reject unreducible events *before* apply sees them. An alien type hashes
    // perfectly well — hashing proves integrity, never intelligibility.
    const version = known[event.type];
    if (version === undefined) {
      return { seq: event.seq, eventId: event.id, reason: `unknown event type ${String(event.type)}` };
    }
    if (event.schemaVersion !== version) {
      return {
        seq: event.seq,
        eventId: event.id,
        reason: `${event.type} is schemaVersion ${event.schemaVersion}, this engine implements ${version}`,
      };
    }

    if (event.seq !== expectedSeq) {
      return { seq: event.seq, eventId: event.id, reason: `sequence gap: expected seq ${expectedSeq}` };
    }
    expectedSeq += 1;

    // WORLD_INIT opens a new counter epoch: a fresh floor draws from a fresh
    // seed, addressed from zero, and both the generator and `apply` already
    // treat it so. Demanding continuity across the stairs refused every saved
    // run that had ever descended — found by a player losing a session to
    // "diverges at seq 120", where seq 120 was floor 2 being born.
    if (event.type !== 'WORLD_INIT' && state.rngCounter !== event.rngCounter) {
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
