import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { createWorld } from '../src/core/commands.js';
import { playerStep, runWorldTurns } from '../src/play/session.js';
import { canonicalJson } from '../src/log/canonical.js';
import { ENGINE_VERSION } from '../src/version.js';

// A red golden-replay test means a real regression, or a deliberate behaviour
// change needing a schemaVersion bump and an upcaster. It does not mean the
// fixture is stale. Regenerating is the one action that silently destroys the
// guarantee this whole project rests on, and it was previously a single
// frictionless command — so it now requires saying so out loud.
if (process.env.ALLOW_GOLDEN_REGEN !== '1') {
  console.error(
    'Refusing to regenerate tests/fixtures/golden-run.json.\n\n' +
      'If the golden test is failing, diagnose the regression — do not replace\n' +
      'the fixture. If you genuinely intend to replace it, and have bumped the\n' +
      'affected schemaVersion and written any upcaster needed:\n\n' +
      '  ALLOW_GOLDEN_REGEN=1 npm run golden\n',
  );
  process.exit(1);
}

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

  // A real playthrough, not just a walk: the world takes its turns too, so the
  // recorded run exercises the AI, combat, and a draw count that actually
  // varies. A golden fixture that never fights would leave the newest and
  // riskiest code untouched by the strongest test in the repo.
  const acted = playerStep({ log, head }, 'player', step[0], step[1]);
  void acted.draft;
  const after = runWorldTurns(acted.position, 'player');
  log = after.log;
  head = after.head;
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
