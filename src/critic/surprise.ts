import { chain } from '../log/chain.js';
import { apply } from '../core/apply.js';
import { EMPTY_STATE } from '../core/state.js';
import { findEntity } from '../core/entity.js';
import type { EventLog } from '../log/chain.js';
import type { GameState } from '../core/state.js';

/**
 * Lens #2, The Lens of Surprise.
 *
 * The share of things that happened which the game itself said were unlikely.
 * Not a guess at whether a *player* was surprised — that is the judged tier's
 * problem — but the one part of it a machine can settle: every roll this engine
 * makes has a probability that is known exactly, so "how often did the improbable
 * happen" is arithmetic rather than opinion.
 *
 * Two rolls carry probability, and both count:
 *
 *   **Whether a blow landed.** `needed` is the number a d20 had to beat, so
 *   `P(hit) = (21 - needed) / 20`, and the outcome that actually occurred has
 *   either that probability or its complement.
 *
 *   **How much it hurt.** Damage is uniform over `1..might`, so a specific
 *   value has probability `1 / might`.
 *
 * The second one is why this folds the chain rather than scanning a list of
 * events. A `STRIKE` records the damage dealt but not the range it came from,
 * and estimating the range from the largest damage ever observed is circular
 * for precisely the big rolls that ought to register — the roll would define
 * the range that then makes it look rare. Folding gives the attacker's actual
 * might at the moment they swung, which is exact.
 *
 * **On the current combat maths this reads 0.00, and that is the answer, not a
 * bug.** `needed = 10 + speed - might`, so a sub-0.15 outcome wants a gap of
 * seven or more between those stats, and the game produces 8s and 10s. A game
 * whose dice never surprise anyone is a finding worth stating out loud.
 */

export const SURPRISE_THRESHOLD = 0.15;

export interface Surprise {
  /** Share of modelled outcomes that came in under the threshold. */
  readonly rate: number;
  readonly surprising: number;
  /** How many outcomes had a probability at all. Without this, "nothing was
   *  surprising" and "nothing was measured" render identically. */
  readonly modelled: number;
}

/** A d20 target as a probability, clamped: a target of 25 cannot be met and a
 *  target of 0 cannot be missed, and neither should produce a negative chance. */
function chanceToHit(needed: number): number {
  return Math.max(0, Math.min(1, (21 - needed) / 20));
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function surpriseOf(log: EventLog, head: string | null): Surprise {
  let surprising = 0;
  let modelled = 0;

  let state: GameState = EMPTY_STATE;
  let events;
  try {
    events = chain(log, head);
  } catch {
    // A head that is not in this log. Nothing to read rather than a crash: this
    // runs against whatever is on disk, including logs an older engine wrote.
    return { rate: 0, surprising: 0, modelled: 0 };
  }

  for (const event of events) {
    if (event.type === 'STRIKE') {
      const p = event.payload as Partial<{ attackerId: string; hit: boolean; crit: boolean; damage: number; needed: number }>;

      if (isNumber(p.needed) && typeof p.hit === 'boolean') {
        // A natural 20 is its own outcome with its own probability — 1 in 20,
        // always under the threshold. This is the event the lens waited for:
        // before crits existed, nothing the dice could do was unlikely.
        const landed = chanceToHit(p.needed);
        const happened = p.crit === true ? 1 / 20 : p.hit ? landed : 1 - landed;
        modelled += 1;
        if (happened < SURPRISE_THRESHOLD) surprising += 1;
      }

      // Read before applying. Nothing observable turns on it today — a STRIKE
      // does not change the attacker's own might — but the reading should be
      // of the world that produced the roll, and an effect that alters might
      // on a hit is one rule away from existing.
      const attacker = typeof p.attackerId === 'string' ? findEntity(state.entities, p.attackerId) : undefined;
      if (p.hit === true && isNumber(p.damage) && attacker !== undefined && attacker.stats.might > 0) {
        modelled += 1;
        if (1 / attacker.stats.might < SURPRISE_THRESHOLD) surprising += 1;
      }
    }

    try {
      state = apply(state, event);
    } catch {
      // One unreadable event should not end the reading. The log's own
      // integrity is `verifyChain`'s job, not the Critic's.
    }
  }

  return {
    rate: modelled === 0 ? 0 : surprising / modelled,
    surprising,
    modelled,
  };
}
