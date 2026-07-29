import { FLOOR, WALL, EXIT, SECRET, makeGrid, idx, isPassable, tileAt } from './grid.js';
import type { Grid } from './grid.js';
import { intBetween } from './rng.js';
import { reachableFrom } from './reachability.js';
import { MOTIFS } from './tables.js';
import type { Motif } from './tables.js';

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

/** Boards too small to hold two separated rooms become one open chamber, so
 *  trial worlds and tiny test boards flow through the same generator as the
 *  real game rather than through a fossil kept alive for them. Judged
 *  against the smallest motif's rooms, motif-independent — a tiny board is
 *  a chamber whatever the depth. */
const MIN_ROOMY_WIDTH = 3 * 2 + 5;
const MIN_ROOMY_HEIGHT = 3 * 2 + 5;

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
  /** The depth band's shape (tables.ts MOTIFS). Defaults to the door — the
   *  shape the game launched with — so every existing caller and test means
   *  exactly what it meant. */
  motif: Motif = MOTIFS.door,
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

  // Rogue put ~9 rooms on 80x24 (one per ~210 tiles); Brogue runs denser.
  // The divisor is the motif's: the warren crowds, the halls breathe.
  const target = Math.max(3, Math.min(16, Math.round((width * height) / motif.tilesPerRoom)));
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < target * 10 && rooms.length < target; attempt += 1) {
    const w = intBetween(seed, c, motif.roomW[0], motif.roomW[1]); c += 1;
    const h = intBetween(seed, c, motif.roomH[0], motif.roomH[1]); c += 1;
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
  // The rate is the motif's: the warren loops hard, the halls barely.
  let loops = 0;
  if (rooms.length >= 3) {
    const wanted = Math.max(1, Math.floor(rooms.length / motif.loopPer));
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

/** A shortest walk between two tiles, root-first and inclusive of both ends,
 *  or [] when no walk exists. Fixed neighbour order (east, west, south,
 *  north — the hunt's order), so the road a floor is judged by is the same
 *  road every replay judges. Drawless: a path is derived, never rolled. */
export function walkPath(
  grid: Grid,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const parent = new Map<number, number>();
  const seen = new Set<number>([idx(grid, from.x, from.y)]);
  const queue: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  let found = false;
  while (queue.length > 0 && !found) {
    const here = queue.shift();
    if (here === undefined) break;
    for (const [nx, ny] of [[here.x + 1, here.y], [here.x - 1, here.y], [here.x, here.y + 1], [here.x, here.y - 1]] as const) {
      if (!isPassable(grid, nx, ny)) continue;
      const key = idx(grid, nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      parent.set(key, idx(grid, here.x, here.y));
      if (nx === to.x && ny === to.y) { found = true; break; }
      queue.push({ x: nx, y: ny });
    }
  }
  if (!found && !(from.x === to.x && from.y === to.y)) return [];
  const path: Array<{ x: number; y: number }> = [];
  let at = idx(grid, to.x, to.y);
  const home = idx(grid, from.x, from.y);
  while (at !== home) {
    path.push({ x: at % grid.width, y: Math.floor(at / grid.width) });
    const back = parent.get(at);
    if (back === undefined) return [];
    at = back;
  }
  path.push({ x: from.x, y: from.y });
  path.reverse();
  return path;
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

/** Flood fill that treats undiscovered secrets as the walls they pretend to
 *  be — the player's-eye reachability, as opposed to reachableFrom's truth. */
function floodHonest(grid: Grid, start: { x: number; y: number }): Set<number> {
  const seen = new Set<number>();
  const passable = (x: number, y: number): boolean => {
    const t = tileAt(grid, x, y);
    return t !== WALL && t !== SECRET;
  };
  if (!passable(start.x, start.y)) return seen;
  const stack: Array<[number, number]> = [[start.x, start.y]];
  seen.add(idx(grid, start.x, start.y));
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
      if (!passable(nx, ny)) continue;
      const i = idx(grid, nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * The walkable tiles in the one-tile band around a room, told apart: a
 * `door` is a narrow gap — floor with wall on both shoulders, the shape a
 * doorway actually has — while `open` counts band floor that is simply more
 * room, the shared edge of rooms the generator let run together. Only doors
 * can be sealed; painting SECRET across an open edge turns the neighbor's
 * own floor into fake wall (found on floor 7 of the first voiced run, where
 * two entire "walls" of a room were secrets). Corners sit diagonal — no
 * 4-way step enters through one — so they are neither.
 */
function boundaryOf(grid: Grid, room: Room): { doors: number[]; open: number } {
  const doors: number[] = [];
  let open = 0;
  const consider = (x: number, y: number, aX: number, aY: number, bX: number, bY: number): void => {
    if (tileAt(grid, x, y) !== FLOOR) return;
    if (tileAt(grid, aX, aY) !== FLOOR && tileAt(grid, bX, bY) !== FLOOR) doors.push(idx(grid, x, y));
    else open += 1;
  };
  for (let x = room.x; x < room.x + room.w; x += 1) {
    for (const y of [room.y - 1, room.y + room.h]) consider(x, y, x - 1, y, x + 1, y);
  }
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (const x of [room.x - 1, room.x + room.w]) consider(x, y, x, y - 1, x, y + 1);
  }
  return { doors, open };
}

const inRoom = (room: Room, x: number, y: number): boolean =>
  x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;

/**
 * Sometimes, a room keeps itself secret.
 *
 * Roughly one floor in three, one room's every doorway becomes an illusory
 * wall: it looks like wall and blocks the fog until walked through, but was
 * always walkable — walking into it is how it is found. The start and exit
 * rooms are never sealed, and the seal is committed only if everything
 * OUTSIDE the room stays reachable without crossing a secret — a corridor
 * that merely passes through the room may be load-bearing, and sealing a
 * thoroughfare would hide half the floor rather than one room.
 *
 * Every choice is a counted draw, like all generation.
 */
export function sealSecretRoom(
  seed: number,
  counter: number,
  grid: Grid,
  rooms: readonly Room[],
  start: { x: number; y: number },
  exit: { x: number; y: number },
  /** Odds of sealing: 1 in this. The motif's — the deep keeps more secrets
   *  (Brogue ramps secret doors 0→67% over its depths; ours band-steps). */
  secretIn = 3,
): { grid: Grid; counterAfter: number; sealed: boolean } {
  let c = counter;
  if (rooms.length < 3) return { grid, counterAfter: c, sealed: false };

  const roll = intBetween(seed, c, 1, secretIn); c += 1;
  if (roll !== 1) return { grid, counterAfter: c, sealed: false };

  const eligible = rooms.filter((r) =>
    !inRoom(r, start.x, start.y) && !inRoom(r, exit.x, exit.y));
  if (eligible.length === 0) return { grid, counterAfter: c, sealed: false };

  // A few tries: a drawn room whose sealing would strand the floor is
  // skipped, not forced.
  for (let attempt = 0; attempt < Math.min(4, eligible.length); attempt += 1) {
    const pick = intBetween(seed, c, 0, eligible.length - 1); c += 1;
    const room = eligible[pick]!;
    const { doors, open } = boundaryOf(grid, room);
    // No doors is nothing to seal; open boundary is a room merged into its
    // neighbor — it has no wall to hide behind, and sealing it would eat
    // the neighbor's floor.
    if (doors.length === 0 || open > 0) continue;

    const tiles = [...grid.tiles];
    for (const d of doors) tiles[d] = SECRET;
    const sealedGrid = makeGrid(grid.width, grid.height, tiles);

    // The player's-eye check: everything outside the room must still be
    // walkable without knowing any secret.
    const honest = floodHonest(sealedGrid, start);
    let stranded = false;
    for (let i = 0; i < tiles.length && !stranded; i += 1) {
      if (tiles[i] !== FLOOR && tiles[i] !== EXIT) continue;
      const x = i % grid.width;
      const y = Math.floor(i / grid.width);
      if (inRoom(room, x, y)) continue;
      if (!honest.has(i)) stranded = true;
    }
    if (stranded) continue;

    return { grid: sealedGrid, counterAfter: c, sealed: true };
  }

  return { grid, counterAfter: c, sealed: false };
}

/**
 * The repair rule, stated by the designer: if a map arrives with rooms the
 * player cannot reach, we do not throw it away — we cut a hidden way in.
 * Any walkable region the honest flood cannot reach gets one wall on its
 * boundary turned into a secret passage, until nothing is stranded.
 *
 * By construction the generator never produces such a map, so this is
 * defence in depth — but a sabotaged build once leaked exactly that into a
 * live session, and the rule is better than the throw. Drawless and
 * deterministic: the punched wall is the lowest-index candidate.
 */
export function repairWithSecret(grid: Grid, start: { x: number; y: number }): { grid: Grid; punched: number } {
  const tiles = [...grid.tiles];
  let punched = 0;

  for (let guard = 0; guard < 8; guard += 1) {
    const current = makeGrid(grid.width, grid.height, tiles);
    // TRUE disconnection only: reachableFrom walks secrets like the floor
    // they are, so a deliberately sealed room is already connected and never
    // "repaired" with a redundant second door. Stranded means no path exists
    // at all — the sabotage case.
    const truth = reachableFrom(current, start.x, start.y);

    let hole = -1;
    outer:
    for (let i = 0; i < tiles.length; i += 1) {
      if (tiles[i] !== WALL) continue;
      const x = i % grid.width;
      const y = Math.floor(i / grid.width);
      let touchesReached = false;
      let touchesStranded = false;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!isPassable(current, nx, ny)) continue;
        if (truth.has(idx(grid, nx, ny))) touchesReached = true;
        else touchesStranded = true;
      }
      if (touchesReached && touchesStranded) { hole = i; break outer; }
    }

    if (hole === -1) return { grid: current, punched };
    tiles[hole] = SECRET;
    punched += 1;
  }

  return { grid: makeGrid(grid.width, grid.height, tiles), punched };
}
