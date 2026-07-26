import { WALL, tileAt, idx, inBounds } from '../core/grid.js';
import type { Grid } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { GameEvent } from '../core/events.js';

/**
 * Fog of war — what the PLAY view knows.
 *
 * Deliberately in ui/, not core/. Sight is presentation: the world itself is
 * fully determined and fully recorded, the developer panels stay omniscient,
 * and nothing here touches an event or a draw. What the player has seen is
 * *derived* from the chain — the union of every field of view along the
 * player's recorded path — so there is nothing to store, and a rewind or a
 * fork shrinks what is known exactly as it shrinks what happened. A new
 * floor starts dark by the same construction: WORLD_INIT resets the walk.
 */

/** How far sight reaches, in tiles. Rooms are 4–8 wide, so standing inside
 *  one usually lights it whole; corridors read as tunnels of exactly what
 *  they are. Said here once so the number has a home a designer can find. */
export const SIGHT = 9;

/** The eight octant transforms of recursive shadowcasting. */
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

/**
 * Recursive shadowcasting (the RogueBasin form), one octant at a time.
 *
 * Each octant sweeps rows outward from the origin; a wall splits the sweep
 * into the slopes it leaves open, and everything behind it is never visited
 * at all. Walls themselves are visible when the sweep reaches them — a wall
 * you can see is how a room reads as a room.
 */
export function visibleFrom(grid: Grid, ox: number, oy: number, radius = SIGHT): Set<number> {
  const out = new Set<number>([idx(grid, ox, oy)]);

  const scan = (
    xx: number, xy: number, yx: number, yy: number,
    row: number, startSlope: number, endSlope: number,
  ): void => {
    if (startSlope < endSlope) return;
    let nextStart = startSlope;
    for (let depth = row; depth <= radius; depth += 1) {
      let blocked = false;
      for (let col = Math.ceil(depth * nextStart - 0.5); col >= Math.floor(depth * endSlope + 0.5) - 0; col -= 1) {
        const lSlope = (col + 0.5) / (depth - 0.5);
        const rSlope = (col - 0.5) / (depth + 0.5);
        if (rSlope > startSlope) continue;
        if (lSlope < endSlope) break;

        const x = ox + col * xx + depth * yx;
        const y = oy + col * xy + depth * yy;
        // Bounds first: `idx` is plain y*width+x, so an out-of-range x wraps
        // to a real tile on the next row — the scan running one tile past the
        // east wall lit a phantom square rows away, found by a player seeing
        // a "discovered" tile beyond the border. tileAt below is safe (out of
        // bounds reads as wall, which is what ends the sweep); only the
        // *recording* must be gated. Round-ish edge rather than a square.
        if (inBounds(grid, x, y) && col * col + depth * depth <= radius * radius + radius) {
          out.add(idx(grid, x, y));
        }

        if (blocked) {
          if (tileAt(grid, x, y) === WALL) {
            nextStart = rSlope;
          } else {
            blocked = false;
            startSlope = nextStart;
          }
        } else if (tileAt(grid, x, y) === WALL && depth < radius) {
          blocked = true;
          scan(xx, xy, yx, yy, depth + 1, nextStart, lSlope);
          nextStart = rSlope;
        }
      }
      if (blocked) break;
    }
  };

  for (const [xx, xy, yx, yy] of OCTANTS) {
    scan(xx, xy, yx, yy, 1, 1.0, 0.0);
  }
  return out;
}

export interface Fog {
  /** Every tile index the player has ever had in view on this floor. */
  readonly seen: ReadonlySet<number>;
  /** The tile indices in view right now. */
  readonly visible: ReadonlySet<number>;
}

/** One-slot incremental cache: the usual render extends the last head by a
 *  few events, so the walk back finds it almost immediately. A fork, switch
 *  or rewind misses and rebuilds from the root — which is exactly the case
 *  where knowledge must shrink, and a rebuild is what shrinks it. */
let cached: { head: string; grid: Grid | null; pos: { x: number; y: number } | null; seen: Set<number> } | null = null;

function blank(): { grid: Grid | null; pos: { x: number; y: number } | null; seen: Set<number> } {
  return { grid: null, pos: null, seen: new Set<number>() };
}

/** Applies one event's effect on where the player stands and what that adds
 *  to the seen set. Only three things move a player: being born, walking,
 *  and a rule's shove. */
function absorb(
  acc: { grid: Grid | null; pos: { x: number; y: number } | null; seen: Set<number> },
  event: GameEvent,
  gridOf: (payload: { width: number; height: number; tiles: number[] }) => Grid,
): void {
  if (event.type === 'WORLD_INIT') {
    acc.grid = gridOf(event.payload);
    acc.pos = { x: event.payload.player.pos.x, y: event.payload.player.pos.y };
    acc.seen = new Set<number>();
  } else if (event.type === 'MOVE' && event.payload.entityId === 'player') {
    acc.pos = { x: event.payload.to.x, y: event.payload.to.y };
  } else if (event.type === 'RULE_FIRED') {
    for (const o of event.payload.outcomes) {
      if (o.kind === 'move' && o.entityId === 'player') acc.pos = { x: o.to.x, y: o.to.y };
    }
  } else {
    return;
  }
  if (acc.grid !== null && acc.pos !== null) {
    for (const i of visibleFrom(acc.grid, acc.pos.x, acc.pos.y)) acc.seen.add(i);
  }
}

/**
 * What the player has seen by `head`, and what they see standing there.
 *
 * `makeGrid` is passed in rather than imported so this module stays free of
 * core construction concerns beyond reading tiles.
 */
export function fogAt(
  log: EventLog,
  head: string | null,
  gridOf: (payload: { width: number; height: number; tiles: number[] }) => Grid,
): Fog {
  if (head === null) return { seen: new Set(), visible: new Set() };

  // Walk back to the cached head, or to the root.
  const pending: GameEvent[] = [];
  let cursor: string | null = head;
  let acc = blank();
  while (cursor !== null) {
    if (cached !== null && cursor === cached.head) {
      acc = { grid: cached.grid, pos: cached.pos, seen: new Set(cached.seen) };
      break;
    }
    const event = log.events.get(cursor);
    if (event === undefined) throw new Error(`fog: missing event ${cursor}`);
    pending.push(event);
    cursor = event.parent;
  }

  for (let i = pending.length - 1; i >= 0; i -= 1) absorb(acc, pending[i]!, gridOf);
  cached = { head, grid: acc.grid, pos: acc.pos, seen: new Set(acc.seen) };

  const visible = acc.grid !== null && acc.pos !== null
    ? visibleFrom(acc.grid, acc.pos.x, acc.pos.y)
    : new Set<number>();
  return { seen: acc.seen, visible };
}
