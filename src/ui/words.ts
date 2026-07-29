import { verbOf } from '../core/tables.js';

/**
 * The combat voice: more words, spent carefully.
 *
 * Display-side entirely — pools are picked by a hash of the event's seq and
 * actor, never by a counted draw, so the journal can grow new lines forever
 * without touching replay (a narration that consumed draws would freeze its
 * own vocabulary into the chain).
 *
 * The shape is the researched one: SHARED templates per outcome tier
 * (miss / hit / crit / kill), with a per-verb swing word injected — a small
 * flavor table makes every shared line read bespoke, which beats a bespoke
 * pool per creature both in words written and in words repeated. A
 * no-repeat-of-the-last-two rule keeps the frequent tiers from stuttering;
 * the rare tiers don't need it.
 */

/** How a kind's blows land, in one word. The line carries the mechanical
 *  truth (tier, numbers); this carries the silhouette. */
const SWINGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  trample: Object.freeze(['slams', 'batters']),
  lunge: Object.freeze(['cuts', 'slashes']),
  ambush: Object.freeze(['punctures', 'strikes']),
  vigil: Object.freeze(['hammers', 'checks']),
  venom: Object.freeze(['bites', 'stings']),
  call: Object.freeze(['claws', 'rakes']),
  volley: Object.freeze(['stings', 'cracks']),
  plain: Object.freeze(['hits', 'strikes']),
});

type Tier = 'miss' | 'hit' | 'crit' | 'kill';

/** Same recipe as the namesmith's: fast, stable, fair enough. */
function mix(seq: number, salt: string): number {
  let hash = 0x811c9dc5;
  const text = `${String(seq)}|${salt}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The recent picks per pool, so frequent lines never stutter — and keyed
 *  by the event's seq, so asking about the same blow twice answers the
 *  same both times. Display state only: a reload forgetting it costs
 *  nothing but one coincidence. */
const lastPicks = new Map<string, { seq: number; at: number }[]>();

function pick(poolKey: string, size: number, h: number, seq: number): number {
  if (size <= 1) return 0;
  const recent = lastPicks.get(poolKey) ?? [];
  const again = recent.find((r) => r.seq === seq);
  if (again !== undefined) return again.at;
  let at = h % size;
  // Walk forward past the last two picks; a pool of 3+ always has room.
  const avoid = recent.slice(0, 2).map((r) => r.at);
  for (let hop = 0; hop < size && avoid.includes(at); hop += 1) at = (at + 1) % size;
  lastPicks.set(poolKey, [{ seq, at }, ...recent].slice(0, 4));
  return at;
}

export interface Blow {
  /** True when the player threw it. */
  mine: boolean;
  /** True when the blow flew — a STRIKE whose mode is ranged. Your shots
   *  get their own pool (the stone, not the swing); theirs wear the
   *  volley's swing word on the shared templates. */
  ranged?: boolean;
  /** The attacker's kind — picks the swing word when it is not yours. */
  attackerKind: string;
  /** What the journal calls the other party. */
  them: string;
  damage: number;
  /** The dice, already formatted — "(14 vs 10)". Sil's lesson: legible
   *  numbers are words too, and they ride on every line. */
  roll: string;
  tier: Tier;
  /** The event's seq — the deterministic picker's whole entropy. */
  seq: number;
}

/** One strike, told. Decorations (the lunge's crossing, the spring, the
 *  brace's counter) belong to the caller — this is only the blow itself. */
export function strikeLine(blow: Blow): string {
  const { them, damage, roll, seq } = blow;
  const h = mix(seq, `${blow.attackerKind}|${blow.tier}`);

  if (blow.mine && blow.ranged === true) {
    const pools: Record<Tier, string[]> = {
      miss: [
        `your stone goes wide ${roll}`,
        `${them} leans off the line ${roll}`,
        `the stone skips past ${them} ${roll}`,
      ],
      hit: [
        `your stone takes ${them} for ${damage} ${roll}`,
        `you strike ${them} from afar — ${damage} ${roll}`,
        `the stone lands — ${damage} to ${them} ${roll}`,
      ],
      crit: [
        `the stone finds the seam — ${damage}, doubled ${roll}`,
        `clean across the room — ${damage} to ${them} ${roll}`,
      ],
      kill: [
        `${them} drops at distance — ${damage}, and the floor is quieter ${roll}`,
        `your stone finishes ${them} where it stands ${roll}`,
      ],
    };
    const pool = pools[blow.tier];
    return pool[pick(`you-shot|${blow.tier}`, pool.length, h, seq)]!;
  }

  if (blow.mine) {
    const pools: Record<Tier, string[]> = {
      miss: [
        `you miss ${them} ${roll}`,
        `${them} slips the blow ${roll}`,
        `your swing finds air ${roll}`,
      ],
      hit: [
        `you hit ${them} for ${damage} ${roll}`,
        `you catch ${them} for ${damage} ${roll}`,
        `you open ${them} for ${damage} ${roll}`,
        `your blow lands — ${damage} to ${them} ${roll}`,
      ],
      crit: [
        `clean through — ${damage} to ${them} ${roll}`,
        `you find the seam — ${damage}, doubled ${roll}`,
        `${them} takes it whole — ${damage} ${roll}`,
      ],
      kill: [
        `${them} drops where it stood ${roll}`,
        `you finish ${them} — ${damage} and done ${roll}`,
        `${them} folds, and the floor is quieter ${roll}`,
      ],
    };
    const pool = pools[blow.tier];
    return pool[pick(`you|${blow.tier}`, pool.length, h, seq)]!;
  }

  const swings = SWINGS[verbOf(blow.attackerKind) ?? 'plain'] ?? SWINGS['plain']!;
  const sw = swings[h % swings.length]!;
  const pools: Record<Tier, string[]> = {
    miss: [
      `${them} misses you ${roll}`,
      `you turn ${them} aside ${roll}`,
      `${them} swings past you ${roll}`,
    ],
    hit: [
      `${them} ${sw} you for ${damage} ${roll}`,
      `${them} ${sw} you — ${damage} ${roll}`,
    ],
    crit: [
      `${them} ${sw} you clean through — ${damage} ${roll}`,
      `${them} finds the seam in you — ${damage} ${roll}`,
    ],
    kill: [
      `${them} ${sw} you down — ${damage}, and the floor takes you ${roll}`,
    ],
  };
  const pool = pools[blow.tier];
  return pool[pick(`them|${blow.tier}`, pool.length, h, seq)]!;
}

/**
 * Threshold crossings, told once each time they are crossed.
 *
 * Not a per-line dimension (that multiplies pools into spam) but an event
 * of its own: first blood, below half, nearly spent. Derived purely from
 * the hit points before and after, so there is no ledger to keep — healing
 * back above and falling again says it again, which is when you would want
 * to hear it again.
 */
export function crossings(preHp: number, postHp: number, maxHp: number): string[] {
  const said: string[] = [];
  if (postHp <= 0) return said; // the fall is its own story
  if (preHp >= maxHp && postHp < maxHp) said.push('first blood — yours');
  if (preHp > maxHp / 2 && postHp <= maxHp / 2) {
    said.push('below half — mind the arithmetic');
  }
  const brink = Math.max(1, Math.ceil(maxHp / 5));
  if (preHp > brink && postHp <= brink) {
    said.push('nearly spent — one wrong step ends this');
  }
  return said;
}
