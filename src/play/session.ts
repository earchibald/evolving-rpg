import { append, fold } from '../log/chain.js';
import { attemptMove, advanceTurn, endsTurn } from '../core/commands.js';
import { decide } from '../core/ai.js';
import { findEntity, isAlive } from '../core/entity.js';
import type { Action } from '../core/ai.js';
import type { EventLog } from '../log/chain.js';
import type { GameState } from '../core/state.js';
import type { DraftEvent } from '../core/events.js';

/**
 * The driver: the loop that turns intentions into events.
 *
 * A third layer on purpose. `core/` holds rules and knows nothing about
 * history; `log/` holds history and knows nothing about rules; this knows both
 * and is the only place that does. Without it the generator and the view each
 * grow their own copy of the turn loop, and they drift — which has already
 * happened once on this project.
 */
export interface Position {
  log: EventLog;
  head: string;
}

/** Appends a draft, then the turn advance it earns. A refused action earns none. */
function commit(position: Position, draft: DraftEvent): Position {
  const acted = append(position.log, position.head, draft);
  if (!endsTurn(draft)) return { log: acted.log, head: acted.event.id };

  const turned = append(acted.log, acted.event.id, advanceTurn(fold(acted.log, acted.event.id)));
  return { log: turned.log, head: turned.event.id };
}

/**
 * Turns a decision into a draft.
 *
 * A strike routes through `attemptMove` rather than having its own command:
 * bumping into something hostile *is* the attack, and giving creatures a
 * separate path would let their combat drift away from the player's. One rule,
 * one code path, whoever is swinging.
 */
function draftFor(state: GameState, entityId: string, action: Action): DraftEvent | null {
  if (action.kind === 'wait') return null;

  if (action.kind === 'step') return attemptMove(state, entityId, action.dx, action.dy);

  const self = findEntity(state.entities, entityId);
  const target = findEntity(state.entities, action.targetId);
  if (self === undefined || target === undefined) return null;

  // Only ever chosen at range 1, so exactly one axis is non-zero.
  return attemptMove(
    state,
    entityId,
    Math.sign(target.pos.x - self.pos.x),
    Math.sign(target.pos.y - self.pos.y),
  );
}

export function playerStep(position: Position, playerId: string, dx: number, dy: number): {
  position: Position;
  draft: DraftEvent;
} {
  const draft = attemptMove(fold(position.log, position.head), playerId, dx, dy);
  return { position: commit(position, draft), draft };
}

/**
 * Runs every other creature until it is the player's turn again.
 *
 * Bounded rather than trusting the turn order to come back around: a creature
 * that waits forever, or an order that never reaches the player, would
 * otherwise hang the game with no clue why. The cap is generous enough that
 * hitting it means a bug, not a busy world.
 */
export function runWorldTurns(position: Position, playerId: string, maxSteps = 64): Position {
  let current = position;

  for (let i = 0; i < maxSteps; i += 1) {
    const state = fold(current.log, current.head);

    const player = findEntity(state.entities, playerId);
    if (player === undefined || !isAlive(player)) return current;

    const active = state.activeEntityId;
    if (active === null || active === playerId) return current;

    const draft = draftFor(state, active, decide(state, active));
    if (draft === null) {
      // Waiting still passes the turn, or the order never moves on.
      const turned = append(current.log, current.head, advanceTurn(state));
      current = { log: turned.log, head: turned.event.id };
      continue;
    }
    current = commit(current, draft);
  }

  return current;
}
