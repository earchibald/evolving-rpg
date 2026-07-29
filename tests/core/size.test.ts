import { sizeStretch, spawnBudget, levelForXp, xpToReach, MAX_BOARD_DIM } from '../../src/core/tables.js';
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

  it('multiplies the rent by the BOUNTY past the teaching floor — gentler than the ground', () => {
    // Measured (2026-07-29): the full stretch doubled fights-per-heal and
    // the depth-3 runner out-survived the fighter 2/10 v 1/10 — the one
    // domination the covenant forbids. The bounty (1 / 1.5 / 2) holds
    // fights-per-heal near the vale's while the ground stretches whole.
    for (const depth of [3, 5, 9]) {
      expect(spawnBudget(depth, 1)).toBe(spawnBudget(depth));
      expect(spawnBudget(depth, 2)).toBe(Math.round(spawnBudget(depth) * 1.5));
      expect(spawnBudget(depth, 3)).toBe(spawnBudget(depth) * 2);
    }
  });

  it('the teaching floor pays the FULL stretch — three bodies on four vales of ground taught nothing', () => {
    // The designer's filing (2026-07-29, played live on the expanse):
    // "only two monsters on the whole first floor! ... quite boring."
    // Measured true: budget 59 against level-1 prices of 13–23 buys 3,
    // and every filler element (patrols, traps, mimic, scrolls) gates
    // depth 2+. The fights-per-heal wound was a depth-3 phenomenon; the
    // door pin stays the judge of gentle.
    expect(spawnBudget(1, 1)).toBe(spawnBudget(1));
    expect(spawnBudget(1, 2)).toBe(spawnBudget(1) * 2);
    expect(spawnBudget(1, 3)).toBe(spawnBudget(1) * 3);
  });

  it('the stretched door spends on numbers, not menace — and the vale keeps its variety', () => {
    // The cliff was composition, not count: the same doubled rent spent
    // on mixed kinds (two 23-point stalkers) measured 6/10 at the door;
    // capped to the teaching kind it measured 8/10 with the population
    // doubled. Patrols at the door were measured too (they alone cost
    // four escapes in ten) and deferred — density carries the filing.
    const seeds = [100, 101, 102, 103, 104];
    for (const s of seeds) {
      const door = createWorld(s, EXPANSE.width, EXPANSE.height).payload.opponents;
      expect(door.length).toBeGreaterThanOrEqual(5);
      for (const o of door) expect(o.kind.startsWith('skirmisher')).toBe(true);
    }
    const vale = seeds.flatMap((s) => createWorld(s, VALE.width, VALE.height).payload.opponents);
    expect(vale.some((o) => !o.kind.startsWith('skirmisher'))).toBe(true);
  });

  it('the readout and the reducer share one ladder — xpToReach wears the stretch', () => {
    // The vitals row once read the raw table and told an expanse player
    // "22/16 xp" at level 1 (the designer's filing, 2026-07-29): the
    // engine levelled at 24, the view promised 16. One helper now, so
    // the two cannot drift.
    expect(xpToReach(2)).toBe(16);
    expect(xpToReach(2, 2)).toBe(24);
    expect(xpToReach(2, 3)).toBe(32);
    expect(xpToReach(3, 2)).toBe(60);
    expect(xpToReach(99, 2)).toBeUndefined();
    // The helper IS levelForXp's own gate, proven at the boundary.
    expect(levelForXp(xpToReach(2, 2)! - 1, 2)).toBe(1);
    expect(levelForXp(xpToReach(2, 2)!, 2)).toBe(2);
  });

  it('stretches the XP ladder by the same bounty — threat in, XP out, one factor', () => {
    // 16 XP reaches level 2 on the vale; the expanse asks 24 (×1.5, exact
    // — every vale threshold is even), the waste 32.
    expect(levelForXp(16)).toBe(2);
    expect(levelForXp(16, 2)).toBe(1);
    expect(levelForXp(24, 2)).toBe(2);
    expect(levelForXp(23, 2)).toBe(1);
    expect(levelForXp(32, 3)).toBe(2);
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
