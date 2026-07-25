import { chain } from './chain.js';
import type { EventLog } from './chain.js';
import { ENGINE_VERSION } from '../version.js';

/** `readonly` throughout: `createRef` and `setHead` copy the Map but share every
 *  Ref they are not touching, so an in-place write would silently corrupt every
 *  other snapshot holding that same object. Fields are all primitives, so
 *  readonly closes it completely — no freeze traversal needed. */
export interface Ref {
  readonly name: string;
  readonly head: string | null;
  readonly engineVersion: string;
  readonly createdAtSeq: number;
  readonly note: string;
}

export interface Refs {
  byName: Map<string, Ref>;
}

export function emptyRefs(): Refs {
  return { byName: new Map() };
}

export function createRef(
  refs: Refs,
  name: string,
  head: string | null,
  createdAtSeq: number,
  note: string,
): Refs {
  if (refs.byName.has(name)) throw new Error(`createRef: ref ${name} already exists`);
  const byName = new Map(refs.byName);
  byName.set(name, { name, head, engineVersion: ENGINE_VERSION, createdAtSeq, note });
  return { byName };
}

export function getRef(refs: Refs, name: string): Ref {
  const ref = refs.byName.get(name);
  if (ref === undefined) throw new Error(`getRef: unknown ref ${name}`);
  return ref;
}

export function setHead(refs: Refs, name: string, head: string | null): Refs {
  const ref = getRef(refs, name);
  const byName = new Map(refs.byName);
  byName.set(name, { ...ref, head });
  return { byName };
}

/** True when `candidate` lies on the chain ending at `head`, head included. */
export function isAncestor(log: EventLog, head: string | null, candidate: string): boolean {
  if (head === null) return false;
  return chain(log, head).some((e) => e.id === candidate);
}

/**
 * A fork is a new name pointing at a hash that already exists. Nothing is
 * copied — both worlds share every event up to the fork point.
 */
export function fork(
  log: EventLog,
  refs: Refs,
  fromName: string,
  newName: string,
  atHash: string | null,
  note: string,
): Refs {
  const source = getRef(refs, fromName);
  if (refs.byName.has(newName)) throw new Error(`fork: ref ${newName} already exists`);

  const at = atHash ?? source.head;
  if (at !== null && !isAncestor(log, source.head, at)) {
    throw new Error(`fork: ${at} is not on the chain of ${fromName}`);
  }

  const seq = at === null ? 0 : chain(log, at).length - 1;
  return createRef(refs, newName, at, seq, note);
}

/**
 * Moves a ref backwards along its own chain. Non-destructive: the abandoned
 * events stay in the log, so the reset can itself be undone.
 */
export function reset(log: EventLog, refs: Refs, name: string, toHash: string | null): Refs {
  const ref = getRef(refs, name);
  if (toHash !== null && !isAncestor(log, ref.head, toHash)) {
    throw new Error(`reset: ${toHash} is not on the chain of ${name}`);
  }
  return setHead(refs, name, toHash);
}

export function listRefs(refs: Refs): Ref[] {
  return [...refs.byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
