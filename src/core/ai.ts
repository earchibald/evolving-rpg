import { isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { verbOf, LURK_RANGE, VIGIL_LEASH, GUARD_LEASH, CALL_RANGE, SHOT_RANGE } from './tables.js';
import { clearShot, withinReach } from './sight.js';
import { walkDistance } from './mapgen.js';
import type { Entity, Pos } from './entity.js';
import type { GameState } from './state.js';

/** How far a creature notices you from: steps of *walking*, not line of
 *  flight. Eight steps down a corridor is eight steps; eight steps through a
 *  wall is no steps at all, because the path does not exist. This is what
 *  makes a closed door of wall a real refuge, and it is the same arithmetic a
 *  player can do by counting tiles. */
export const AWARENESS = 8;

export type Action =
  | { kind: 'call' }
  | { kind: 'strike'; targetId: string }
  | { kind: 'step'; dx: number; dy: number }
  | { kind: 'lunge'; targetId: string }
  | { kind: 'mend' }
  | { kind: 'draw' }
  | { kind: 'shoot'; targetId: string }
  | { kind: 'wait' };

function manhattan(a: Entity, b: Entity): number {
  return Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y);
}

/**
 * First step of the hunt: a breadth-first search out to AWARENESS steps, over
 * tiles the hunter could actually stand on — walls block it, and so do other
 * living creatures, which is why a corridor fills single-file rather than
 * clipping through itself. If the search reaches the goal, the first step of
 * that shortest path comes back; if not — too far, or the way is blocked —
 * null. Neighbour order is fixed (east, west, south, north), so the chosen
 * path is deterministic and a replayed world hunts identically.
 */
function firstStep(
  state: GameState,
  selfId: string,
  from: Pos,
  goal: Pos,
  /** How far the search may walk. The hunt keeps AWARENESS; the guard's
   *  homeward walk and the wanderer's round pass the whole board, because
   *  a post or a waypoint is farther away than prey is allowed to be. */
  reach = AWARENESS,
): { dx: number; dy: number } | null {
  const { width, height } = state.grid;
  const key = (x: number, y: number): number => y * width + x;
  const occupied = new Set<number>();
  for (const e of state.entities) {
    if (e.id !== selfId && isAlive(e)) occupied.add(key(e.pos.x, e.pos.y));
  }
  const goalKey = key(goal.x, goal.y);

  const seen = new Set<number>([key(from.x, from.y)]);
  let frontier: Array<{ x: number; y: number; first: { dx: number; dy: number } | null }> = [
    { x: from.x, y: from.y, first: null },
  ];

  for (let depth = 0; depth < reach; depth += 1) {
    const next: typeof frontier = [];
    for (const at of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = at.x + dx;
        const y = at.y + dy;
        // Bounds before the key: `key` is plain y*width+x, so an off-map
        // coordinate wraps onto a real tile — one column east of the map IS
        // the next row's west door by arithmetic, and a hunt whose quarry
        // stood at x=0 walked EAST off the world toward the collision.
        // The fog fixed this same wrap first (fov.ts); live floors dodged
        // it only because their borders are wall. Found by the volley's
        // borderless test grids.
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const k = key(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        const first = at.first ?? { dx, dy };
        if (k === goalKey) return first;
        if (!isPassable(state.grid, x, y) || occupied.has(k)) continue;
        next.push({ x, y, first });
      }
    }
    frontier = next;
  }

  return null;
}

/** Whether the skirmisher's lunge geometry holds: exactly two tiles of
 *  ground with a free tile on the way. The twin of the check inside
 *  `lungeStrike` (commands.ts), which is the one that decides for real —
 *  this only keeps the brain from wishing for the impossible. */
function canLunge(state: GameState, self: Entity, quarry: Entity): boolean {
  if (manhattan(self, quarry) !== 2) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const mid = { x: self.pos.x + dx, y: self.pos.y + dy };
    const closes = Math.abs(quarry.pos.x - mid.x) + Math.abs(quarry.pos.y - mid.y) === 1;
    if (!closes) continue;
    if (!isPassable(state.grid, mid.x, mid.y)) continue;
    if (state.entities.some((e) => isAlive(e) && e.id !== self.id && e.pos.x === mid.x && e.pos.y === mid.y)) continue;
    return true;
  }
  return false;
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
 * On top of the shared hunt, each archetype acts by its verb (tables.ts):
 *
 * - **ambush** (stalker): born coiled, it holds perfectly still until the
 *   quarry comes within LURK_RANGE steps of walking — visible stillness is
 *   the tell — then hunts; its first landed blow releases the spring.
 * - **lunge** (skirmisher): two tiles and the blow in one motion, the only
 *   actor that can — approach is what it punishes.
 * - **vigil** (warden): leashed to its post; it pursues only quarry within
 *   VIGIL_LEASH of the post, walks home when the leash empties, and knits
 *   shut once it stands at its post unwatched.
 * - **trample** (bruiser): decided nowhere here — the shove lives in the
 *   blow itself (commands.ts), because it is part of hitting, not a choice.
 */
export function decide(state: GameState, entityId: string): Action {
  const self = findEntity(state.entities, entityId);
  if (self === undefined || !isAlive(self)) return { kind: 'wait' };

  // Reeling spends the action. The wait it decides is the event that clears
  // the tag — one stagger, one lost turn, no bookkeeping anywhere else.
  if (self.tags.includes('staggered')) return { kind: 'wait' };

  // The mimic's whole art is stillness: hidden, it does nothing at all —
  // no hunt, no drift, no tell — because an item that fidgets is no item.
  // The lie lives on the render side; this wait is just a thing that does
  // not move yet. Unmasked, it fights plain (its loaded spring is the
  // strike's business, not the mind's).
  if (verbOf(self.kind) === 'feign' && self.tags.includes('hidden')) return { kind: 'wait' };

  const quarry = state.entities.find((e) => e.kind === 'you' && isAlive(e));
  if (quarry === undefined) return { kind: 'wait' };

  // Smoke in the air: a fooled hunter chases where you WERE when it rose.
  // Whoever had you in claws' reach then (recorded in the event) still has
  // you — and if you never moved, the stale trail still ends at your feet,
  // which is exactly what standing in your own smoke deserves.
  const fooled = state.smoke !== null
    && state.turn < state.smoke.until
    && !state.smoke.unfooled.includes(entityId);
  const scent: Pos = fooled && state.smoke !== null ? state.smoke.at : quarry.pos;

  const verb = verbOf(self.kind);

  // The vigil, before anything else: a warden's world is its post.
  if (verb === 'vigil') {
    const post = self.post ?? self.pos;
    const intruderNear = walkDistance(state.grid, post, scent) <= VIGIL_LEASH;
    if (!intruderNear) {
      const home = self.pos.x === post.x && self.pos.y === post.y;
      if (home) {
        // Unwatched and wounded: the vigil knits the fight shut. Whole, it
        // simply stands — the stairs are what it is for.
        return self.stats.hp < self.maxHp ? { kind: 'mend' } : { kind: 'wait' };
      }
      const back = firstStep(state, entityId, self.pos, post);
      return back === null ? { kind: 'wait' } : { kind: 'step', dx: back.dx, dy: back.dy };
    }
    // Intruder inside the leash: an ordinary hunt from here down.
  }

  // The alarm ringing: the floor knows where you are. Read here because it
  // answers two questions below — whether a posted guard leaves its post, and
  // how far the hunt may search.
  //
  // The designer's filing, 2026-07-29: "the alarm bell trap doesn't seem...to
  // attract monsters". Measured, they were right by arithmetic, and the clock
  // was not the reason: 83% of an expanse floor's bodies are POST-LEASHED
  // GUARDS, and the bell used to excuse every one of them. Per belled floor,
  // barely half a body took a single step — and ringing five times longer
  // moved exactly the same half. So the leash is what the bell cuts. A guard
  // whose whole floor is screaming does not keep standing by its shelf; the
  // warden's vigil does, because the warden is bound to the door BY ROLE and
  // the stairs being watched is load-bearing.
  const alarmed = state.alarm !== null && state.turn < state.alarm.until;

  // A posted guard is the vigil's homeward half without the mend (v10):
  // it hunts only what comes within GUARD_LEASH of its post — the leash
  // anchored to the POST, not to wherever the chase has dragged it — and
  // walks home when the leash empties. The keeper and every relic guard
  // hold their prizes now instead of freezing where a chase went cold.
  if (self.disposition === 'guard' && verb !== 'vigil' && !alarmed) {
    const post = self.post ?? self.pos;
    const intruderNear = walkDistance(state.grid, post, scent) <= GUARD_LEASH;
    if (!intruderNear) {
      const home = self.pos.x === post.x && self.pos.y === post.y;
      if (home) return { kind: 'wait' };
      const back = firstStep(state, entityId, self.pos, post, state.grid.width + state.grid.height);
      return back === null ? { kind: 'wait' } : { kind: 'step', dx: back.dx, dy: back.dy };
    }
  }

  // Coiled: perfectly still until the quarry is close enough to commit to.
  // The stillness is in plain sight — that is the tell, and the dread.
  if (verb === 'ambush' && self.tags.includes('ambush')) {
    const near = walkDistance(state.grid, self.pos, scent) <= LURK_RANGE;
    if (!near) return { kind: 'wait' };
  }

  // The voice, before the teeth: a caller with its cry unspent cries out
  // the moment prey walks into range, and hunts like anything else after.
  // It cries at the scent — a smoked floor gets called down on where you
  // were, which is exactly what the smoke is for.
  if (verb === 'call' && self.tags.includes('call')
    && walkDistance(state.grid, self.pos, scent) <= CALL_RANGE) {
    return { kind: 'call' };
  }

  // A fooled hunter cannot strike or lunge at what it has lost — it walks
  // its stale trail. Only the unfooled fight as if they can see.
  if (!fooled) {
    if (manhattan(self, quarry) === 1) return { kind: 'strike', targetId: quarry.id };

    // The skirmisher's tooth: close two tiles and strike in the same action.
    if (verb === 'lunge' && canLunge(state, self, quarry)) {
      return { kind: 'lunge', targetId: quarry.id };
    }

    // The volley: the fight starts before you arrive. Undrawn it draws —
    // the tell everyone sees, covenant M8 — and drawn it looses. No retreat
    // ever: the tradition regrets dancing AI, and the slinger's menace is
    // that it stands there. A broken line falls through to the hunt, whose
    // first step drops the stance — it re-draws when it re-acquires.
    if (verb === 'volley'
      && withinReach(self.pos, quarry.pos, SHOT_RANGE)
      && clearShot(state.grid, state.entities, self.pos, quarry.pos)) {
      return self.tags.includes('drawn')
        ? { kind: 'shoot', targetId: quarry.id }
        : { kind: 'draw' };
    }
  }

  // The awareness cap — the wall of eight steps that makes a closed corridor
  // a refuge — is gone while the ringing lasts.
  const step = firstStep(state, entityId, self.pos, scent,
    alarmed ? state.grid.width + state.grid.height : AWARENESS);
  if (step !== null) return { kind: 'step', dx: step.dx, dy: step.dy };

  // Nothing in reach to hunt: the wanderer walks its round. The reducer
  // advances the leg as steps land on waypoints; here it is only read —
  // and a body already standing on its goal heads for the next stop, as
  // does one whose goal another body is parked on, so a round never
  // stalls on its own doorstep. Drawless like every decision here.
  if (self.disposition === 'wander' && self.route !== undefined && self.route.length > 0) {
    const leg = (self.leg ?? 0) % self.route.length;
    let goal = self.route[leg]!;
    const blocked = (w: Pos): boolean =>
      (w.x === self.pos.x && w.y === self.pos.y)
      || state.entities.some((e) => e.id !== entityId && isAlive(e) && e.pos.x === w.x && e.pos.y === w.y);
    if (blocked(goal)) goal = self.route[(leg + 1) % self.route.length]!;
    const walk = firstStep(state, entityId, self.pos, goal, state.grid.width + state.grid.height);
    if (walk !== null) return { kind: 'step', dx: walk.dx, dy: walk.dy };
  }
  return { kind: 'wait' };
}
