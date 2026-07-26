import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { createWorld, ratifyRule } from '../src/core/commands.js';
import { autoplay } from '../src/play/autoplay.js';
import { POLICIES } from '../src/play/policies.js';
import { readTheGame } from '../src/critic/critic.js';
import { summariseRun } from '../src/canon/rulesmith.js';
import { validateRule, isRejected, readRule } from '../src/canon/rule.js';
import { assayRule } from '../src/assay/ruleAssay.js';
import { readNote } from '../src/channels/channels.js';
import type { Position } from '../src/play/session.js';
import type { Note } from '../src/channels/channels.js';
import type { Rule } from '../src/canon/rule.js';

/**
 * The whole evolution loop, one command, no browser:
 *
 *   play a baseline → summarise it → get a proposal → put it on trial →
 *   ratify what survives → play again → measure what changed.
 *
 *   npm run loop -- --seed 7                  (asks the dev server's oracle)
 *   npm run loop -- --seed 7 --rule r.json    (offline: trial a rule you wrote)
 *
 * This is the tool that lets any agent be the whole table: player, rulesmith,
 * assayer and critic in one sitting, with the verdicts in JSON and the full
 * report written to runs/loops/. The propose step needs the dev server for a
 * real model; --rule skips it, which is also how the loop tests itself.
 */

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1]! : fallback;
}

const seed = Number(arg('seed', '7'));
const rulePath = arg('rule', '');
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');

function world(rules: Rule[]): Position {
  const born = append(emptyLog(), null, createWorld(seed, 24, 16, 60));
  let position: Position = { log: born.log, head: born.event.id };
  for (const rule of rules) {
    const done = append(position.log, position.head, ratifyRule(fold(position.log, position.head), rule));
    position = { log: done.log, head: done.event.id };
  }
  return position;
}

interface Sweep {
  policy: string;
  ended: string;
  actions: number;
  hpLeft: number;
  firings: number;
  interest: string;
  deadAir: number;
}

function sweep(rules: Rule[]): Sweep[] {
  const rows: Sweep[] = [];
  for (const [name, policy] of Object.entries(POLICIES)) {
    const done = autoplay(world(rules), policy, 600);
    const report = readTheGame(done.position.log, done.position.head);
    const interest = report.readings.find((r) => r.lens === 61);
    const flattest = /flattest run (\d+)/u.exec(interest?.confidence ?? '');
    rows.push({
      policy: name,
      ended: done.ended,
      actions: done.actions,
      hpLeft: done.state.entities.find((e) => e.id === 'player')?.stats.hp ?? 0,
      firings: chain(done.position.log, done.position.head).filter((e) => e.type === 'RULE_FIRED').length,
      interest: interest?.figure ?? '—',
      deadAir: flattest === null ? 0 : Number(flattest[1]),
    });
  }
  return rows;
}

function notesFromDisk(): Note[] {
  if (!existsSync('runs/notes.jsonl')) return [];
  return readFileSync('runs/notes.jsonl', 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => readNote(JSON.parse(line)));
}

async function propose(baseline: Position): Promise<unknown> {
  const state = fold(baseline.log, baseline.head);
  const run = summariseRun(chain(baseline.log, baseline.head), state, notesFromDisk(), 'loop');
  const response = await fetch('http://localhost:5173/__oracle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'propose', subject: `loop:${String(seed)}`, context: { run } }),
  });
  if (!response.ok) throw new Error(`oracle ${String(response.status)}`);
  const answered = (await response.json()) as { data?: unknown };
  return answered.data;
}

const report: string[] = [];
const say = (line: string): void => { report.push(line); console.log(line); };

function finish(code: number): never {
  mkdirSync('runs/loops', { recursive: true });
  const path = `runs/loops/${stamp}.md`;
  writeFileSync(path, `${report.join('\n')}\n`, 'utf8');
  console.log(`\nreport: ${path}`);
  process.exit(code);
}

// ── 1. baseline ──────────────────────────────────────────────────────────
say(`# Loop — seed ${String(seed)}, ${stamp}`);
say('\n## Baseline (no rules)');
const before = sweep([]);
for (const r of before) say(`- ${r.policy}: ${r.ended} in ${String(r.actions)} actions, hp ${String(r.hpLeft)}, dead-air ${String(r.deadAir)}`);

// ── 2. a proposal, from the model or from a file ─────────────────────────
let rawRule: unknown;
if (rulePath !== '') {
  rawRule = JSON.parse(readFileSync(rulePath, 'utf8'));
} else {
  try {
    rawRule = await propose(autoplay(world([]), POLICIES['brawler']!, 600).position);
  } catch (error) {
    say(`\nproposal failed: ${String(error).slice(0, 120)} — is the dev server up?`);
    finish(1);
  }
}

// ── 3. the trial ─────────────────────────────────────────────────────────
const stamped = { id: 'rule-1', ratifiedAt: new Date().toISOString(), ...(rawRule as Record<string, unknown>) };
const checked = validateRule(stamped);
if (isRejected(checked)) {
  say(`\n## Refused before trial\n${checked.rejected}`);
  // The raw reply, so a reader can tell a flaky model from a broken plugin.
  say(`raw: ${JSON.stringify(rawRule).slice(0, 300)}`);
  finish(2);
}
const rule: Rule = checked;
const assay = assayRule(rule);
say(`\n## The candidate\n${readRule(rule)}`);
say(`because: ${rule.provenance.because}`);
say(`\n## The trial\nverdict: ${assay.verdict}`);
for (const f of assay.findings) say(`- ${f}`);

if (assay.verdict === 'refused') {
  say('\nRefused. The world does not change.');
  finish(2);
}

// ── 4. play under the rule, measure the difference ───────────────────────
say('\n## Under the rule');
const after = sweep([rule]);
for (const r of after) {
  const was = before.find((b) => b.policy === r.policy);
  const delta = was === undefined ? '' :
    ` (was ${was.ended}, hp ${String(was.hpLeft)}, dead-air ${String(was.deadAir)})`;
  say(`- ${r.policy}: ${r.ended} in ${String(r.actions)} actions, hp ${String(r.hpLeft)}, fired ${String(r.firings)}, dead-air ${String(r.deadAir)}${delta}`);
}

say('\n## Judgment material');
say('Compare outcomes and dead-air above. A sound rule should move at least one');
say('policy\'s experience without flipping any outcome to unloseable or unwinnable.');
finish(0);
