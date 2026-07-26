import { isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import type { Entity } from './entity.js';
import type { GameState } from './state.js';

/** How far a creature notices you from: steps of *walking*, not line of
 *  flight. Eight steps down a corridor is eight steps; eight steps through a
 *  wall is no steps at all, because the path does not exist. This is what
 *  makes a closed door of wall a real refuge, and it is the same arithmetic a
 *  player can do by counting tiles. */
export const AWARENESS = 8;

export type Action =
  | { kind: 'strike'; targetId: string }
  | { kind: 'step'; dx: number; dy: number }
  | { kind: 'wait' };

function manhattan(a: Entity, b: Entity): number {
  return Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y);
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
 * The hunt is a breadth-first search out to AWARENESS steps, over tiles the
 * creature could actually stand on — walls block it, and so do other living
 * creatures, which is why a corridor fills single-file rather than clipping
 * through itself. If the search reaches you, the creature takes the first step
 * of that shortest path. If it does not — too far, or the way is blocked — it
 * holds still. Neighbour order is fixed (east, west, south, north), so the
 * chosen path is deterministic and a replayed world hunts identically.
 */
export function decide(state: GameState, entityId: string): Action {
  const self = findEntity(state.entities, entityId);
  if (self === undefined || !isAlive(self)) return { kind: 'wait' };

  const quarry = state.entities.find((e) => e.kind === 'you' && isAlive(e));
  if (quarry === undefined) return { kind: 'wait' };

  if (manhattan(self, quarry) === 1) return { kind: 'strike', targetId: quarry.id };

  // BFS from the creature, bounded by AWARENESS, through standable tiles.
  const { width } = state.grid;
  const key = (x: number, y: number): number => y * width + x;
  const occupied = new Set<number>();
  for (const e of state.entities) {
    if (e.id !== entityId && isAlive(e)) occupied.add(key(e.pos.x, e.pos.y));
  }
  const goal = key(quarry.pos.x, quarry.pos.y);

  const seen = new Set<number>([key(self.pos.x, self.pos.y)]);
  let frontier: Array<{ x: number; y: number; first: { dx: number; dy: number } | null }> = [
    { x: self.pos.x, y: self.pos.y, first: null },
  ];

  for (let depth = 0; depth < AWARENESS; depth += 1) {
    const next: typeof frontier = [];
    for (const at of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = at.x + dx;
        const y = at.y + dy;
        const k = key(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        const first = at.first ?? { dx, dy };
        if (k === goal) return { kind: 'step', dx: first.dx, dy: first.dy };
        if (!isPassable(state.grid, x, y) || occupied.has(k)) continue;
        next.push({ x, y, first });
      }
    }
    frontier = next;
  }

  return { kind: 'wait' };
}
