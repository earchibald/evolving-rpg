/**
 * THE TABLES
 *
 * Every number a designer would tune, in one file, each with its unit and its
 * reason. Combat code that contains a number not defined here is defective by
 * convention. The prose companion is docs/design/BALANCE.md; change them
 * together.
 *
 * Lineage, so the shapes are legible to anyone who has played these games:
 *
 * - **Bounded accuracy** (D&D 5e): hit chances live in a band whatever the
 *   level gap, while hp and damage scale. Growth stays legible forever and a
 *   lucky low-level swing still lands sometimes.
 * - **Criticals** (everything since the 1970s): natural 20 doubles, natural 1
 *   whiffs. Five percent of blows become stories — and lens #2 finally has
 *   something under its threshold to count.
 * - **XP thresholds with full-heal level-ups** (DCSS lineage): the level-up is
 *   the sawtooth's "ease" tooth — a breath, then the next depth bites.
 * - **Out-of-depth overlap** (Brogue): depth N draws creatures from bands
 *   N−1..N+1, so difficulty blurs upward instead of stair-stepping.
 */

import type { Stats } from './entity.js';

/* ── the d20 ─────────────────────────────────────────────────────────────── */

/** Natural roll that always lands, and doubles the damage. */
export const CRIT = 20;
/** Natural roll that always misses, whatever the numbers say. */
export const WHIFF = 1;

/** The bounded-accuracy band for the number a d20 must meet. Clamping here is
 *  what keeps every fight winnable and every fight losable: needed 4 is 85%,
 *  needed 17 is 20%, and nothing outside that band can exist. */
export const NEEDED_FLOOR = 4;
export const NEEDED_CEILING = 17;

/**
 * The number the attacker's d20 must meet or beat.
 *
 * `10 + speed − might` (the increment-2 formula), clamped to the band. Speed
 * defends, might attacks; a 3-point advantage moves the odds 15 points. At
 * parity between the starting player (might 3) and a depth-1 skirmisher
 * (speed 2) this is 9 — a 60% hit, which is the "fighting should feel good"
 * anchor the balance doc explains.
 */
export function neededToHit(attackerMight: number, targetSpeed: number): number {
  const raw = 10 + targetSpeed - attackerMight;
  return Math.max(NEEDED_FLOOR, Math.min(NEEDED_CEILING, raw));
}

/** Chance in twentieths that a blow lands, crit and whiff included: the nat-20
 *  always hits and the nat-1 always misses, so the band is really [1..19]. */
export function chanceIn20(needed: number): number {
  return Math.max(1, Math.min(19, 21 - needed));
}

/* ── damage ──────────────────────────────────────────────────────────────── */

/** Damage by might band: roll 1..die, add flat. Replaces uniform 1..might,
 *  which was brutally swingy at low might (a third of blows dealt 1) and
 *  scaled its variance with its mean. Means rise gently: 1.5, 2.5, 3.5, 4.5,
 *  6.5, 8.5 across the bands. */
export interface DamageDice {
  readonly die: number;
  readonly flat: number;
}

const DAMAGE_BANDS: readonly (readonly [number, DamageDice])[] = Object.freeze([
  [1, Object.freeze({ die: 2, flat: 0 })],   // might 1–2:  1d2      (1–2)
  [3, Object.freeze({ die: 3, flat: 1 })],   // might 3–4:  1d3+1    (2–4)
  [5, Object.freeze({ die: 4, flat: 2 })],   // might 5–6:  1d4+2    (3–6)
  [7, Object.freeze({ die: 6, flat: 3 })],   // might 7–8:  1d6+3    (4–9)
  [9, Object.freeze({ die: 8, flat: 4 })],   // might 9+:   1d8+4    (5–12)
]);

export function damageDice(might: number): DamageDice {
  let chosen = DAMAGE_BANDS[0]![1];
  for (const [floor, dice] of DAMAGE_BANDS) {
    if (might >= floor) chosen = dice;
  }
  return chosen;
}

export function meanDamage(might: number): number {
  const { die, flat } = damageDice(might);
  return (die + 1) / 2 + flat;
}

/* ── experience ──────────────────────────────────────────────────────────── */

/**
 * XP needed to *reach* each level. Level 1 is birth. The curve is quadratic-
 * ish (DCSS-flavoured): early levels arrive inside one floor, later ones need
 * a deliberate detour through danger — which is the whole incentive the game
 * was missing.
 */
export const XP_TO_REACH: readonly number[] = Object.freeze([0, 0, 10, 25, 45, 70, 100, 140, 190, 250]);

export function levelForXp(xp: number): number {
  let level = 1;
  for (let l = XP_TO_REACH.length - 1; l >= 1; l -= 1) {
    if (xp >= XP_TO_REACH[l]!) { level = l; break; }
  }
  return level;
}

/** What one level-up grants, by the level being *reached* (index 2 = reaching
 *  level 2). Might and speed alternate so neither runs away; wits every third
 *  level so it accrues a purpose as rules learn to read it. maxHp every level
 *  keeps deeper floors survivable at all. Deterministic on purpose: replay
 *  needs no choices, and the Forge can propose choice later. */
export function growthAt(level: number): Stats {
  return {
    hp: 3,
    might: level % 2 === 0 ? 1 : 0,
    speed: level % 2 === 1 ? 1 : 0,
    wits: level % 3 === 0 ? 1 : 0,
  };
}

/* ── the bestiary ────────────────────────────────────────────────────────── */

/**
 * Mechanical archetypes. The Oracle names each kind when touched (a
 * `skirmisher-2` is a new kind and earns a new name); these are the bones
 * under the names. Growth is per depth-level of the creature, not of the
 * floor it appears on — out-of-depth overlap means floor 2 can hold a level-1
 * skirmisher and a level-3 bruiser at once.
 */
export interface Archetype {
  readonly kind: string;
  readonly base: Stats;
  readonly growth: Stats;
  /** Spawn weight within a band; the warden's zero means "never random". */
  readonly weight: number;
}

export const BESTIARY: readonly Archetype[] = Object.freeze([
  Object.freeze({
    kind: 'skirmisher',
    base: Object.freeze({ hp: 4, might: 2, wits: 1, speed: 3 }),
    growth: Object.freeze({ hp: 2, might: 1, wits: 0, speed: 1 }),
    weight: 3,
  }),
  Object.freeze({
    kind: 'bruiser',
    base: Object.freeze({ hp: 7, might: 4, wits: 1, speed: 1 }),
    growth: Object.freeze({ hp: 3, might: 1, wits: 0, speed: 0 }),
    weight: 2,
  }),
  Object.freeze({
    kind: 'stalker',
    base: Object.freeze({ hp: 3, might: 3, wits: 2, speed: 4 }),
    growth: Object.freeze({ hp: 1, might: 1, wits: 1, speed: 1 }),
    weight: 2,
  }),
  Object.freeze({
    kind: 'warden',
    base: Object.freeze({ hp: 16, might: 5, wits: 2, speed: 2 }),
    growth: Object.freeze({ hp: 6, might: 1, wits: 1, speed: 0 }),
    weight: 0,
  }),
]);

export function archetype(kind: string): Archetype | undefined {
  return BESTIARY.find((a) => a.kind === kind);
}

/** A creature's stats at a given level of itself. Level 1 is the base. */
export function creatureStats(kind: string, level: number): Stats | undefined {
  const arch = archetype(kind);
  if (arch === undefined) return undefined;
  const l = Math.max(1, Math.floor(level)) - 1;
  return {
    hp: arch.base.hp + arch.growth.hp * l,
    might: arch.base.might + arch.growth.might * l,
    wits: arch.base.wits + arch.growth.wits * l,
    speed: arch.base.speed + arch.growth.speed * l,
  };
}

/* ── threat and the spawn budget ─────────────────────────────────────────── */

/**
 * One number for "how much creature is this". Offence is mean damage scaled by
 * how often it lands on the *starting* player; defence is hit points weighted
 * below offence because a sponge is less dangerous than a blade. Also the XP a
 * kill pays, which makes the risk/reward symmetry explicit: threat in, XP out.
 */
export function threatOf(stats: Stats): number {
  const landRate = chanceIn20(neededToHit(stats.might, 4)) / 20;
  const offence = meanDamage(stats.might) * landRate * 10;
  const defence = stats.hp * 0.6 + stats.speed * 0.4;
  return Math.round(offence + defence);
}

/** The spawn budget a floor may spend on creatures. Linear and steep enough
 *  that depth 2 visibly bites: ~3 modest creatures at depth 1, 4–5 stronger
 *  ones at depth 2, the warden's floor at 3. */
export function spawnBudget(depth: number): number {
  return 14 + 12 * Math.max(1, Math.floor(depth));
}

/** Out-of-depth overlap: which creature-levels a floor may draw, with weights.
 *  Mostly your depth, sometimes one shallower, rarely one deeper — the Brogue
 *  blur that keeps difficulty from stair-stepping. */
export function depthBands(depth: number): readonly { level: number; weight: number }[] {
  const d = Math.max(1, Math.floor(depth));
  const bands = [{ level: d, weight: 6 }];
  if (d > 1) bands.push({ level: d - 1, weight: 3 });
  bands.push({ level: d + 1, weight: 1 });
  return bands;
}

/** Every third floor, the stairs are guarded. */
export function wardenAt(depth: number): boolean {
  return depth >= 3 && depth % 3 === 0;
}
