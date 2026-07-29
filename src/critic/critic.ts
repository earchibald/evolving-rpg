import { chain } from '../log/chain.js';
import { LENSES } from './lenses.js';
import { ensemblePointer } from './ensemble.js';
import { surpriseOf } from './surprise.js';
import { interestOf } from './interest.js';
import type { EventLog } from '../log/chain.js';

/**
 * What the game looks like from outside it.
 *
 * One call, one reading, no model. The computed tier has to be cheap enough to
 * run whenever the world changes and identical for identical history, which is
 * what makes it a gradient rather than an opinion — the same run always scores
 * the same, so a change in the score means a change in the game.
 *
 * Two things here are about honesty rather than arithmetic.
 *
 * **A lens nobody is measuring says so.** It would be trivial to leave the two
 * deferred lenses out, or to report them as 0.00. Both read as a pass. A
 * scorecard that cannot distinguish "fine" from "unexamined" is worse than no
 * scorecard, because it invites confidence.
 *
 * **A figure carries what it was computed from.** "0.00 across 21 outcomes" and
 * "0.00 across 4,000" are different claims. Below the thresholds below, the
 * reading says outright that it cannot conclude anything, because a metric that
 * hedges only when asked will be quoted when it wasn't.
 */

/** Under these, a reading admits it is standing on very little. Set by what one
 *  ordinary run produces: the recorded runs give 20-odd modelled outcomes and
 *  60-odd turns, so these sit just under a single run's worth. */
export const ENOUGH_OUTCOMES = 20;
export const ENOUGH_TURNS = 20;

/** Schell wants interest peaking late. A run resolving before this fraction has
 *  spent its remainder on aftermath. */
const LATE_ENOUGH = 0.7;

/** A stretch this long with nothing changing is dead air worth naming. */
const TOO_FLAT = 8;

export interface Reading {
  readonly lens: number;
  readonly title: string;
  /** The number as text, or a dash where there is no number. */
  readonly figure: string;
  /** A sentence a person can act on. */
  readonly verdict: string;
  /** What it was computed from, in plain words. */
  readonly confidence: string;
  /** False for a lens this codebase does not yet measure. */
  readonly measured: boolean;
}

export interface Report {
  readonly readings: readonly Reading[];
  readonly turns: number;
  readonly events: number;
}

function surpriseReading(log: EventLog, head: string | null, title: string): Omit<Reading, 'lens'> {
  const s = surpriseOf(log, head);
  const thin = s.modelled < ENOUGH_OUTCOMES;

  // Below the floor the lens does not read at all. The 929-second run's
  // listener caught a shaped verdict standing on a one-turn sample, hedged
  // only in the fine print — and a hedge appended to a claim is still a
  // claim. Under the floor the claim itself is withheld.
  if (thin) {
    return {
      title,
      figure: '—',
      verdict: s.modelled === 0
        ? 'Nothing with a knowable probability has happened yet — no blows have been struck. No reading.'
        : `Only ${s.modelled} modelled outcome(s) — no reading below ${ENOUGH_OUTCOMES}.`,
      confidence: `across ${s.modelled} modelled outcome(s) — too little to conclude anything`,
      measured: false,
    };
  }

  const verdict = s.rate === 0
    ? 'Nothing that happened was unlikely. The dice never surprise you: every to-hit '
      + 'target the game produces sits near even money, so no roll can land outside expectation.'
    : `${s.surprising} of ${s.modelled} outcomes were long shots — the dice do occasionally overturn a fight.`;

  return {
    title,
    figure: s.rate.toFixed(2),
    verdict,
    confidence: `across ${s.modelled} modelled outcomes`,
    measured: true,
  };
}

function interestReading(log: EventLog, head: string | null, title: string): Omit<Reading, 'lens'> {
  const i = interestOf(log, head);
  const thin = i.turns < ENOUGH_TURNS;

  // Same floor as the surprise lens: "the curve rises and falls" was once
  // said of a single turn. There is no curve in one turn — below the floor
  // there is no reading, not a reading with a disclaimer.
  if (thin) {
    return {
      title,
      figure: '—',
      verdict: `Only ${i.turns} turn(s) — no curve to read below ${ENOUGH_TURNS}.`,
      confidence: `across ${i.turns} turn(s) — too little to conclude anything`,
      measured: false,
    };
  }

  const notes: string[] = [];
  if (i.turns > 1) {
    notes.push(i.peakAt >= LATE_ENOUGH
      ? `Tension peaks ${Math.round(i.peakAt * 100)}% through, which is where it should.`
      : `Tension peaks ${Math.round(i.peakAt * 100)}% through and the rest is aftermath.`);
  }
  if (i.flattest >= TOO_FLAT) {
    notes.push(`${i.flattest} turns went by with nothing about your situation changing — dead air.`);
  }
  if (i.spread < 0.1 && i.turns > 1) {
    notes.push('The curve barely moves; the run is one long note.');
  }
  if (notes.length === 0) notes.push('The curve rises and falls without a long flat stretch.');

  return {
    title,
    figure: i.mean.toFixed(2),
    verdict: notes.join(' '),
    confidence: `across ${i.turns} turns, peak at ${Math.round(i.peakAt * 100)}%, flattest run ${i.flattest}`,
    measured: true,
  };
}

/**
 * Reads the whole chain once, through every lens in the registry.
 *
 * Total: an empty log, a null head, and a head that is not in the log all
 * produce a full set of readings rather than an exception. This is called from
 * a render.
 */
export function readTheGame(log: EventLog, head: string | null): Report {
  let events = 0;
  let turns = 0;
  try {
    const walked = chain(log, head);
    events = walked.length;
    turns = interestOf(log, head).turns;
  } catch {
    events = 0;
  }

  const readings: Reading[] = LENSES.map((lens) => {
    if (lens.state === 'ensemble') {
      // A single chain cannot answer these. Saying where the answer lives is
      // honest; a zero would be a lie and silence would be a pass.
      return {
        lens: lens.id,
        title: lens.title,
        figure: '∴',
        verdict: ensemblePointer(lens),
        confidence: 'a many-runs reading — see npm run balance',
        measured: false,
      };
    }
    if (lens.state === 'deferred') {
      return {
        lens: lens.id,
        title: lens.title,
        figure: '—',
        verdict: `Not measured. ${lens.why}`,
        confidence: 'no reading',
        measured: false,
      };
    }

    if (lens.id === 2) return { lens: lens.id, ...surpriseReading(log, head, lens.title) };
    if (lens.id === 61) return { lens: lens.id, ...interestReading(log, head, lens.title) };

    // A lens marked computed with nothing behind it. Said out loud rather than
    // silently skipped, because the registry and the metrics disagreeing is a
    // bug in this file and should look like one.
    return {
      lens: lens.id,
      title: lens.title,
      figure: '—',
      verdict: 'Marked as measured, but no metric is wired to it. This is a bug.',
      confidence: 'no reading',
      measured: false,
    };
  });

  return { readings, turns, events };
}
