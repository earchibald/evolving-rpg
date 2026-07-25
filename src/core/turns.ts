import { isAlive } from './entity.js';
import type { Entity } from './entity.js';

/** Speed descending, id ascending on ties. Ties must break the same way every
 *  run or two replays of one log can disagree about whose turn it is. */
export function initiativeOrder(entities: readonly Entity[]): string[] {
  return entities
    .filter(isAlive)
    .slice()
    .sort((a, b) => {
      if (b.stats.speed !== a.stats.speed) return b.stats.speed - a.stats.speed;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .map((e) => e.id);
}

export function nextActive(
  entities: readonly Entity[],
  currentId: string | null,
): { activeEntityId: string | null; wrapped: boolean } {
  const order = initiativeOrder(entities);
  const first = order[0];
  if (first === undefined) return { activeEntityId: null, wrapped: false };
  if (currentId === null) return { activeEntityId: first, wrapped: false };

  const at = order.indexOf(currentId);
  if (at === -1) return { activeEntityId: first, wrapped: true };

  const next = (at + 1) % order.length;
  return { activeEntityId: order[next] ?? first, wrapped: next === 0 };
}
