import { emptyLog, append, fold, chain } from '../log/chain.js';
import { ratifyRule } from '../core/commands.js';
import { FLOOR, EXIT } from '../core/grid.js';
import { autoplay } from '../play/autoplay.js';
import { sitter, shuffler, bumper, brawler } from '../play/policies.js';
import { assayLine } from './register.js';
import { creatureStats } from '../core/tables.js';
import type { Policy } from '../play/policies.js';
import type { Position } from '../play/session.js';
import type { Rule, StatName } from '../canon/rule.js';
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

function born(width: number, tiles: number[], player: EntitySeed, opponents: EntitySeed[], items: Item[]): Position {
  const init = {
    type: 'WORLD_INIT', schemaVersion: 5, rngCounter: 0, rngDraws: 0,
    payload: { width, height: 1, tiles, seed: 7, items, player, opponents },
  } as DraftEvent;
  const w = append(emptyLog(), null, init);
  return { log: w.log, head: w.event.id };
}

/** A friendly corridor for greed: room to shuffle, a wall to bump, an item to
 *  take, an exit far off, and three ordinary creatures at the far end so
 *  STRIKE and KILLED have something to spend themselves on. */
function greedWorld(): Position {
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
function cowardWorld(): Position {
  const width = 6;
  const tiles = new Array<number>(width).fill(FLOOR);
  tiles[width - 1] = EXIT;
  const bruiser = creatureStats('bruiser', 1)!;
  return born(
    width, tiles,
    seed('player', 'you', 0, 0, 10, 3, 3),
    [{ id: 'brute', kind: 'bruiser', pos: { x: 1, y: 0 }, stats: { ...bruiser, hp: 99 }, tags: [] }],
    [],
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
  const exploiter = exploiterFor(rule);
  const greedy = autoplay(withRule(greedWorld(), rule), exploiter, TRIAL_ACTIONS);
  const honest = autoplay(greedWorld(), exploiter, TRIAL_ACTIONS);
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
  const cornered = withRule(cowardWorld(), rule);
  const cowardRun = autoplay(cornered, sitter, TRIAL_ACTIONS);
  fired += firings(cowardRun.position, rule.id);

  const baseline = autoplay(cowardWorld(), sitter, TRIAL_ACTIONS);
  if (baseline.ended === 'dead' && cowardRun.ended !== 'dead') {
    findings.push(
      'refused (M1): a brute that kills an idle player in a handful of turns no longer can — death has stopped being possible while holding still',
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
    const honest = autoplay(withRule(greedWorld(), rule), brawler, TRIAL_ACTIONS * 2);
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
