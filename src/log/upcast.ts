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

  // WORLD_INIT has changed three times, so it walks the ladder a step at a
  // time rather than jumping. Each block is one version's worth of change, in
  // order, and the next one means adding a block rather than rewriting these.
  if (type === 'WORLD_INIT') {
    const payload = { ...event.payload };
    let rngDraws = typeof event.rngDraws === 'number' ? event.rngDraws : 0;

    if (version <= 1) {
      // v1 → v2: randomness accounting moved from the payload to the envelope.
      const counterAfter = payload.counterAfter;
      if (typeof counterAfter !== 'number') {
        throw new Error('upcastEvent: WORLD_INIT v1 has no counterAfter to derive draws from');
      }
      rngDraws = counterAfter - event.rngCounter;
      delete payload.counterAfter;
    }

    if (version <= 2) {
      // v2 → v3: a world arrives with its inhabitants. Worlds written before
      // that had none, and an empty list says so honestly — inventing
      // occupants for an old log would be fabricating history, not migrating it.
      payload.opponents = payload.opponents ?? [];
    }

    if (version <= 3) {
      // v3 → v4: worlds carry what is lying in them. Older ones carried
      // nothing, and an empty list says exactly that.
      payload.items = payload.items ?? [];
    }

    if (version <= 4) {
      // v4 → v5: worlds learned how deep they lie. Everything recorded before
      // depth existed was the first floor, which is simply true.
      payload.depth = payload.depth ?? 1;
    }

    if (version <= 5) {
      // v5 → v6: worlds carry their generation story. Old worlds were scatter
      // maps and never said so; an honest migration states that rather than
      // inventing an account after the fact.
      payload.story = payload.story ?? 'scattered walls (before rooms)';
    }

    // v6 → v7: worlds record the cut they were shaped to (payload.motif).
    // Older floors never said, and stay unsaid — absence folds to null and
    // `motifIs` reads it as false, rather than a migration inventing a shape
    // for floors cut before motifs existed. Nothing to rewrite.

    // v7 → v8: the satchel crosses the stairs (payload.playerSatchel), and
    // floors are born holding one provision. Old floors had neither; empty
    // hands and a bare floor are what absence already says. Nothing to
    // rewrite.

    return {
      type: 'WORLD_INIT',
      schemaVersion: current,
      rngCounter: event.rngCounter,
      rngDraws,
      payload,
    } as unknown as DraftEvent;
  }

  if (type === 'ITEM_TAKEN') {
    // v1 → v2: same shape, different meaning — items stack in v1 and equip
    // into slots in v2. The shape passes through; the version records that a
    // v1 log's folded stats may differ under this engine, which is the honest
    // limit of a semantic migration.
    //
    // v2 → v3: takes may ride in the satchel (payload.satchel). An old take
    // never did; absence already says so. Nothing to rewrite.
    return {
      type: 'ITEM_TAKEN',
      schemaVersion: current,
      rngCounter: event.rngCounter,
      rngDraws: typeof event.rngDraws === 'number' ? event.rngDraws : 0,
      payload: event.payload,
    } as unknown as DraftEvent;
  }

  if (type === 'STRIKE') {
    // v1 → v2: blows learned to be critical. Nothing recorded before crits
    // existed was one, and saying `false` outright is the honest migration —
    // reinterpreting an old natural 20 as a crit would change history's damage.
    //
    // v2 → v3: blows learned the verbs — a lunge's crossing, a trample's
    // shove, the ambush spring (all optional payload fields). Nothing to
    // rewrite: an old blow moved nobody, and absence already says so.
    const payload = { ...event.payload, crit: event.payload.crit ?? false };
    return {
      type: 'STRIKE',
      schemaVersion: current,
      rngCounter: event.rngCounter,
      rngDraws: typeof event.rngDraws === 'number' ? event.rngDraws : 0,
      payload,
    } as unknown as DraftEvent;
  }

  if (version !== 1) throw new Error(`upcastEvent: no upcaster from ${type} v${version}`);

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
