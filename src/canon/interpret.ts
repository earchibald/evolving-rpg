import { SCHEMA_VERSIONS } from '../core/events.js';
import { isAlive, findEntity } from '../core/entity.js';
import type { Condition, Effect, Rule, Trigger } from './rule.js';
import type { DraftEvent } from '../core/events.js';
import type { GameState } from '../core/state.js';

/**
 * Where a rule stops being data and starts being play.
 *
 * Two properties carry the whole design.
 *
 * **Firing is decided here and recorded there.** `fireRules` evaluates
 * conditions once, at the moment of firing, and emits a `RULE_FIRED` event
 * carrying the effects it settled on. `apply` then replays those effects
 * without ever re-reading the rule. If the reducer re-evaluated conditions
 * instead, ratifying a rule today would silently rewrite what a run did last
 * week — your past would keep changing under you, which is the one thing an
 * append-only log exists to prevent.
 *
 * **Firing draws no randomness.** Every effect is a pure function of the state
 * and the recorded numbers. That is why `RULE_FIRED` always carries
 * `rngDraws: 0`, and why putting a new rule into play cannot shift a single
 * subsequent roll.
 *
 * There is deliberately no cascade. `RULE_FIRED` is not a member of `Trigger`,
 * so a rule cannot trigger a rule — not by convention, but because the type
 * cannot express it. A rule whose effect satisfies its own condition is
 * therefore harmless rather than an infinite loop.
 */

/** Manhattan distance, matching how movement and the threat readout measure. */
function stepsBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** How far the nearest *living* thing that is not the actor stands. `Infinity`
 *  when nothing qualifies, which makes "nothing within n" true on an empty map
 *  and "something within n" false, both of which read correctly. */
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

/**
 * Whether one condition holds, from the actor's point of view.
 *
 * Total: an actor that is not in the state makes every condition false rather
 * than throwing. A rule referring to something that has left the world should
 * quietly not fire, not take the turn down with it.
 */
export function holds(condition: Condition, state: GameState, actorId: string): boolean {
  const actor = findEntity(state.entities, actorId);
  if (actor === undefined) return false;

  switch (condition.kind) {
    case 'noCreatureWithin':
      return nearestCreature(state, actorId) > condition.n;
    case 'creatureWithin':
      return nearestCreature(state, actorId) <= condition.n;
    case 'hpAtMost':
      return actor.stats.hp <= condition.n;
    case 'hpAtLeast':
      return actor.stats.hp >= condition.n;
    default: {
      const unhandled: never = condition.kind;
      throw new Error(`unhandled condition ${String(unhandled)}`);
    }
  }
}

/** Every condition, never merely one. A player who reads "with X and Y" and
 *  gets "with X or Y" has been lied to about their own game. */
function matches(rule: Rule, state: GameState, actorId: string): boolean {
  return rule.require.every((c) => holds(c, state, actorId));
}

/**
 * Every rule that fires for this trigger, in ratification order, at most once
 * each. A single pass — no rule fires as a consequence of another.
 */
export function fireRules(
  state: GameState,
  trigger: Trigger,
  actorId: string,
): Extract<DraftEvent, { type: 'RULE_FIRED' }>[] {
  const fired: Extract<DraftEvent, { type: 'RULE_FIRED' }>[] = [];

  for (const rule of state.rules) {
    if (rule.when !== trigger) continue;
    if (!matches(rule, state, actorId)) continue;

    fired.push({
      type: 'RULE_FIRED',
      schemaVersion: SCHEMA_VERSIONS.RULE_FIRED,
      rngCounter: state.rngCounter,
      rngDraws: 0,
      payload: {
        ruleId: rule.id,
        actorId,
        // Copied out of the rule rather than referenced into it. The rule lives
        // in a frozen event that every fork shares; the effects recorded here
        // must stand alone, because this is what will be replayed.
        effects: rule.then.map(copyEffect),
      },
    });
  }

  return fired;
}

function copyEffect(e: Effect): Effect {
  return e.kind === 'speak' ? { kind: 'speak', text: e.text } : { kind: e.kind, n: e.n };
}

/**
 * What a recorded effect does to one entity's health.
 *
 * Clamped at both ends. Healing stops at the ceiling the entity was created
 * with — without that, "recover 1 hit point when nothing is near" turns into
 * unbounded hit points for anyone willing to hold still long enough, which is
 * not a rule a player could sensibly ratify. Harm stops at zero, so death
 * happens exactly once and by exactly the same test as a blow: `hp <= 0`.
 */
export function healthAfter(hp: number, maxHp: number, effects: readonly Effect[]): number {
  let next = hp;
  for (const e of effects) {
    if (e.kind === 'heal') next = Math.min(next + e.n, maxHp);
    else if (e.kind === 'harm') next = Math.max(next - e.n, 0);
  }
  return next;
}
