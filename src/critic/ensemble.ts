import type { Lens } from './lenses.js';

/**
 * The ensemble lenses: the two Schell lenses a single run cannot answer.
 *
 * #33 Triangularity asks whether distinct approaches are all worth taking.
 * #71 Freedom asks whether the choices on offer lead anywhere meaningfully
 * different. Both are properties of *many* runs — and the autoplay harness
 * now produces many runs cheaply, with archetypal policies standing in for
 * approaches: the fighter, the runner, the coward are exactly the "distinct
 * approaches" the lens means.
 *
 * The spec's warned failure mode for Freedom is counting meaningless doors.
 * Nothing here counts options off the map: an approach is *viable* only by
 * its measured escape rate, and two approaches are *different* only when
 * their observed outcome distributions actually diverge. A door that leads
 * where every other door leads adds nothing to either figure.
 */

export interface ApproachOutcomes {
  readonly approach: string;
  readonly escaped: number;
  readonly dead: number;
  /** Ran to the action cap: neither won nor lost, declined to play. */
  readonly stalled: number;
}

/** An approach is worth taking when it wins often enough to be a strategy
 *  rather than a miracle. */
export const VIABLE_RATE = 0.25;

/** Two outcome distributions are the same choice wearing different clothes
 *  until they diverge by at least this much in some component. */
export const DISTINCT_GAP = 0.2;

const total = (a: ApproachOutcomes): number => Math.max(1, a.escaped + a.dead + a.stalled);
const profile = (a: ApproachOutcomes): [number, number, number] => {
  const n = total(a);
  return [a.escaped / n, a.dead / n, a.stalled / n];
};

/** Largest component-wise gap between two outcome profiles. */
function divergence(a: ApproachOutcomes, b: ApproachOutcomes): number {
  const pa = profile(a);
  const pb = profile(b);
  return Math.max(...pa.map((v, i) => Math.abs(v - pb[i]!)));
}

export interface EnsembleReading {
  readonly lens: number;
  readonly figure: string;
  readonly verdict: string;
  readonly confidence: string;
}

/** #33: how many observed approaches are genuinely worth taking. */
export function triangularityOf(approaches: readonly ApproachOutcomes[]): EnsembleReading {
  const viable = approaches.filter((a) => a.escaped / total(a) >= VIABLE_RATE);
  const names = viable.map((a) => a.approach).join(', ');

  return {
    lens: 33,
    figure: String(viable.length),
    verdict: viable.length === 0
      ? 'No approach wins often enough to be a strategy — the game cannot currently be beaten on purpose.'
      : viable.length === 1
        ? `Only ${names} is worth taking; every other approach is a trap. One viable path is a corridor, not a choice.`
        : `${String(viable.length)} approaches are genuinely worth taking (${names}) — risk and safety both have a case.`,
    confidence: `across ${String(approaches.length)} approaches, ${String(approaches.reduce((n, a) => n + total(a), 0))} runs; viable means ≥${String(VIABLE_RATE * 100)}% escape`,
  };
}

/** #71: how many meaningfully different places the choices lead. Counted by
 *  greedy clustering on outcome profiles: an approach joins an existing
 *  cluster when its distribution sits within the gap of one already there. */
export function freedomOf(approaches: readonly ApproachOutcomes[]): EnsembleReading {
  const clusters: ApproachOutcomes[][] = [];
  for (const a of approaches) {
    const home = clusters.find((c) => c.some((b) => divergence(a, b) < DISTINCT_GAP));
    if (home === undefined) clusters.push([a]);
    else home.push(a);
  }

  const described = clusters
    .map((c) => c.map((a) => a.approach).join('/'))
    .join(' · ');

  return {
    lens: 71,
    figure: String(clusters.length),
    verdict: clusters.length <= 1
      ? 'Every approach ends the same way — the choices are decoration.'
      : `The choices lead ${String(clusters.length)} meaningfully different places: ${described}.`,
    confidence: `distinct means outcome distributions diverging ≥${String(DISTINCT_GAP * 100)} points; doors are never counted, only where they led`,
  };
}

/** What the per-chain Critic says about a lens it cannot compute alone. */
export function ensemblePointer(lens: Lens): string {
  return `Measured across many runs rather than one: run \`npm run balance\` for the current ${lens.title} reading.`;
}
