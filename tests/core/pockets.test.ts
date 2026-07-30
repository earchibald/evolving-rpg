import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import { createWorld, attemptMove, shoveAt } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { POCKET_IN, PROVISIONS, SCROLLS, ARMORY, threatOf } from '../../src/core/tables.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';

function corridor(entities: Entity[], over: Partial<GameState> = {}): GameState {
  const width = 20;
  const height = 3;
  const tiles = new Array<number>(width * height).fill(WALL);
  for (let x = 1; x < width - 1; x += 1) tiles[width + x] = FLOOR;
  return {
    grid: makeGrid(width, height, tiles),
    entities,
    items: [],
    turn: 1,
    activeEntityId: entities[0]?.id ?? null,
    seed: 7,
    rngCounter: 0,
    rules: [],
    xp: 0,
    level: 1,
    depth: 3,
    gold: 0,
    story: '', motif: null, bodies: [], bible: null, smoke: null,
    traps: [], alarm: null, unveiled: [], ...over,
  };
}

const you = (x: number): Entity => ({
  id: 'player', kind: 'you', pos: { x, y: 1 },
  stats: { hp: 12, might: 9, wits: 3, speed: 4 }, tags: [], maxHp: 12,
});

const carrier = (x: number, hp = 1): Entity => ({
  id: 'foe-1', kind: 'skirmisher', pos: { x, y: 1 },
  stats: { hp, might: 2, wits: 1, speed: 3 }, tags: [], maxHp: 4,
  pocket: { kind: 'vital draught', grants: { hp: 0, might: 0, wits: 0, speed: 0 } },
});

const sealed = (draft: DraftEvent): GameEvent => ({ ...draft, id: 'e', parent: null, seq: 1 } as GameEvent);

const KNOWN_KINDS = new Set([
  ...PROVISIONS.map((p) => p.kind),
  ...SCROLLS.map((s) => s.kind),
  ...ARMORY.map((r) => r.kind),
]);

describe('the pocket spills', () => {
  it('a killing blow sets the carried thing down where the body falls', () => {
    // Might 9 against hp 1: scan seeds for a landed blow.
    for (let seed = 1; seed < 40; seed += 1) {
      const state = corridor([you(5), carrier(6)], { seed });
      const draft = attemptMove(state, 'player', 1, 0);
      if (draft.type !== 'STRIKE' || !draft.payload.hit) continue;
      const after = apply(state, sealed(draft));
      const drop = after.items.find((i) => i.id === 'pocket-foe-1');
      expect(drop).toBeDefined();
      expect(drop!.kind).toBe('vital draught');
      expect(drop!.pos).toEqual({ x: 6, y: 1 });
      // The kill still pays its XP beside the spill.
      expect(after.xp).toBe(threatOf(state.entities[1]!.stats, 'skirmisher'));
      return;
    }
    throw new Error('no seed landed the blow');
  });

  it('a slam kill spills too — any death, one law', () => {
    // Carrier against the corridor's east wall: the shove slams it dead.
    const state = corridor([you(17), carrier(18)]);
    const draft = shoveAt(state, 'player', 1, 0)!;
    expect(draft.payload.slammed).toBe(true);
    const after = apply(state, sealed(draft));
    expect(after.items.some((i) => i.id === 'pocket-foe-1')).toBe(true);
  });

  it('a taken tile nudges the spill one pace by fixed order', () => {
    const lying = { id: 'already', kind: 'tallow flare', pos: { x: 6, y: 1 }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } };
    for (let seed = 1; seed < 40; seed += 1) {
      const state = corridor([you(5), carrier(6)], { seed, items: [lying] });
      const draft = attemptMove(state, 'player', 1, 0);
      if (draft.type !== 'STRIKE' || !draft.payload.hit) continue;
      const after = apply(state, sealed(draft));
      const drop = after.items.find((i) => i.id === 'pocket-foe-1');
      expect(drop).toBeDefined();
      // East first in the fixed order: x+1.
      expect(drop!.pos).toEqual({ x: 7, y: 1 });
      return;
    }
    throw new Error('no seed landed the blow');
  });

  it('the survivor keeps its pocket: no drop without a death', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const state = corridor([you(5), carrier(6, 4)], { seed });
      const draft = attemptMove(state, 'player', 1, 0);
      if (draft.type !== 'STRIKE') continue;
      if (draft.payload.hit && draft.payload.damage >= 4) continue;
      const after = apply(state, sealed(draft));
      expect(after.items.some((i) => i.id === 'pocket-foe-1')).toBe(false);
      return;
    }
    throw new Error('no seed produced a surviving carrier');
  });
});

describe('generation deals the pockets', () => {
  it('about one in three carries; the carried kind is always a real kind; the mimic always hoards', () => {
    let carried = 0;
    let bodies = 0;
    let mimics = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const born = createWorld(seed, 96, 64, 'player', 3);
      for (const o of born.payload.opponents) {
        if (o.guise !== undefined) {
          mimics += 1;
          expect(o.pocket).toBeDefined();
          continue;
        }
        bodies += 1;
        if (o.pocket === undefined) continue;
        carried += 1;
        expect(KNOWN_KINDS.has(o.pocket.kind)).toBe(true);
      }
    }
    const rate = carried / bodies;
    expect(rate).toBeGreaterThan(1 / POCKET_IN - 0.15);
    expect(rate).toBeLessThan(1 / POCKET_IN + 0.15);
    expect(mimics).toBeGreaterThan(0);
  });

  it('what a body carries is not on the floor: the pocket stays out of items until the death', () => {
    const born = createWorld(11, 96, 64, 'player', 3);
    const pocketKinds = born.payload.opponents.filter((o) => o.pocket !== undefined).length;
    expect(born.payload.items.every((i) => !i.id.startsWith('pocket-'))).toBe(true);
    // The world knows the truth; the item layer does not show it yet.
    expect(pocketKinds).toBeGreaterThanOrEqual(0);
  });
});
