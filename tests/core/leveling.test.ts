import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { emptyLog, append, fold } from '../../src/log/chain.js';
import { threatOf, XP_TO_REACH, growthAt, creatureStats } from '../../src/core/tables.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';
import type { EventLog } from '../../src/log/chain.js';

/**
 * Leveling is derived, never evented. XP and level are functions of the kill
 * history, computed in `apply` — so there is no LEVELED event to upcast, no
 * way for the log and the level to disagree, and replay stays exact by
 * construction. These tests fold chains and read the consequences.
 */

const skirmisher = creatureStats('skirmisher', 1)!;

function world(opponents: { id: string; hp?: number }[]): DraftEvent {
  return {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 10, height: 1, tiles: new Array<number>(10).fill(FLOOR), seed: 1, items: [],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 1, speed: 3 }, tags: [] },
      opponents: opponents.map((o, i) => ({
        id: o.id, kind: 'skirmisher', pos: { x: 2 + i, y: 0 },
        stats: { ...skirmisher, hp: o.hp ?? skirmisher.hp }, tags: [],
      })),
    },
  } as DraftEvent;
}

const kill = (targetId: string, damage: number, attackerId = 'player'): DraftEvent => ({
  type: 'STRIKE', schemaVersion: 2, rngCounter: 0, rngDraws: 2,
  payload: { attackerId, targetId, hit: true, crit: false, damage, roll: 15, needed: 9 },
} as DraftEvent);

const hurt = (targetId: string, damage: number): DraftEvent => kill(targetId, damage);

function played(drafts: DraftEvent[]): { log: EventLog; head: string } {
  let out = append(emptyLog(), null, drafts[0]!);
  for (const d of drafts.slice(1)) out = append(out.log, out.event.id, d);
  return { log: out.log, head: out.event.id };
}

describe('experience arrives with the kill', () => {
  it('pays the victim\'s threat value, exactly', () => {
    const p = played([world([{ id: 'a' }]), kill('a', 99)]);
    expect(fold(p.log, p.head).xp).toBe(threatOf(skirmisher, 'skirmisher'));
  });

  it('pays nothing for a wound that does not finish', () => {
    const p = played([world([{ id: 'a' }]), hurt('a', 1)]);
    expect(fold(p.log, p.head).xp).toBe(0);
  });

  it('pays nothing when creatures kill each other', () => {
    const p = played([world([{ id: 'a' }, { id: 'b' }]), kill('a', 99, 'b')]);
    expect(fold(p.log, p.head).xp).toBe(0);
  });

  it('pays for a kill a rule made, when the player owned the rule\'s firing', () => {
    const w = played([world([{ id: 'a', hp: 2 }])]);
    const fired: DraftEvent = {
      type: 'RULE_FIRED', schemaVersion: 1, rngCounter: 0, rngDraws: 0,
      payload: {
        ruleId: 'r', actorId: 'player',
        outcomes: [{ kind: 'health', entityId: 'a', to: 0 }],
      },
    } as DraftEvent;
    const done = append(w.log, w.head, fired);
    expect(fold(done.log, done.event.id).xp).toBe(threatOf({ ...skirmisher, hp: 2 }, 'skirmisher'));
  });

  it('does not pay twice for a body', () => {
    const p = played([world([{ id: 'a' }]), kill('a', 99), kill('a', 99)]);
    expect(fold(p.log, p.head).xp).toBe(threatOf(skirmisher, 'skirmisher'));
  });
});

describe('crossing a threshold', () => {
  // Enough weak kills to cross XP_TO_REACH[2].
  const toLevel2 = (): DraftEvent[] => {
    const perKill = threatOf(skirmisher);
    const needed = Math.ceil(XP_TO_REACH[2]! / perKill);
    const foes = Array.from({ length: needed }, (_x, i) => ({ id: `f${String(i)}` }));
    return [world(foes), ...foes.map((f) => kill(f.id, 99))];
  };

  it('raises the level when the xp arrives', () => {
    const p = played(toLevel2());
    expect(fold(p.log, p.head).level).toBeGreaterThanOrEqual(2);
  });

  it('applies the growth table to the player', () => {
    const p = played(toLevel2());
    const state = fold(p.log, p.head);
    const you = state.entities[0]!;
    const g = growthAt(2);
    expect(you.maxHp).toBe(10 + g.hp * (state.level - 1) + (state.level >= 3 ? 0 : 0));
    expect(you.stats.might + you.stats.speed).toBeGreaterThan(3 + 3);
  });

  it('heals to full at the moment of leveling — the ease tooth', () => {
    // Take a wound first, then cross the threshold.
    const perKill = threatOf(skirmisher);
    const needed = Math.ceil(XP_TO_REACH[2]! / perKill);
    const foes = Array.from({ length: needed }, (_x, i) => ({ id: `f${String(i)}` }));
    const woundMe: DraftEvent = {
      type: 'STRIKE', schemaVersion: 2, rngCounter: 0, rngDraws: 2,
      payload: { attackerId: 'f0', targetId: 'player', hit: true, crit: false, damage: 6, roll: 15, needed: 9 },
    } as DraftEvent;
    const p = played([world(foes), woundMe, ...foes.map((f) => kill(f.id, 99))]);
    const state = fold(p.log, p.head);
    expect(state.entities[0]!.stats.hp).toBe(state.entities[0]!.maxHp);
  });

  it('starts every world at level 1 with no xp', () => {
    const p = played([world([{ id: 'a' }])]);
    const state = fold(p.log, p.head);
    expect(state.level).toBe(1);
    expect(state.xp).toBe(0);
  });
});
