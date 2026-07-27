import { emptyLog, append, fold, chain } from '../log/chain.js';
import { ratifyRule, recordBodies } from '../core/commands.js';
import { FLOOR, EXIT } from '../core/grid.js';
import { autoplay } from '../play/autoplay.js';
import { sitter, shuffler, bumper, brawler } from '../play/policies.js';
import { assayLine } from './register.js';
import { creatureStats } from '../core/tables.js';
import type { Policy } from '../play/policies.js';
import type { Position } from '../play/session.js';
import type { Rule, StatName, MotifName } from '../canon/rule.js';
import { SCHEMA_VERSIONS } from '../core/events.js';
import type { DraftEvent, EntitySeed } from '../core/events.js';
import type { Item } from '../core/item.js';
import type { GameState } from '../core/state.js';

/**
 * The trial of a rule: play it, adversarially, before anyone is asked to
 * ratify it.
 *
 * The validator says a rule is *well-formed*. It cannot say the rule is
 * *sound*, because soundness is a property of play — "when you hold still,
 * might rises by one" validates perfectly and breaks the game completely. So
 * the assay does what a munchkin would do the moment the rule landed: spams
 * its trigger in a world built for exploiting it, and measures what happened.
 *
 * Three trials, each enforcing a Covenant invariant:
 *
 * **Greed (M2).** An exploiter hammers the trigger in a friendly world. If any
 * stat climbs past `MAX_RULE_GAIN` in one run, the rule is an engine, not a
 * rule. Boundedness the game already provides shows up on its own: heal stops
 * at the ceiling, kills run out of creatures, an item can be taken once.
 *
 * **The Coward (M1).** A brute stands adjacent and the player only waits — the
 * degenerate defence. Without rules this kills in a handful of turns; if the
 * rule keeps the player alive through the whole trial, death has stopped being
 * possible while holding still, and a game you cannot lose by doing nothing
 * has lost its stakes.
 *
 * **Function (M3, the honest half).** If a rule never fired in any trial, that
 * is said as a *caution*, not a refusal: a simulation can demonstrate breakage
 * but cannot prove a universal negative — `turnAtLeast 500` is a legitimate
 * rule these trials will simply never reach.
 *
 * Refusals are reserved for what a trial demonstrated. Everything else is a
 * finding attached to the verdict, so the Forge can show it and the player can
 * overrule it.
 */

/** The most any single stat may provably gain in one exploited run. Their
 *  ratified rules earn +1s and +2s; a run that can mint +6 of anything has
 *  stopped being about the map. A judgment, exported, arguable. */
export const MAX_RULE_GAIN = 6;

/** Actions per trial. Long enough to demonstrate divergence and to let the
 *  brute finish the job; short enough to run inside a keypress budget. */
export const TRIAL_ACTIONS = 120;

export interface RuleAssay {
  readonly verdict: 'sound' | 'refused';
  /** Refusals and cautions alike, each naming its Covenant invariant. */
  readonly findings: readonly string[];
  /** True when no trial ever saw the rule fire. A caution, not a refusal. */
  readonly neverFired: boolean;
}

const seed = (id: string, kind: string, x: number, y: number, hp: number, might: number, speed: number): EntitySeed =>
  ({ id, kind, pos: { x, y }, stats: { hp, might, wits: 1, speed }, tags: [] });

/**
 * The world-shape a rule's conditions need before they can hold at all:
 * depth, the floor's cut, a body to stand on. The trials meet the rule where
 * it lives (VOCABULARY.md — simulate before ratifying, *honestly*): a
 * `depthAtLeast 3` rule trialled only at depth 1 reads as dead weight and is
 * not. Both sides of every marginal comparison get the same environment, so
 * nothing here tilts a trial — it only unlocks the door the rule stands
 * behind.
 */
interface TrialEnvironment {
  readonly depth?: number;
  readonly motif?: MotifName;
  readonly body?: boolean;
}

function environmentFor(rule: Rule): TrialEnvironment {
  let depth: number | undefined;
  let motif: MotifName | undefined;
  let body = false;
  for (const c of rule.require) {
    if (c.kind === 'depthAtLeast') depth = Math.max(depth ?? 1, c.n);
    if (c.kind === 'motifIs') motif = c.motif;
    if (c.kind === 'bodyHere') body = true;
  }
  return { depth, motif, body };
}

function born(
  width: number, tiles: number[], player: EntitySeed, opponents: EntitySeed[], items: Item[],
  worldSeed = 7, progress?: { xp: number; level: number }, env: TrialEnvironment = {},
): Position {
  const init = {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width, height: 1, tiles, seed: worldSeed, items, player, opponents,
      ...(progress ?? {}),
      ...(env.depth === undefined ? {} : { depth: env.depth }),
      ...(env.motif === undefined ? {} : { motif: env.motif }),
    },
  } as DraftEvent;
  const w = append(emptyLog(), null, init);
  let at: Position = { log: w.log, head: w.event.id };
  if (env.body === true) {
    // A body on every open tile: the exploiter trials measure a body-gated
    // rule at its most exploitable, which is the trials' whole posture —
    // a munchkin who found one body would stand on it all day anyway.
    const lying = tiles.flatMap((t, x) => (t === FLOOR ? [{ x, y: 0 }] : []));
    const done = append(at.log, at.head, recordBodies(fold(at.log, at.head), lying));
    at = { log: done.log, head: done.event.id };
  }
  return at;
}

/** A friendly corridor for greed: room to shuffle, a wall to bump, an item to
 *  take, an exit far off, and three ordinary creatures at the far end so
 *  STRIKE and KILLED have something to spend themselves on. The seed varies
 *  only the dice, never the geometry — which is what lets the proportion
 *  trial reroll the same fight. */
function greedWorld(worldSeed = 7, env: TrialEnvironment = {}): Position {
  // One open row. An earlier draft put a wall mid-corridor for the bumper to
  // hit and thereby cut the creatures off from the brawler entirely — KILLED
  // could never fire and read as unexploitable. The map edge bumps just as
  // well and blocks nobody.
  const width = 16;
  const tiles = new Array<number>(width).fill(FLOOR);
  tiles[width - 1] = EXIT;
  return born(
    width, tiles,
    seed('player', 'you', 0, 0, 12, 3, 3),
    // Table-standard chaff, so the trial's economy matches the game's.
    [8, 10, 12].map((x, i) => ({
      id: `thing-${String(i + 1)}`, kind: 'skirmisher', pos: { x, y: 0 },
      stats: creatureStats('skirmisher', 1)!, tags: [],
    })),
    [{ id: 'item-0', kind: 'edge', pos: { x: 2, y: 0 }, grants: { hp: 0, might: 1, wits: 0, speed: 0 } }],
    worldSeed,
    undefined,
    env,
  );
}

/** The proportion trial's fight: opposition heavy enough that the bare
 *  fighter ends bloody. Weight cannot be measured against a fight the player
 *  wins untouched — the greed corridor's chaff left every heal clamped at
 *  the ceiling and every rule reading as weightless. The player starts
 *  mid-level (xp 41, next threshold at 72; three kills pay ~27) because the
 *  level-up's full heal otherwise lands in BOTH runs and launders whatever
 *  blood the rule saved — measured: every swing read exactly zero. */
function proportionWorld(worldSeed: number, env: TrialEnvironment = {}): Position {
  const width = 16;
  const tiles = new Array<number>(width).fill(FLOOR);
  tiles[width - 1] = EXIT;
  return born(
    width, tiles,
    seed('player', 'you', 0, 0, 12, 3, 3),
    [
      { id: 'thing-1', kind: 'skirmisher-2', pos: { x: 8, y: 0 }, stats: creatureStats('skirmisher', 2)!, tags: [] },
      { id: 'thing-2', kind: 'skirmisher', pos: { x: 10, y: 0 }, stats: creatureStats('skirmisher', 1)!, tags: [] },
      { id: 'thing-3', kind: 'bruiser', pos: { x: 12, y: 0 }, stats: creatureStats('bruiser', 1)!, tags: [] },
    ],
    [],
    worldSeed,
    { xp: 41, level: 3 },
    env,
  );
}

/**
 * The coward's corner: a table-standard bruiser adjacent, nowhere worth going.
 * Kills a sitting player in a handful of turns unless a rule intervenes.
 *
 * The aggressor comes from the bestiary rather than being hand-rolled, and its
 * band matters: a level-1 bruiser's heaviest crit (1d3+1 doubled = 8) cannot
 * one-shot a full 10-hp player, so "heal enough every wait" genuinely makes
 * death impossible — which is exactly the degenerate case M1 exists to refuse.
 * Against a heavier aggressor, crits pierce any heal and the trial could never
 * fire at all.
 */
function cowardWorld(env: TrialEnvironment = {}): Position {
  const width = 6;
  const tiles = new Array<number>(width).fill(FLOOR);
  tiles[width - 1] = EXIT;
  const bruiser = creatureStats('bruiser', 1)!;
  return born(
    width, tiles,
    seed('player', 'you', 0, 0, 10, 3, 3),
    [{ id: 'brute', kind: 'bruiser', pos: { x: 1, y: 0 }, stats: { ...bruiser, hp: 99 }, tags: [] }],
    [],
    undefined,
    undefined,
    env,
  );
}

function withRule(world: Position, rule: Rule): Position {
  const done = append(world.log, world.head, ratifyRule(fold(world.log, world.head), rule));
  return { log: done.log, head: done.event.id };
}

const STATS_TO_WATCH: readonly (StatName | 'hp')[] = ['might', 'speed', 'wits', 'maxHp'];

function statOf(state: GameState, name: StatName | 'hp'): number {
  const you = state.entities.find((e) => e.id === 'player');
  if (you === undefined) return 0;
  if (name === 'maxHp') return you.maxHp;
  return you.stats[name];
}

function firings(position: Position, ruleId: string): number {
  return chain(position.log, position.head)
    .filter((e) => e.type === 'RULE_FIRED' && e.payload.ruleId === ruleId).length;
}

/** The policy a munchkin would bring to this trigger. */
function exploiterFor(rule: Rule): Policy {
  switch (rule.when) {
    case 'MOVE': return shuffler;
    case 'MOVE_BLOCKED': return bumper;
    case 'STRIKE': case 'KILLED': case 'ITEM_TAKEN': return brawler;
    // WAIT, TURN_PASSED, STRUCK: hold still and let it happen.
    default: return sitter;
  }
}

export function assayRule(rule: Rule): RuleAssay {
  const findings: string[] = [];
  let fired = 0;

  // ── the thematic half rides along: a rule's spoken lines are canon too ──
  for (const effect of rule.then) {
    if (effect.kind === 'speak') {
      for (const f of assayLine(effect.text).findings) findings.push(f);
    }
  }
  const brokeRegister = findings.length > 0;

  // ── trial of greed (M2) ────────────────────────────────────────────────
  //
  // Marginal, not absolute: the same world and the same exploiter run twice,
  // with and without the rule, and the rule is billed only for the difference.
  // The game now grows the player honestly — items grant might, kills pay XP
  // and levels raise stats — and an assay that billed a rule for a level-up
  // would refuse every rule in a world where fighting works.
  // The same environment on both sides of every marginal pair: the rule's
  // world-shape gates are unlocked, never weighed.
  const env = environmentFor(rule);

  const exploiter = exploiterFor(rule);
  const greedy = autoplay(withRule(greedWorld(7, env), rule), exploiter, TRIAL_ACTIONS);
  const honest = autoplay(greedWorld(7, env), exploiter, TRIAL_ACTIONS);
  fired += firings(greedy.position, rule.id);

  for (const stat of STATS_TO_WATCH) {
    const gain = (statOf(greedy.state, stat) - statOf(honest.state, stat));
    if (gain >= MAX_RULE_GAIN) {
      findings.push(
        `refused (M2): exploited for ${String(TRIAL_ACTIONS)} actions, ${stat} climbed ${String(gain)} past what the same play earns without the rule — a repeatable action may not mint stats`,
      );
    }
  }

  // ── trial of the coward (M1) ───────────────────────────────────────────
  const cornered = withRule(cowardWorld(env), rule);
  const cowardRun = autoplay(cornered, sitter, TRIAL_ACTIONS);
  fired += firings(cowardRun.position, rule.id);

  const baseline = autoplay(cowardWorld(env), sitter, TRIAL_ACTIONS);
  if (baseline.ended === 'dead' && cowardRun.ended !== 'dead') {
    findings.push(
      'refused (M1): a brute that kills an idle player in a handful of turns no longer can — death has stopped being possible while holding still',
    );
  }

  // ── trial of proportion (M6) — the swing, measured and said ───────────
  //
  // Bounded is not the same as fair: a rule can pass greed and coward and
  // still hand the fighter a relic's worth of hit points every floor — the
  // founding case was a ratifier reading a proposal and only feeling "far
  // too strong" after playing it. So the same fight is rerolled across
  // seeds, with and without the rule, and the measured swing rides with the
  // proposal. A caution, never a refusal: how heavy is too heavy is exactly
  // the judgment the ratifier is there to make — blind is the only wrong way
  // to make it.
  const PROPORTION_SEEDS = [7, 11, 23, 41, 61, 83] as const;
  let hpSwing = 0;
  let flips = 0;
  for (const s of PROPORTION_SEEDS) {
    const ruled = autoplay(withRule(proportionWorld(s, env), rule), brawler, TRIAL_ACTIONS);
    const bare = autoplay(proportionWorld(s, env), brawler, TRIAL_ACTIONS);
    fired += firings(ruled.position, rule.id);
    hpSwing += statOf(ruled.state, 'hp') - statOf(bare.state, 'hp');
    if ((ruled.ended === 'dead') !== (bare.ended === 'dead')) flips += 1;
  }
  const meanSwing = hpSwing / PROPORTION_SEEDS.length;
  if (Math.abs(meanSwing) >= 4 || flips >= 3) {
    const direction = meanSwing >= 0 ? 'in the player\'s favour' : 'against the player';
    // A body-gated rule was weighed on a floor strewn with bodies — the gate
    // stood open the whole run. Said beside the number, because a ratifier
    // reading "heavier than a relic" deserves to know it was the heaviest
    // case, not the typical one.
    const strewn = env.body === true
      ? ' (weighed on a floor strewn with bodies — the heaviest case, not the typical one)'
      : '';
    findings.push(
      `caution (M6): across ${String(PROPORTION_SEEDS.length)} rerolled fights this rule swings hit points left by ${meanSwing.toFixed(1)} and flips ${String(flips)} outcome(s) ${direction} — heavier than a relic; weigh it before ratifying${strewn}`,
    );
  }

  // ── trial of function (M3) — a caution, never a refusal ───────────────
  //
  // The exploiters above play badly on purpose, so rules gated on playing
  // *well* — a cleared floor, a long walk, a late turn — never fire for them
  // and drew a false caution. (The founding case: a dead-air rule that fired
  // four times in real sweeps while the assay called it dead weight.) A
  // fighter's honest pass through the same world covers that class.
  if (fired === 0) {
    const honest = autoplay(withRule(greedWorld(7, env), rule), brawler, TRIAL_ACTIONS * 2);
    fired += firings(honest.position, rule.id);
  }
  const neverFired = fired === 0;
  if (neverFired) {
    findings.push(
      'caution (M3): no trial ever saw this rule fire; it may be waiting on conditions the trials cannot reach, or it may be dead weight',
    );
  }

  const refused = brokeRegister || findings.some((f) => f.startsWith('refused'));
  return Object.freeze({
    verdict: refused ? 'refused' : 'sound',
    findings: Object.freeze(findings),
    neverFired,
  });
}
