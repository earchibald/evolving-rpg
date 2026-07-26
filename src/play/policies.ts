import { EXIT, WALL, tileAt, isPassable } from '../core/grid.js';
import { isAlive, findEntity } from '../core/entity.js';
import type { GameState } from '../core/state.js';
import type { Entity, Pos } from '../core/entity.js';

/**
 * Archetypal players, as pure functions.
 *
 * A policy looks at the world and says what it would do — step somewhere, or
 * hold still. Nothing here touches the log: the driver in `autoplay.ts` turns
 * these wishes into real events through the same session layer a keyboard
 * uses, which is the point. A harness that plays through a side door tests the
 * side door.
 *
 * These exist so the game can be *played* thousands of times without a human —
 * by the Critic to measure, by the assays to break candidate rules, and by an
 * agent checking that a change made anything better. They are deliberately
 * simple: an archetype is a question ("what does a run look like if you only
 * ever flee?"), not an attempt at good play.
 */

export interface Wish {
  readonly kind: 'step' | 'wait';
  readonly dx: number;
  readonly dy: number;
}

export type Policy = (state: GameState, playerId: string) => Wish;

const WAIT: Wish = { kind: 'wait', dx: 0, dy: 0 };
const step = (dx: number, dy: number): Wish => ({ kind: 'step', dx, dy });

function you(state: GameState, playerId: string): Entity | undefined {
  return findEntity(state.entities, playerId);
}

function livingOthers(state: GameState, playerId: string): Entity[] {
  return state.entities.filter((e) => e.id !== playerId && isAlive(e));
}

const steps = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * First step of a shortest path, walls respected, living creatures walkable —
 * walking into one is a strike, which is how the game itself reads a bump.
 * Null when no path exists.
 */
export function firstStepToward(state: GameState, from: Pos, goal: (p: Pos) => boolean): Wish | null {
  const { width, height } = state.grid;
  const key = (p: Pos): number => p.y * width + p.x;

  const queue: Pos[] = [from];
  const seen = new Set<number>([key(from)]);
  const prev = new Map<number, Pos>();
  let found: Pos | null = null;

  while (queue.length > 0 && found === null) {
    const at = queue.shift();
    if (at === undefined) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, at);
      if (goal(next)) { found = next; break; }
      if (isPassable(state.grid, next.x, next.y)) queue.push(next);
    }
  }
  if (found === null) return null;

  let at = found;
  while (true) {
    const back = prev.get(key(at));
    if (back === undefined) return null;
    if (back.x === from.x && back.y === from.y) break;
    at = back;
  }
  return step(Math.sign(at.x - from.x), Math.sign(at.y - from.y));
}

/** Heads for the way out, fighting through whatever stands in the path. */
export const rusher: Policy = (state, playerId) => {
  const me = you(state, playerId);
  if (me === undefined) return WAIT;
  return firstStepToward(state, me.pos, (p) => tileAt(state.grid, p.x, p.y) === EXIT) ?? WAIT;
};

/** Hunts the nearest living thing and keeps swinging until nothing is left,
 *  then leaves. The policy that finds out what combat actually costs. */
export const brawler: Policy = (state, playerId) => {
  const me = you(state, playerId);
  if (me === undefined) return WAIT;
  const prey = livingOthers(state, playerId);
  if (prey.length === 0) return rusher(state, playerId);
  return firstStepToward(state, me.pos, (p) => prey.some((e) => e.pos.x === p.x && e.pos.y === p.y)) ?? WAIT;
};

/** Maximises distance from everything alive and holds still when clear. The
 *  policy that finds out whether patience is ever worth anything. */
export const coward: Policy = (state, playerId) => {
  const me = you(state, playerId);
  if (me === undefined) return WAIT;
  const threats = livingOthers(state, playerId);
  if (threats.length === 0) return WAIT;

  const near = Math.min(...threats.map((e) => steps(me.pos, e.pos)));
  if (near > 6) return WAIT;

  let best: Wish = WAIT;
  let bestGain = near;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const to = { x: me.pos.x + dx, y: me.pos.y + dy };
    if (!isPassable(state.grid, to.x, to.y)) continue;
    if (threats.some((e) => e.pos.x === to.x && e.pos.y === to.y)) continue;
    const gain = Math.min(...threats.map((e) => steps(to, e.pos)));
    if (gain > bestGain) { bestGain = gain; best = step(dx, dy); }
  }
  return best;
};

/** Paces between two floor squares forever. The MOVE trigger, spammed. */
export const shuffler: Policy = (state, playerId) => {
  const me = you(state, playerId);
  if (me === undefined) return WAIT;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const to = { x: me.pos.x + dx, y: me.pos.y + dy };
    if (isPassable(state.grid, to.x, to.y)
      && !livingOthers(state, playerId).some((e) => e.pos.x === to.x && e.pos.y === to.y)) {
      return step(dx, dy);
    }
  }
  return WAIT;
};

/** Walks into the nearest wall, forever. MOVE_BLOCKED costs no turn, which is
 *  exactly why a rule firing on it needs this policy pointed at it.
 *
 *  On a rooms-and-corridors map the middle of a room has no wall in reach, so
 *  a bumper with nothing adjacent *seeks* one: it steps toward the nearest
 *  wall first, then spends the rest of eternity walking into it. A policy
 *  whose whole job is MOVE_BLOCKED must produce some on any board. */
export const bumper: Policy = (state, playerId) => {
  const me = you(state, playerId);
  if (me === undefined) return WAIT;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const to = { x: me.pos.x + dx, y: me.pos.y + dy };
    if (to.x < 0 || to.y < 0 || to.x >= state.grid.width || to.y >= state.grid.height) return step(dx, dy);
    if (tileAt(state.grid, to.x, to.y) === WALL) return step(dx, dy);
  }
  const found = firstStepToward(state, me.pos, (p) => tileAt(state.grid, p.x, p.y) === WALL);
  return found ?? WAIT;
};

/** Holds still, whatever happens. WAIT and TURN_PASSED, spammed. */
export const sitter: Policy = () => WAIT;

export const POLICIES: Readonly<Record<string, Policy>> = Object.freeze({
  rusher, brawler, coward, shuffler, bumper, sitter,
});
