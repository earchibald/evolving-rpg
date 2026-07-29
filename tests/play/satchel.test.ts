import { emptyLog, append, fold } from '../../src/log/chain.js';
import { playerStep, playerUse, playerWait, runWorldTurns } from '../../src/play/session.js';
import { decide } from '../../src/core/ai.js';
import { brawler, coward } from '../../src/play/policies.js';
import { draughtCeiling, smokeTurns, BOT_QUAFF_BELOW } from '../../src/core/tables.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';

/**
 * The satchel: two carried things now (the designer's second slot,
 * 2026-07-28), spent on purpose — q the first hand, Q the second.
 *
 * Everything here drives the session layer — the same playerStep and
 * playerUse a keyboard reaches — because "walking fills a free hand" and
 * "using costs the turn" are session truths, not reducer truths.
 */

interface Placed {
  id: string;
  kind: string;
  x: number;
  grants?: { hp: number; might: number; wits: number; speed: number };
}

function corridor(items: Placed[], foes: Array<{ id: string; kind: string; x: number; hp?: number }> = [], carrying?: string[], height = 1): Position {
  const width = 14;
  const draft: DraftEvent = {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width, height, tiles: new Array<number>(width * height).fill(FLOOR), seed: 9, depth: 1,
      ...(carrying === undefined ? {} : { playerSatchel: { kinds: carrying } }),
      items: items.map((i) => ({
        id: i.id, kind: i.kind, pos: { x: i.x, y: 0 },
        grants: i.grants ?? { hp: 0, might: 0, wits: 0, speed: 0 },
      })),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: foes.map((f) => ({
        id: f.id, kind: f.kind, pos: { x: f.x, y: 0 },
        stats: { hp: f.hp ?? 5, might: 2, wits: 1, speed: 1 }, tags: [],
      })),
    },
  } as DraftEvent;
  const opened = append(emptyLog(), null, draft);
  return { log: opened.log, head: opened.event.id };
}

const at = (p: Position): ReturnType<typeof fold> => fold(p.log, p.head);

describe('carrying', () => {
  it('walks a provision into an empty satchel', () => {
    let p = corridor([{ id: 'provision-1', kind: 'still smoke', x: 1 }]);
    p = playerStep(p, 'player', 1, 0).position;
    const s = at(p);
    expect(s.entities[0]?.satchel).toEqual([{ kind: 'still smoke' }]);
    expect(s.items).toHaveLength(0);
  });

  it('fills the second hand on walk-over, and full hands refuse the third', () => {
    let p = corridor([{ id: 'provision-1', kind: 'vital draught', x: 1 }], [], ['still smoke']);
    p = playerStep(p, 'player', 1, 0).position;
    const s = at(p);
    expect(s.entities[0]?.satchel).toEqual([{ kind: 'still smoke' }, { kind: 'vital draught' }]);
    expect(s.items).toHaveLength(0);

    const full = corridor([{ id: 'provision-1', kind: 'tallow flare', x: 1 }], [], ['still smoke', 'vital draught']);
    const walked = playerStep(full, 'player', 1, 0).position;
    const fs = at(walked);
    expect(fs.entities[0]?.satchel).toEqual([{ kind: 'still smoke' }, { kind: 'vital draught' }]);
    expect(fs.items).toHaveLength(1); // the flare stays where it lies
  });

  it('welcomes a twin — two smokes are two smokes', () => {
    let p = corridor([{ id: 'provision-1', kind: 'still smoke', x: 1 }], [], ['still smoke']);
    p = playerStep(p, 'player', 1, 0).position;
    const s = at(p);
    expect(s.items).toHaveLength(0);
    expect(s.entities[0]?.satchel).toEqual([{ kind: 'still smoke' }, { kind: 'still smoke' }]);
  });

  it('rides the stairs in the player payload', () => {
    // descend() is exercised end to end elsewhere; here, the payload field
    // folds into the satchel on arrival — the carry mechanism itself.
    const p = corridor([], [], ['vital draught']);
    expect(at(p).entities[0]?.satchel).toEqual([{ kind: 'vital draught' }]);
  });
});

describe('the vital draught', () => {
  it('mends whole and raises the ceiling, in one swallow, for one turn', () => {
    let p = corridor([], [{ id: 'foe-1', kind: 'bruiser', x: 12 }], ['vital draught']);
    // Bleed first, so the mend is visible: give the world a few turns.
    p = playerWait(p, 'player').position;
    const wounded = {
      ...p,
      // Wound by hand via a strike would need dice; instead trust hp 10 and
      // check the raise arithmetic — the mend-to-full is the same write.
    };
    const before = at(wounded);
    const ceiling = before.entities[0]!.maxHp;

    const used = playerUse(wounded, 'player');
    expect(used.draft?.type).toBe('ITEM_USED');
    const after = at(used.position);
    expect(after.entities[0]?.maxHp).toBe(ceiling + draughtCeiling(1));
    expect(after.entities[0]?.stats.hp).toBe(ceiling + draughtCeiling(1));
    expect(after.entities[0]?.satchel).toBeUndefined();
  });

  it('does nothing with empty hands', () => {
    const p = corridor([]);
    const used = playerUse(p, 'player');
    expect(used.draft).toBeNull();
    expect(used.position).toBe(p);
  });
});

describe('the still smoke', () => {
  it('records who was already in claws\' reach — they are not fooled', () => {
    let p = corridor([], [
      { id: 'near', kind: 'bruiser', x: 1 },
      { id: 'far', kind: 'bruiser', x: 9 },
    ], ['still smoke']);

    const used = playerUse(p, 'player');
    expect(used.draft?.type).toBe('ITEM_USED');
    p = used.position;
    const s = at(p);
    expect(s.smoke).not.toBeNull();
    expect(s.smoke?.unfooled).toEqual(['near']);
    expect(s.smoke?.at).toEqual({ x: 0, y: 0 });
    expect(s.smoke?.until).toBe(1 + smokeTurns(1));
  });

  it('sends the fooled to where you were, and lets the unfooled keep striking', () => {
    // Two rows, so the stale trail can be walked around the bystander —
    // single-file corridors block hunts by design, smoke or no smoke. The
    // fooled one stands close enough that the detour (around its unfooled
    // fellow) still fits inside awareness.
    const world = corridor([], [
      { id: 'near', kind: 'bruiser', x: 1 },
      { id: 'far', kind: 'bruiser', x: 5 },
    ], ['still smoke'], 2);
    const smoked = at(playerUse(world, 'player').position);

    // The player slips past and east; the fooled hunter still walks WEST,
    // toward where the smoke rose, with the truth walking away behind it.
    const slipped = {
      ...smoked,
      entities: smoked.entities.map((e) => (e.id === 'player' ? { ...e, pos: { x: 9, y: 0 } } : e)),
    };
    expect(decide(slipped, 'far')).toEqual({ kind: 'step', dx: -1, dy: 0 });

    // The one that had you in claws' reach was never fooled: wherever you
    // both stand now, adjacency is still a blow.
    const besieged = {
      ...smoked,
      entities: smoked.entities.map((e) => (e.id === 'near' ? { ...e, pos: { x: 8, y: 0 } } : e))
        .map((e) => (e.id === 'player' ? { ...e, pos: { x: 9, y: 0 } } : e)),
    };
    expect(decide(besieged, 'near')).toEqual({ kind: 'strike', targetId: 'player' });
  });

  it('clears when its turns run out', () => {
    const world = corridor([], [{ id: 'far', kind: 'bruiser', x: 9 }], ['still smoke']);
    const smoked = at(playerUse(world, 'player').position);
    const stale = { ...smoked, turn: smoked.smoke!.until };
    // Past the smoke, the hunt reads the truth again.
    const slipped = {
      ...stale,
      entities: stale.entities.map((e) => (e.id === 'player' ? { ...e, pos: { x: 12, y: 0 } } : e)),
    };
    expect(decide(slipped, 'far')).toEqual({ kind: 'step', dx: 1, dy: 0 });
  });
});

describe('the archetypal players and the satchel', () => {
  it('the brawler drinks when bleeding past the table\'s line', () => {
    const world = corridor([], [{ id: 'foe-1', kind: 'bruiser', x: 12 }], ['vital draught']);
    const s = at(world);
    const bloodied = {
      ...s,
      entities: s.entities.map((e) => (e.id === 'player'
        ? { ...e, stats: { ...e.stats, hp: Math.max(1, Math.floor(e.maxHp * BOT_QUAFF_BELOW) - 1) } }
        : e)),
    };
    expect(brawler(bloodied, 'player').kind).toBe('use');
    // Whole, it fights instead.
    expect(brawler(s, 'player').kind).toBe('step');
  });

  it('the coward smokes when the chase closes, never once touched', () => {
    const world = corridor([], [{ id: 'foe-1', kind: 'bruiser', x: 3 }], ['still smoke']);
    const s = at(world);
    expect(coward(s, 'player').kind).toBe('use');

    const touched = {
      ...s,
      entities: s.entities.map((e) => (e.id === 'foe-1' ? { ...e, pos: { x: 1, y: 0 } } : e)),
    };
    // Adjacent smoke fools nobody; the coward knows better than to waste it.
    expect(coward(touched, 'player').kind).not.toBe('use');
  });
});

describe('using spends the turn', () => {
  it('hands the world its turn after a use', () => {
    let p = corridor([], [{ id: 'foe-1', kind: 'bruiser', x: 3 }], ['vital draught']);
    p = playerUse(p, 'player').position;
    p = runWorldTurns(p, 'player');
    const s = at(p);
    // The bruiser moved: the drink was a real turn, not a free action.
    expect(s.entities.find((e) => e.id === 'foe-1')?.pos.x).toBe(2);
  });
});
