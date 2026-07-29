import { WALL, SECRET, tileAt } from './grid.js';
import { isAlive } from './entity.js';
import type { Grid } from './grid.js';
import type { Entity, Pos } from './entity.js';

/**
 * The honest line — covenant M7's geometry, in core because a shot is
 * mechanics. The fog (ui/fov.ts) answers "what does the player see";
 * this answers "what can a stone cross", and the two must be allowed to
 * disagree at their edges: sight is presentation, the line is law.
 */

/** The reach disc, exactly the circle the fog draws (fov.ts): dx²+dy² ≤ r²+r.
 *  One rounding rule for every circle in the game, so a ring the renderer
 *  shows is a ring the dice agree with. */
export function withinReach(from: Pos, to: Pos, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy <= radius * radius + radius;
}

/**
 * Whether a straight shot from `from` to `to` flies clear.
 *
 * An integer supercover walk, center to center, symmetric by construction
 * (the walk from B to A visits the same cells). Walls and secrets stop it —
 * an illusory wall is real enough to stop a stone, in both directions, so
 * geometry never leaks the secret. Living bodies stop it where the line
 * truly crosses their tile: no shooting through your enemies, theirs or
 * ours, which is what makes a corridor single-file into cover. A corner
 * crossed exactly blocks only when BOTH flanking cells are solid — two
 * walls kissing stop the shot; a body never blocks at a corner it merely
 * clips. The end tiles never block: the archer and the mark stand on them.
 */
export function clearShot(grid: Grid, entities: readonly Entity[], from: Pos, to: Pos): boolean {
  const solid = (x: number, y: number): boolean => {
    const t = tileAt(grid, x, y); // out of bounds reads as wall
    return t === WALL || t === SECRET;
  };
  const stands = (x: number, y: number): boolean =>
    entities.some((e) => isAlive(e) && e.pos.x === x && e.pos.y === y
      && !(x === from.x && y === from.y) && !(x === to.x && y === to.y));

  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);

  // Crossing times, scaled to integers: the k-th x-boundary is crossed at
  // (2k+1)·dy of 2·dx·dy, the j-th y-boundary at (2j+1)·dx. Comparing the
  // scaled pair walks the exact segment with no floats to round.
  let x = from.x;
  let y = from.y;
  let i = 0;
  let j = 0;
  while (i < dx || j < dy) {
    const tX = i < dx ? (2 * i + 1) * dy : Number.POSITIVE_INFINITY;
    const tY = j < dy ? (2 * j + 1) * dx : Number.POSITIVE_INFINITY;
    if (tX === tY) {
      if (solid(x + sx, y) && solid(x, y + sy)) return false;
      x += sx; y += sy; i += 1; j += 1;
    } else if (tX < tY) {
      x += sx; i += 1;
    } else {
      y += sy; j += 1;
    }
    if (x === to.x && y === to.y) break;
    if (solid(x, y) || stands(x, y)) return false;
  }
  return true;
}
