import { generateMap, pickSpawnPoints, farthestFrom, withExit, walkDistance, walkPath, sealSecretRoom, repairWithSecret } from './mapgen.js';
import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { intBetween } from './rng.js';
import { clearShot, withinReach } from './sight.js';
import { neededToHit, chanceIn20, damageDice, critFloor, WHIFF, BESTIARY, creatureStats, threatOf, spawnBudget, depthBands, wardenAt, ARMORY, relicGrant, slotFor, RELIC_TRAITS, motifAt, verbOf, wardenLevel, AMBUSH_MIGHT_BONUS, AMBUSH_FROM_DEPTH, braceWall, CALL_RISERS, CALL_DISTANCE, dominates, wearsTrait, FLARE_RADIUS, provisionsAt, provisionOf, draughtCeiling, smokeTurns, BOTTOM_DEPTH, HEART_KIND, WAVE_DISTANCE, SHOT_RANGE } from './tables.js';
import type { Relic } from './tables.js';
import type { Entity, Stats, Pos } from './entity.js';
import { itemAt } from './item.js';
import { EXIT, SECRET, tileAt } from './grid.js';
import { nextActive } from './turns.js';
import { MAX_RULES } from '../canon/rule.js';
import type { Rule } from '../canon/rule.js';
import type { Bible } from '../canon/bible.js';
import { SCHEMA_VERSIONS } from './events.js';
import type { DraftEvent } from './events.js';
import type { GameState } from './state.js';

const STARTING_STATS = { hp: 10, might: 3, wits: 3, speed: 4 } as const;

/** Fewer hit points than you, and it hits harder. One is a fight you win while
 *  losing blood; two at once is a fight you lose. That gap is the whole reason
 *  avoiding something, or detouring for an edge, can be the better move. */


/** Far enough that nothing is already on top of you when the world opens. */
export const OPPONENT_MIN_DISTANCE = 8;

/** A strike always consumes two draws — the roll, then the damage — whether or
 *  not it lands. Spending the same count either way keeps the counter's
 *  progress independent of the outcome, so a replay lands on identical draws
 *  without needing to know what happened. */
export const STRIKE_DRAWS = 2;

/**
 * Whether one creature will attack another: the world against you, never
 * against itself. The old rule — different kinds fight — was written when
 * every creature was a 'thing'; a mixed bestiary under it would brawl among
 * itself on the way to the player, and a dungeon that clears its own floors
 * is a hallway.
 */
export function isHostile(a: Entity, b: Entity): boolean {
  return (a.kind === 'you') !== (b.kind === 'you');
}

/**
 * Resolves a blow. Legible on purpose: you need `10 + their speed - your might`
 * or better on a d20, and deal 1 to your might. A player can hold that in their
 * head and decide whether a fight is worth taking, which is what makes avoiding
 * one a decision rather than a coin toss.
 */
/**
 * What `attacker` needs on a d20 to land a blow on `target`.
 *
 * Exported because a number you decide on has to be a number you can see. The
 * stat block says `might 3`; it does not say "you hit on 10+ and deal 1 to 3",
 * and the second is the one a player actually weighs. Playing found this: a +2
 * might item raises damage per turn by about three quarters and read as having
 * done nothing at all, because nothing ever said so.
 */
export function toHit(attacker: Entity, target: Entity): number {
  return neededToHit(attacker.stats.might, target.stats.speed);
}

/** The chance, out of 20, that the blow lands. */
export function hitChance(attacker: Entity, target: Entity): number {
  return chanceIn20(toHit(attacker, target));
}

/** Whether this attacker is a coiled ambusher whose spring is still loaded.
 *  The tag is written by generation (stalkers born at depth 2+), spent by the
 *  reducer on the first landed blow — so the gate is the tag, one source of
 *  truth, and no strike-time depth check can disagree with the floor. */
function springLoaded(attacker: Entity): boolean {
  return verbOf(attacker.kind) === 'ambush' && attacker.tags.includes('ambush');
}

function resolveStrike(
  seed: number,
  counter: number,
  attacker: Entity,
  target: Entity,
): { roll: number; needed: number; hit: boolean; damage: number; crit: boolean; warded?: true } {
  const roll = intBetween(seed, counter, 1, 20);
  // The set guard raises the bar: harder to hit by 2 + wits/2 — wits is the
  // stat that reads the incoming blow. Baked into `needed` so the recorded
  // event and every tooltip say the truth the roll actually faced.
  const needed = toHit(attacker, target)
    + (target.tags.includes('braced') ? braceWall(target.stats.wits) : 0);

  // The naturals outrank the arithmetic: the crit band always lands and
  // doubles, a 1 always misses. Wits widens the band — the one mechanical job
  // wits has, so a rule granting it grants something real.
  const crit = roll >= critFloor(attacker.stats.wits);
  const hit = crit || (roll !== WHIFF && roll >= needed);

  // Drawn either way, so the draw count never depends on the outcome. The
  // crit doubles this same draw rather than taking another.
  //
  // The ambush blow rolls one damage band harder (might + 2 is the band
  // step): the coiled spring, released. To-hit is untouched — stillness
  // sharpens the blow, not the aim — and the bonus caps at one band because
  // a first strike that can kill from full health is a no-warning spike,
  // and the tradition deleted those. A braced guard breaks the spring: the
  // bonus is absorbed, the coil still spends itself.
  const sprung = springLoaded(attacker) && !target.tags.includes('braced');
  const { die, flat } = damageDice(attacker.stats.might + (sprung ? AMBUSH_MIGHT_BONUS : 0));
  const rolledDamage = intBetween(seed, counter + 1, 1, die) + flat;
  const landing = hit ? (crit ? rolledDamage * 2 : rolledDamage) : 0;
  // The worn ward drinks a landing blow whole. Resolved HERE so the chain
  // records what happened (damage 0, warded said), and the draws are spent
  // either way — the ward changes the wound, never the stream. Absent when
  // it did not fire, so every caller's payload spread reads legacy-clean.
  const warded = landing > 0 && target.tags.includes('warded');
  return warded
    ? { roll, needed, hit, crit, damage: 0, warded: true }
    : { roll, needed, hit, crit, damage: landing };
}

/** The player as a floor receives them: stats, ceiling and progress carried
 *  whole from the floor above. */
export interface CarriedPlayer {
  stats: Stats;
  maxHp: number;
  xp: number;
  level: number;
  gear?: Record<string, { kind: string; grants: Stats }>;
  satchel?: { kinds: readonly string[] };
}

/**
 * Chooses this floor's population from the bestiary, spending the depth's
 * threat budget. Every choice is a counted draw, so generation stays inside
 * the draw protocol.
 *
 * Two-stage pick per creature: a depth band (mostly here, sometimes one up,
 * rarely one down — the Brogue blur), then an archetype by weight. Spending
 * stops when the budget cannot afford the cheapest thing left, so a floor is
 * always as full as its budget allows. The warden joins on its floors without
 * consuming budget: a boss is the floor's *feature*, not part of its rent.
 */
function chooseSpawns(seed: number, counter: number, depth: number): {
  chosen: { kind: string; level: number; stats: Stats }[];
  counterAfter: number;
} {
  const chosen: { kind: string; level: number; stats: Stats }[] = [];
  const spawnable = BESTIARY.filter((a) => a.weight > 0 && depth >= (a.fromDepth ?? 1));
  let budget = spawnBudget(depth);
  let c = counter;

  // A boss floor is a peak, not a double peak: the warden pays half its own
  // threat out of the floor's budget, so its minions thin out around it and
  // the fight is about the warden rather than the crowd it stands in.
  if (wardenAt(depth)) {
    const level = wardenLevel(depth);
    budget -= Math.floor(threatOf(creatureStats('warden', level)!, 'warden') / 2);
  }

  const cheapest = (): number => Math.min(
    ...spawnable.map((a) => threatOf(creatureStats(a.kind, Math.max(1, depth - 1))!, a.kind)),
  );

  for (let guard = 0; guard < 32 && budget >= cheapest(); guard += 1) {
    const bands = depthBands(depth);
    const bandTotal = bands.reduce((n, b) => n + b.weight, 0);
    let roll = intBetween(seed, c, 1, bandTotal); c += 1;
    let level = bands[0]!.level;
    for (const band of bands) {
      roll -= band.weight;
      if (roll <= 0) { level = band.level; break; }
    }

    const archTotal = spawnable.reduce((n, a) => n + a.weight, 0);
    let pick = intBetween(seed, c, 1, archTotal); c += 1;
    let arch = spawnable[0]!;
    for (const a of spawnable) {
      pick -= a.weight;
      if (pick <= 0) { arch = a; break; }
    }

    const stats = creatureStats(arch.kind, level)!;
    const price = threatOf(stats, arch.kind);
    if (price > budget) continue; // rolled above our means; roll again
    budget -= price;
    chosen.push({ kind: level === 1 ? arch.kind : `${arch.kind}-${String(level)}`, level, stats });
  }

  if (wardenAt(depth)) {
    const level = wardenLevel(depth);
    chosen.push({ kind: level === 1 ? 'warden' : `warden-${String(level)}`, level, stats: creatureStats('warden', level)! });
  }

  return { chosen, counterAfter: c };
}

export function createWorld(
  seed: number,
  width: number,
  height: number,
  playerId = 'player',
  depth = 1,
  carried?: CarriedPlayer,
): Extract<DraftEvent, { type: 'WORLD_INIT' }> {
  // The depth cuts the floor to a motif — the door, the warren, the halls,
  // or the deep's per-floor draw (tables.ts, BALANCE.md pass 10). Drawn
  // first, so the whole floor is shaped by it.
  const cut = motifAt(seed, 0, depth);
  const generated = generateMap(seed, cut.counterAfter, width, height, cut.motif);

  // The way out sits at the far end of the map, so a run has a direction and
  // the journey is the longest one this world affords rather than an accident.
  //
  // Except at the bottom. The ninth floor turns around: the HEART lies at
  // the far end (behind the last warden), and the way out is the stair you
  // came down by — the tile you are standing on when the floor is born.
  // Seize the heart and carry it back: the ending is the reversal, not the
  // touch.
  const bottom = depth >= BOTTOM_DEPTH;
  const far = farthestFrom(generated.grid, generated.start);
  const exit = bottom ? generated.start : far;
  const opened = withExit(generated.grid, exit);

  // Sometimes a room keeps itself secret — every doorway an illusory wall.
  // Then the designer's repair rule, defence in depth: a floor that somehow
  // arrives with truly stranded rooms gets a hidden way cut in rather than
  // being thrown away. By construction repair never fires; a sabotaged build
  // once leaked exactly such a floor into a live session, and the rule is
  // better than the throw.
  // At the bottom, the far anchor protects the heart's room from sealing
  // (exit === start there, so both ends stay open either way).
  const secret = sealSecretRoom(seed, generated.counterAfter, opened, generated.rooms, generated.start, bottom ? far : exit, cut.motif.secretIn);
  const repaired = repairWithSecret(secret.grid, generated.start);
  const grid = repaired.grid;

  const walk = walkDistance(grid, generated.start, bottom ? far : exit);

  const population = chooseSpawns(seed, secret.counterAfter, depth);

  // The floor's prizes, drawn from the armory by weight — counted draws like
  // every other choice generation makes. One relic on the first floor; two
  // from depth 2, drawn without replacement so a floor never doubles up.
  //
  // Two is a tuning consequence, not generosity: when the armory replaced the
  // guaranteed +2-might edge with a weighted draw, the fighter's expected
  // power dropped and the depth-3 inversion collapsed to a coin flip
  // (13 vs 14 on 40 seeds). Deeper floors owing two relics restores the
  // expected growth the sawtooth was tuned against, and buys a real choice —
  // which prize to fight toward first — at the same time.
  // The first floor always leaves a weapon. The fighter's early curve keys on
  // the might band-jump the edge buys, and when the armory made that a
  // weighted maybe, floor-one deaths quadrupled and the depth-3 inversion
  // collapsed. Variety starts at depth 2, where the floors owe two relics.
  const relicCount = depth >= 2 ? 2 : 1;
  // Depth 1 guarantees the keen edge BY NAME — the fighter's curve keys on
  // it, and finding it by granted stat was one armory reorder away from
  // handing the teaching floor a sling instead (the panel's fragility note).
  const pool = depth === 1 ? [ARMORY.find((r) => r.kind === 'keen edge')!] : [...ARMORY];
  const relics: Relic[] = [];
  let c = population.counterAfter;
  for (let i = 0; i < relicCount && pool.length > 0; i += 1) {
    const totalWeight = pool.reduce((n, r) => n + r.weight, 0);
    let roll = intBetween(seed, c, 1, totalWeight); c += 1;
    let picked = pool[0]!;
    for (const r of pool) {
      roll -= r.weight;
      if (roll <= 0) { picked = r; break; }
    }
    relics.push(picked);
    pool.splice(pool.indexOf(picked), 1);
  }
  // Depth 2 owes a ranged relic (the panel's verdict, 2026-07-28): the
  // slinger debuts here, and the floor that first volleys AT you is the
  // floor that puts the volley in your hand. The draws stand as drawn —
  // this is a drawless adjustment, like every placement decision — and
  // only the second prize gives way.
  if (depth === 2 && !relics.some((r) => RELIC_TRAITS[r.kind] === 'ranged')) {
    relics[relics.length - 1] = ARMORY.find((r) => RELIC_TRAITS[r.kind] === 'ranged')!;
  }

  // The floor's one provision, drawn by weight like everything else and laid
  // at the last drawn point — far from the door, unguarded on purpose. The
  // armory pays for fighting; the satchel pays for scouting: a guarded
  // consumable would just be a fifth relic, and an on-path one is not a
  // detour, it is a toll both already collected.
  const pantry = provisionsAt(depth);
  const provTotal = pantry.reduce((n, p) => n + p.weight, 0);
  let provRoll = intBetween(seed, c, 1, provTotal); c += 1;
  let provision = pantry[0]!;
  for (const p of pantry) {
    provRoll -= p.weight;
    if (provRoll <= 0) { provision = p; break; }
  }

  const spawned = pickSpawnPoints(
    seed,
    c,
    grid,
    generated.start,
    population.chosen.length + 1,
    OPPONENT_MIN_DISTANCE,
  );
  const provisionTile = spawned.points[spawned.points.length - 1] ?? exit;

  // Placed on creatures' tiles: a prize is guarded, so taking it means going
  // through something. An item you can pick up for free is not a choice.
  const guardPosts = relics.map((_r, i) => spawned.points[i] ?? exit);

  // The teaching floor reaches the player (the baseline-balance ruling,
  // 2026-07-28): depth 1's one relic — the fighter's whole early curve —
  // and its guard stand ON the walked path, eight steps in, so simply
  // walking the floor meets the fight early and the prize on the way.
  // Measured need: a real player crossed 273 turns of this floor with the
  // keen edge lying unclaimed on a far drawn point, and died bare, twice.
  // Chosen, not drawn (drawless like every placement decision); deeper
  // floors keep the detour economy untouched.
  if (depth === 1 && guardPosts.length > 0) {
    const road = walkPath(grid, generated.start, exit);
    const at = Math.min(OPPONENT_MIN_DISTANCE, road.length - 2);
    const post = road[at];
    if (post !== undefined && at > 0) guardPosts[0] = { x: post.x, y: post.y };
  }

  // The stairs are watched. Rooms and corridors made every fight avoidable —
  // measured: the runner out-survived the fighter 11 to 9 at depth 3, the
  // exact domination the Covenant forbids — so the way out costs something:
  // the strongest thing on the floor stands beside it. On warden floors that
  // is the warden, with no special case, because a boss out-threatens
  // everything by construction (ties break to the later pick, where the
  // warden stands). Chosen before guard duty is handed out: the keeper is
  // never a relic guard, even on a floor with more prizes than creatures —
  // found on exactly such a floor, where the warden had been drafted onto a
  // relic and the stairs stood open. Deterministic and drawless, like every
  // placement *decision*.
  let keeper = -1;
  let keeperThreat = -1;
  population.chosen.forEach((ch, i) => {
    const t = threatOf(ch.stats, ch.kind);
    if (t >= keeperThreat) { keeperThreat = t; keeper = i; }
  });
  // On a warden floor the warden keeps the door BY ROLE, not by arithmetic.
  // The old claim — "it out-threatens everything by construction" — broke
  // quietly the first time an out-of-depth roll landed: a depth-9 floor was
  // measured with its warden fourth-scariest, and the stairs going to a
  // skirmisher. The post is the warden's identity (the vigil verb says so);
  // the strongest-thing rule remains for every unbossed floor.
  if (wardenAt(depth)) {
    const w = population.chosen.findIndex((ch) => ch.kind.startsWith('warden'));
    if (w >= 0) keeper = w;
  }

  // Guards: the first creatures that are not the keeper, one per relic. A
  // floor too poor in creatures leaves its later prizes lying unguarded —
  // poverty is honest, an unwatched stair is not.
  const guardOf = new Map<number, number>();
  for (let i = 0; i < population.chosen.length && guardOf.size < relics.length; i += 1) {
    if (i !== keeper) guardOf.set(i, guardOf.size);
  }

  // The post is the first standable tile beside the exit that is not a guard
  // post; everyone unassigned takes the remaining drawn points in order.
  const isGuardPost = (p: { x: number; y: number }): boolean =>
    guardPosts.slice(0, guardOf.size).some((q) => q.x === p.x && q.y === p.y);
  // What the keeper watches: the stairs — or, at the bottom, the heart.
  const watched = bottom ? far : exit;
  const keeperTile = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    .map(([dx, dy]) => ({ x: watched.x + dx, y: watched.y + dy }))
    .find((p) => isPassable(grid, p.x, p.y)
      // Never on an illusory wall: a keeper standing in what paints as wall
      // gives the secret away, and reads as a haunting.
      && tileAt(grid, p.x, p.y) !== SECRET
      && !(p.x === generated.start.x && p.y === generated.start.y)
      && !isGuardPost(p));
  const freePoints = spawned.points.filter((p, i) =>
    i >= relics.length && i < spawned.points.length - 1
    && !(keeperTile !== undefined && p.x === keeperTile.x && p.y === keeperTile.y));
  let nextFree = 0;

  // The floor's whole account, recorded where facts live — covenant L1: the
  // shape, the journey, the rent and what it bought, who watches the door,
  // what lies guarded. This is the generation reasoning chain, in the event,
  // so the ledger can read it back for any floor of any run forever.
  const spent = population.chosen.reduce((n, ch) => n + threatOf(ch.stats, ch.kind), 0);
  const kinds = population.chosen.map((ch) => ch.kind).join(', ');
  const watcher = keeper >= 0 && keeperTile !== undefined ? population.chosen[keeper]!.kind : 'nobody';
  const coiled = depth >= AMBUSH_FROM_DEPTH
    ? population.chosen.filter((ch) => verbOf(ch.kind) === 'ambush').length
    : 0;
  const story = `${cut.motif.name} · ${generated.story}`
    + (bottom
      ? ` · the bottom — the heart lies ${Number.isFinite(walk) ? walk : '?'} steps of walking away, and the way out is the stair you came down by`
      : ` · the way out is ${Number.isFinite(walk) ? walk : '?'} steps of walking`)
    + ` · a budget of ${spawnBudget(depth)} paid ${spent} for ${population.chosen.length}: ${kinds}`
    + ` · ${watcher} watches ${bottom ? 'the heart' : 'the stairs'}`
    + ` · ${relics.map((r) => r.kind).join(' and ') || 'nothing'} lies guarded`
    + ` · ${provision.kind} lies where the path does not go`
    + (coiled > 0 ? ` · ${coiled} of them lie${coiled === 1 ? 's' : ''} coiled, waiting` : '')
    + (secret.sealed ? ' · one room keeps itself secret' : '')
    + (repaired.punched > 0 ? ` · ${repaired.punched} hidden way(s) cut where no way was` : '')
    + (depth === 1 ? ` · the world runs ${BOTTOM_DEPTH} floors deep, and something beats at the bottom` : '');

  return {
    type: 'WORLD_INIT',
    schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0,
    // Generation started from counter 0, so the counter it finished on after
    // placing inhabitants is exactly the number of draws it consumed.
    rngDraws: spawned.counterAfter,
    payload: {
      width,
      height,
      tiles: [...grid.tiles],
      seed,
      story,
      // The cut, as a token beside the story's prose — same fact, one for
      // rules to read and one for players.
      motif: cut.motif.key,
      depth,
      xp: carried?.xp ?? 0,
      level: carried?.level ?? 1,
      ...(carried === undefined ? {} : { playerMaxHp: carried.maxHp }),
      ...(carried?.gear === undefined ? {} : { playerGear: carried.gear }),
      ...(carried?.satchel === undefined ? {} : { playerSatchel: { kinds: [...carried.satchel.kinds] } }),
      items: [
        ...relics.map((r, i) => ({
          id: `relic-${String(i + 1)}`,
          kind: r.kind,
          pos: { x: guardPosts[i]!.x, y: guardPosts[i]!.y },
          grants: relicGrant(r, depth),
        })),
        {
          id: 'provision-1',
          kind: provision.kind,
          pos: { x: provisionTile.x, y: provisionTile.y },
          grants: { hp: 0, might: 0, wits: 0, speed: 0 },
        },
        // The bottom keeps its heart at the far end, watched by the last
        // warden. Grants nothing worn — what it grants is the ending.
        ...(bottom ? [{
          id: 'heart-1',
          kind: HEART_KIND,
          pos: { x: far.x, y: far.y },
          grants: { hp: 0, might: 0, wits: 0, speed: 0 },
        }] : []),
      ],
      player: {
        id: playerId,
        kind: 'you',
        pos: { x: generated.start.x, y: generated.start.y },
        stats: carried === undefined ? { ...STARTING_STATS } : { ...carried.stats },
        tags: [],
      },
      opponents: population.chosen.map((c, i) => {
        const relicIndex = guardOf.get(i);
        const post = relicIndex !== undefined
          ? guardPosts[relicIndex]!
          : i === keeper && keeperTile !== undefined
            ? keeperTile
            : freePoints[nextFree++] ?? exit;
        return {
          id: `foe-${String(i + 1)}`,
          kind: c.kind,
          pos: { x: post.x, y: post.y },
          stats: { ...c.stats },
          // Stalkers below the teaching floor are born coiled: the spring is
          // a recorded fact of generation, spent by the first landed blow.
          // Depth 1 stays springless — the 19-in-20 gentle pin holds about
          // one death of slack, and an opening band-jump would spend it.
          tags: ((): string[] => {
            // Born loaded: the coil's one spring, the caller's one voice.
            // Tags are the single source of truth for spent-or-not.
            if (verbOf(c.kind) === 'ambush' && depth >= AMBUSH_FROM_DEPTH) return ['ambush'];
            if (verbOf(c.kind) === 'call') return ['call'];
            return [];
          })(),
        };
      }),
    },
  };
}

export function attemptMove(state: GameState, entityId: string, dx: number, dy: number): DraftEvent {
  // Integers as well as magnitude: (0.5, 0.5) sums to exactly 1, so a
  // magnitude-only guard would land the player between tiles — and from a
  // fractional position every later move reads as blocked, because a
  // non-integer array index resolves to undefined.
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) {
    throw new Error(`attemptMove: expected a single orthogonal step, got (${dx}, ${dy})`);
  }
  const mover = findEntity(state.entities, entityId);
  if (mover === undefined) throw new Error(`attemptMove: no entity ${entityId}`);

  const to = { x: mover.pos.x + dx, y: mover.pos.y + dy };

  if (!inBounds(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, attempted: to, reason: 'out-of-bounds' },
    };
  }
  if (!isPassable(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, attempted: to, reason: 'wall' },
    };
  }
  const occupant = state.entities.find(
    (o) => o.id !== entityId && isAlive(o) && o.pos.x === to.x && o.pos.y === to.y,
  );
  if (occupant !== undefined) {
    // Bump to attack — no separate key. Walking into something hostile is the
    // attack, which keeps the whole game on four inputs.
    if (!isHostile(mover, occupant)) {
      return {
        type: 'MOVE_BLOCKED',
        schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
        rngCounter: state.rngCounter,
        rngDraws: 0,
        payload: { entityId, attempted: to, reason: 'occupied' },
      };
    }

    const outcome = resolveStrike(state.seed, state.rngCounter, mover, occupant);

    // The trample: a bruiser's landed blow shoves the target one tile along
    // the line of the attack and the bruiser lumbers into the gap — atomic in
    // this one event, so there is no in-between turn to kite through (the
    // gap-shove that waits a turn is a self-defeating gap-maker). Every
    // landed blow shoves; a sometimes-shove is dice noise that takes two
    // encounters to read instead of one. No shove when the tile behind is
    // denied (wall, body in the way, the world's edge), when the blow kills
    // (the dead are not driven anywhere), and never onto the way out —
    // an exit you can be knocked through is an escape you did not choose.
    const verbExtras: { attackerTo?: Pos; targetTo?: Pos; ambush?: boolean } = {};
    if (springLoaded(mover) && outcome.hit) verbExtras.ambush = true;
    // A braced target holds their ground: the trample lands as a plain blow.
    // Steady boots hold it always — the named relic's one rule.
    if (verbOf(mover.kind) === 'trample' && outcome.hit && occupant.stats.hp > outcome.damage
      && !occupant.tags.includes('braced') && !wearsTrait(occupant.gear, 'hold-ground')) {
      const behind = { x: occupant.pos.x + dx, y: occupant.pos.y + dy };
      const denied = !inBounds(state.grid, behind.x, behind.y)
        || !isPassable(state.grid, behind.x, behind.y)
        || tileAt(state.grid, behind.x, behind.y) === EXIT
        || state.entities.some((e) => isAlive(e) && e.id !== occupant.id && e.pos.x === behind.x && e.pos.y === behind.y);
      if (!denied) {
        verbExtras.targetTo = behind;
        verbExtras.attackerTo = { x: occupant.pos.x, y: occupant.pos.y };
      }
    }

    return {
      type: 'STRIKE',
      schemaVersion: SCHEMA_VERSIONS.STRIKE,
      rngCounter: state.rngCounter,
      rngDraws: STRIKE_DRAWS,
      payload: { attackerId: entityId, targetId: occupant.id, mode: 'melee', ...outcome, ...verbExtras },
    };
  }

  return {
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId, from: { x: mover.pos.x, y: mover.pos.y }, to },
  };
}

/**
 * Whether an action ends the actor's turn.
 *
 * A refused action costs nothing: walking into a wall is a mispress, not a
 * decision, and charging a turn for it hands a free hit to whatever is standing
 * next to you. The rule lives here rather than in the view because the view is
 * a throwaway harness and this is a rule of the game — the next caller would
 * otherwise reproduce the bug, and this is exactly the kind of statement that
 * later becomes a declarative rule rather than a function.
 */
export function endsTurn(draft: DraftEvent): boolean {
  // ITEM_TAKEN rides along with the move that reached it, so it must not spend
  // a second turn of its own.
  return draft.type !== 'MOVE_BLOCKED' && draft.type !== 'ITEM_TAKEN';
}

/**
 * The lunge: two tiles of ground and the blow, in one motion.
 *
 * The skirmisher's verb, and the only actor that can close distance and
 * strike in the same action — which is what makes it the system's one
 * anti-kite tooth: with everyone moving one tile a turn, disengaging is
 * otherwise always free. Normal damage, no bonus; the verb is the tempo,
 * not the arithmetic. Null when the geometry refuses (not exactly two steps
 * of walking away, or no free tile on the way) — the caller falls back to
 * an ordinary step.
 *
 * The intermediate tile is chosen in the fixed neighbour order (east, west,
 * south, north), so a replayed lunge crosses the same tile every time.
 */
export function lungeStrike(
  state: GameState,
  entityId: string,
  targetId: string,
): Extract<DraftEvent, { type: 'STRIKE' }> | null {
  const mover = findEntity(state.entities, entityId);
  const target = findEntity(state.entities, targetId);
  if (mover === undefined || target === undefined || !isAlive(target)) return null;
  if (!isHostile(mover, target)) return null;

  const away = Math.abs(target.pos.x - mover.pos.x) + Math.abs(target.pos.y - mover.pos.y);
  if (away !== 2) return null;

  const standable = (x: number, y: number): boolean =>
    inBounds(state.grid, x, y)
    && isPassable(state.grid, x, y)
    && !state.entities.some((e) => isAlive(e) && e.id !== entityId && e.pos.x === x && e.pos.y === y);

  let via: Pos | null = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const mid = { x: mover.pos.x + dx, y: mover.pos.y + dy };
    const closes = Math.abs(target.pos.x - mid.x) + Math.abs(target.pos.y - mid.y) === 1;
    if (closes && standable(mid.x, mid.y)) { via = mid; break; }
  }
  if (via === null) return null;

  const outcome = resolveStrike(state.seed, state.rngCounter, mover, target);
  return {
    type: 'STRIKE',
    schemaVersion: SCHEMA_VERSIONS.STRIKE,
    rngCounter: state.rngCounter,
    rngDraws: STRIKE_DRAWS,
    payload: { attackerId: entityId, targetId, mode: 'melee', ...outcome, attackerTo: via },
  };
}

/**
 * The player's shove: drive an adjacent hostile one tile along the push.
 *
 * Deterministic on purpose — no roll, no draws. A tool you position with
 * cannot be a tool that gambles (Into the Breach's rule, adopted whole).
 * Open ground displaces; a wall or the door frame slams (SLAM_DAMAGE and a
 * stagger — the wall is the argument); another body means collision — both
 * reel, nobody moves. Null when there is nothing hostile to shove that way:
 * a mispress, not a turn.
 */
export function shoveAt(
  state: GameState,
  entityId: string,
  dx: number,
  dy: number,
): Extract<DraftEvent, { type: 'SHOVE' }> | null {
  const mover = findEntity(state.entities, entityId);
  if (mover === undefined) return null;
  const at = { x: mover.pos.x + dx, y: mover.pos.y + dy };
  const target = state.entities.find(
    (e) => e.id !== entityId && isAlive(e) && e.pos.x === at.x && e.pos.y === at.y,
  );
  if (target === undefined || !isHostile(mover, target)) return null;

  const behind = { x: target.pos.x + dx, y: target.pos.y + dy };
  const payload = ((): { to: Pos | null; slammed: boolean; struckId: string | null } => {
    // The world's edge and the way out stop a body the way a wall does.
    if (!inBounds(state.grid, behind.x, behind.y)
      || !isPassable(state.grid, behind.x, behind.y)
      || tileAt(state.grid, behind.x, behind.y) === EXIT) {
      return { to: null, slammed: true, struckId: null };
    }
    const inTheWay = state.entities.find(
      (e) => e.id !== target.id && isAlive(e) && e.pos.x === behind.x && e.pos.y === behind.y,
    );
    if (inTheWay !== undefined) return { to: null, slammed: false, struckId: inTheWay.id };
    return { to: behind, slammed: false, struckId: null };
  })();

  return {
    type: 'SHOVE',
    schemaVersion: SCHEMA_VERSIONS.SHOVE,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { shoverId: entityId, targetId: target.id, ...payload },
  };
}

/** The player set against the coming round. Costs the turn; the stance
 *  lasts until their next action of any kind. */
export function braceSelf(state: GameState, entityId: string): Extract<DraftEvent, { type: 'BRACED' }> {
  return {
    type: 'BRACED',
    schemaVersion: SCHEMA_VERSIONS.BRACED,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId },
  };
}

/** Whether this entity can fight at distance at all: a creature by its verb,
 *  the player by what they wear. One question, both answers — the volley is
 *  one discipline whoever holds it. */
function armedForDistance(entity: Entity): boolean {
  return entity.kind === 'you'
    ? wearsTrait(entity.gear, 'ranged')
    : verbOf(entity.kind) === 'volley';
}

/** Whether a shot from `archer` could fly at `target` right now: hostile,
 *  alive, past arm's reach (the bump owns range 1), inside the reach disc,
 *  and the honest line clear — covenant M7, asked once, answered for
 *  commands and minds alike. */
function shotEligible(state: GameState, archer: Entity, target: Entity): boolean {
  if (!isAlive(target) || !isHostile(archer, target)) return false;
  if (Math.abs(target.pos.x - archer.pos.x) + Math.abs(target.pos.y - archer.pos.y) === 1) return false;
  if (!withinReach(archer.pos, target.pos, SHOT_RANGE)) return false;
  return clearShot(state.grid, state.entities, archer.pos, target.pos);
}

/**
 * The draw: half of every shot, and all of its warning — covenant M8.
 * Costs the turn, like the brace it displaces; the shot it promises flies
 * only if the stance survives to the next action. Null for hands that
 * cannot throw and for a stance already held: mispresses, not turns.
 */
export function drawStance(state: GameState, entityId: string): Extract<DraftEvent, { type: 'DRAWN' }> | null {
  const archer = findEntity(state.entities, entityId);
  if (archer === undefined || !isAlive(archer)) return null;
  if (!armedForDistance(archer)) return null;
  if (archer.tags.includes('drawn')) return null;
  return {
    type: 'DRAWN',
    schemaVersion: SCHEMA_VERSIONS.DRAWN,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId },
  };
}

/**
 * The mark: nearest hostile the shot could reach, nearest by the disc's own
 * squared distance, ties to birth order — deterministic, so the UI can say
 * which and replay can never disagree. Null when nothing in the world can
 * be shot from here.
 */
export function shotTarget(state: GameState, entityId: string): Entity | null {
  const archer = findEntity(state.entities, entityId);
  if (archer === undefined) return null;
  let best: Entity | null = null;
  let bestAway = Number.POSITIVE_INFINITY;
  for (const e of state.entities) {
    if (e.id === entityId || !shotEligible(state, archer, e)) continue;
    const dx = e.pos.x - archer.pos.x;
    const dy = e.pos.y - archer.pos.y;
    const away = dx * dx + dy * dy;
    if (away < bestAway) { bestAway = away; best = e; }
  }
  return best;
}

/**
 * The loose: the drawn stance spent as a blow at distance. The same dice as
 * every strike — the guard's raised bar included — at the same two draws,
 * with no movement ever riding along: a stone moves nothing but blood.
 * Null when the stance is not held or the line refuses; the caller decides
 * whether that refusal costs a turn (it does not — a shot that cannot fly
 * was never loosed).
 */
export function looseShot(
  state: GameState,
  entityId: string,
  targetId: string,
): Extract<DraftEvent, { type: 'STRIKE' }> | null {
  const archer = findEntity(state.entities, entityId);
  const target = findEntity(state.entities, targetId);
  if (archer === undefined || target === undefined) return null;
  if (!archer.tags.includes('drawn')) return null;
  if (!armedForDistance(archer)) return null;
  if (!shotEligible(state, archer, target)) return null;

  const outcome = resolveStrike(state.seed, state.rngCounter, archer, target);
  return {
    type: 'STRIKE',
    schemaVersion: SCHEMA_VERSIONS.STRIKE,
    rngCounter: state.rngCounter,
    rngDraws: STRIKE_DRAWS,
    payload: { attackerId: entityId, targetId, mode: 'ranged', ...outcome },
  };
}

/**
 * The vigil kept: a warden at its post, the intruder gone past the leash,
 * knitting shut. Once per disengagement by construction — after this the
 * wound is gone, and the condition cannot hold again until someone comes
 * back and reopens it. This is what closes the poke-and-retreat hole the
 * leash itself opens: attrition against the stairs' keeper costs the whole
 * fight each time, not a tenth of one.
 */
export function vigilKept(state: GameState, entityId: string): Extract<DraftEvent, { type: 'VIGIL_KEPT' }> {
  return {
    type: 'VIGIL_KEPT',
    schemaVersion: SCHEMA_VERSIONS.VIGIL_KEPT,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId },
  };
}

/**
 * The seized world stirring: while the heart is carried, every WAVE_EVERY
 * turns the bottom floor answers back.
 *
 * The first stir raises the dead — your own past falls stand up where the
 * bodies lie, wearing your current strength whole. The best deaths you ever
 * died become the last things between you and out; graves grant the world
 * teeth, never the player loot. Every stir after (and the first, if the
 * floor is graveless) draws one riser from the bestiary at the bottom's
 * band, on a drawn tile at least WAVE_DISTANCE from the carrier — pressure
 * arriving as a chase, never out of the air beside you.
 *
 * Everything is resolved here and recorded whole (kinds, stats, tiles), so
 * replay raises the same dead the same way forever. Null when nothing can
 * rise — a stir that raises nobody is not a fact worth recording.
 */
export function stirWorld(state: GameState, playerId = 'player'): Extract<DraftEvent, { type: 'WORLD_STIRRED' }> | null {
  const carrier = findEntity(state.entities, playerId);
  if (carrier === undefined) return null;

  const risen: { id: string; kind: string; pos: Pos; stats: Stats; tags: string[] }[] = [];
  let c = state.rngCounter;

  const stood = (x: number, y: number): boolean =>
    state.entities.some((e) => isAlive(e) && e.pos.x === x && e.pos.y === y)
    || risen.some((r) => r.pos.x === x && r.pos.y === y);

  // The echoes, once: whoever fell here rises with the carrier's strength.
  if (!state.entities.some((e) => e.kind === 'echo')) {
    let n = 0;
    for (const b of state.bodies) {
      if (stood(b.x, b.y)) continue;
      n += 1;
      risen.push({
        id: `echo-${String(n)}`,
        kind: 'echo',
        pos: { x: b.x, y: b.y },
        stats: { ...carrier.stats, hp: carrier.maxHp },
        tags: [],
      });
    }
  }

  // One riser from the bestiary, at the bottom's own band, on a drawn tile
  // far enough away that its arrival is a chase.
  const spawnable = BESTIARY.filter((a) => a.weight > 0);
  const archTotal = spawnable.reduce((n, a) => n + a.weight, 0);
  let pick = intBetween(state.seed, c, 1, archTotal); c += 1;
  let arch = spawnable[0]!;
  for (const a of spawnable) {
    pick -= a.weight;
    if (pick <= 0) { arch = a; break; }
  }
  const level = Math.max(1, Math.floor(BOTTOM_DEPTH / 3));

  const candidates: Pos[] = [];
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      if (!isPassable(state.grid, x, y)) continue;
      if (tileAt(state.grid, x, y) === EXIT) continue;
      if (Math.abs(x - carrier.pos.x) + Math.abs(y - carrier.pos.y) < WAVE_DISTANCE) continue;
      if (stood(x, y)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length > 0) {
    const at = intBetween(state.seed, c, 0, candidates.length - 1); c += 1;
    const tile = candidates[at]!;
    risen.push({
      id: `risen-${String(state.turn)}`,
      kind: level === 1 ? arch.kind : `${arch.kind}-${String(level)}`,
      pos: { x: tile.x, y: tile.y },
      stats: creatureStats(arch.kind, level)!,
      tags: [],
    });
  }

  if (risen.length === 0) return null;
  return {
    type: 'WORLD_STIRRED',
    schemaVersion: SCHEMA_VERSIONS.WORLD_STIRRED,
    rngCounter: state.rngCounter,
    rngDraws: c - state.rngCounter,
    payload: { opponents: risen },
  };
}

/**
 * The call answered: a caller crying out, and the floor sending bodies.
 *
 * Everything is drawn and recorded here — kinds at the floor's shallowest
 * band, tiles at least CALL_DISTANCE of straight ground from the prey — so
 * replay wakes the same things in the same places forever. Callers never
 * call callers: one voice per floor is a clock, a chain of voices is a
 * fork bomb. Null when the floor has nowhere to answer from.
 */
export function callOut(state: GameState, entityId: string, preyId = 'player'): Extract<DraftEvent, { type: 'CALLED' }> | null {
  const caller = findEntity(state.entities, entityId);
  const prey = findEntity(state.entities, preyId);
  if (caller === undefined || prey === undefined) return null;

  const risen: { id: string; kind: string; pos: Pos; stats: Stats; tags: string[] }[] = [];
  let c = state.rngCounter;

  const answering = BESTIARY.filter((a) =>
    a.weight > 0 && state.depth >= (a.fromDepth ?? 1) && verbOf(a.kind) !== 'call');
  const archTotal = answering.reduce((n, a) => n + a.weight, 0);

  const stood = (x: number, y: number): boolean =>
    state.entities.some((e) => isAlive(e) && e.pos.x === x && e.pos.y === y)
    || risen.some((r) => r.pos.x === x && r.pos.y === y);

  for (let i = 0; i < CALL_RISERS; i += 1) {
    let pick = intBetween(state.seed, c, 1, archTotal); c += 1;
    let arch = answering[0]!;
    for (const a of answering) {
      pick -= a.weight;
      if (pick <= 0) { arch = a; break; }
    }

    const candidates: Pos[] = [];
    for (let y = 0; y < state.grid.height; y += 1) {
      for (let x = 0; x < state.grid.width; x += 1) {
        if (!isPassable(state.grid, x, y)) continue;
        if (tileAt(state.grid, x, y) === EXIT) continue;
        if (Math.abs(x - prey.pos.x) + Math.abs(y - prey.pos.y) < CALL_DISTANCE) continue;
        if (stood(x, y)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) break;
    const at = intBetween(state.seed, c, 0, candidates.length - 1); c += 1;
    const tile = candidates[at]!;
    risen.push({
      id: `called-${String(state.turn)}-${String(i)}`,
      kind: arch.kind,
      pos: { x: tile.x, y: tile.y },
      // Answered at the floor's first band: the call buys bodies, not elites.
      stats: creatureStats(arch.kind, 1)!,
      tags: [],
    });
  }

  if (risen.length === 0) return null;
  return {
    type: 'CALLED',
    schemaVersion: SCHEMA_VERSIONS.CALLED,
    rngCounter: state.rngCounter,
    rngDraws: c - state.rngCounter,
    payload: { callerId: entityId, opponents: risen },
  };
}

/**
 * Holding position.
 *
 * Without this, time passes only when you move — so a player could never let
 * something come to them and had to walk into its reach instead. Found by
 * playing: blocked moves correctly cost no turn, which left no way at all to
 * spend one deliberately.
 */
export function wait(state: GameState, entityId: string): Extract<DraftEvent, { type: 'WAIT' }> {
  return {
    type: 'WAIT',
    schemaVersion: SCHEMA_VERSIONS.WAIT,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { entityId },
  };
}

/** What is underfoot, if anything worth having. */
export function takeUnderfoot(
  state: GameState,
  entityId: string,
  /** A chosen take (the , key): accepts tradeoffs and downgrades alike —
   *  walking only ever takes strict upgrades. */
  deliberate = false,
): Extract<DraftEvent, { type: 'ITEM_TAKEN' }> | null {
  const taker = findEntity(state.entities, entityId);
  if (taker === undefined) return null;

  const item = itemAt(state.items, taker.pos.x, taker.pos.y);
  if (item === undefined) return null;

  // The heart fills your hands. It takes the first slot — shoving out
  // whatever rode there (left on the tile, like any swap) — and SEALS the
  // whole satchel: nothing can be taken up or used, either hand, while you
  // carry the world's ending. Recorded like any satchel take; the weight
  // is in what it refuses after.
  if (item.kind === HEART_KIND) {
    return {
      type: 'ITEM_TAKEN',
      schemaVersion: SCHEMA_VERSIONS.ITEM_TAKEN,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, itemId: item.id, grants: { ...item.grants }, satchel: { swappedOut: taker.satchel?.[0]?.kind ?? null, slot: 0 } },
    };
  }

  // A provision rides in the satchel, not on the body — two slots now (the
  // designer's ruling, 2026-07-28), filled in order, duplicates welcome:
  // two flares are two flares. Full hands refuse the walk-over (the caller
  // says so out loud); the , key swaps the FIRST slot out onto this tile,
  // reversible by one step back. Hands sealed by something that is not a
  // provision (the heart) do not open at all.
  if (provisionOf(item.kind) !== undefined) {
    const carried = taker.satchel ?? [];
    if (carried.some((c) => provisionOf(c.kind) === undefined)) return null;
    if (carried.length < 2) {
      return {
        type: 'ITEM_TAKEN',
        schemaVersion: SCHEMA_VERSIONS.ITEM_TAKEN,
        rngCounter: state.rngCounter,
        rngDraws: 0,
        payload: { entityId, itemId: item.id, grants: { ...item.grants }, satchel: { swappedOut: null, slot: carried.length } },
      };
    }
    if (!deliberate) return null;
    return {
      type: 'ITEM_TAKEN',
      schemaVersion: SCHEMA_VERSIONS.ITEM_TAKEN,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, itemId: item.id, grants: { ...item.grants }, satchel: { swappedOut: carried[0]!.kind, slot: 0 } },
    };
  }

  // Walking takes only what DOMINATES — at least as good on every axis,
  // better in total. A tradeoff relic (the heavy edge's speed for its blow)
  // is incomparable by construction, so it waits on the floor for a chosen
  // take; a strict downgrade waits forever unless chosen too. The old total
  // order produced zero decisions by definition — this is the smallest
  // possible concession to there being a choice.
  //
  // The slot resolves HERE, kind in hand (slotFor: trait first, grants for
  // the rest — the sling to the sling hand), and rides the event, so replay
  // never re-derives routing. What comes off rides too, kind and grants,
  // and the reducer lands it on this tile — a set-down relic that used to
  // vanish (found by the first voiced run: "nothing drops when we set down
  // the old item").
  const gearSlot = slotFor(item.kind, item.grants);
  const worn = taker.gear?.[gearSlot];
  if (!deliberate && !dominates(item.grants, worn?.grants ?? { hp: 0, might: 0, wits: 0, speed: 0 })) {
    return null;
  }

  return {
    type: 'ITEM_TAKEN',
    schemaVersion: SCHEMA_VERSIONS.ITEM_TAKEN,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: {
      entityId, itemId: item.id, grants: { ...item.grants },
      gearSlot,
      shed: worn === undefined ? null : { kind: worn.kind, grants: { ...worn.grants } },
    },
  };
}

/**
 * Spends what the satchel holds. Effects resolve HERE — how much the draught
 * mends, who the smoke fools — and the event records the resolution, so
 * replay applies rather than re-decides. Null when the hands are empty or
 * hold something that is not a tool (the heart seals the satchel).
 */
export function useCarried(
  state: GameState,
  entityId: string,
  /** Which hand: 0 is q's, 1 is Q's. What remains compacts forward. */
  slot = 0,
): Extract<DraftEvent, { type: 'ITEM_USED' }> | null {
  const user = findEntity(state.entities, entityId);
  if (user === undefined) return null;
  // The heart seals both hands — a flare beside the world's ending stays lit.
  if (user.satchel?.some((c) => provisionOf(c.kind) === undefined) === true) return null;
  const kind = user.satchel?.[slot]?.kind;
  if (kind === undefined || provisionOf(kind) === undefined) return null;

  if (kind === 'vital draught') {
    // Brogue's answer to the pure-heal no-brainer: the mend and a permanent
    // raise in one swallow. Drunk early it banks the ceiling; drunk late it
    // banks the blood; no timing wastes it.
    const ceilingTo = user.maxHp + draughtCeiling(state.depth);
    return {
      type: 'ITEM_USED',
      schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, kind, slot, effect: { kind: 'draught', healedTo: ceilingTo, ceilingTo } },
    };
  }

  // The flare: the floor admits its shape — layout, never occupants. The
  // whole effect is the fog's to apply; here it is only recorded.
  if (kind === 'tallow flare') {
    return {
      type: 'ITEM_USED',
      schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: {
        entityId,
        kind,
        slot,
        effect: { kind: 'flare', at: { x: user.pos.x, y: user.pos.y }, radius: FLARE_RADIUS },
      },
    };
  }

  // The ward: worn until a blow spends it. One warding per body — a second
  // swallow while the first holds would be a wasted hand, so it refuses
  // (a mispress, not a turn; the view says why).
  if (kind === 'ash ward') {
    if (user.tags.includes('warded')) return null;
    return {
      type: 'ITEM_USED',
      schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, kind, slot, effect: { kind: 'ward' } },
    };
  }

  // The burr: everyone hostile standing beside you reels — resolved here,
  // recorded whole, replay staggers the same bodies forever. Casting it at
  // empty air is allowed and honest (the line says nothing stood beside
  // you): the satchel pays for judgment, not just for luck.
  if (kind === 'iron burr') {
    const beside = state.entities
      .filter((e) => e.id !== entityId && isAlive(e) && isHostile(user, e)
        && Math.abs(e.pos.x - user.pos.x) + Math.abs(e.pos.y - user.pos.y) === 1)
      .map((e) => e.id);
    return {
      type: 'ITEM_USED',
      schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: { entityId, kind, slot, effect: { kind: 'burr', staggered: beside } },
    };
  }

  // The bell: rings once and the way out answers — the exit and every
  // unfound prize, resolved here so the fog can read positions off the
  // chain without re-deriving a dead floor's layout.
  if (kind === 'hollow bell') {
    const exitAt = state.grid.tiles.indexOf(EXIT);
    const exit = exitAt < 0
      ? { x: user.pos.x, y: user.pos.y }
      : { x: exitAt % state.grid.width, y: Math.floor(exitAt / state.grid.width) };
    return {
      type: 'ITEM_USED',
      schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: {
        entityId,
        kind,
        slot,
        effect: { kind: 'bell', exit, prizes: state.items.map((i) => ({ x: i.pos.x, y: i.pos.y })) },
      },
    };
  }

  // The smoke: for a while, every hunt chases where you WERE. Whatever is
  // already in your claws' reach is not fooled — it has you by touch, not by
  // trail — which is also what keeps the smoke from powering hit-and-run
  // whittling: it must rise BEFORE they reach you, or not at all.
  const unfooled = state.entities
    .filter((e) => e.id !== entityId && isAlive(e) && isHostile(user, e)
      && Math.abs(e.pos.x - user.pos.x) + Math.abs(e.pos.y - user.pos.y) === 1)
    .map((e) => e.id);
  return {
    type: 'ITEM_USED',
    schemaVersion: SCHEMA_VERSIONS.ITEM_USED,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: {
      entityId,
      kind,
      slot,
      effect: { kind: 'smoke', until: state.turn + smokeTurns(state.depth), at: { x: user.pos.x, y: user.pos.y }, unfooled },
    },
  };
}

export type Outcome = 'playing' | 'escaped' | 'dead' | 'won';

/** Whether the world's ending rides in this player's hands — either of them. */
export function heartHeld(state: GameState, playerId = 'player'): boolean {
  return findEntity(state.entities, playerId)?.satchel?.some((c) => c.kind === HEART_KIND) === true;
}

/**
 * How the run stands.
 *
 * Derived rather than stored, and no event records it. Standing on the exit is
 * escaping and no hit points is dying — both already true in the state, and a
 * second recording of a fact is a second thing that can disagree with the
 * first. The same reason canon is folded rather than kept.
 *
 * The bottom floor turns the exit around: its stair is the one you came down
 * by (you are BORN standing on it), so standing there means nothing until
 * the heart is in your hands — and then it means everything.
 */
export function outcome(state: GameState, playerId = 'player'): Outcome {
  const player = findEntity(state.entities, playerId);
  if (player === undefined || !isAlive(player)) return 'dead';
  if (tileAt(state.grid, player.pos.x, player.pos.y) !== EXIT) return 'playing';
  if (state.depth >= BOTTOM_DEPTH) return heartHeld(state, playerId) ? 'won' : 'playing';
  return 'escaped';
}

/**
 * Puts a rule into play.
 *
 * The cap is enforced here rather than at validation because it is a property
 * of a *world*, not of a rule: the same rule may be perfectly ratifiable in a
 * fork that has room for it. Throwing rather than returning a rejection is
 * deliberate — by this point the player has already said yes, so a full
 * ruleset is a bug in whatever offered the choice, not a routine outcome.
 */
export function ratifyRule(state: GameState, rule: Rule): Extract<DraftEvent, { type: 'RULE_RATIFIED' }> {
  if (state.rules.length >= MAX_RULES) {
    throw new Error(`ratify: this world already holds the limit of ${MAX_RULES} rules`);
  }
  return {
    type: 'RULE_RATIFIED',
    schemaVersion: SCHEMA_VERSIONS.RULE_RATIFIED,
    rngCounter: state.rngCounter,
    // Rules never consume randomness. See the interpreter for why that is a
    // load-bearing guarantee rather than an accident.
    rngDraws: 0,
    payload: { rule },
  };
}

/**
 * Writes where this world's dead lie on the floor a run is entering. Appended
 * by the rebirth and descent ceremonies (identity, then the dead, then law),
 * never by generation — the bodies are the graveyard's fact, not the floor's.
 * Draws nothing: the dead are where they fell, not where dice put them.
 */
export function recordBodies(state: GameState, bodies: readonly Pos[]): Extract<DraftEvent, { type: 'WORLD_BODIES' }> {
  return {
    type: 'WORLD_BODIES',
    schemaVersion: SCHEMA_VERSIONS.WORLD_BODIES,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { bodies: bodies.map((b) => ({ x: b.x, y: b.y })) },
  };
}

/**
 * Writes the world's identity into its history. The caller has already
 * validated the bible (validateBible) — by this point a malformed one is a
 * bug in whoever offered it, same contract as ratifyRule. Draws nothing:
 * identity is chosen, not rolled.
 */
export function foundWorld(state: GameState, bible: Bible): Extract<DraftEvent, { type: 'WORLD_BIBLE' }> {
  return {
    type: 'WORLD_BIBLE',
    schemaVersion: SCHEMA_VERSIONS.WORLD_BIBLE,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { bible },
  };
}

export function advanceTurn(state: GameState): Extract<DraftEvent, { type: 'TURN_ADVANCED' }> {
  const { activeEntityId, wrapped } = nextActive(state.entities, state.activeEntityId);
  return {
    type: 'TURN_ADVANCED',
    schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
    rngCounter: state.rngCounter,
    rngDraws: 0,
    payload: { activeEntityId, turn: wrapped ? state.turn + 1 : state.turn },
  };
}
