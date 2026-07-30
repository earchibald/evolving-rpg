// The reference engine writes its own examination paper.
//
// Dumps ground truth from the frozen TypeScript engine so the GDScript port can
// assert against it rather than against anyone's memory of what JS does. Run
// only from the `ts-baseline` tag (or a bugfix descendant of it); the output is
// COMMITTED and is never regenerated to make a failing GDScript test pass —
// a mismatch means the port is wrong, which is the entire point of the file.
//
// Written for the Godot migration: docs/superpowers/specs/2026-07-29-godot-migration-spec.md
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { u32, intBetween } from '../src/core/rng.js';
import { canonicalJson } from '../src/log/canonical.js';
import { hashEvent } from '../src/log/hash.js';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { EMPTY_STATE } from '../src/core/state.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { DraftEvent } from '../src/core/events.js';
import type { EventLog } from '../src/log/chain.js';

const OUT = 'godot/test/fixtures';
mkdirSync(OUT, { recursive: true });

/** The golden fixture's state-hash recipe, exactly as scripts/generate-golden.ts
 *  spells it: sha256 over the canonical bytes of the whole state object. */
function hashHex(material: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(material)));
}

// rng: a grid over 32-bit edge seeds and representative counters. The negative
// seeds are the ones that matter — JS `| 0` reads the pattern signed, and a
// 64-bit language that forgets to mask will disagree there and nowhere else.
const u32Rows: { seed: number; counter: number; u32: number }[] = [];
for (const seed of [0, 1, 17, 123456789, -5, 2147483647, -2147483648]) {
  for (const counter of [0, 1, 2, 3, 10, 100, 1000, 65535, 1000000]) {
    u32Rows.push({ seed, counter, u32: u32(seed, counter) });
  }
}
const intRows: { seed: number; counter: number; min: number; max: number; value: number }[] = [];
for (const [min, max] of [[1, 6], [0, 0], [5, 300], [-3, 3]] as const) {
  for (const counter of [0, 7, 99]) {
    intRows.push({ seed: 17, counter, min, max, value: intBetween(17, counter, min, max) });
  }
}
writeFileSync(`${OUT}/rng.json`, JSON.stringify({ u32: u32Rows, intBetween: intRows }, null, 2));

// canonical: [input, expected] pairs. Inputs must survive a JSON round-trip, so
// `undefined`-dropping is asserted TS-side only (see tests/log/canonical.test.ts);
// the GDScript convention for it is "omit the key entirely".
const canonicalCases: unknown[] = [
  null, true, false, 0, -7, 2, 4294967295,
  'two', 'quote " back \\ slash \n newline',
  [], [1, 'two', null, [2]],
  {}, { b: [1, 'two', null], a: { z: true, m: 2 } },
  { Z: 2, a: 1 },          // sort is code-point order: "Z" (90) before "a" (97)
  { keep: 1, drop: null }, // null survives; only undefined is dropped
];
writeFileSync(
  `${OUT}/canonical.json`,
  JSON.stringify(canonicalCases.map((input) => ({ input, expected: canonicalJson(input) })), null, 2),
);

// hashes: hashEvent reads only {type, schemaVersion, rngCounter, payload} plus
// (parent, seq) — payload shape is opaque to it, so synthetic payloads are fine.
// Identity is content PLUS position: the same draft at a different seq is a
// different event, which is what the second case pins.
const hashCases = [
  { draft: { type: 'WAIT', schemaVersion: 1, rngCounter: 3, payload: { entityId: 'p1' } }, parent: null as string | null, seq: 0 },
  { draft: { type: 'WAIT', schemaVersion: 1, rngCounter: 3, payload: { entityId: 'p1' } }, parent: 'abc123', seq: 4 },
  { draft: { type: 'MOVE', schemaVersion: 2, rngCounter: 0, payload: { entityId: 'p1', nested: { a: [1, 2], b: 'x' } } }, parent: null as string | null, seq: 0 },
];
writeFileSync(
  `${OUT}/hashes.json`,
  JSON.stringify(hashCases.map(({ draft, parent, seq }) => ({ draft, parent, seq, id: hashEvent(draft as unknown as DraftEvent, parent, seq) })), null, 2),
);

// state-shape: the exact GameState the golden chain folds to, plus the empty
// baseline. The Phase 2 fold gate hashes canonicalJson(state), so the GDScript
// state Dictionary has to match this object KEY FOR KEY — including which
// optional keys are ABSENT rather than null, since canonicalJson drops
// undefined. Dumping it makes that comparison mechanical: a fold-hash mismatch
// names the offending key instead of having to be bisected by hand.
const goldenRun = JSON.parse(readFileSync('tests/fixtures/golden-run.json', 'utf8')) as {
  events: DraftEvent[];
  head: string;
  finalStateHash: string;
};
let shapeLog: EventLog = emptyLog();
let shapeHead: string | null = null;
for (const draft of goldenRun.events) {
  const appended = append(shapeLog, shapeHead, draft);
  shapeLog = appended.log;
  shapeHead = appended.event.id;
}
const goldenFinal = fold(shapeLog, shapeHead);
writeFileSync(
  `${OUT}/state-shape.json`,
  JSON.stringify(
    {
      emptyState: EMPTY_STATE,
      emptyStateKeys: Object.keys(EMPTY_STATE).sort(),
      goldenFinal,
      goldenFinalKeys: Object.keys(goldenFinal).sort(),
      goldenChainLength: chain(shapeLog, shapeHead).length,
      goldenHead: shapeHead,
    },
    null,
    2,
  ),
);

// The dump is only useful if it IS the state the fixture recorded. Prove it here
// rather than trusting it downstream: a wrong oracle would send the GDScript
// port chasing a divergence that does not exist.
const rebuiltHash = hashHex(canonicalJson(goldenFinal));
if (rebuiltHash !== goldenRun.finalStateHash) {
  throw new Error(
    `state-shape dump does not reproduce finalStateHash\n` +
      `  recomputed ${rebuiltHash}\n  recorded   ${goldenRun.finalStateHash}`,
  );
}
if (shapeHead !== goldenRun.head) {
  throw new Error(`state-shape dump head ${shapeHead} is not the recorded ${goldenRun.head}`);
}
console.log(`state-shape verified: folds to ${rebuiltHash}, head ${shapeHead}`);

copyFileSync('tests/fixtures/golden-run.json', `${OUT}/golden-run.json`);
console.log(`fixtures written to ${OUT}`);
