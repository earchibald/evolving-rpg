import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import type { Entity } from './entity.js';
import type { GameState } from './state.js';

/** How far a creature notices you from. Manhattan distance, so it is the same
 *  metric movement uses — a creature cannot see round a corner it cannot walk
 *  round. */
export const AWARENESS = 8;

export type Action =
  | { kind: 'strike'; targetId: string }
  | { kind: 'step'; dx: number; dy: number }
  | { kind: 'wait' };

function manhattan(a: Entity, b: Entity): number {
  return Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y);
}

function canStand(state: GameState, moverId: string, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) return false;
  if (!isPassable(state.grid, x, y)) return false;
  return !state.entities.some((o) => o.id !== moverId && isAlive(o) && o.pos.x === x && o.pos.y === y);
}

/**
 * What a creature does on its turn.
 *
 * Deliberately **deterministic and drawless**. Randomness in the decision would
 * have to be threaded through the counter protocol for every creature on every
 * turn, and replay would then hinge on the order creatures were asked in.
 * Chance belongs in whether a blow lands, not in whether a creature decides to
 * throw it — and keeping it here means an opponent's behaviour can be reasoned
 * about by a player, which is what makes avoiding a fight a real decision
 * rather than a gamble.
 *
 * Ties break toward the larger axis, then toward x. Not arbitrary: it makes a
 * creature close the longer gap first, so it approaches on a readable diagonal
 * staircase rather than jittering.
 */
export function decide(state: GameState, entityId: string): Action {
  const self = findEntity(state.entities, entityId);
  if (self === undefined || !isAlive(self)) return { kind: 'wait' };

  const quarry = state.entities.find((e) => e.kind === 'you' && isAlive(e));
  if (quarry === undefined) return { kind: 'wait' };

  const distance = manhattan(self, quarry);
  if (distance === 1) return { kind: 'strike', targetId: quarry.id };
  if (distance > AWARENESS) return { kind: 'wait' };

  const dx = quarry.pos.x - self.pos.x;
  const dy = quarry.pos.y - self.pos.y;
  const stepX = { dx: Math.sign(dx), dy: 0 };
  const stepY = { dx: 0, dy: Math.sign(dy) };

  // Larger gap first; x wins an exact tie.
  const preferred = Math.abs(dx) >= Math.abs(dy) ? [stepX, stepY] : [stepY, stepX];

  for (const step of preferred) {
    if (step.dx === 0 && step.dy === 0) continue;
    if (canStand(state, entityId, self.pos.x + step.dx, self.pos.y + step.dy)) {
      return { kind: 'step', dx: step.dx, dy: step.dy };
    }
  }

  return { kind: 'wait' };
}
