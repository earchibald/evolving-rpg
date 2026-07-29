import { apply } from '../../src/core/apply.js';
import { takeUnderfoot, createWorld } from '../../src/core/commands.js';
import { slotFor, slotOf, SLOTS, ARMORY, RELIC_TRAITS, wearsTrait } from '../../src/core/tables.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameState } from '../../src/core/state.js';
import { FLOOR } from '../../src/core/grid.js';

/**
 * Dual wield, proposal A — strong arms throw hard. The panel's verdict
 * (three lenses, unanimous): ranged relics route to their own 'sling'
 * slot by trait, grants stack into the one might stat, and the same
 * ITEM_TAKEN v4 that learned satchel slots records the resolved gear
 * slot and the shed relic — so replay never re-derives routing, and
 * what you set down finally lands on the floor.
 */

interface Seed {
  gear?: Record<string, { kind: string; grants: { hp: number; might: number; wits: number; speed: number } }>;
  items?: { id: string; kind: string; x: number; y: number; grants: { hp: number; might: number; wits: number; speed: number } }[];
}

let seq = 0;
function world(opt: Seed = {}): GameState {
  seq += 1;
  return apply(EMPTY_STATE, {
    id: `w${String(seq)}`, parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0, rngDraws: 0,
    payload: {
      width: 8, height: 1, tiles: Array.from({ length: 8 }, () => FLOOR), seed: 3,
      ...(opt.gear === undefined ? {} : { playerGear: opt.gear }),
      items: (opt.items ?? []).map((i) => ({ id: i.id, kind: i.kind, pos: { x: i.x, y: i.y }, grants: i.grants })),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as GameEvent);
}

const commit = (s: GameState, d: unknown): GameState =>
  apply(s, { ...(d as GameEvent), id: `e${String((seq += 1))}`, parent: null, seq } as GameEvent);

const G = (might = 0, hp = 0, speed = 0, wits = 0) => ({ hp, might, wits, speed });

describe('the sling slot — routed by trait, not by stat', () => {
  it('exists, and slotFor sends ranged kinds there while grants still route the rest', () => {
    expect(SLOTS).toContain('sling');
    expect(slotFor('leaden sling', G(2))).toBe('sling');
    expect(slotFor('keen edge', G(2))).toBe('weapon');
    expect(slotFor('keen edge', G(2))).toBe(slotOf(G(2)));
  });

  it('walking takes the sling into its own slot beside a worn sword — both stay, might stacks', () => {
    const armed = world({
      gear: { weapon: { kind: 'keen edge', grants: G(2) } },
      items: [{ id: 'relic-9', kind: 'leaden sling', x: 0, y: 0, grants: G(1) }],
    });
    const took = takeUnderfoot(armed, 'player');
    expect(took).not.toBeNull();
    expect(took!.payload.gearSlot).toBe('sling');
    const after = commit(armed, took);
    const you = after.entities[0]!;
    expect(you.gear?.['weapon']?.kind).toBe('keen edge');
    expect(you.gear?.['sling']?.kind).toBe('leaden sling');
    expect(you.stats.might).toBe(3 + 1); // base 3 + sling 1, edge already folded into base by fixture
    expect(wearsTrait(you.gear, 'ranged')).toBe(true);
  });
});

describe('what you set down lands on the floor — the vanish retired', () => {
  it('records the shed relic and mints it where the new one lay, grants intact', () => {
    const worn = world({
      gear: { weapon: { kind: 'keen edge', grants: G(2) } },
      items: [{ id: 'relic-9', kind: 'heavy edge', x: 0, y: 0, grants: { hp: 0, might: 3, wits: 0, speed: -1 } }],
    });
    const took = takeUnderfoot(worn, 'player', true); // a tradeoff: the , key
    expect(took).not.toBeNull();
    expect(took!.payload.shed).toEqual({ kind: 'keen edge', grants: G(2) });
    const after = commit(worn, took);
    const dropped = after.items.find((i) => i.kind === 'keen edge');
    expect(dropped).toBeDefined();
    expect(dropped!.pos).toEqual({ x: 0, y: 0 });
    expect(dropped!.grants).toEqual(G(2)); // still worth wearing when re-taken
  });

  it('a bare-slot take sheds nothing and mints nothing', () => {
    const bare = world({ items: [{ id: 'relic-9', kind: 'keen edge', x: 0, y: 0, grants: G(2) }] });
    const took = takeUnderfoot(bare, 'player');
    expect(took!.payload.shed).toBeNull();
    expect(commit(bare, took).items).toHaveLength(0);
  });

  it('an old chain\'s gear take (no gearSlot, no shed) folds the legacy way', () => {
    const worn = world({ gear: { weapon: { kind: 'keen edge', grants: G(2) } } });
    const legacy = {
      type: 'ITEM_TAKEN', schemaVersion: 3, rngCounter: 0, rngDraws: 0,
      payload: { entityId: 'player', itemId: 'ghost', grants: G(3) },
    };
    const after = commit({ ...worn, items: [{ id: 'ghost', kind: 'edge of salt', pos: { x: 1, y: 0 }, grants: G(3) }] }, legacy);
    // Routed by grants alone, replaced in place, nothing minted — exactly
    // what the recorded past did (M4: replay applies, never re-decides).
    expect(after.entities[0]!.gear?.['weapon']?.kind).toBe('edge of salt');
    expect(after.items.some((i) => i.kind === 'keen edge')).toBe(false);
  });
});

describe('the floors keep their promises', () => {
  it('depth 1 still guarantees the keen edge by name — order cannot unseat it', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const p = createWorld(seed, 48, 32).payload;
      expect(p.items.some((i) => i.kind === 'keen edge')).toBe(true);
      expect(p.items.some((i) => RELIC_TRAITS[i.kind] === 'ranged')).toBe(false);
    }
  });

  it('depth 2 owes a ranged relic — the slinger\'s debut floor arms the answer', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const p = createWorld(seed, 48, 32, 'player', 2).payload;
      const ranged = p.items.filter((i) => RELIC_TRAITS[i.kind] === 'ranged');
      expect(ranged.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the armory still holds exactly one ranged kind, so the guarantee is the sling', () => {
    expect(ARMORY.filter((r) => RELIC_TRAITS[r.kind] === 'ranged')).toHaveLength(1);
  });
});
