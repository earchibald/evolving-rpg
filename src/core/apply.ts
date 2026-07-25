import { makeGrid } from './grid.js';
import type { GameEvent } from './events.js';
import type { GameState } from './state.js';

/**
 * The only way state changes. Pure: no RNG, no clock, no network. Everything
 * random was resolved when the command ran and is recorded in the payload,
 * which is what makes a replay faithful rather than merely similar.
 *
 * Total over *validated* events. A WORLD_INIT payload that is internally
 * inconsistent with the grid it describes — a tile count disagreeing with the
 * declared size, or a non-positive width or height — throws out of makeGrid.
 * That is deliberate rather than a gap: it happens only to a corrupted log,
 * where failing loudly beats folding nonsense. Verify an untrusted log with
 * verifyChain before folding it.
 */
export function apply(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'WORLD_INIT': {
      const p = event.payload;
      return {
        grid: makeGrid(p.width, p.height, p.tiles),
        entities: [{
          id: p.player.id,
          kind: p.player.kind,
          pos: { x: p.player.pos.x, y: p.player.pos.y },
          stats: { ...p.player.stats },
          tags: [...p.player.tags],
        }],
        turn: 1,
        activeEntityId: p.player.id,
        seed: p.seed,
        rngCounter: p.counterAfter,
      };
    }

    case 'MOVE': {
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId ? { ...e, pos: { x: p.to.x, y: p.to.y } } : e,
        ),
      };
    }

    case 'MOVE_BLOCKED':
      return state;

    case 'TURN_ADVANCED':
      return { ...state, turn: event.payload.turn, activeEntityId: event.payload.activeEntityId };
  }
}
