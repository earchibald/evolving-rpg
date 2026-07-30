import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { createWorld, outcome } from '../src/core/commands.js';
import { autoplay } from '../src/play/autoplay.js';
import { POLICIES } from '../src/play/policies.js';
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

// Driven by a policy rather than a fixed key script. Rooms-and-corridors
// killed the scripted walker: a fixed pattern grinds the walls of its first
// room and never finds a door — probed across 140 seed/script pairs, not one
// produced a fight. The brawler tours the map, fights everything, takes
// prizes and leaves: every subsystem in one recorded run. The policy's code
// is part of the input now, which is wanted — a behaviour change in pathing
// or combat turns the golden red, and regenerating past it is the ceremony
// above.
//
// Seed hand-picked by probe (re-picked when the secret-room roll shifted the
// stream, again when the verbs and the provision draw reshaped it, and again
// when the exit's distance bands added two draws to every floor's generation):
// 28 strikes, two crits, three lunges on record, an item equipped, all three
// creatures dead on the ground, escapes — 451 events. A golden fixture that
// never fights leaves the newest and riskiest code untouched by the strongest
// test in the repo, and the old seed-15 run had stopped killing anything.
const SEED = 17;
const WIDTH = 48;
const HEIGHT = 32;
const POLICY = 'brawler';
const MAX_ACTIONS = 220;

const first = append(emptyLog(), null, createWorld(SEED, WIDTH, HEIGHT));

const done = autoplay({ log: first.log, head: first.event.id }, POLICIES[POLICY]!, MAX_ACTIONS);
const head = done.position.head;
const log = done.position.log;

const finalState = fold(log, head);
const ended = outcome(finalState);
const fixture = {
  note: 'Generated once and committed. Never regenerate to make a failing test pass.',
  engineVersion: ENGINE_VERSION,
  seed: SEED,
  width: WIDTH,
  height: HEIGHT,
  policy: POLICY,
  maxActions: MAX_ACTIONS,
  actions: done.actions,
  outcome: ended,
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
console.log(`actions: ${fixture.actions}, outcome: ${ended}`);
console.log(`head: ${head}`);
console.log(`finalStateHash: ${fixture.finalStateHash}`);
