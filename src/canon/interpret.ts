import { SCHEMA_VERSIONS } from '../core/events.js';
import { isAlive, findEntity } from '../core/entity.js';
import { EXIT, isPassable, tileAt } from '../core/grid.js';
import type { Condition, Effect, Rule, StatName, Trigger } from './rule.js';
import type { DraftEvent } from '../core/events.js';
import type { GameState } from '../core/state.js';
import type { Entity, Pos } from '../core/entity.js';

/**
 * Where a rule stops being data and starts being play.
 *
 * Three properties carry the whole design.
 *
 * **Firing is decided here and recorded there.** `fireRules` evaluates
 * conditions once, at the moment of firing, and emits a `RULE_FIRED` event
 * carrying what it settled on. `apply` replays that without ever re-reading the
 * rule. If the reducer re-decided, ratifying a rule today would silently
 * rewrite what a run did last week — your past would keep changing, which is
 * the one thing an append-only log exists to prevent.
 *
 * **Effects are resolved, not merely copied.** An authored effect says "shove
 * it back 2"; what gets recorded is "move thing-1 to (4,7)". The reducer never
 * has to work out who "it" was or where the walls are, so the resolution rules
 * can change without any risk of old history re-interpreting itself. This is
 * what let the vocabulary grow past effects that only touch the actor.
 *
 * **Firing draws no randomness.** Every effect is a pure function of state and
 * recorded numbers, so putting a rule into play cannot shift a subsequent roll.
 *
 * There is deliberately no cascade: `RULE_FIRED` is not a member of `Trigger`,
 * so a rule cannot trigger a rule — not by convention, but because the type
 * cannot express it.
 */

/** What the triggering action was, for the conditions and effects that need to
 *  know. Absent fields simply make those conditions false. */
export interface Blow {
  /** The other party in the exchange — what you struck, or what struck you. */
  readonly otherId?: string;
  readonly hit?: boolean;
}

/** An effect with every "who" and "where" already worked out. This is what
 *  lands in the log and what replay applies. */
export type Resolved =
  | { readonly kind: 'health'; readonly entityId: string; readonly to: number }
  | { readonly kind: 'stat'; readonly entityId: string; readonly stat: StatName; readonly to: number }
  | { readonly kind: 'move'; readonly entityId: string; readonly to: Pos }
  | { readonly kind: 'said'; readonly text: string };

function stepsBetween(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestCreature(state: GameState, actorId: string): number {
  const actor = findEntity(state.entities, actorId);
  if (actor === undefined) return Infinity;

  let best = Infinity;
  for (const e of state.entities) {
    if (e.id === actorId || !isAlive(e)) continue;
    best = Math.min(best, stepsBetween(actor.pos, e.pos));
  }
  return best;
}

function livingOthers(state: GameState, actorId: string): number {
  return state.entities.filter((e) => e.id !== actorId && isAlive(e)).length;
}

/** How far the way out is, or `Infinity` on a map without one. */
function stepsToExit(state: GameState, from: Pos): number {
  let best = Infinity;
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      if (tileAt(state.grid, x, y) === EXIT) best = Math.min(best, stepsBetween(from, { x, y }));
    }
  }
  return best;
}

function statOf(e: Entity, stat: StatName): number {
  return stat === 'maxHp' ? e.maxHp : e.stats[stat];
}

/**
 * Whether one condition holds, from the actor's point of view.
 *
 * Total: an actor not in the state makes every condition false rather than
 * throwing. A rule referring to something that has left the world should
 * quietly not fire, not take the turn down with it.
 */
export function holds(condition: Condition, state: GameState, actorId: string, blow: Blow = {}): boolean {
  const actor = findEntity(state.entities, actorId);
  if (actor === undefined) return false;

  switch (condition.kind) {
    case 'hpAtMost': return actor.stats.hp <= condition.n;
    case 'hpAtLeast': return actor.stats.hp >= condition.n;
    // Guarded against a zero ceiling, which would otherwise divide by zero and
    // make a percentage condition NaN — silently false, and maddening to debug.
    case 'hpBelowPercent': return actor.maxHp > 0 && (actor.stats.hp * 100) / actor.maxHp < condition.n;
    case 'hpAbovePercent': return actor.maxHp > 0 && (actor.stats.hp * 100) / actor.maxHp > condition.n;
    case 'creatureWithin': return nearestCreature(state, actorId) <= condition.n;
    case 'noCreatureWithin': return nearestCreature(state, actorId) > condition.n;
    case 'creaturesAtMost': return livingOthers(state, actorId) <= condition.n;
    case 'creaturesAtLeast': return livingOthers(state, actorId) >= condition.n;
    case 'exitWithin': return stepsToExit(state, actor.pos) <= condition.n;
    case 'exitBeyond': return stepsToExit(state, actor.pos) > condition.n;
    case 'turnAtLeast': return state.turn >= condition.n;
    case 'depthAtLeast': return state.depth >= condition.n;
    case 'statAtLeast': return statOf(actor, condition.stat) >= condition.n;
    // A floor that never recorded its cut has none — old logs make this false
    // rather than guessing, the same honesty as an absent blow.
    case 'motifIs': return state.motif === condition.motif;
    case 'bodyHere': return state.bodies.some((b) => b.x === actor.pos.x && b.y === actor.pos.y);
    case 'blowLanded': return blow.hit === true;
    case 'blowMissed': return blow.hit === false;
    default: {
      const unhandled: never = condition;
      throw new Error(`unhandled condition ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Every condition, never merely one. A player who reads "with X and Y" and
 *  gets "with X or Y" has been lied to about their own game. */
function matches(rule: Rule, state: GameState, actorId: string, blow: Blow): boolean {
  return rule.require.every((c) => holds(c, state, actorId, blow));
}

/** Where a shove lands: straight away from the shover, stopping at the last
 *  square that is both open and empty. A push into a wall simply goes nowhere. */
function shovedTo(state: GameState, from: Pos, victim: Entity, squares: number): Pos {
  const dx = Math.sign(victim.pos.x - from.x);
  const dy = Math.sign(victim.pos.y - from.y);
  // Directly on top of the shover — no direction to shove in.
  if (dx === 0 && dy === 0) return { ...victim.pos };

  let at = { ...victim.pos };
  for (let i = 0; i < squares; i += 1) {
    const next = { x: at.x + dx, y: at.y + dy };
    if (!isPassable(state.grid, next.x, next.y)) break;
    if (state.entities.some((e) => isAlive(e) && e.pos.x === next.x && e.pos.y === next.y)) break;
    at = next;
  }
  return at;
}

/**
 * Turns one authored effect into concrete outcomes, or nothing at all when it
 * has no one to act on.
 *
 * Health is clamped at both ends here rather than in the reducer, so the
 * recorded number is the final one. Healing stops at the ceiling — without it,
 * "recover 1 when nothing is near" becomes unbounded health for anyone willing
 * to hold still. Harm stops at zero, so death happens once and by the same
 * test as a blow.
 */
function resolve(effect: Effect, state: GameState, actor: Entity, other: Entity | undefined): Resolved[] {
  switch (effect.kind) {
    case 'speak':
      return [{ kind: 'said', text: effect.text }];

    case 'heal':
      return [{ kind: 'health', entityId: actor.id, to: Math.min(actor.stats.hp + effect.n, actor.maxHp) }];

    case 'harm':
      return [{ kind: 'health', entityId: actor.id, to: Math.max(actor.stats.hp - effect.n, 0) }];

    case 'harmOther':
      return other === undefined ? []
        : [{ kind: 'health', entityId: other.id, to: Math.max(other.stats.hp - effect.n, 0) }];

    case 'grant':
      return [{ kind: 'stat', entityId: actor.id, stat: effect.stat, to: statOf(actor, effect.stat) + effect.n }];

    // Floored at 1: a stat of zero means never hitting anything again, or never
    // acting again, which is a rule that ends the game rather than changes it.
    case 'drain':
      return [{ kind: 'stat', entityId: actor.id, stat: effect.stat, to: Math.max(statOf(actor, effect.stat) - effect.n, 1) }];

    case 'push': {
      if (other === undefined) return [];
      const to = shovedTo(state, actor.pos, other, effect.n);
      return to.x === other.pos.x && to.y === other.pos.y ? [] : [{ kind: 'move', entityId: other.id, to }];
    }

    default: {
      const unhandled: never = effect;
      throw new Error(`unhandled effect ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Every rule that fires for this trigger, in ratification order, at most once
 * each. A single pass — no rule fires as a consequence of another.
 *
 * Effects are resolved against the state as it stands *when that rule fires*,
 * so two rules on the same trigger compose in order rather than both reading
 * the world as it was before either ran.
 */
export function fireRules(
  state: GameState,
  trigger: Trigger,
  actorId: string,
  blow: Blow = {},
): Extract<DraftEvent, { type: 'RULE_FIRED' }>[] {
  const fired: Extract<DraftEvent, { type: 'RULE_FIRED' }>[] = [];
  let running = state;

  for (const rule of running.rules) {
    if (rule.when !== trigger) continue;
    if (!matches(rule, running, actorId, blow)) continue;

    const actor = findEntity(running.entities, actorId);
    if (actor === undefined) continue;
    const other = blow.otherId === undefined ? undefined : findEntity(running.entities, blow.otherId);

    const outcomes = rule.then.flatMap((e) => resolve(e, running, actor, other));
    if (outcomes.length === 0) continue;

    fired.push({
      type: 'RULE_FIRED',
      schemaVersion: SCHEMA_VERSIONS.RULE_FIRED,
      rngCounter: running.rngCounter,
      rngDraws: 0,
      payload: { ruleId: rule.id, actorId, outcomes },
    });

    running = applyResolved(running, outcomes);
  }

  return fired;
}

/**
 * Replays resolved outcomes. Shared by `fireRules` (to compose rules within one
 * pass) and by the reducer (to replay history) so there is exactly one meaning
 * for what an outcome does.
 */
export function applyResolved(state: GameState, outcomes: readonly Resolved[]): GameState {
  let entities = state.entities;

  for (const o of outcomes) {
    if (o.kind === 'said') continue;

    entities = entities.map((e) => {
      if (e.id !== o.entityId) return e;
      if (o.kind === 'health') return { ...e, stats: { ...e.stats, hp: o.to } };
      if (o.kind === 'move') return { ...e, pos: { x: o.to.x, y: o.to.y } };
      return o.stat === 'maxHp'
        ? { ...e, maxHp: o.to }
        : { ...e, stats: { ...e.stats, [o.stat]: o.to } };
    });
  }

  return entities === state.entities ? state : { ...state, entities };
}
