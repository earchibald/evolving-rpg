import { chain } from '../log/chain.js';
import { apply } from '../core/apply.js';
import { EMPTY_STATE } from '../core/state.js';
import { isAlive, findEntity } from '../core/entity.js';
import { AWARENESS } from '../core/ai.js';
import type { EventLog } from '../log/chain.js';
import type { GameState } from '../core/state.js';

/**
 * Lens #61, the Interest Curve.
 *
 * Schell's lens asks two answerable questions of a run: does interest rise
 * toward the end, and is there dead air. This measures tension as a stand-in
 * for interest and then reports the shape.
 *
 * **The tension figure is a heuristic and the weights are stated, not buried.**
 * It is how hurt you are and how close the nearest living thing is — the two
 * things this game actually has. It is not a claim about what a person felt; a
 * claim about that belongs to the judged tier, which reads prose rather than
 * arithmetic.
 *
 * **The shape reading is not a heuristic.** Where the curve peaks as a fraction
 * of the run, and the longest stretch it goes without changing, are facts about
 * the numbers whatever the numbers mean. A peak at 0.1 says the run was most
 * interesting before the player understood it. A flat stretch of ninety says
 * ninety turns went by in which nothing about the player's situation changed —
 * which is the shape of walking a long way, and the last recorded run walked
 * 389 steps to swing six times.
 */

/** Stated so they can be argued with. A heuristic nobody can inspect is
 *  indistinguishable from a number somebody made up. */
export const HURT_WEIGHT = 0.6;
export const NEAR_WEIGHT = 0.4;

export interface Interest {
  /** One tension figure per turn, in order. */
  readonly curve: readonly number[];
  readonly mean: number;
  /** Standard deviation — a flat run and a jagged one with the same average are
   *  very different games. */
  readonly spread: number;
  /** Where the peak fell, as a fraction of the run: 0 at the start, 1 at the
   *  end. A fraction rather than a turn number so runs of different lengths can
   *  be compared at all. */
  readonly peakAt: number;
  /** The longest stretch of turns whose tension did not change. Dead air. */
  readonly flattest: number;
  readonly turns: number;
}

const NOTHING: Interest = Object.freeze({
  curve: Object.freeze([]), mean: 0, spread: 0, peakAt: 0, flattest: 0, turns: 0,
});

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function stepsToNearest(state: GameState, playerId: string): number {
  const you = findEntity(state.entities, playerId);
  if (you === undefined) return Infinity;

  let best = Infinity;
  for (const e of state.entities) {
    if (e.id === playerId || !isAlive(e)) continue;
    best = Math.min(best, Math.abs(e.pos.x - you.pos.x) + Math.abs(e.pos.y - you.pos.y));
  }
  return best;
}

function tensionOf(state: GameState, playerId: string): number {
  const you = findEntity(state.entities, playerId);
  if (you === undefined) return 0;

  // A ceiling of zero would make this NaN, and NaN quietly poisons every figure
  // downstream — the mean, the spread, the peak.
  const hurt = you.maxHp > 0 ? clamp01(1 - you.stats.hp / you.maxHp) : 1;

  // Awareness is the range at which the world starts caring about you, which
  // makes it the natural scale for "close".
  const steps = stepsToNearest(state, playerId);
  const near = Number.isFinite(steps) ? clamp01((AWARENESS - steps) / AWARENESS) : 0;

  return clamp01(HURT_WEIGHT * hurt + NEAR_WEIGHT * near);
}

/** Rounded, so two runs of identical shape compare equal and float noise does
 *  not invent variation that was never there. */
const settle = (v: number): number => Math.round(v * 1000) / 1000;

export function interestOf(log: EventLog, head: string | null, playerId = 'player'): Interest {
  let events;
  try {
    events = chain(log, head);
  } catch {
    return NOTHING;
  }
  if (events.length === 0) return NOTHING;

  const curve: number[] = [];
  /** Which floor each sample belongs to, so flat stretches never span the
   *  stairs: a run that descends is several curves stitched, and dead air
   *  measured across the seam blames floor one for floor three. */
  const floorOf: number[] = [];
  let state: GameState = EMPTY_STATE;
  let sampledTurn = -1;

  for (const event of events) {
    try {
      state = apply(state, event);
    } catch {
      continue;
    }
    // One sample per turn, taken when the turn number first changes — so a run
    // of forty turns reads as forty points whatever else happened inside them.
    if (state.turn !== sampledTurn) {
      sampledTurn = state.turn;
      curve.push(settle(tensionOf(state, playerId)));
      floorOf.push(state.depth);
    }
  }

  // The last state always gets a point, so the end of a run is never invisible
  // just because the turn did not tick over on the final event.
  const last = settle(tensionOf(state, playerId));
  if (curve.length === 0 || curve[curve.length - 1] !== last) {
    curve.push(last);
    floorOf.push(state.depth);
  }

  const mean = curve.reduce((a, b) => a + b, 0) / curve.length;
  const spread = Math.sqrt(curve.reduce((a, b) => a + (b - mean) ** 2, 0) / curve.length);

  let peakIndex = 0;
  for (let i = 1; i < curve.length; i += 1) {
    if (curve[i]! > curve[peakIndex]!) peakIndex = i;
  }

  let flattest = 1;
  let run = 1;
  for (let i = 1; i < curve.length; i += 1) {
    const sameFloor = floorOf[i] === floorOf[i - 1];
    run = sameFloor && curve[i] === curve[i - 1] ? run + 1 : 1;
    flattest = Math.max(flattest, run);
  }

  return Object.freeze({
    curve: Object.freeze([...curve]),
    mean: settle(mean),
    spread: settle(spread),
    peakAt: curve.length <= 1 ? 0 : settle(peakIndex / (curve.length - 1)),
    flattest,
    turns: curve.length,
  });
}
