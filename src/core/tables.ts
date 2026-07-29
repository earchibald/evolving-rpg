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

export function levelForXp(xp: number, stretch = 1): number {
  // The stretch scales the thresholds, not the kills: a bigger board pays
  // roughly stretch× the XP per cleared floor (spawnBudget carries the same
  // factor), so stretching the ladder by the same integer keeps levels-per-
  // floor on the tuned curve at every size. Derived from the grid's own
  // dims at apply time — never evented, so the log and the level still
  // cannot disagree.
  const s = Math.max(1, Math.floor(stretch));
  let level = 1;
  for (let l = XP_TO_REACH.length - 1; l >= 1; l -= 1) {
    if (xp >= XP_TO_REACH[l]! * s) { level = l; break; }
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
  /** Shallowest floor this kind may spawn on. Absent means anywhere. The
   *  teaching floor stays teachable: lingering harm and floor-waking do not
   *  belong in the first lesson (the ambush tag's depth gate, generalized). */
  readonly fromDepth?: number;
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
  // The stinger: weak blows that keep costing after the fight breaks off.
  // Its weapon is the retreat math — venom is the reason to answer it now.
  Object.freeze({
    kind: 'stinger',
    base: Object.freeze({ hp: 3, might: 2, wits: 2, speed: 3 }),
    growth: Object.freeze({ hp: 1, might: 1, wits: 1, speed: 1 }),
    weight: 2,
    fromDepth: 2,
  }),
  // The caller: frail and loud. It does not fight you; it makes the floor
  // fight you — the fight stops being this monster and becomes this room,
  // and the clock (the goblin-conjurer lineage, distilled).
  Object.freeze({
    kind: 'caller',
    base: Object.freeze({ hp: 3, might: 1, wits: 3, speed: 2 }),
    growth: Object.freeze({ hp: 2, might: 0, wits: 1, speed: 0 }),
    weight: 1,
    fromDepth: 3,
  }),
  // The slinger: the fight starts before you arrive — its verb is the
  // ground between you. Frail and slow so that reaching it settles it;
  // never on the teaching floor, where the first lesson is the bump.
  Object.freeze({
    kind: 'slinger',
    base: Object.freeze({ hp: 3, might: 2, wits: 2, speed: 2 }),
    growth: Object.freeze({ hp: 1, might: 1, wits: 1, speed: 0 }),
    weight: 2,
    fromDepth: 2,
  }),
  Object.freeze({
    kind: 'warden',
    base: Object.freeze({ hp: 16, might: 5, wits: 2, speed: 2 }),
    growth: Object.freeze({ hp: 6, might: 1, wits: 1, speed: 0 }),
    weight: 0,
  }),
  // The mimic: an item that was never an item. Weight 0 like the warden —
  // it never spawns from the random pool; the mimic roll is its own rare
  // draw at generation (MIMIC_IN). A surprise brawl at arm's reach: solid
  // body, real teeth, no legs to speak of — reaching it was the mistake.
  Object.freeze({
    kind: 'mimic',
    base: Object.freeze({ hp: 6, might: 4, wits: 1, speed: 2 }),
    growth: Object.freeze({ hp: 2, might: 1, wits: 0, speed: 0 }),
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
export type Verb = 'trample' | 'lunge' | 'ambush' | 'vigil' | 'venom' | 'call' | 'volley' | 'feign';

const VERBS: Readonly<Record<string, Verb>> = Object.freeze({
  bruiser: 'trample',
  skirmisher: 'lunge',
  stalker: 'ambush',
  warden: 'vigil',
  stinger: 'venom',
  caller: 'call',
  slinger: 'volley',
  // The mimic's art is stillness: hidden it does nothing at all, and its
  // unmasking loads the stalker's own spring — the first blow one band
  // harder, through the same recorded machinery.
  mimic: 'feign',
});

/** The archetype under a levelled kind: "bruiser-2" is a bruiser. Verbs,
 *  names and every other fact about a KIND belong to this, never to the
 *  level suffix — the designer's ruling 2026-07-28, after the 929-second
 *  run's keeper (warden-7) wore a stranger's name from the depth-6 warden
 *  (warden-4) and "a soot herald killed me" taught nothing. */
export function archetypeOf(kind: string): string {
  return kind.includes('-') ? kind.slice(0, kind.indexOf('-')) : kind;
}

/** The verb a kind acts by. */
export function verbOf(kind: string): Verb | undefined {
  return VERBS[archetypeOf(kind)];
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

/** How long a venomed wound burns, in rounds, and what each round costs.
 *  Three and one: enough to change the retreat math (breaking off does not
 *  end the fight), never enough to be a death sentence on its own. */
export const VENOM_TURNS = 3;
export const VENOM_HARM = 1;

/** How close (steps of walking) prey must come before a caller cries out —
 *  and how far from the prey the answered things rise. The riser distance
 *  matches the wave doctrine: pressure arrives as a chase, never out of
 *  the air beside you. */
export const CALL_RANGE = 6;
export const CALL_RISERS = 2;
export const CALL_DISTANCE = 6;

/** How far a loosed shot reaches, as the sight disc counts (dx²+dy² ≤ r²+r,
 *  the fog's own rounding) — inside the deepest floor's sight (7), so nothing
 *  shoots out of the dark. Adjacency is refused separately: the bump owns
 *  range 1, and the sling wants the ground the sword owns. One reach for
 *  every distance weapon until a weapon earns its own. */
export const SHOT_RANGE = 5;

/* ── the player's verbs ─────────────────────────────────────────────────── */

/**
 * The brace: set against the next blow. The monsters got verbs and the
 * player got none — that asymmetry was the gap the research kept pointing
 * at (Into the Breach's answer-every-telegraph discipline). Braced, you are
 * harder to hit by 2 + wits/2 — wits is the stat that sees the blow coming
 * — a trample cannot drive you back, a coiled spring breaks on the guard,
 * and anything that MISSES a set guard staggers, having overcommitted.
 * One round only: your next action of any kind drops the stance, so brace
 * is a read of the coming turn, never a place to live.
 */
export function braceWall(wits: number): number {
  return 2 + Math.floor(Math.max(0, wits) / 2);
}

/** What a body driven into a wall takes. One point: the shove is a tool of
 *  position, not a damage source — the wall is the argument. */
export const SLAM_DAMAGE = 1;

/** How far (steps of walking) a warden will be drawn from its post. Five
 *  covers the stair room; past it the warden turns back — the stairs are
 *  what it is for, and a boss kited across the floor is a boss solved. */
export const VIGIL_LEASH = 5;

/** How far a posted guard will be drawn from its post — the vigil's
 *  homeward half, generalized (the living-dungeon pass; the sibling
 *  agent-adventures engine leashes its guardians to the ANCHOR, not to
 *  wherever the chase has dragged them, and so do we). One shorter than
 *  the warden's: a guard owns a room, not an arena. */
export const GUARD_LEASH = 4;

/** The shallowest floor that wanders. The teaching floor stays teachable —
 *  the first lesson is the bump, not the patrol crossing your start. */
export const WANDER_FROM_DEPTH = 2;

/** The mimic's rarity: 1 floor in this many, from MIMIC_FROM_DEPTH down,
 *  holds at most one. Rare on purpose — met about once or twice per full
 *  descent, so an item on the floor stays worth trusting and the one that
 *  is not becomes a story. Never on the teaching floor: the first lesson
 *  about items must be true. */
export const MIMIC_IN = 6;
export const MIMIC_FROM_DEPTH = 2;

/** What a mimic may pretend to be: any kind the floor's own tables could
 *  honestly have put there — a lie is only good if it is plausible. */
export function mimicGuises(depth: number): readonly string[] {
  return [...provisionsAt(depth).map((p) => p.kind), ...ARMORY.map((r) => r.kind)];
}

/** A wanderer's round: how many waypoints, drawn between these bounds. */
export const ROUTE_STOPS: readonly [number, number] = [2, 4];

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
  // The venom's blows keep costing after the fight breaks off; the call is
  // worth more than the caller — it spends the floor's budget on a body
  // that buys two more. The volley is lunge-class: it converts approach
  // rounds into damage rounds, from farther — every step of the walk-in
  // is a round it may spend on you.
  venom: 1.2,
  call: 1.3,
  volley: 1.25,
  // Ambush-class, plus the disguise: the fight starts on its terms or not
  // at all. Priced though it never spends floor budget (the mimic roll is
  // separate) because threat is also the XP a kill pays.
  feign: 1.3,
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

/* ── board size ──────────────────────────────────────────────────────────── */

/**
 * The one integer the board's size turns: max(1, round(sqrt(area / 1536))).
 *
 * 1536 is the vale (48x32, the board the whole game was tuned on); the
 * expanse (96x64) reads 2, the waste (128x96) reads 3, and every tiny test
 * board reads 1 — which is what keeps stretch-1 worlds bit-identical to the
 * game as it stood before boards could breathe.
 *
 * Why sqrt and not area: meetings along a journey ≈ density × path length,
 * and the path grows with the *dimension*. Scaling creature count with the
 * dimension (not the area) holds encounters-per-journey roughly flat, so a
 * bigger board is locally SPARSER — the breathing room the designer asked
 * for, with the new elements (patrols, traps, the rare mimic) filling it.
 * Derived from dims already recorded in WORLD_INIT: size needs no schema.
 */
export function sizeStretch(width: number, height: number): number {
  return Math.max(1, Math.round(Math.sqrt((width * height) / 1536)));
}

/** The board chokepoint (the maze-solver discipline: clamp once, loudly).
 *  Above this an accidental dimension allocates a country, not a floor. */
export const MAX_BOARD_DIM = 256;

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
export function spawnBudget(depth: number, stretch = 1): number {
  const d = Math.max(1, Math.floor(depth));
  const deep = Math.max(0, d - 2);
  // The stretch multiplies the whole rent (sizeStretch): a bigger board
  // fields more creatures in absolute count and fewer per tile — meetings
  // per journey hold roughly flat, and the ground breathes between them.
  return (24 + 15 * d + 4 * deep * deep) * Math.max(1, Math.floor(stretch));
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

/** How grown the warden arrives. Level 1 on the first boss floor — the
 *  depth-3 pins were tuned against it — then tracking the floor (depth − 2)
 *  so the deep's wardens stay wardens: measured at the old floor(depth/3),
 *  a depth-9 warden rated 63 threat while its own floor's chaff rated 113,
 *  and the "boss" was the fourth-scariest thing in its own arena. */
export function wardenLevel(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  return d <= 3 ? 1 : d - 2;
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
  /** What wearing it costs, when it costs. A tradeoff relic is never taken
   *  by walking — the dominance rule refuses it and the , key accepts it —
   *  so the price is always a price somebody chose to pay. */
  readonly costs?: { readonly stat: keyof Stats; readonly amount: number };
}

export const ARMORY: readonly Relic[] = Object.freeze([
  Object.freeze({ kind: 'keen edge', grants: 'might' as const, base: 2, per: 3, weight: 3 }),
  Object.freeze({ kind: 'iron charm', grants: 'hp' as const, base: 3, per: 1, weight: 3 }),
  Object.freeze({ kind: 'fleet boots', grants: 'speed' as const, base: 1, per: 3, weight: 2 }),
  Object.freeze({ kind: 'grey lens', grants: 'wits' as const, base: 1, per: 2, weight: 2 }),
  // The iconic tradeoff, singular on purpose (the research's cap: one or
  // two where the flavor does the explaining — "heavy" explains itself).
  Object.freeze({ kind: 'heavy edge', grants: 'might' as const, base: 3, per: 2, weight: 2, costs: Object.freeze({ stat: 'speed' as const, amount: 1 }) }),
  // The named properties: one rule-bending trait each, stats deliberately
  // modest — the property is the point (Brogue's runics, kept to a count
  // the fold can honor).
  Object.freeze({ kind: 'sure edge', grants: 'might' as const, base: 2, per: 4, weight: 1 }),
  Object.freeze({ kind: 'steady boots', grants: 'speed' as const, base: 1, per: 4, weight: 1 }),
  // The distance weapon. Modest might on purpose: it rides its own hand
  // (the sling slot — dual wield, the panel's verdict 2026-07-28) beside
  // the blade, and its grant stacks into the one might stat — strong arms
  // throw hard, and the number the rail shows stays the number every blow
  // obeys. Its real grant is the 'ranged' trait: draw and loose (M8).
  Object.freeze({ kind: 'leaden sling', grants: 'might' as const, base: 1, per: 3, weight: 2 }),
]);

/** The rule a named relic bends, by kind. Read at the moments the rule
 *  matters (a crit landing, a trample shoving) — never stored on the
 *  entity, so replay derives it identically forever. */
export const RELIC_TRAITS: Readonly<Record<string, 'stagger-crit' | 'hold-ground' | 'ranged'>> = Object.freeze({
  'sure edge': 'stagger-crit',
  'steady boots': 'hold-ground',
  'leaden sling': 'ranged',
});

/** Whether an entity's worn gear carries a trait. */
export function wearsTrait(
  gear: Readonly<Partial<Record<string, { kind: string }>>> | undefined,
  trait: 'stagger-crit' | 'hold-ground' | 'ranged',
): boolean {
  if (gear === undefined) return false;
  return Object.values(gear).some((g) => g !== undefined && RELIC_TRAITS[g.kind] === trait);
}

/** Strict upgrade: at least as good on every axis and better in total.
 *  This is what walking may take unasked; anything less — any tradeoff,
 *  any sidegrade — waits for a decision. A total order produces zero
 *  decisions by construction; this is the minimum concession. */
export function dominates(a: Stats, b: Stats): boolean {
  return a.hp >= b.hp && a.might >= b.might && a.wits >= b.wits && a.speed >= b.speed
    && grantValue(a) > grantValue(b);
}

/**
 * Which slot a relic occupies, by the stat it grants. One slot, one item:
 * a second keen edge REPLACES the first rather than stacking — two swords do
 * not make you twice as strong, they make you a person holding two swords.
 */
export const SLOTS = ['weapon', 'sling', 'armor', 'boots', 'trinket'] as const;
export type Slot = (typeof SLOTS)[number];

export function slotOf(grants: Stats): Slot {
  if (grants.might >= Math.max(grants.hp, grants.speed, grants.wits)) return 'weapon';
  if (grants.hp >= Math.max(grants.speed, grants.wits)) return 'armor';
  if (grants.speed >= grants.wits) return 'boots';
  return 'trinket';
}

/** Where a relic goes, KNOWING what it is: the trait routes first (a
 *  ranged relic lives in the sling hand — dual wield, the panel's verdict
 *  2026-07-28), the grants route the rest. New takes record the resolved
 *  slot on the event (ITEM_TAKEN v4 gearSlot); old chains never carried
 *  it and refold by grants alone, exactly as they always did. */
export function slotFor(kind: string, grants: Stats): Slot {
  if (RELIC_TRAITS[kind] === 'ranged') return 'sling';
  return slotOf(grants);
}

/** One number for "how much item": what replacement compares. */
export function grantValue(grants: Stats): number {
  return grants.hp + grants.might + grants.wits + grants.speed;
}

/** The grant a relic gives at a depth. Never zero: a prize that does nothing
 *  is a lie with a guard on it. A costed relic's price rides in the same
 *  Stats, negative — one shape for every reader. */
export function relicGrant(relic: Relic, depth: number): Stats {
  const d = Math.max(1, Math.floor(depth));
  const amount = relic.base + Math.floor((d - 1) / relic.per);
  const worth = (stat: keyof Stats): number =>
    (relic.grants === stat ? amount : 0) - (relic.costs?.stat === stat ? relic.costs.amount : 0);
  return { hp: worth('hp'), might: worth('might'), wits: worth('wits'), speed: worth('speed') };
}

/* ── the satchel ─────────────────────────────────────────────────────────── */

/**
 * What the satchel may carry: one thing, used once, chosen over and over.
 *
 * The research lineage is specific about what this must NOT be: a pure heal
 * collapses to "carry heal, drink at low health" (DCSS calls that a
 * no-brainer; Slay the Spire's potion-hoarding is the same failure with
 * three slots), and this game's stair-heal and level-heal already saturate
 * attrition. So the draught is Brogue's answer — potion of *life*, not of
 * healing: the mend and a permanent raise in one swallow, so drinking early
 * banks the ceiling and drinking late banks the blood, and neither timing
 * is wasted. The smoke is the fog-and-chase game's own escape: the hunt
 * loses the truth of you, which is the one story this AI can tell best.
 *
 * One satchel slot, walk-over swap (the old one stays on the tile, taking
 * it back is one step), one key to use. No farming surface: one provision
 * per floor, fixed at generation, counted like everything else.
 */
export interface Provision {
  readonly kind: string;
  readonly weight: number;
  /** The first depth this kind may spawn at (absent reads 1). Floor one
   *  keeps the teaching trio; the wider pantry opens as floors go by. */
  readonly fromDepth?: number;
}

export const PROVISIONS: readonly Provision[] = Object.freeze([
  Object.freeze({ kind: 'vital draught', weight: 3 }),
  Object.freeze({ kind: 'still smoke', weight: 2 }),
  // The information tool: break it and light reaches FLARE_RADIUS paces —
  // layout, never occupants.
  Object.freeze({ kind: 'tallow flare', weight: 2 }),
  // The pantry widened on the designer's word (the 929-second run filled
  // both hands with phials and asked for more kinds, math run). Three more,
  // one per niche the trio leaves open, none of them raising player damage:
  //
  // The ward: held protection. The NEXT blow that lands on you is drunk
  // whole — no wound, no venom, no flinch — then it is spent. Worth about
  // one deep-warden blow (10-12), under half a draught's rescue, but it can
  // be worn BEFORE the fight and it holds a draw steady through a hit.
  Object.freeze({ kind: 'ash ward', weight: 2, fromDepth: 2 }),
  // The burr: cast at your feet, every hostile beside you staggers — each
  // spends its next action reeling (the recorded WAIT). The melee escape
  // valve, priced by needing them adjacent first: smoke's cousin that works
  // AFTER they reach you, on the ones who did.
  Object.freeze({ kind: 'iron burr', weight: 2, fromDepth: 3 }),
  // The bell: rings once and the way out answers — the exit and every
  // unfound prize on the floor join the map. Knowledge, never power; the
  // flare's far-sighted sibling.
  Object.freeze({ kind: 'hollow bell', weight: 1, fromDepth: 2 }),
]);

/** The kinds a floor of this depth may hold — the pantry gate. One counted
 *  draw either way, so generation's stream is untouched by the gating. */
export function provisionsAt(depth: number): readonly Provision[] {
  return PROVISIONS.filter((p) => (p.fromDepth ?? 1) <= depth);
}

/** How far the flare's knowledge reaches, in tiles. Wider than sight, less
 *  than a floor: a room and its neighbours, not the map. */
export const FLARE_RADIUS = 7;

export function provisionOf(kind: string): Provision | undefined {
  return PROVISIONS.find((p) => p.kind === kind);
}

/** The draught's permanent raise to the health ceiling, by depth band —
 *  deeper floors owe stronger blood. Small on purpose: it compounds only as
 *  fast as floors go by, one per floor at most. */
export function draughtCeiling(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 3) return 2;
  if (d <= 6) return 3;
  return 4;
}

/** How many turns the smoke holds — hunts chase where you WERE when it rose,
 *  then stand puzzled. Deeper floors buy longer, because deeper floors have
 *  more to run from. */
export function smokeTurns(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 3) return 6;
  if (d <= 6) return 8;
  return 10;
}

/** When the archetypal players reach for the satchel (play/policies.ts) —
 *  fixed thresholds, deliberately dumb. They are also the collapse canary:
 *  if a bot drinking at 35% plays the satchel as well as a person, the
 *  satchel has stopped being a decision and should be redesigned. */
export const BOT_QUAFF_BELOW = 0.35;
export const BOT_SMOKE_WITHIN = 3;

/* ── traps ───────────────────────────────────────────────────────────────── */

/**
 * The trap table (the living-dungeon pass). The designer asked for wits-
 * rolled detection; the sibling engine's doctrine ("hidden = chore,
 * visible = puzzle") tunes it: the two chances compound high enough that
 * most traps are FOUND things — a marked square you route around — and
 * the rare miss is the story. Kinds are the genre's shapes of harm
 * (blood, venom, tempo, noise, bodies, gravity, distance — the ml-maze
 * taxonomy widened by the classics), never on the teaching floor, and
 * none of them on the walked-in first steps.
 *
 * `dodge` is the kind's law: 'always' rolls speed, 'never' is by design
 * (you cannot dodge the floor giving way or a bell you already rang),
 * and a number is the player level that first earns the roll.
 */
export interface TrapKind {
  readonly kind: string;
  readonly fromDepth: number;
  /** Deepest floor this kind may lie on. The maw never on the bottom:
   *  there is no floor below the bottom to fall to. */
  readonly maxDepth?: number;
  readonly weight: number;
  readonly dodge: 'always' | 'never' | number;
}

export const TRAP_KINDS: readonly TrapKind[] = Object.freeze([
  // Blood, plainly: 1d4 + floor(depth/2), dodgeable outright.
  Object.freeze({ kind: 'spike pit', fromDepth: 2, weight: 3, dodge: 'always' as const }),
  // The stinger's wound without the stinger — dodgeable once you have
  // learned to move (player level 3): the needle is FAST.
  Object.freeze({ kind: 'venom needle', fromDepth: 2, weight: 2, dodge: 3 }),
  // Tempo: rooted for a few rounds. Blows still swing both ways; what the
  // snare takes is the choice to leave.
  Object.freeze({ kind: 'strangling snare', fromDepth: 2, weight: 2, dodge: 'always' as const }),
  // Noise: the floor knows you. Every hunt ignores its awareness cap while
  // the ringing holds. Undodgeable by design — it already rang.
  Object.freeze({ kind: 'alarm bell', fromDepth: 3, weight: 2, dodge: 'never' as const }),
  // Bodies: one riser, drawn from the floor's own band, standing up a few
  // paces off — never adjacent, so the spawn's first blow is avoidable by
  // moving (the designer's word). The trigger itself cannot be dodged.
  Object.freeze({ kind: 'hatch', fromDepth: 3, weight: 2, dodge: 'never' as const }),
  Object.freeze({ kind: 'nest hatch', fromDepth: 5, weight: 1, dodge: 'never' as const }),
  // Gravity: the floor gives way — fall damage and the floor below, no
  // stair rest, satchel kept. You cannot dodge the floor.
  Object.freeze({ kind: 'the maw', fromDepth: 4, maxDepth: 8, weight: 1, dodge: 'never' as const }),
  // Distance: a drawn far tile swallows you. Sometimes an escape, mostly
  // a stranding — the lodestone does not care which you needed.
  Object.freeze({ kind: 'lodestone', fromDepth: 4, weight: 1, dodge: 'never' as const }),
]);

export function trapOf(kind: string): TrapKind | undefined {
  return TRAP_KINDS.find((t) => t.kind === kind);
}

/** The kinds a floor of this depth may hold. */
export function trapKindsAt(depth: number): readonly TrapKind[] {
  return TRAP_KINDS.filter((t) => t.fromDepth <= depth && depth <= (t.maxDepth ?? Number.POSITIVE_INFINITY));
}

/** How many traps a floor lays: none on the teaching floor, then a band
 *  by depth, stretched with the board — about one per thousand tiles at
 *  the default size, Brogue's order of rarity. */
export function trapCount(depth: number, stretch = 1): number {
  const d = Math.max(1, Math.floor(depth));
  if (d <= 1) return 0;
  const base = d <= 3 ? 2 : d <= 6 ? 3 : 4;
  return base * Math.max(1, Math.floor(stretch));
}

/** A trap's level: what the wits and speed rolls are up against. */
export function trapLevelAt(depth: number): number {
  return Math.min(3, Math.ceil(Math.max(1, depth) / 3));
}

/** The three rolls, one shape: d20 + stat ≥ need + 2·level. Sight is the
 *  first look, near is the second chance up close (easier — closer is
 *  louder), dodge is the last instant. At depth 4 (level 2, wits 4-5) the
 *  two detection chances compound to ≈83%: most traps are found things. */
export const TRAP_SIGHT_NEED = 10;
export const TRAP_NEAR_NEED = 8;
export const TRAP_DODGE_NEED = 12;
/** How close (steps of walking) "very near" is. */
export const TRAP_NEAR_RADIUS = 2;

/** What the kinds do, in numbers. */
export const SPIKE_DIE = 4;
export const NEEDLE_VENOM_TURNS = 4;
export const SNARE_TURNS = 3;
export const ALARM_TURNS = 12;
export const MAW_DIE = 6;
export const MAW_FLAT = 2;
/** Where a hatch's risers stand up: steps of walking from the trap,
 *  inside this band — never beside you, always a chase. */
export const HATCH_BAND: readonly [number, number] = [3, 5];

/* ── the bottom ──────────────────────────────────────────────────────────── */

/**
 * The world has a floor, and the floor has a heart.
 *
 * GESTALT L4, shaped by what the tradition itself testifies: touching the
 * prize and instantly winning is the anticlimax DCSS diagnosed in its own
 * orb run, and the full climb back out is a second game's worth of build.
 * What carries the meaning is the REVERSAL — after the prize, the world
 * hunts you — so the ending is a one-floor holdout: the heart lies at the
 * far end of the ninth floor behind the last warden; seizing it fills your
 * hands (the satchel is sealed); the world stirs in waves while you carry
 * it back to the stair you came down by. Reach it, and the world is won.
 *
 * Nine floors: wardens stand at 3, 6 and 9, so the bottom is the third
 * peak — and nine is a run's worth of evenings under rebirth, not 1980's
 * twenty-six.
 */
export const BOTTOM_DEPTH = 9;

/** The one thing the ninth floor keeps. Named per world (the Oracle draws
 *  from the bible's palette); article-free like every kind. */
export const HEART_KIND = 'heart';

/** How often the seized world stirs: every this-many turns while the heart
 *  is carried, something rises. Eight is two or three fights' worth of
 *  walking on a 48-wide floor — pressure, not a blender. */
export const WAVE_EVERY = 8;

/** How far from the carrier a stirred thing rises (tiles of flight, cheap
 *  on purpose): far enough to be a chase, never an ambush out of the air. */
export const WAVE_DISTANCE = 8;
