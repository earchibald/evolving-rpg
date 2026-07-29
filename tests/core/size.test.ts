import { sizeStretch, spawnBudget, levelForXp, MAX_BOARD_DIM } from '../../src/core/tables.js';
import { createWorld } from '../../src/core/commands.js';
import { generateMap } from '../../src/core/mapgen.js';
import { apply } from '../../src/core/apply.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameEvent } from '../../src/core/events.js';

/** The three boards the door offers, by the names the sheet will use. */
const VALE = { width: 48, height: 32 };
const EXPANSE = { width: 96, height: 64 };
const WASTE = { width: 128, height: 96 };

const fold = (event: ReturnType<typeof createWorld>): ReturnType<typeof apply> =>
  apply(EMPTY_STATE, { ...event, id: 'w', parent: null, seq: 0 } as GameEvent);

describe('the board stretches', () => {
  it('reads 1 on the vale and every test board, 2 on the expanse, 3 on the waste', () => {
    expect(sizeStretch(VALE.width, VALE.height)).toBe(1);
    expect(sizeStretch(EXPANSE.width, EXPANSE.height)).toBe(2);
    expect(sizeStretch(WASTE.width, WASTE.height)).toBe(3);
    // The tiny boards the suite lives on: stretch must never shrink below
    // one, or every fixture's budget would collapse.
    expect(sizeStretch(12, 8)).toBe(1);
    expect(sizeStretch(15, 7)).toBe(1);
  });

  it('multiplies the rent by the stretch and nothing else', () => {
    for (const depth of [1, 3, 5, 9]) {
      expect(spawnBudget(depth, 1)).toBe(spawnBudget(depth));
      expect(spawnBudget(depth, 2)).toBe(spawnBudget(depth) * 2);
      expect(spawnBudget(depth, 3)).toBe(spawnBudget(depth) * 3);
    }
  });

  it('stretches the XP ladder by the same integer', () => {
    // 16 XP reaches level 2 on the vale; the expanse asks 32 for the same
    // step — levels-per-floor stays the tuned curve when kills double.
    expect(levelForXp(16)).toBe(2);
    expect(levelForXp(16, 2)).toBe(1);
    expect(levelForXp(32, 2)).toBe(2);
    expect(levelForXp(31, 2)).toBe(1);
  });

  it('a stretch-1 world is bit-identical to the world before boards could breathe', () => {
    // The load-bearing identity: every sawtooth pin, the golden fixture and
    // every standing chain rest on the vale meaning exactly what it meant.
    // The golden replay test is the deep proof; this is the fast tripwire.
    const a = createWorld(15, VALE.width, VALE.height);
    expect(a.payload.items.filter((i) => i.id.startsWith('provision-'))).toHaveLength(1);
    expect(a.payload.story).toContain('lies where the path does not go');
  });

  it('the expanse pays a doubled budget for a bigger population, spread thinner', () => {
    const vale = fold(createWorld(21, VALE.width, VALE.height, 'player', 3));
    const expanse = fold(createWorld(21, EXPANSE.width, EXPANSE.height, 'player', 3));
    const foes = (s: typeof vale): number => s.entities.filter((e) => e.id !== 'player').length;
    // More creatures in absolute count...
    expect(foes(expanse)).toBeGreaterThan(foes(vale));
    // ...but fewer per tile: the breathing room is the point.
    expect(foes(expanse) / (EXPANSE.width * EXPANSE.height))
      .toBeLessThan(foes(vale) / (VALE.width * VALE.height));
  });

  it('the expanse owes more prizes and a fuller pantry; the teaching floor holds one whatever the acreage', () => {
    const d1 = createWorld(7, EXPANSE.width, EXPANSE.height, 'player', 1);
    expect(d1.payload.items.filter((i) => i.id.startsWith('relic-'))).toHaveLength(1);
    expect(d1.payload.items.filter((i) => i.id.startsWith('provision-'))).toHaveLength(2);

    const d3 = createWorld(7, EXPANSE.width, EXPANSE.height, 'player', 3);
    expect(d3.payload.items.filter((i) => i.id.startsWith('relic-'))).toHaveLength(3);
    expect(d3.payload.items.filter((i) => i.id.startsWith('provision-'))).toHaveLength(2);

    const waste3 = createWorld(7, WASTE.width, WASTE.height, 'player', 3);
    expect(waste3.payload.items.filter((i) => i.id.startsWith('relic-'))).toHaveLength(4);
    expect(waste3.payload.items.filter((i) => i.id.startsWith('provision-'))).toHaveLength(3);
  });

  it('the room cap scales with area, so the motif keeps its density', () => {
    // On the vale the cap (16) binds before the door motif's divisor does
    // (1536/110 ≈ 14 — close); on the expanse a fixed 16 would hand back a
    // prairie with sixteen sheds. The generator self-checks connectivity,
    // so a green run here is also a reachability proof at every size.
    const big = generateMap(5, 0, EXPANSE.width, EXPANSE.height);
    expect(big.rooms.length).toBeGreaterThan(16);
    const vale = generateMap(5, 0, VALE.width, VALE.height);
    expect(vale.rooms.length).toBeLessThanOrEqual(16);
  });

  it('refuses a board past the chokepoint', () => {
    expect(() => createWorld(1, MAX_BOARD_DIM + 1, 32)).toThrow(/board cap/);
    expect(() => createWorld(1, 48, MAX_BOARD_DIM + 1)).toThrow(/board cap/);
  });

  it('every floor of the expanse still stands its whole account in the story', () => {
    const born = createWorld(33, EXPANSE.width, EXPANSE.height, 'player', 2);
    expect(born.payload.story).toContain('a budget of');
    expect(born.payload.story).toContain('lie where the path does not go');
  });
});
