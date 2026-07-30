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
import {
  damageDice, neededToHit, chanceIn20, critFloor, threatOf, creatureStats,
  xpToReach, levelForXp, growthAt, sizeStretch, bountyStretch,
  BESTIARY, VERB_THREAT, MOTIFS,
} from '../src/core/tables.js';
import { generateMap } from '../src/core/mapgen.js';
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

/** An inclusive integer range. Every domain grid below is built from this
 *  rather than hand-typed, so a domain is a fact about the function under
 *  test, not a transcription exercise someone can get subtly wrong. */
function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

/** JSON.stringify silently turns NaN/±Infinity into `null` — which would be
 *  indistinguishable from a deliberate undefined-return row (creatureStats,
 *  xpToReach) once written. Walk the dump BEFORE serializing and refuse to
 *  let that happen by accident. */
function assertFinite(path: string, value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`non-finite number at ${path}: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(`${path}[${i}]`, v));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFinite(`${path}.${k}`, v);
  }
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

// tables: every exported numeric function in src/core/tables.ts, dumped over
// its whole meaningful domain, plus BESTIARY, VERB_THREAT and MOTIFS dumped
// verbatim — the two later tasks this unblocks (2.B3 ports tables.ts, 2.D1
// ports mapgen.ts) diff their GDScript against these rather than retyping
// the reference and hoping. Two conventions, local to this one file, and
// NEITHER is the ABSENT-KEY LAW (which governs state dictionaries only):
//   - `args` is the exact positional list GDScript's Callable.callv(args)
//     would take. threatOf's `kind` is the only optional argument any of
//     these take; omitting it is spelled `null`, since no listed function
//     ever legitimately RECEIVES a null argument.
//   - `value` is the return. A JS `undefined` return (xpToReach past the
//     ladder, creatureStats for an unknown kind) is spelled `null` too,
//     since no listed function ever legitimately RETURNS null either.
const MIGHT_DOMAIN = [-5, -1, ...range(0, 20)]; // negatives probe the Math.max(0,…) guards
const WITS_DOMAIN = [-5, -1, ...range(0, 20)];
const KIND_LEVEL_DOMAIN = BESTIARY.flatMap((a) => range(1, 10).map((level) => ({ kind: a.kind, level })));

const damageDiceRows = MIGHT_DOMAIN.map((might) => ({ args: [might], value: damageDice(might) }));

const neededToHitRows = range(0, 20).flatMap((might) =>
  range(0, 20).map((speed) => ({ args: [might, speed], value: neededToHit(might, speed) })),
);

const chanceIn20Rows = range(-5, 25).map((needed) => ({ args: [needed], value: chanceIn20(needed) }));

const critFloorRows = WITS_DOMAIN.map((wits) => ({ args: [wits], value: critFloor(wits) }));

// threatOf: the verb multiplier is THE thing this table prices — unpriced
// verbs once collapsed depth-5 survival from a pinned [1,10]/20 to 0/20
// (VERB_THREAT's own docstring). So every bestiary kind at every level is
// dumped BOTH priced (kind passed) and unpriced (kind omitted, args[1] =
// null) against the IDENTICAL stats — the gap between the two rows for the
// same (kind, level) is the multiplier, made a fact in the fixture instead
// of a claim in a comment. A third pass confirms an unmapped kind string
// prices exactly like no kind at all (verbOf(kind) misses the VERBS table
// either way).
const threatPriced = KIND_LEVEL_DOMAIN.map(({ kind, level }) => {
  const stats = creatureStats(kind, level)!;
  return { args: [stats, kind], value: threatOf(stats, kind) };
});
const threatUnpriced = KIND_LEVEL_DOMAIN.map(({ kind, level }) => {
  const stats = creatureStats(kind, level)!;
  return { args: [stats, null], value: threatOf(stats) };
});
const threatUnmappedKind = BESTIARY.map((a) => {
  const stats = creatureStats(a.kind, 1)!;
  return { args: [stats, 'gremlin'], value: threatOf(stats, 'gremlin') };
});
const threatOfRows = [...threatPriced, ...threatUnpriced, ...threatUnmappedKind];

// creatureStats: every kind at levels 1-10, plus the two edge shapes a JSON
// dump cannot leave implicit — an unknown kind (undefined, spelled null)
// and a level below 1 (clamped up to level 1 by Math.max(1, floor(l))).
const creatureStatsRows = [
  ...KIND_LEVEL_DOMAIN.map(({ kind, level }) => ({ args: [kind, level], value: creatureStats(kind, level) ?? null })),
  ...[1, 5].map((level) => ({ args: ['gremlin', level], value: creatureStats('gremlin', level) ?? null })),
  ...[0, -3].map((level) => ({ args: ['skirmisher', level], value: creatureStats('skirmisher', level) ?? null })),
];

// xpToReach / levelForXp: `stretch` here is never bountyStretch's OWN
// output. Every real caller (apply.ts, commands.ts, ui/debug.ts) passes
// sizeStretch(width, height) straight through, and xpToReach computes
// bountyStretch internally — so the meaningful stretch domain is exactly
// {1, 2, 3}: sizeStretch's own output for the vale, the expanse, the waste.
const REAL_STRETCHES = [1, 2, 3];

const xpToReachRows = range(-1, 12).flatMap((level) =>
  REAL_STRETCHES.map((stretch) => ({ args: [level, stretch], value: xpToReach(level, stretch) ?? null })),
);

// Probe points are DERIVED from the real thresholds (xpToReach itself)
// rather than hand-computed, so a transcription slip here can't fake a
// passing fixture: one xp below, at, and above every level's threshold,
// plus the floor and a value past the whole ladder.
const levelForXpRows = REAL_STRETCHES.flatMap((stretch) => {
  const thresholds = range(0, 9).map((level) => xpToReach(level, stretch)!);
  const probes = new Set<number>([0, 9999]);
  for (const t of thresholds) { probes.add(t - 1); probes.add(t); probes.add(t + 1); }
  return [...probes].sort((a, b) => a - b).map((xp) => ({ args: [xp, stretch], value: levelForXp(xp, stretch) }));
});

const growthAtRows = [-1, ...range(0, 12)].map((level) => ({ args: [level], value: growthAt(level) }));

const sizeStretchRows = ([
  [48, 32], [96, 64], [128, 96], // the vale, the expanse, the waste — the three real boards
  [1, 1], [10, 10], [32, 32],    // "every tiny test board reads 1" per sizeStretch's own docstring
  [256, 256],                    // MAX_BOARD_DIM corner
] as const).map(([width, height]) => ({ args: [width, height], value: sizeStretch(width, height) }));

// bountyStretch: the only function on this list whose VALUE is genuinely
// non-integral. bountyStretch(2) === 1.5 on the expanse — a common porting
// slip is `(stretch + 1) / 2` under GDScript's int/int truncating division,
// which would silently return 1 instead. Rounding this away in the fixture
// would hide exactly the bug the row exists to catch, so it stays a real
// float — see the task report for how that interacts with FixtureLoader.
const bountyStretchRows = [-2, 0, 1, 2, 3, 4].map((stretch) => ({ args: [stretch], value: bountyStretch(stretch) }));

const tablesFixture = {
  damageDice: damageDiceRows,
  neededToHit: neededToHitRows,
  chanceIn20: chanceIn20Rows,
  critFloor: critFloorRows,
  threatOf: threatOfRows,
  creatureStats: creatureStatsRows,
  xpToReach: xpToReachRows,
  levelForXp: levelForXpRows,
  growthAt: growthAtRows,
  sizeStretch: sizeStretchRows,
  bountyStretch: bountyStretchRows,
  // Verbatim data, not sampled function rows: the bestiary, the verb pricing
  // table and the depth motifs are what the port must copy exactly rather
  // than retype and hope. mapgen.json's own cases were generated against
  // MOTIFS.door and need this table to mean anything once ported.
  bestiary: BESTIARY,
  verbThreat: VERB_THREAT,
  motifs: MOTIFS,
};
assertFinite('tables', tablesFixture);
writeFileSync(`${OUT}/tables.json`, JSON.stringify(tablesFixture, null, 2));
console.log(
  `tables.json: damageDice=${damageDiceRows.length} neededToHit=${neededToHitRows.length} ` +
  `chanceIn20=${chanceIn20Rows.length} critFloor=${critFloorRows.length} threatOf=${threatOfRows.length} ` +
  `creatureStats=${creatureStatsRows.length} xpToReach=${xpToReachRows.length} levelForXp=${levelForXpRows.length} ` +
  `growthAt=${growthAtRows.length} sizeStretch=${sizeStretchRows.length} bountyStretch=${bountyStretchRows.length} ` +
  `bestiary=${BESTIARY.length} verbThreat=${Object.keys(VERB_THREAT).length} motifs=${Object.keys(MOTIFS).length}`,
);

// mapgen: a full generateMap() result for every (seed, size) pair 2.D1 will
// replay. The fact that matters most is counterAfter — generation spends
// COUNTED randomness and a REJECTED draw (an overlapping room, a bad exit
// band) still advances the counter, so a port that spends a different
// number of draws anywhere builds a different world from the same seed and
// every downstream test diverges silently from there on. MapGenResult
// carries that counter itself (mapgen.ts's own return type), so it is
// dumped verbatim rather than reconstructed — `counterAfter - counterIn` is
// exactly how many draws 2.D1's port must also spend, no more, no fewer, to
// stay on the same stream as the reference.
const MAPGEN_TILE_CONSTANTS = { FLOOR: 0, WALL: 1, EXIT: 2, SECRET: 3 };
const MAPGEN_SEEDS = [17, 99, 12345];
const MAPGEN_SIZES = [[48, 32], [96, 64]] as const;

const mapgenCases = MAPGEN_SEEDS.flatMap((seed) =>
  MAPGEN_SIZES.map(([width, height]) => {
    const counterIn = 0;
    const result = generateMap(seed, counterIn, width, height, MOTIFS.door);
    if (result.grid.tiles.length !== width * height) {
      throw new Error(
        `mapgen.json: seed ${seed} ${width}x${height} produced ${result.grid.tiles.length} tiles, expected ${width * height}`,
      );
    }
    return {
      seed,
      width,
      height,
      counterIn,
      drawsConsumed: result.counterAfter - counterIn,
      result: {
        grid: result.grid,
        start: result.start,
        rooms: result.rooms,
        counterAfter: result.counterAfter,
        story: result.story,
      },
    };
  }),
);

const mapgenFixture = {
  tileConstants: MAPGEN_TILE_CONSTANTS,
  // The motif actually used for every case below (generateMap's own default
  // parameter). Duplicated here rather than left as a cross-reference into
  // tables.json's `motifs.door` so this one file is enough on its own to
  // replay every case — the whole point of writing down an interface is
  // that nobody has to go find the other half of it.
  defaultMotif: MOTIFS.door,
  cases: mapgenCases,
};
assertFinite('mapgen', mapgenFixture);
writeFileSync(`${OUT}/mapgen.json`, JSON.stringify(mapgenFixture, null, 2));
console.log(`mapgen.json: ${mapgenCases.length} cases`);
for (const c of mapgenCases) {
  console.log(`  seed ${c.seed} ${c.width}x${c.height}: ${c.result.grid.tiles.length} tiles, ${c.drawsConsumed} draws, "${c.result.story}"`);
}

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
