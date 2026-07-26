import { readFileSync } from 'node:fs';
import { emptyLog, append, chain } from '../src/log/chain.js';
import { createWorld } from '../src/core/commands.js';
import { autoplay } from '../src/play/autoplay.js';
import { POLICIES } from '../src/play/policies.js';
import { beginAgain } from '../src/play/session.js';
import { readTheGame } from '../src/critic/critic.js';
import { deserialise } from '../src/play/store.js';
import type { Position } from '../src/play/session.js';
import type { Saved } from '../src/play/store.js';

/**
 * Plays the game, structured and repeatable, for anyone — human at a shell or
 * agent behind one.
 *
 *   npm run play -- --policy rusher --seeds 20
 *   npm run play -- --policy all --seeds 12 --json
 *   npm run play -- --world runs/latest.json --policy all
 *
 * `--world` starts from a saved chronicle: the active world begins again with
 * its ratified rules in force, so what gets played is the game as it actually
 * stands, not a bare board. Output is a table for people or JSON for agents;
 * the JSON is the contract, and the playtester persona reads nothing else.
 */

interface RunReport {
  seed: number | string;
  ended: string;
  actions: number;
  hpLeft: number;
  strikes: number;
  ruleFirings: number;
  surprise: string;
  interest: string;
  peakAt: number;
  deadAir: number;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1]! : fallback;
}
const wantsJson = process.argv.includes('--json');

function freshWorld(seed: number): Position {
  const born = append(emptyLog(), null, createWorld(seed, 24, 16, 60));
  return { log: born.log, head: born.event.id };
}

function savedWorld(path: string): Position {
  const saved = JSON.parse(readFileSync(path, 'utf8')) as Saved;
  const restored = deserialise(saved);
  const begun = beginAgain(restored.log, restored.refs, restored.active);
  const head = begun.refs.byName.get(restored.active)?.head ?? null;
  if (head === null) throw new Error(`world "${restored.active}" has no head`);
  return { log: begun.log, head };
}

function playOne(start: Position, policyName: string, seed: number | string): RunReport {
  const policy = POLICIES[policyName];
  if (policy === undefined) throw new Error(`no policy "${policyName}" — have: ${Object.keys(POLICIES).join(', ')}`);

  const done = autoplay(start, policy, 600);
  const report = readTheGame(done.position.log, done.position.head);
  const surprise = report.readings.find((r) => r.lens === 2);
  const interest = report.readings.find((r) => r.lens === 61);
  const you = done.state.entities.find((e) => e.id === 'player');

  const events = chain(done.position.log, done.position.head);
  const flattest = /flattest run (\d+)/u.exec(interest?.confidence ?? '');
  const peak = /peak at (\d+)%/u.exec(interest?.confidence ?? '');

  return {
    seed,
    ended: done.ended,
    actions: done.actions,
    hpLeft: you?.stats.hp ?? 0,
    strikes: events.filter((e) => e.type === 'STRIKE').length,
    ruleFirings: events.filter((e) => e.type === 'RULE_FIRED').length,
    surprise: surprise?.figure ?? '—',
    interest: interest?.figure ?? '—',
    peakAt: peak === null ? -1 : Number(peak[1]),
    deadAir: flattest === null ? -1 : Number(flattest[1]),
  };
}

const policyArg = arg('policy', 'rusher');
const seeds = Number(arg('seeds', '10'));
const worldPath = arg('world', '');

const policies = policyArg === 'all' ? Object.keys(POLICIES) : [policyArg];
const out: Record<string, { runs: RunReport[]; escaped: number; dead: number; playing: number }> = {};

for (const name of policies) {
  const runs: RunReport[] = [];
  if (worldPath !== '') {
    runs.push(playOne(savedWorld(worldPath), name, `saved:${worldPath}`));
  } else {
    for (let seed = 1; seed <= seeds; seed += 1) runs.push(playOne(freshWorld(seed), name, seed));
  }
  out[name] = {
    runs,
    escaped: runs.filter((r) => r.ended === 'escaped').length,
    dead: runs.filter((r) => r.ended === 'dead').length,
    playing: runs.filter((r) => r.ended === 'playing').length,
  };
}

if (wantsJson) {
  console.log(JSON.stringify({ policies: out }, null, 1));
} else {
  for (const [name, r] of Object.entries(out)) {
    console.log(`\n${name}: ${String(r.escaped)} escaped, ${String(r.dead)} dead, ${String(r.playing)} still going of ${String(r.runs.length)}`);
    const mean = (f: (x: RunReport) => number): string =>
      (r.runs.reduce((a, x) => a + f(x), 0) / Math.max(r.runs.length, 1)).toFixed(1);
    console.log(`   mean actions ${mean((x) => x.actions)}, hp left ${mean((x) => x.hpLeft)}, strikes ${mean((x) => x.strikes)}, rule firings ${mean((x) => x.ruleFirings)}, dead-air ${mean((x) => Math.max(0, x.deadAir))}`);
  }
}
