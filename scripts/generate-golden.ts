import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../src/core/commands.js';
import { canonicalJson } from '../src/log/canonical.js';
import { ENGINE_VERSION } from '../src/version.js';

const SEED = 12345;
const WIDTH = 24;
const HEIGHT = 16;
const WALLS = 60;

/** Fixed, hand-written input script — 100 steps. Not generated, so it never drifts. */
const SCRIPT = 'NNEESSWWNESWNNWWSSEE'.repeat(5);

const STEPS: Record<string, readonly [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
};

let log = emptyLog();
const first = append(log, null, createWorld(SEED, WIDTH, HEIGHT, WALLS));
log = first.log;
let head = first.event.id;

for (const key of SCRIPT) {
  const step = STEPS[key];
  if (step === undefined) throw new Error(`bad script character ${key}`);
  const moved = append(log, head, attemptMove(fold(log, head), 'player', step[0], step[1]));
  log = moved.log;
  head = moved.event.id;

  const turned = append(log, head, advanceTurn(fold(log, head)));
  log = turned.log;
  head = turned.event.id;
}

const finalState = fold(log, head);
const fixture = {
  note: 'Generated once and committed. Never regenerate to make a failing test pass.',
  engineVersion: ENGINE_VERSION,
  seed: SEED,
  width: WIDTH,
  height: HEIGHT,
  walls: WALLS,
  script: SCRIPT,
  head,
  finalStateHash: bytesToHex(sha256(new TextEncoder().encode(canonicalJson(finalState)))),
  events: chain(log, head),
};

// fileURLToPath rather than import.meta.dirname, which needs Node 20.11+.
const out = fileURLToPath(new URL('../tests/fixtures/golden-run.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

console.log(`wrote ${out}`);
console.log(`events: ${fixture.events.length}`);
console.log(`head: ${head}`);
console.log(`finalStateHash: ${fixture.finalStateHash}`);
