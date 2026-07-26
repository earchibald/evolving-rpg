import { validateRule, isRejected, readRule, MAX_RULES } from './rule.js';
import { notesFor } from '../channels/channels.js';
import { assayRule } from '../assay/ruleAssay.js';
import { outcome } from '../core/commands.js';
import { isAlive } from '../core/entity.js';
import type { Rule, Rejected } from './rule.js';
import type { Note } from '../channels/channels.js';
import type { Oracle } from '../oracle/oracle.js';
import type { GameEvent } from '../core/events.js';
import type { GameState } from '../core/state.js';
import { readTheGame } from '../critic/critic.js';
import type { EventLog } from '../log/chain.js';

/**
 * The Rulesmith: reads a run that has ended and drafts one rule.
 *
 * It is handed three kinds of evidence and treats them differently. The
 * *events* say what happened mechanically. The *designer notes* say what you
 * thought about it, out here, in your own voice. The *gamemaster exchanges*
 * say what you reached for in the fiction — and what you reach for that the
 * game cannot do is the sharpest signal there is about what is missing.
 *
 * Three rules govern this module.
 *
 * **Only the player's notes.** Agent-authored notes are filtered out, always.
 * This is not tidiness: `runs/notes.jsonl` holds notes written by an agent
 * during testing, and feeding those back would mean the game evolves towards
 * whatever a fixture happened to say.
 *
 * **Nothing is trusted.** Whatever comes back is validated before it is
 * *shown*, not merely before it is stored. A malformed proposal appears as a
 * failed call in the visible queue; it never renders as a rule.
 *
 * **It never blocks and never becomes canon.** The call goes through
 * `consult`, so it is not cached: asking twice may reasonably give two
 * different rules, because a proposal is a conversation rather than a fact.
 * Only ratification is permanent.
 */

export interface RunSummary {
  world: string;
  ended: 'dead' | 'escaped' | 'playing';
  turns: number;
  /** Plain sentences, one per observation, for the model to reason over.
   *  Deliberately not raw JSON — a log dump buries the two facts that matter
   *  under four hundred that do not. */
  happened: string[];
  /** What you said, out here and in the fiction, with the world's replies. */
  said: string[];
  /** Event ids the summary drew on, so a proposal can cite one. */
  citable: string[];
  /** Note timestamps, likewise. */
  citableNotes: string[];
  /** Already in force, in English, so it does not propose them again. */
  inForce: string[];
  /** The Critic's verdicts, one sentence each. A reading only a human sees is
   *  a report; one the world sees is a gradient. */
  measured: string[];
  /** Lens numbers the verdicts covered, so a citation can be checked. */
  citableLenses: number[];
}

function count(events: readonly GameEvent[], type: GameEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}

/**
 * Turns a run into something worth reading.
 *
 * The shape of the summary is the design decision here. A model handed four
 * hundred raw events will describe them; handed a dozen sentences about what
 * was notable, it can notice what was *absent* — which is where rules come
 * from. "You held still eleven times and nothing happened" is a proposal
 * waiting to be written. The same fact spread across eleven WAIT events is not.
 */
export function summariseRun(
  events: readonly GameEvent[],
  state: GameState,
  notes: readonly Note[],
  world: string,
  playerId = 'player',
): RunSummary {
  // The Critic reads the same events, reconstructed as a log. Chains are
  // parent-linked, so the reconstruction is exact.
  const asLog: EventLog = { events: new Map(events.map((e) => [e.id, e])) };
  const head = events.length === 0 ? null : events[events.length - 1]!.id;
  const report = readTheGame(asLog, head);
  const measured = report.readings
    .filter((r) => r.measured)
    .map((r) => `Lens #${r.lens}, ${r.title}: ${r.verdict} (${r.confidence})`);
  const citableLenses = report.readings.filter((r) => r.measured).map((r) => r.lens);

  const strikes = events.filter((e) => e.type === 'STRIKE');
  const mine = strikes.filter((e) => e.type === 'STRIKE' && e.payload.attackerId === playerId);
  const theirs = strikes.filter((e) => e.type === 'STRIKE' && e.payload.targetId === playerId);
  const landed = (list: typeof strikes): number => list.filter((e) => e.type === 'STRIKE' && e.payload.hit).length;

  const dealt = mine.reduce((n, e) => n + (e.type === 'STRIKE' ? e.payload.damage : 0), 0);
  const taken = theirs.reduce((n, e) => n + (e.type === 'STRIKE' ? e.payload.damage : 0), 0);

  const waits = count(events, 'WAIT');
  const bumps = count(events, 'MOVE_BLOCKED');
  const fired = count(events, 'RULE_FIRED');
  const player = state.entities.find((e) => e.id === playerId);
  const dead = state.entities.filter((e) => e.id !== playerId && !isAlive(e)).length;
  const alive = state.entities.filter((e) => e.id !== playerId && isAlive(e)).length;

  const happened: string[] = [
    `The run lasted ${state.turn} turns and ended: ${outcome(state, playerId)}.`,
    `You took ${count(events, 'MOVE')} steps and walked into something solid ${bumps} times.`,
    `You held still ${waits} times.`,
    `You swung ${mine.length} times, landing ${landed(mine)}, dealing ${dealt} damage.`,
    `You were swung at ${theirs.length} times, hit ${landed(theirs)} times, taking ${taken} damage.`,
    `${dead} creatures died; ${alive} were still standing.`,
    `You picked up ${count(events, 'ITEM_TAKEN')} things.`,
    player === undefined
      ? 'You are not on the map.'
      : `You finished with ${player.stats.hp} of ${player.maxHp} hit points, might ${player.stats.might}, speed ${player.stats.speed}, wits ${player.stats.wits}.`,
    fired === 0 ? 'No rule fired during this run.' : `Rules fired ${fired} times.`,
  ];

  // The player's own voice only. An agent's notes are test writing, and reading
  // them back as intent is how the game learns to evolve towards its fixtures.
  const theirNotes = notesFor(notes, world, 'player');
  const said = theirNotes.map((n) => (
    n.channel === 'designer'
      ? `Out of world, about the game, they said: "${n.said}"`
      : `In the fiction they said: "${n.said}"${n.reply === null ? ' — and the world did not answer.' : ` — the world answered: "${n.reply}"`}`
  ));

  return {
    world,
    ended: outcome(state, playerId),
    turns: state.turn,
    happened,
    said,
    // A handful, newest first: enough to cite, not enough to drown in.
    citable: events.slice(-40).map((e) => e.id),
    citableNotes: theirNotes.map((n) => n.at),
    inForce: state.rules.map(readRule),
    measured,
    citableLenses,
  };
}

/**
 * The single gate everything passes to become a rule — the Rulesmith's draft
 * and the player's edit of it alike.
 *
 * There is exactly one of these on purpose. An edit that skipped validation
 * would be the obvious hole: the proposal is checked, the player nudges a
 * number, and an unchecked object goes into an append-only log.
 */
export function finalise(
  draft: unknown,
  existing: readonly Rule[],
  at: string,
  run?: RunSummary,
  opts: { trial?: boolean } = {},
): Rule | Rejected {
  if (existing.length >= MAX_RULES) {
    return { rejected: `this world already holds the limit of ${MAX_RULES} rules` };
  }
  if (typeof draft !== 'object' || draft === null) {
    return { rejected: 'that is not a rule' };
  }

  const d = draft as Record<string, unknown>;
  const stamped = {
    ...d,
    // The id is ours, not the model's: it must not collide with one already in
    // force, and a rule named "the good one" helps nobody.
    id: `rule-${existing.length + 1}`,
    ratifiedAt: at,
    provenance: run === undefined ? d['provenance'] : pruneProvenance(d['provenance'], run),
  };

  const checked = validateRule(stamped);
  if (isRejected(checked)) return checked;

  if (duplicates(checked, existing)) {
    return { rejected: `this world already plays under that rule: ${readRule(checked)}` };
  }

  // The trial: an exploiter plays the rule before anyone is asked to ratify
  // it. Skippable only for previews — everything that could enter the log
  // passes through it.
  if (opts.trial !== false) {
    const tried = assayRule(checked);
    if (tried.verdict === 'refused') {
      return { rejected: `the assay refused it — ${tried.findings.filter((f) => !f.startsWith('caution')).join('; ')}` };
    }
  }
  return checked;
}

/** Same trigger and same effects as something already in force. Proposing one
 *  of these wastes the player's attention on a decision they already made. */
function duplicates(rule: Rule, existing: readonly Rule[]): boolean {
  const shape = (r: Rule): string => JSON.stringify({ when: r.when, then: r.then });
  return existing.some((r) => shape(r) === shape(rule));
}

/** Only ids and timestamps this run actually contains. A model citing a
 *  plausible-looking hash it invented would put a fabricated reason into an
 *  append-only log, where it stays for good. */
function pruneProvenance(raw: unknown, run: RunSummary): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const p = raw as Record<string, unknown>;
  const keep = (list: unknown, allowed: readonly string[]): string[] =>
    (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === 'string' && allowed.includes(x));

  const rawLenses: unknown = p['lenses'];
  const lenses = (Array.isArray(rawLenses) ? rawLenses : [])
    .filter((x): x is number => typeof x === 'number' && run.citableLenses.includes(x));

  return {
    ...p,
    events: keep(p['events'], run.citable),
    notes: keep(p['notes'], run.citableNotes),
    // Same treatment as event ids: a lens the reading never produced is an
    // invented reason, and invented reasons do not enter an append-only log.
    lenses,
  };
}

/**
 * Asks for one rule, and returns it only if it survives every check.
 *
 * Never throws: a dead transport, a timeout, a reply that is not a rule, and a
 * rule that duplicates one already in force all come back as a `Rejected` with
 * something a person can read.
 */
export async function proposeRule(
  oracle: Oracle,
  run: RunSummary,
  existing: readonly Rule[],
  at: string,
): Promise<Rule | Rejected> {
  let answered;
  try {
    answered = await oracle.consult({
      intent: 'propose',
      subject: `${run.world}:${run.turns}`,
      context: { run },
    });
  } catch (error) {
    return { rejected: `the world had nothing to propose: ${String(error).slice(0, 120)}` };
  }

  if (typeof answered.data !== 'object' || answered.data === null) {
    return { rejected: 'the reply was not a rule' };
  }

  return finalise(answered.data, existing, at, run);
}
