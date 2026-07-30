import { WALL, SECRET, FLOOR, EXIT, tileAt, idx, inBounds } from '../core/grid.js';
import { sightAt } from '../core/tables.js';
import type { Grid } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { GameEvent } from '../core/events.js';
import type { GameState } from '../core/state.js';
import { isAlive } from '../core/entity.js';

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
export function visibleFrom(
  grid: Grid,
  ox: number,
  oy: number,
  radius = SIGHT,
  /** Tiles the player has trodden. A SECRET tile occludes like wall until it
   *  is in here — an illusory wall has to fool the fog or it fools nobody —
   *  and never occludes again after. */
  trodden?: ReadonlySet<number>,
): Set<number> {
  const out = new Set<number>([idx(grid, ox, oy)]);

  // What stops sight: wall, and any secret not yet walked through.
  const solid = (x: number, y: number): boolean => {
    const t = tileAt(grid, x, y);
    if (t === WALL) return true;
    return t === SECRET && !(trodden?.has(idx(grid, x, y)) ?? false);
  };

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
          if (solid(x, y)) {
            nextStart = rSlope;
          } else {
            blocked = false;
            startSlope = nextStart;
          }
        } else if (solid(x, y) && depth < radius) {
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
  /** Every tile the player has stood on. A secret passage is one of these or
   *  it is a wall — the render and the fog agree through this one set. */
  readonly revealed: ReadonlySet<number>;
}

interface FogAcc {
  grid: Grid | null;
  pos: { x: number; y: number } | null;
  seen: Set<number>;
  trod: Set<number>;
  /** How far this floor lets you see — the depth's darkness (tables.ts
   *  sightAt): Rogue and Moria ramped rooms to full dark; ours closes in. */
  sight: number;
}

/** One-slot incremental cache: the usual render extends the last head by a
 *  few events, so the walk back finds it almost immediately. A fork, switch
 *  or rewind misses and rebuilds from the root — which is exactly the case
 *  where knowledge must shrink, and a rebuild is what shrinks it. */
let cached: ({ head: string } & FogAcc) | null = null;

function blank(): FogAcc {
  return { grid: null, pos: null, seen: new Set<number>(), trod: new Set<number>(), sight: SIGHT };
}

/** Applies one event's effect on where the player stands and what that adds
 *  to the seen set. Only three things move a player: being born, walking,
 *  and a rule's shove. Every tile stood on joins `trod`, which is what turns
 *  an illusory wall into a known passage — for the fog and forever. */
function absorb(
  acc: FogAcc,
  event: GameEvent,
  gridOf: (payload: { width: number; height: number; tiles: number[] }) => Grid,
): void {
  if (event.type === 'WORLD_INIT') {
    acc.grid = gridOf(event.payload);
    acc.pos = { x: event.payload.player.pos.x, y: event.payload.player.pos.y };
    acc.seen = new Set<number>();
    acc.trod = new Set<number>();
    acc.sight = sightAt(event.payload.depth ?? 1);
  } else if (event.type === 'ITEM_USED' && event.payload.effect.kind === 'bell'
    && event.payload.entityId === 'player') {
    // The bell: the way out and the unfound prizes answer — single tiles
    // join SEEN, never their surroundings. Positions were resolved on the
    // event, so a rewind un-knows them exactly, like the flare.
    if (acc.grid !== null) {
      const { exit, prizes } = event.payload.effect;
      if (inBounds(acc.grid, exit.x, exit.y)) acc.seen.add(idx(acc.grid, exit.x, exit.y));
      for (const p of prizes) {
        if (inBounds(acc.grid, p.x, p.y)) acc.seen.add(idx(acc.grid, p.x, p.y));
      }
    }
    return;
  } else if (event.type === 'ITEM_USED' && event.payload.effect.kind === 'flare'
    && event.payload.entityId === 'player') {
    // The flare: the floor admits its shape in a burst — SEEN, never
    // visible, walls not consulted (light leaks where eyes cannot). Read
    // straight off the chain, so a rewind un-knows it exactly.
    if (acc.grid !== null) {
      const { at, radius } = event.payload.effect;
      for (let y = at.y - radius; y <= at.y + radius; y += 1) {
        for (let x = at.x - radius; x <= at.x + radius; x += 1) {
          const dx = x - at.x;
          const dy = y - at.y;
          if (inBounds(acc.grid, x, y) && dx * dx + dy * dy <= radius * radius + radius) {
            acc.seen.add(idx(acc.grid, x, y));
          }
        }
      }
    }
    return;
  } else if (event.type === 'SCROLL_READ' && event.payload.entityId === 'player') {
    const eff = event.payload.effect;
    if (acc.grid === null) return;
    if (eff.kind === 'unveiling') {
      // Named doors join the map as single known tiles — like the bell's
      // gifts. They keep occluding until walked: you know the door is
      // there; you cannot see through it.
      for (const s of eff.secrets) {
        if (inBounds(acc.grid, s.x, s.y)) acc.seen.add(idx(acc.grid, s.x, s.y));
      }
      return;
    }
    if (eff.kind === 'stone song') {
      // The walls fall in the fog's own copy of the grid too, or sight
      // would forever stop at ground that is no longer there.
      const tiles = [...acc.grid.tiles];
      for (const b of eff.broken) {
        if (inBounds(acc.grid, b.x, b.y)) tiles[idx(acc.grid, b.x, b.y)] = FLOOR;
      }
      acc.grid = gridOf({ width: acc.grid.width, height: acc.grid.height, tiles: tiles as number[] });
      // Fall through: light floods the opened ground from where you stand.
    } else if (eff.kind === 'blink') {
      acc.pos = { x: eff.to.x, y: eff.to.y };
      // Fall through: you see from where you landed.
    } else {
      return;
    }
  } else if (event.type === 'TRAP_SPRUNG' && event.payload.victimId === 'player'
    && !event.payload.dodged && event.payload.effect.kind === 'lodestone') {
    // The lodestone moved you; the fog follows (the trample taught this).
    acc.pos = { x: event.payload.effect.to.x, y: event.payload.effect.to.y };
  } else if (event.type === 'STRIKE' && event.payload.targetId === 'player'
    && event.payload.targetTo !== undefined) {
    // The trample drives you back a pace — found defect: the fog lagged a
    // tile behind a shoved player until their next own step.
    acc.pos = { x: event.payload.targetTo.x, y: event.payload.targetTo.y };
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
    acc.trod.add(idx(acc.grid, acc.pos.x, acc.pos.y));
    for (const i of visibleFrom(acc.grid, acc.pos.x, acc.pos.y, acc.sight, acc.trod)) acc.seen.add(i);
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
  if (head === null) return { seen: new Set(), visible: new Set(), revealed: new Set() };

  // Walk back to the cached head, or to the root.
  const pending: GameEvent[] = [];
  let cursor: string | null = head;
  let acc = blank();
  while (cursor !== null) {
    if (cached !== null && cursor === cached.head) {
      acc = { grid: cached.grid, pos: cached.pos, seen: new Set(cached.seen), trod: new Set(cached.trod), sight: cached.sight };
      break;
    }
    const event = log.events.get(cursor);
    if (event === undefined) throw new Error(`fog: missing event ${cursor}`);
    pending.push(event);
    cursor = event.parent;
  }

  for (let i = pending.length - 1; i >= 0; i -= 1) absorb(acc, pending[i]!, gridOf);
  cached = { head, grid: acc.grid, pos: acc.pos, seen: new Set(acc.seen), trod: new Set(acc.trod), sight: acc.sight };

  const visible = acc.grid !== null && acc.pos !== null
    ? visibleFrom(acc.grid, acc.pos.x, acc.pos.y, acc.sight, acc.trod)
    : new Set<number>();
  return { seen: acc.seen, visible, revealed: acc.trod };
}

/**
 * What is worth stopping a run for, named.
 *
 * The designer's rule for the run is "until it spots *anything* new", so
 * "anything" has to be a SET and "new" has to be a set difference — a guess
 * would stop on nothing or on every step. These are the things a player would
 * actually look up for: every living creature and every item currently in
 * view, every trap the run has found, and the way out once the map holds it.
 *
 * Newly-seen GROUND is deliberately not in here. A pace down a corridor
 * uncovers a tile or two, so ground-as-novelty would stop the run every single
 * step; the caller watches the SIZE of the newly-seen set instead, which is
 * what tells a corridor going on from a corridor opening up.
 */
export function notablesInView(state: GameState, fog: { seen: ReadonlySet<number>; visible: ReadonlySet<number> }): Set<string> {
  const out = new Set<string>();
  for (const e of state.entities) {
    if (e.kind === 'you' || !isAlive(e)) continue;
    if (fog.visible.has(idx(state.grid, e.pos.x, e.pos.y))) out.add(`body:${e.id}`);
  }
  for (const item of state.items) {
    if (fog.visible.has(idx(state.grid, item.pos.x, item.pos.y))) out.add(`thing:${item.id}`);
  }
  for (const t of state.traps) {
    if (t.revealed) out.add(`trap:${t.id}`);
  }
  for (let at = 0; at < state.grid.tiles.length; at += 1) {
    if (state.grid.tiles[at] === EXIT && fog.seen.has(at)) { out.add('the way out'); break; }
  }
  return out;
}
