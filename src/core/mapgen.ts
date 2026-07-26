import { FLOOR, WALL, EXIT, makeGrid, idx, isPassable } from './grid.js';
import type { Grid } from './grid.js';
import { intBetween } from './rng.js';
import { reachableFrom } from './reachability.js';

export interface SpawnResult {
  points: Array<{ x: number; y: number }>;
  counterAfter: number;
}

/**
 * Chooses where a world's inhabitants stand.
 *
 * Candidates are the tiles genuinely reachable from the start and at least
 * `minDistance` away, so nothing is already breathing on you when the world
 * opens and nothing is sealed somewhere you can never reach. Picking by index
 * out of a shrinking list guarantees distinct tiles in exactly one draw each,
 * rather than rejection-sampling an unbounded number of times.
 *
 * Returns fewer points than asked for rather than looping forever if the
 * reachable area is too small — a cramped map is a reason to have fewer
 * creatures in it, not a reason to hang.
 */
export function pickSpawnPoints(
  seed: number,
  counter: number,
  grid: Grid,
  start: { x: number; y: number },
  count: number,
  minDistance: number,
): SpawnResult {
  const reachable = reachableFrom(grid, start.x, start.y);
  const candidates: Array<{ x: number; y: number }> = [];

  for (const index of reachable) {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (Math.abs(x - start.x) + Math.abs(y - start.y) >= minDistance) candidates.push({ x, y });
  }
  // Set iteration order is insertion order, which depends on the flood fill's
  // traversal — deterministic, but sort anyway so the choice never depends on
  // an implementation detail of reachableFrom.
  candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const points: Array<{ x: number; y: number }> = [];
  let c = counter;

  for (let i = 0; i < count && candidates.length > 0; i += 1) {
    const pick = intBetween(seed, c, 0, candidates.length - 1);
    c += 1;
    const chosen = candidates[pick];
    if (chosen === undefined) break;
    points.push(chosen);
    candidates.splice(pick, 1);
  }

  return { points, counterAfter: c };
}

/** A room's interior — every tile in [x, x+w) × [y, y+h) is floor. */
export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapGenResult {
  grid: Grid;
  start: { x: number; y: number };
  rooms: Room[];
  counterAfter: number;
  /** The generator's own account of what it built, in plain words. Legibility
   *  is covenant L1: a map whose shape cannot be read cannot be checked. */
  story: string;
}

/** Interior room sizes. Rogue used a 3x3 grid of rooms on 80x24; Brogue's run
 *  6..12 wide. Ours sit between: wide enough to fight in, small enough that a
 *  48x32 board holds a dozen with corridors between. */
const ROOM_W = { min: 4, max: 8 } as const;
const ROOM_H = { min: 3, max: 6 } as const;

/** Boards too small to hold two separated rooms become one open chamber, so
 *  trial worlds and tiny test boards flow through the same generator as the
 *  real game rather than through a fossil kept alive for them. */
const MIN_ROOMY_WIDTH = ROOM_W.min * 2 + 5;
const MIN_ROOMY_HEIGHT = ROOM_H.min * 2 + 5;

const center = (r: Room): { x: number; y: number } => ({
  x: r.x + Math.floor(r.w / 2),
  y: r.y + Math.floor(r.h / 2),
});

/** One tile of wall kept between rooms, so two rooms never merge by touching
 *  and every join is a corridor something chose to carve. */
function overlapsWithMargin(a: Room, b: Room): boolean {
  return a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x
    && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y;
}

function carveRoom(tiles: number[], width: number, room: Room): void {
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (let x = room.x; x < room.x + room.w; x += 1) {
      tiles[y * width + x] = FLOOR;
    }
  }
}

/** An L-shaped corridor between two interior points, one tile wide: the whole
 *  horizontal leg, then the whole vertical leg, or the other way round. Both
 *  ends are room centers, so the path never touches the border. */
function carveL(
  tiles: number[],
  width: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  horizontalFirst: boolean,
): void {
  const bend = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  for (const [a, b] of [[from, bend], [bend, to]] as const) {
    const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        tiles[y * width + x] = FLOOR;
      }
    }
  }
}

/**
 * Rooms joined by corridors, with loops.
 *
 * The shape is the classical one — Rogue's rooms-and-passages, sized against
 * Brogue's conventions (see docs/design/MAPS.md for the survey). Placement is
 * rejection sampling: draw a rectangle, keep it if it fits with a one-tile
 * margin, until the target count is met or the attempts run out. Every room
 * then joins the *nearest already-connected* room — a spanning tree, so the
 * whole map is connected by construction — and a few extra corridors are
 * carved on top, because a tree makes every wrong turn a dead end you must
 * walk back out of, and loops are what turn a chase into a choice. That is
 * Brogue's stated reason for cycles, and it is ours.
 *
 * Every random choice is a counted draw. Rejected rectangles consume their
 * draws — wanted, since the counter's whole job is to make the sequence of
 * decisions replayable, including the ones that came to nothing.
 *
 * Boards below the rooms-and-corridors minimum become one open chamber, so
 * every consumer — the real game, the assay's trial worlds, a 12x8 test board
 * — flows through this one generator.
 */
export function generateMap(
  seed: number,
  counter: number,
  width: number,
  height: number,
): MapGenResult {
  let c = counter;

  // The open-chamber degenerate: all interior floor inside a solid border.
  if (width < MIN_ROOMY_WIDTH || height < MIN_ROOMY_HEIGHT) {
    if (width < 3 || height < 3) throw new Error(`generateMap: ${width}x${height} cannot hold an interior`);
    const tiles = new Array<number>(width * height).fill(WALL);
    const chamber: Room = { x: 1, y: 1, w: width - 2, h: height - 2 };
    carveRoom(tiles, width, chamber);
    const sx = intBetween(seed, c, 1, width - 2); c += 1;
    const sy = intBetween(seed, c, 1, height - 2); c += 1;
    return {
      grid: makeGrid(width, height, tiles),
      start: { x: sx, y: sy },
      rooms: [chamber],
      counterAfter: c,
      story: 'one open chamber',
    };
  }

  const tiles = new Array<number>(width * height).fill(WALL);

  // Rogue put ~9 rooms on 80x24 (one per ~210 tiles); Brogue runs denser. One
  // per ~110 tiles gives 4 rooms on the old 24x16 and 13 on 48x32.
  const target = Math.max(3, Math.min(13, Math.round((width * height) / 110)));
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < target * 10 && rooms.length < target; attempt += 1) {
    const w = intBetween(seed, c, ROOM_W.min, ROOM_W.max); c += 1;
    const h = intBetween(seed, c, ROOM_H.min, ROOM_H.max); c += 1;
    const x = intBetween(seed, c, 1, width - 1 - w); c += 1;
    const y = intBetween(seed, c, 1, height - 1 - h); c += 1;
    const candidate: Room = { x, y, w, h };
    if (rooms.some((r) => overlapsWithMargin(candidate, r))) continue;
    rooms.push(candidate);
    carveRoom(tiles, width, candidate);
  }

  // A board that fits no second room is still a world: fall back to a chamber
  // rather than hand back an all-wall grid.
  if (rooms.length === 0) {
    const chamber: Room = { x: 1, y: 1, w: width - 2, h: height - 2 };
    carveRoom(tiles, width, chamber);
    rooms.push(chamber);
  }

  // Spanning connection: each room joins the nearest room already connected.
  // Connectivity of the whole map follows by induction, not by luck.
  for (let i = 1; i < rooms.length; i += 1) {
    const here = center(rooms[i]!);
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < i; j += 1) {
      const there = center(rooms[j]!);
      const d = Math.abs(here.x - there.x) + Math.abs(here.y - there.y);
      if (d < best) { best = d; nearest = j; }
    }
    const horizontalFirst = intBetween(seed, c, 0, 1) === 0; c += 1;
    carveL(tiles, width, here, center(rooms[nearest]!), horizontalFirst);
  }

  // Loops. A pure tree means every wrong turn is walked twice; a cycle means a
  // route *around* — flight has somewhere to go and a chase has two mouths.
  let loops = 0;
  if (rooms.length >= 3) {
    const wanted = Math.max(1, Math.floor(rooms.length / 4));
    for (let i = 0; i < wanted; i += 1) {
      const a = intBetween(seed, c, 0, rooms.length - 1); c += 1;
      const b = intBetween(seed, c, 0, rooms.length - 1); c += 1;
      if (a === b) continue;
      const horizontalFirst = intBetween(seed, c, 0, 1) === 0; c += 1;
      carveL(tiles, width, center(rooms[a]!), center(rooms[b]!), horizontalFirst);
      loops += 1;
    }
  }

  const startRoom = intBetween(seed, c, 0, rooms.length - 1); c += 1;
  const start = center(rooms[startRoom]!);

  const grid = makeGrid(width, height, tiles);

  // By construction every carved tile is connected; this is the loud check
  // that the construction holds. A generator that could hand back a sealed
  // room would break covenant M5 silently, and silence is the failure mode.
  const reachable = reachableFrom(grid, start.x, start.y);
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] === FLOOR && !reachable.has(i)) {
      throw new Error(`generateMap: sealed floor at ${i % width},${Math.floor(i / width)} (seed ${seed})`);
    }
  }

  return {
    grid,
    start,
    rooms,
    counterAfter: c,
    story: `${rooms.length} rooms, ${loops} loop${loops === 1 ? '' : 's'}`,
  };
}

/**
 * The farthest walkable tile from the start, by flood-fill distance rather than
 * straight-line — so "far" means far to walk, not far to look at. Ties break on
 * tile index, which is deterministic and independent of traversal order.
 *
 * Draws nothing: where the way out lies is decided by the map's shape, not by
 * chance, which is what makes every world's journey the longest one available
 * to it rather than an accident.
 */
export function farthestFrom(grid: Grid, start: { x: number; y: number }): { x: number; y: number } {
  const seen = new Map<number, number>();
  const queue: Array<{ x: number; y: number; d: number }> = [{ ...start, d: 0 }];
  seen.set(start.y * grid.width + start.x, 0);

  let best = { x: start.x, y: start.y };
  let bestDistance = -1;
  let bestIndex = Number.POSITIVE_INFINITY;

  while (queue.length > 0) {
    const here = queue.shift();
    if (here === undefined) break;

    const index = here.y * grid.width + here.x;
    if (here.d > bestDistance || (here.d === bestDistance && index < bestIndex)) {
      best = { x: here.x, y: here.y };
      bestDistance = here.d;
      bestIndex = index;
    }

    for (const [nx, ny] of [[here.x + 1, here.y], [here.x - 1, here.y], [here.x, here.y + 1], [here.x, here.y - 1]] as const) {
      if (!isPassable(grid, nx, ny)) continue;
      const key = ny * grid.width + nx;
      if (seen.has(key)) continue;
      seen.set(key, here.d + 1);
      queue.push({ x: nx, y: ny, d: here.d + 1 });
    }
  }

  return best;
}

/** How far the walk to a tile is, or Infinity if there is no walk at all. */
export function walkDistance(grid: Grid, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const seen = new Set<number>([idx(grid, from.x, from.y)]);
  const queue: Array<{ x: number; y: number; d: number }> = [{ ...from, d: 0 }];
  while (queue.length > 0) {
    const here = queue.shift();
    if (here === undefined) break;
    if (here.x === to.x && here.y === to.y) return here.d;
    for (const [nx, ny] of [[here.x + 1, here.y], [here.x - 1, here.y], [here.x, here.y + 1], [here.x, here.y - 1]] as const) {
      if (!isPassable(grid, nx, ny)) continue;
      const key = idx(grid, nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, d: here.d + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Carves the way out into the tiles. The exit is a place, so it lives in the map. */
export function withExit(grid: Grid, exit: { x: number; y: number }): Grid {
  const tiles = [...grid.tiles];
  tiles[exit.y * grid.width + exit.x] = EXIT;
  return makeGrid(grid.width, grid.height, tiles);
}
