import { SCHEMA_VERSIONS } from '../core/events.js';
import type { DraftEvent } from '../core/events.js';
import { emptyLog, append } from './chain.js';
import type { EventLog } from './chain.js';

/**
 * The shape of an event as written by the v1 engine, before the draw protocol
 * moved randomness accounting onto the envelope. Deliberately loose: this is
 * data read off disk, so nothing here may assume the type system vouched for it.
 */
interface RawEvent {
  type?: unknown;
  schemaVersion?: unknown;
  rngCounter?: unknown;
  rngDraws?: unknown;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converts one v1 event to the current shape.
 *
 * v1 accounted for randomness in exactly one place: `WORLD_INIT.payload.counterAfter`.
 * Because generation always began at counter 0, that number *is* the draw count,
 * which is what makes this migration lossless. Every other v1 event consumed
 * nothing, so it declares zero draws — explicitly, where v1 said it by omission.
 */
export function upcastEvent(raw: unknown): DraftEvent {
  if (!isRecord(raw)) throw new Error('upcastEvent: not an object');

  const event = raw as RawEvent;
  const type = event.type;
  const version = event.schemaVersion;

  if (typeof type !== 'string') throw new Error('upcastEvent: missing type');
  if (typeof version !== 'number') throw new Error(`upcastEvent: ${type} has no schemaVersion`);
  if (!isRecord(event.payload)) throw new Error(`upcastEvent: ${type} has no payload`);
  if (typeof event.rngCounter !== 'number') throw new Error(`upcastEvent: ${type} has no rngCounter`);

  const current = (SCHEMA_VERSIONS as Record<string, number>)[type];
  if (current === undefined) throw new Error(`upcastEvent: unknown event type ${type}`);
  if (version > current) {
    throw new Error(
      `upcastEvent: ${type} is schemaVersion ${version}, newer than this engine's ${current} — ` +
        'a log from the future cannot be downcast',
    );
  }
  if (version === current) return raw as DraftEvent;

  if (version !== 1) throw new Error(`upcastEvent: no upcaster from ${type} v${version}`);

  if (type === 'WORLD_INIT') {
    const { counterAfter, ...rest } = event.payload as { counterAfter?: unknown };
    if (typeof counterAfter !== 'number') {
      throw new Error('upcastEvent: WORLD_INIT v1 has no counterAfter to derive draws from');
    }
    return {
      type: 'WORLD_INIT',
      schemaVersion: current,
      rngCounter: event.rngCounter,
      rngDraws: counterAfter - event.rngCounter,
      payload: rest,
    } as DraftEvent;
  }

  // Cast through unknown: the payload came off disk as a Record, and narrowing
  // it per type here would duplicate the validation verifyChain already does
  // properly. Upcasting produces a candidate; verifyChain decides whether it is
  // an event.
  return {
    type,
    schemaVersion: current,
    rngCounter: event.rngCounter,
    rngDraws: 0,
    payload: event.payload,
  } as unknown as DraftEvent;
}

/**
 * Upcasts a whole recorded chain and rebuilds it.
 *
 * Upcasting changes an event's content, and identity here is a hash of content
 * *plus position* — so the ids necessarily change, and the chain is rebuilt by
 * re-appending rather than patched in place. What a migration can honestly
 * promise is not that ids survive but that **meaning** does: the upcast chain
 * folds to the same state the original folded to under the engine that wrote
 * it. That is the invariant worth testing, and the one this returns evidence for.
 *
 * Events must arrive root-first, which is the order `chain()` produces and the
 * order the golden fixture stores.
 */
export function upcastChain(rawEvents: readonly unknown[]): { log: EventLog; head: string | null } {
  let log = emptyLog();
  let head: string | null = null;

  for (const raw of rawEvents) {
    const appended = append(log, head, upcastEvent(raw));
    log = appended.log;
    head = appended.event.id;
  }

  return { log, head };
}
