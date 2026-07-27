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
import { intBetween } from './rng.js';

/* ── the d20 ─────────────────────────────────────────────────────────────── */

/** Natural roll that always lands, and doubles the damage. */
export const CRIT = 20;

/**
 * Wits' job: a keen mind widens the opening. The crit threshold drops one
 * step per four points of wits, floored — so crits stay rare for everyone and
 * merely less rare for the sharp. The starting player (wits 3) crits only on
 * the natural 20, which is why adding this changed no tuning; the grey lens
 * and every third level make it a build.
 */
export const CRIT_FLOOR_LIMIT = 18;
export function critFloor(wits: number): number {
  return Math.max(CRIT_FLOOR_LIMIT, CRIT - Math.floor(Math.max(0, wits) / 4));
}
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
export const XP_TO_REACH: readonly number[] = Object.freeze([0, 0, 16, 40, 72, 112, 160, 224, 304, 400]);

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
    hp: 2,
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

/* ── the verbs ───────────────────────────────────────────────────────────── */

/**
 * What a kind DOES, beyond hitting back. One verb per archetype, because a
 * bestiary that differs only in stat rows is invisible at the resolution a
 * player experiences (measured here: four archetypes, one complaint — "no
 * feeling of difference"). The lineage is the small-bestiary tradition:
 * DCSS's trample, Brogue's dormant lurkers, Sil's charge, NetHack's
 * stair-anchored guardians — chosen over hit-and-run and out-of-sight
 * cleverness, which that same tradition tried and regrets (retreat AI reads
 * as tedium; invisible sophistication reads as nothing).
 *
 * Every verb is deterministic and drawless: triggers are state predicates,
 * tile choices break ties in the fixed neighbour order. Chance stays where
 * it always was — in whether the blow lands.
 */
export type Verb = 'trample' | 'lunge' | 'ambush' | 'vigil';

const VERBS: Readonly<Record<string, Verb>> = Object.freeze({
  bruiser: 'trample',
  skirmisher: 'lunge',
  stalker: 'ambush',
  warden: 'vigil',
});

/** The verb a kind acts by. Kinds carry levels ("bruiser-2"); the verb
 *  belongs to the archetype under the suffix. */
export function verbOf(kind: string): Verb | undefined {
  const base = kind.includes('-') ? kind.slice(0, kind.indexOf('-')) : kind;
  return VERBS[base];
}

/** How close (steps of walking) something must come before a coiled stalker
 *  springs. Three: inside a room it commits before you reach the far door,
 *  and a corridor gives you exactly one turn of warning. */
export const LURK_RANGE = 3;

/** The ambush blow lands one damage band harder — might read as +2 for that
 *  single strike, the band step. Capped at one band on purpose: an alpha
 *  strike that can kill from full health is a no-warning spike, and the
 *  tradition deleted those. */
export const AMBUSH_MIGHT_BONUS = 2;

/** No ambushes on the teaching floor. The depth-1 pin (19 in 20 gentle)
 *  holds about one death of slack, and a first-blow band jump spends it. */
export const AMBUSH_FROM_DEPTH = 2;

/** How far (steps of walking) a warden will be drawn from its post. Five
 *  covers the stair room; past it the warden turns back — the stairs are
 *  what it is for, and a boss kited across the floor is a boss solved. */
export const VIGIL_LEASH = 5;

/* ── threat and the spawn budget ─────────────────────────────────────────── */

/**
 * What a verb is worth, as a multiplier on the stat threat. The verbs made
 * creatures genuinely scarier — measured immediately: with verbs unpriced,
 * depth-5 brawler survival collapsed from the pinned [1,10]/20 to 0/20 —
 * so the budget must pay for them or every deep floor overdraws. The lunge
 * converts an approach round into a hit round; the spring is a banked
 * band-jump; the trample is tempo and terrain, cheaper than either. The
 * vigil prices at par: the leash is the player's favour, the knitting-shut
 * merely takes back what poking never deserved.
 */
export const VERB_THREAT: Readonly<Record<Verb, number>> = Object.freeze({
  trample: 1.1,
  lunge: 1.25,
  ambush: 1.25,
  vigil: 1.0,
});

/**
 * One number for "how much creature is this". Offence is mean damage scaled by
 * how often it lands on the *starting* player; defence is hit points weighted
 * below offence because a sponge is less dangerous than a blade. Also the XP a
 * kill pays, which makes the risk/reward symmetry explicit: threat in, XP out.
 *
 * Pass the kind so the verb is priced in — spawning and XP must use the same
 * number or the symmetry breaks. Statless callers (old fixtures) may omit it.
 */
export function threatOf(stats: Stats, kind?: string): number {
  const landRate = chanceIn20(neededToHit(stats.might, 4)) / 20;
  const offence = meanDamage(stats.might) * landRate * 10;
  const defence = stats.hp * 0.6 + stats.speed * 0.4;
  const verb = kind === undefined ? undefined : verbOf(kind);
  return Math.round((offence + defence) * (verb === undefined ? 1 : VERB_THREAT[verb]));
}

/** The spawn budget a floor may spend on creatures. The linear part is steep
 *  enough that depth 2 visibly bites; first cut (14+12d) let one unlucky
 *  bruiser roll eat floor 1 whole — a single-creature floor teaches nothing —
 *  so the base covers two or three modest creatures outright.
 *
 *  The quadratic term arrived with the 48x32 boards: a linear budget on a 4x
 *  floor left depth 5 fielding four creatures the snowballed fighter could
 *  duel one at a time, and the deep ran 13-in-20 survivable against a stated
 *  band of "rare". It starts at depth 3 — anchored at (d−2) — because
 *  anchoring it one floor earlier crushed the depth-3 runner to 2-in-20 and
 *  lens #33 read the mid-game as a corridor: one viable approach is not a
 *  choice. The teaching floor never feels it at all. */
export function spawnBudget(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  const deep = Math.max(0, d - 2);
  return 24 + 15 * d + 4 * deep * deep;
}

/** Out-of-depth overlap: which creature-levels a floor may draw, with weights.
 *  Mostly your depth, sometimes one shallower, rarely one deeper — the Brogue
 *  blur that keeps difficulty from stair-stepping. */
export function depthBands(depth: number): readonly { level: number; weight: number }[] {
  const d = Math.max(1, Math.floor(depth));
  const bands = [{ level: d, weight: 6 }];
  if (d > 1) {
    bands.push({ level: d - 1, weight: 3 });
    // The out-of-depth scare starts once the player has a floor behind them.
    // On the teaching floor a level-2 bruiser is not a scare, it is an
    // execution: one world in seven rolled one, and floor-one deaths ran 20%
    // against a stated band of "the door is gentle".
    bands.push({ level: d + 1, weight: 1 });
  }
  return bands;
}

/** Every third floor, the stairs are guarded. */
export function wardenAt(depth: number): boolean {
  return depth >= 3 && depth % 3 === 0;
}

/* ── depth motifs ────────────────────────────────────────────────────────── */

/**
 * How a depth band shapes its floors. The research lineage (MAPS.md §5,
 * BALANCE.md pass 10): Brogue blends room shapes and corridor-attach over
 * depth and ramps secret doors 0→67%; Rogue and Moria ramp darkness to
 * total; NetHack and DCSS swap generators per region. Ours is the banded
 * middle: named motifs as bounded rows, drawn per floor in the deep.
 */
export interface Motif {
  /** The vocabulary token for this cut (canon/rule.ts MOTIF_NAMES — a test
   *  pins the lists together). The deep's per-floor draw wraps warren or
   *  halls and keeps the base key: a deep warren is still a warren to a rule,
   *  and the deep itself is depth's business. */
  readonly key: 'door' | 'warren' | 'halls';
  readonly name: string;
  /** One room per this many tiles — density. */
  readonly tilesPerRoom: number;
  readonly roomW: readonly [number, number];
  readonly roomH: readonly [number, number];
  /** One extra looping corridor per this many rooms. */
  readonly loopPer: number;
  /** Secret-room odds: 1 in this. */
  readonly secretIn: number;
}

export const MOTIFS: Readonly<Record<'door' | 'warren' | 'halls', Motif>> = Object.freeze({
  /** The teaching floors: exactly the shape the game launched with. */
  door: Object.freeze({ key: 'door' as const, name: 'the door', tilesPerRoom: 110, roomW: [4, 8] as const, roomH: [3, 6] as const, loopPer: 4, secretIn: 4 }),
  /** Dense, tight, loopy — Brogue's chase topology. */
  warren: Object.freeze({ key: 'warren' as const, name: 'the warren', tilesPerRoom: 90, roomW: [3, 6] as const, roomH: [3, 4] as const, loopPer: 3, secretIn: 3 }),
  /** Big sparse chambers — the keeper's arena. */
  halls: Object.freeze({ key: 'halls' as const, name: 'the halls', tilesPerRoom: 150, roomW: [6, 12] as const, roomH: [4, 7] as const, loopPer: 6, secretIn: 3 }),
});

/**
 * The motif a floor is cut to. Bands 1–6 are fixed — a player learns what
 * depth feels like; the deep (7+) draws warren or halls per floor (a
 * counted draw — Brogue's late variety) and keeps more secrets.
 */
export function motifAt(seed: number, counter: number, depth: number): { motif: Motif; counterAfter: number } {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 2) return { motif: MOTIFS.door, counterAfter: counter };
  if (d <= 4) return { motif: MOTIFS.warren, counterAfter: counter };
  if (d <= 6) return { motif: MOTIFS.halls, counterAfter: counter };
  const base = intBetween(seed, counter, 0, 1) === 0 ? MOTIFS.warren : MOTIFS.halls;
  return {
    motif: Object.freeze({ ...base, name: `the deep ${base.name.slice(4)}`, secretIn: 2 }),
    counterAfter: counter + 1,
  };
}

/** How far sight reaches, by depth: Rogue ramped dark rooms to 100% by
 *  level 11, Moria by 25 — their darkness lineage, mapped gently onto our
 *  fog. The deep closes in; it never goes fully black, because the fog is
 *  already the tax. */
export function sightAt(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 2) return 9;
  if (d <= 6) return 8;
  return 7;
}

/* ── the armory ──────────────────────────────────────────────────────────── */

/**
 * What a floor may leave lying on the ground, guarded. One item per floor,
 * chosen by counted draw, its grant scaled by depth: a keepsake early, a
 * difference-maker deep. Kinds are article-free — the Covenant's name rules
 * apply to the world's own data before they apply to any model.
 *
 * `per` is how many depths buy one more point of the grant; lower is faster.
 * The blade leads the table because might compounds through the damage bands,
 * which is also why it scales slowest.
 */
export interface Relic {
  readonly kind: string;
  readonly grants: keyof Stats;
  readonly base: number;
  readonly per: number;
  readonly weight: number;
}

export const ARMORY: readonly Relic[] = Object.freeze([
  Object.freeze({ kind: 'keen edge', grants: 'might' as const, base: 2, per: 3, weight: 3 }),
  Object.freeze({ kind: 'iron charm', grants: 'hp' as const, base: 3, per: 1, weight: 3 }),
  Object.freeze({ kind: 'fleet boots', grants: 'speed' as const, base: 1, per: 3, weight: 2 }),
  Object.freeze({ kind: 'grey lens', grants: 'wits' as const, base: 1, per: 2, weight: 2 }),
]);

/**
 * Which slot a relic occupies, by the stat it grants. One slot, one item:
 * a second keen edge REPLACES the first rather than stacking — two swords do
 * not make you twice as strong, they make you a person holding two swords.
 */
export const SLOTS = ['weapon', 'armor', 'boots', 'trinket'] as const;
export type Slot = (typeof SLOTS)[number];

export function slotOf(grants: Stats): Slot {
  if (grants.might >= Math.max(grants.hp, grants.speed, grants.wits)) return 'weapon';
  if (grants.hp >= Math.max(grants.speed, grants.wits)) return 'armor';
  if (grants.speed >= grants.wits) return 'boots';
  return 'trinket';
}

/** One number for "how much item": what replacement compares. */
export function grantValue(grants: Stats): number {
  return grants.hp + grants.might + grants.wits + grants.speed;
}

/** The grant a relic gives at a depth. Never zero: a prize that does nothing
 *  is a lie with a guard on it. */
export function relicGrant(relic: Relic, depth: number): Stats {
  const d = Math.max(1, Math.floor(depth));
  const amount = relic.base + Math.floor((d - 1) / relic.per);
  return {
    hp: relic.grants === 'hp' ? amount : 0,
    might: relic.grants === 'might' ? amount : 0,
    wits: relic.grants === 'wits' ? amount : 0,
    speed: relic.grants === 'speed' ? amount : 0,
  };
}
