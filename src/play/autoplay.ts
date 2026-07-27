import { fold } from '../log/chain.js';
import { outcome } from '../core/commands.js';
import { playerStep, playerWait, playerUse, runWorldTurns } from './session.js';
import type { Position } from './session.js';
import type { Policy } from './policies.js';
import type { GameState } from '../core/state.js';

/**
 * Drives a policy through the real session layer — the same `playerStep` and
 * `playerWait` a keyboard reaches, the same world turns, the same rules
 * firing. What a harness plays is therefore exactly what a person plays,
 * which is the whole reason to have one.
 *
 * Capped by *actions*, not turns, deliberately: a blocked move consumes no
 * turn, so a policy that only ever walks into a wall would run forever under
 * a turn cap. That is not a hypothetical — the wall-bumper exists precisely
 * to spam the one trigger that costs nothing.
 */

export interface Played {
  readonly position: Position;
  readonly state: GameState;
  readonly ended: 'dead' | 'escaped' | 'playing' | 'won';
  readonly actions: number;
}

export function autoplay(start: Position, policy: Policy, maxActions = 200, playerId = 'player'): Played {
  let position = start;
  let actions = 0;

  while (actions < maxActions) {
    const state = fold(position.log, position.head);
    if (outcome(state, playerId) !== 'playing') break;

    const wish = policy(state, playerId);
    actions += 1;

    position = wish.kind === 'wait'
      ? playerWait(position, playerId).position
      : wish.kind === 'use'
        // An empty satchel makes 'use' a no-op that never passes the turn —
        // acceptable only because no policy wishes it with empty hands.
        ? playerUse(position, playerId).position
        : playerStep(position, playerId, wish.dx, wish.dy).position;

    position = runWorldTurns(position, playerId);
  }

  const state = fold(position.log, position.head);
  return { position, state, ended: outcome(state, playerId), actions };
}
