import { emptyLog, append } from '../src/log/chain.js';
import { createWorld } from '../src/core/commands.js';
import { autoplay } from '../src/play/autoplay.js';
import { POLICIES } from '../src/play/policies.js';
import { descend } from '../src/play/session.js';
import { createRef, emptyRefs, getRef } from '../src/log/refs.js';
import { triangularityOf, freedomOf } from '../src/critic/ensemble.js';
import type { ApproachOutcomes } from '../src/critic/ensemble.js';
import type { Position } from '../src/play/session.js';
import type { Policy } from '../src/play/policies.js';

/**
 * The balance report: the whole game's shape in one command, including the two
 * lenses only an ensemble can answer.
 *
 *   npm run balance                 (20 seeds, depths 1 and 3)
 *   npm run balance -- --seeds 12 --floors 5 --json
 *
 * Deterministic end to end — same seeds, same report — so a change in this
 * output *is* a change in the game.
 */

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1]! : fallback;
}
const wantsJson = process.argv.includes('--json');
const seeds = Number(arg('seeds', '20'));
const floors = Number(arg('floors', '3'));
const DIMS = { width: 48, height: 32 };

function world(seed: number): Position {
  const born = append(emptyLog(), null, createWorld(seed, DIMS.width, DIMS.height));
  return { log: born.log, head: born.event.id };
}

function run(seed: number, policy: Policy, count: number): 'escaped' | 'dead' | 'playing' | 'won' {
  let done = autoplay(world(seed), policy, 1500);
  for (let floor = 2; floor <= count && done.ended === 'escaped'; floor += 1) {
    const refs = createRef(emptyRefs(), 'run', done.position.head, 0, 'balance');
    const down = descend(done.position.log, refs, 'run', DIMS);
    if (down === null) break;
    const head = getRef(down.refs, 'run').head;
    if (head === null) break;
    done = autoplay({ log: down.log, head }, policy, 1500);
  }
  return done.ended;
}

function sweep(depth: number): ApproachOutcomes[] {
  return Object.entries(POLICIES).map(([name, policy]) => {
    let escaped = 0; let dead = 0; let stalled = 0;
    // Progress to stderr as it grinds — a 90-second sweep with no output
    // reads as a hang, and covenant L1 applies to tools too. stdout stays
    // clean for --json consumers.
    process.stderr.write(`  sweeping ${name} to depth ${String(depth)} (${String(seeds)} seeds)…`);
    for (let seed = 1; seed <= seeds; seed += 1) {
      const ended = run(seed, policy, depth);
      if (ended === 'escaped') escaped += 1;
      else if (ended === 'dead') dead += 1;
      else stalled += 1;
    }
    process.stderr.write(` ${String(escaped)}e/${String(dead)}d/${String(stalled)}s\n`);
    return { approach: name, escaped, dead, stalled };
  });
}

const shallow = sweep(1);
const deep = sweep(floors);

const readings = {
  depth1: { approaches: shallow, triangularity: triangularityOf(shallow), freedom: freedomOf(shallow) },
  [`depth${String(floors)}`]: { approaches: deep, triangularity: triangularityOf(deep), freedom: freedomOf(deep) },
};

if (wantsJson) {
  console.log(JSON.stringify(readings, null, 1));
} else {
  for (const [label, r] of Object.entries(readings)) {
    console.log(`\n═══ ${label} (${String(seeds)} seeds) ═══`);
    for (const a of r.approaches) {
      console.log(`  ${a.approach.padEnd(9)} escaped ${String(a.escaped).padStart(2)}  dead ${String(a.dead).padStart(2)}  stalled ${String(a.stalled).padStart(2)}`);
    }
    console.log(`  #33 Triangularity ${r.triangularity.figure} — ${r.triangularity.verdict}`);
    console.log(`  #71 Freedom       ${r.freedom.figure} — ${r.freedom.verdict}`);
  }
}
