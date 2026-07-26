import { makeGrid } from './grid.js';
import { granted } from './item.js';
import { healthAfter } from '../canon/interpret.js';
import type { GameEvent } from './events.js';
import type { GameState } from './state.js';

/**
 * The shape change for one event, with the RNG counter deliberately left
 * alone — `apply` below is the single authority on that, so no branch here
 * can forget it or advance it twice.
 */
function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'WORLD_INIT': {
      const p = event.payload;
      // Copied out of the payload rather than referenced into state: the event
      // is frozen and shared by every fork, so aliasing it would let one world
      // rewrite another's history.
      const seeded = [p.player, ...p.opponents].map((s) => ({
        id: s.id,
        kind: s.kind,
        pos: { x: s.pos.x, y: s.pos.y },
        stats: { ...s.stats },
        tags: [...s.tags],
        maxHp: s.stats.hp,
      }));
      return {
        grid: makeGrid(p.width, p.height, p.tiles),
        entities: seeded,
        items: p.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          pos: { x: i.pos.x, y: i.pos.y },
          grants: { ...i.grants },
        })),
        turn: 1,
        activeEntityId: p.player.id,
        seed: p.seed,
        rngCounter: 0,
        // A new world plays under no rules, whatever stood before it on the
        // log. WORLD_INIT replaces state wholesale, and rules are state.
        rules: [],
      };
    }

    case 'RULE_FIRED': {
      // Replays the recorded effects. It does not look at `state.rules`, does
      // not re-read the rule, and does not re-evaluate a single condition —
      // that is what keeps folded history stable as rules accumulate.
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.actorId
            ? { ...e, stats: { ...e.stats, hp: healthAfter(e.stats.hp, e.maxHp, p.effects) } }
            : e,
        ),
      };
    }

    case 'RULE_RATIFIED': {
      // A fresh list. The old one is shared with every fold that has already
      // observed this state, so pushing in place would rewrite history that
      // something else is already holding.
      return { ...state, rules: [...state.rules, event.payload.rule] };
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

    // Waiting changes nothing by itself. It exists so that passing time is a
    // choice a player can make rather than something only walls impose on them
    // — and so the chronicle can tell "held position" apart from "had no move".
    case 'WAIT':
      return state;

    case 'ITEM_TAKEN': {
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId
            ? { ...e, stats: granted(e.stats, p.grants), maxHp: e.maxHp + p.grants.hp }
            : e,
        ),
        items: state.items.filter((i) => i.id !== p.itemId),
      };
    }

    case 'STRIKE': {
      const p = event.payload;
      if (!p.hit) return state;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.targetId
            // Clamped at zero: a corpse is dead, not increasingly dead, and
            // letting hp run negative would make "how badly did it lose" a
            // number nothing reads and every display has to special-case.
            ? { ...e, stats: { ...e.stats, hp: Math.max(0, e.stats.hp - p.damage) } }
            : e,
        ),
      };
    }

    case 'TURN_ADVANCED':
      return { ...state, turn: event.payload.turn, activeEntityId: event.payload.activeEntityId };

    default: {
      // Exhaustive at compile time — the never assignment is what proves it —
      // and loud at runtime. Without this arm the switch falls off the end and
      // returns undefined while still typed GameState, so a log carrying an
      // event type this engine does not know folds to nothing and every later
      // read dereferences it. A log from a newer engine is an expected input,
      // not an exotic one, which is exactly why this must throw rather than
      // quietly return the state unchanged.
      const unhandled: never = event;
      throw new Error(`apply: unknown event type ${String((unhandled as { type: unknown }).type)}`);
    }
  }
}

/**
 * The only way state changes. Pure: no RNG, no clock, no network. Everything
 * random was resolved when the command ran and is recorded in the event, which
 * is what makes a replay faithful rather than merely similar.
 *
 * The counter advances by `rngCounter + rngDraws` for every event type without
 * exception. Before v2 only WORLD_INIT moved it, reading a `counterAfter` field
 * out of its payload — a special case that could not survive a second consumer
 * of randomness. Handling it in one place here means a new event type cannot
 * forget to account for its own draws.
 *
 * An event that changes nothing returns the very same state object, so a
 * blocked move stays free of allocation as well as free of consequence.
 *
 * Total over *validated* events. A WORLD_INIT payload that is internally
 * inconsistent with the grid it describes — a tile count disagreeing with the
 * declared size, or a non-positive width or height — throws out of makeGrid.
 * That is deliberate rather than a gap: it happens only to a corrupted log,
 * where failing loudly beats folding nonsense. Verify an untrusted log with
 * verifyChain before folding it.
 */
export function apply(state: GameState, event: GameEvent): GameState {
  const next = reduce(state, event);
  const rngCounter = event.rngCounter + event.rngDraws;
  return next.rngCounter === rngCounter ? next : { ...next, rngCounter };
}
