import { apply } from '../../src/core/apply.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent, GoldMovedPayload } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR, WALL } from '../../src/core/grid.js';
import { valueOf, LOOT_VALUE, PROVISION_VALUE, ARMORY, PROVISIONS, SCROLLS } from '../../src/core/tables.js';
import { COVENANT } from '../../src/assay/covenant.js';

/**
 * The purse (increment A of docs/superpowers/specs/2026-07-30-economy-mining-
 * and-sprites.md). Gold is a DERIVED fact, folded out of recorded exchange —
 * the proposal wanted it in view state, which covenant M4 forbids outright.
 *
 * A kind's worth is a table fact, not a per-item one: two iron ores are worth
 * the same, and storing the number on the instance would give two things that
 * can disagree. Same reasoning that keeps `xp` derived from kill history.
 */

const world = (payload: Record<string, unknown>): GameEvent => ({
  id: 'e0', parent: null, seq: 0,
  type: 'WORLD_INIT',
  schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
  rngCounter: 0,
  rngDraws: 8,
  payload: {
    width: 3, height: 2,
    tiles: [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR],
    seed: 99,
    items: [],
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
    opponents: [],
    ...payload,
  },
});

const goldMoved = (seq: number, delta: number, reason: GoldMovedPayload['reason']): GameEvent => ({
  id: `g${seq}`, parent: `g${seq - 1}`, seq,
  type: 'GOLD_MOVED',
  schemaVersion: SCHEMA_VERSIONS.GOLD_MOVED,
  rngCounter: 8,
  rngDraws: 0,
  payload: { delta, reason },
});

describe('what a kind fetches', () => {
  it('prices every kind the dungeon can actually drop', () => {
    // A kind that generation can put on the floor must have a price, or the
    // first player to try selling it meets a silent zero.
    for (const relic of ARMORY) expect(valueOf(relic.kind)).toBeGreaterThan(0);
    for (const provision of PROVISIONS) expect(valueOf(provision.kind)).toBeGreaterThan(0);
    for (const scroll of SCROLLS) expect(valueOf(scroll.kind)).toBeGreaterThan(0);
  });

  it('keeps the main dungeon nominal — pocket change, never a living', () => {
    // The whole point of the economy: the dungeon pays in XP and relics, the
    // mine pays in money. If floor loot could fund a pickaxe, the mine stops
    // being a decision.
    for (const relic of ARMORY) expect(valueOf(relic.kind)).toBeLessThanOrEqual(LOOT_VALUE);
    for (const provision of PROVISIONS) expect(valueOf(provision.kind)).toBeLessThanOrEqual(LOOT_VALUE);
    expect(PROVISION_VALUE).toBeLessThan(LOOT_VALUE);
  });

  it('pays less for a thing you were going to use up than for a thing you were going to wear', () => {
    // Found by mutation proof: pricing provisions at LOOT_VALUE passed the
    // whole suite, because every other assertion here is an inequality against
    // the ceiling. The band's SHAPE is the design claim, so it gets pinned to
    // the exact numbers rather than to `<=`.
    for (const relic of ARMORY) expect(valueOf(relic.kind)).toBe(LOOT_VALUE);
    for (const scroll of SCROLLS) expect(valueOf(scroll.kind)).toBe(LOOT_VALUE);
    for (const provision of PROVISIONS) expect(valueOf(provision.kind)).toBe(PROVISION_VALUE);
  });

  it('is worth nothing for a kind it does not know, rather than throwing', () => {
    // An old chain may carry a kind this engine renamed. A purse is not the
    // place to die, and a silent zero is honest: this engine cannot price it.
    expect(valueOf('sputtering doohickey')).toBe(0);
    expect(valueOf('')).toBe(0);
  });
});

describe('the purse is folded, never stored', () => {
  it('starts empty', () => {
    expect(EMPTY_STATE.gold).toBe(0);
  });

  it('sums what exchange recorded', () => {
    let state = apply(EMPTY_STATE, world({}));
    expect(state.gold).toBe(0);

    state = apply(state, goldMoved(1, 2, 'sale'));
    state = apply(state, goldMoved(2, 5, 'trove'));
    expect(state.gold).toBe(7);

    state = apply(state, goldMoved(3, -50, 'purchase'));
    expect(state.gold).toBe(-43);
  });

  it('sums honestly rather than clamping, so an unaffordable spend is a visible bug', () => {
    // The spender gates affordability (increment C). If apply clamped at zero
    // instead, a command that let you buy what you cannot afford would fold to
    // a plausible-looking purse and hide itself.
    const state = apply(apply(EMPTY_STATE, world({})), goldMoved(1, -1, 'purchase'));
    expect(state.gold).toBe(-1);
  });

  it('spends no randomness — an exchange is arithmetic, not a roll', () => {
    const before = apply(EMPTY_STATE, world({}));
    const after = apply(before, goldMoved(1, 3, 'sale'));
    expect(after.rngCounter).toBe(before.rngCounter);
  });
});

describe('the purse crosses the stairs', () => {
  it('carries what the player had, like the satchel learned to at v9', () => {
    const descended = apply(EMPTY_STATE, world({ depth: 2, playerGold: 17 }));
    expect(descended.gold).toBe(17);
  });

  it('folds a floor that never said to an empty purse', () => {
    // Every chain written before v15. Absence means nothing was carried, which
    // is simply true — inventing a balance would be fabricating history.
    const legacy = apply(EMPTY_STATE, world({ depth: 2 }));
    expect(legacy.gold).toBe(0);
  });

  it('does not let a new floor forget money already earned mid-run', () => {
    // The bug this pins: descending resets the purse because WORLD_INIT
    // replaces state wholesale. The carry is what stops that.
    let state = apply(EMPTY_STATE, world({}));
    state = apply(state, goldMoved(1, 9, 'sale'));
    expect(state.gold).toBe(9);

    const next = apply(state, world({ depth: 2, playerGold: state.gold }));
    expect(next.gold).toBe(9);
  });
});

describe('the covenant states the purse (M9)', () => {
  it('is stated as mechanical, with an enforcer', () => {
    const m9 = COVENANT.find((i) => i.id === 'M9');
    expect(m9).toBeDefined();
    expect(m9!.register).toBe('mechanical');
    expect(m9!.enforcedBy.length).toBeGreaterThan(5);
  });

  it('says out loud that the purse is chain-derived', () => {
    const m9 = COVENANT.find((i) => i.id === 'M9');
    expect(m9!.statement.toLowerCase()).toContain('chain');
  });
});
