import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalJson } from './canonical.js';
import type { DraftEvent } from '../core/events.js';

/** Identity is content plus position: same event at a different point in the
 *  chain is a different event. */
export function hashEvent(draft: DraftEvent, parent: string | null, seq: number): string {
  const material = canonicalJson({
    type: draft.type,
    schemaVersion: draft.schemaVersion,
    rngCounter: draft.rngCounter,
    payload: draft.payload,
    parent,
    seq,
  });
  return bytesToHex(sha256(new TextEncoder().encode(material)));
}
