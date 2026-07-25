import type { Pos, Stats } from './entity.js';

/**
 * A thing lying on the floor.
 *
 * Not an entity: it has no hit points, takes no turns, and blocks nothing. The
 * only thing it does is change you when you pick it up, and `grants` is the
 * whole of that — a full stat block rather than optional fields, so there is
 * never a question of what an absent key meant.
 */
export interface Item {
  readonly id: string;
  readonly kind: string;
  readonly pos: Pos;
  readonly grants: Stats;
}

export const NOTHING: Stats = { hp: 0, might: 0, wits: 0, speed: 0 };

/** Applies an item's grants to a stat block. */
export function granted(stats: Stats, grants: Stats): Stats {
  return {
    hp: stats.hp + grants.hp,
    might: stats.might + grants.might,
    wits: stats.wits + grants.wits,
    speed: stats.speed + grants.speed,
  };
}

export function itemAt(items: readonly Item[], x: number, y: number): Item | undefined {
  return items.find((i) => i.pos.x === x && i.pos.y === y);
}
