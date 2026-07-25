import { append, fold, chain } from '../log/chain.js';
import { getRef, fork, reset, listRefs } from '../log/refs.js';
import type { Refs } from '../log/refs.js';
import { attemptMove, advanceTurn, endsTurn, wait, takeUnderfoot, outcome } from '../core/commands.js';
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

/** Picks up whatever the mover is now standing on. Rides along with the move
 *  that reached it rather than costing a turn of its own — stooping is not a
 *  decision, walking there was. */
function collect(position: Position, entityId: string): Position {
  const taken = takeUnderfoot(fold(position.log, position.head), entityId);
  return taken === null ? position : commit(position, taken);
}

export function playerStep(position: Position, playerId: string, dx: number, dy: number): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);

  // A finished run takes no more input. Without this you can walk off the exit
  // you just reached, or keep playing a corpse.
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = attemptMove(state, playerId, dx, dy);
  return { position: collect(commit(position, draft), playerId), draft };
}

/** Hold position and let the world come to you. */
export function playerWait(position: Position, playerId: string): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = wait(state, playerId);
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
    // A reached exit ends the world's turn too — nothing gets a parting shot.
    if (outcome(state, playerId) !== 'playing') return current;

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

/** Marks a world nobody is playing any more. Visible in the name on purpose:
 *  a graveyard you have to consult a field to recognise is not a graveyard. */
export const GRAVE_MARK = '†';

export function isGrave(name: string): boolean {
  return name.includes(GRAVE_MARK);
}

export interface Burial {
  refs: Refs;
  /** The world your corpse is in, or null if you are still alive. */
  grave: string | null;
}

/**
 * What death does.
 *
 * The branch you died on is kept, under a new name, forever. The world you are
 * playing rewinds to its beginning. Nothing is deleted — `reset` moves a
 * pointer and the abandoned events stay exactly where they were, which is the
 * property increment 1 built and never had a reason to use until now.
 *
 * The cost is paid by construction rather than by bookkeeping. Rewinding
 * re-folds from the root, so anything you had picked up is un-picked-up: the
 * keen edge is back on the floor where it started, and the only version of you
 * that ever held it is the one lying dead on the other branch. No inventory
 * needs to be taken away, because state was never stored in the first place.
 *
 * This is the answer to "why fork". Until dying was something history had to
 * keep, forking was a devtool.
 */
export function buryIfDead(
  log: EventLog,
  refs: Refs,
  active: string,
  playerId = 'player',
): Burial {
  const ref = getRef(refs, active);
  if (outcome(fold(log, ref.head), playerId) !== 'dead') return { refs, grave: null };

  const past = listRefs(refs).filter((r) => r.name.startsWith(`${active}${GRAVE_MARK}`)).length;
  const grave = `${active}${GRAVE_MARK}${past + 1}`;

  const kept = fork(log, refs, active, grave, ref.head, 'died here');

  const root = chain(log, ref.head)[0];
  return { refs: reset(log, kept, active, root?.id ?? null), grave };
}
