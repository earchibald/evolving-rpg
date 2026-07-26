import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { playerStep, playerWait, runWorldTurns } from '../../src/play/session.js';
import { ratifyRule } from '../../src/core/commands.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import { FLOOR, WALL } from '../../src/core/grid.js';
import type { Rule } from '../../src/canon/rule.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';

/**
 * A rule you can feel.
 *
 * The two properties worth the most here are negative ones. A blocked move must
 * still cost no turn even when a rule fires on it — that bug handed a free hit
 * to anything standing next to you once already, and it does not get to come
 * back through a rule. And a rule the player ratified must not silently fire
 * for every creature on the map: the text they agreed to says "you recover",
 * and healing the things trying to kill them would make that text a lie.
 */

function rule(over: Record<string, unknown> = {}): Rule {
  const r = validateRule({
    id: 'r',
    when: 'WAIT',
    require: [],
    then: [{ kind: 'harm', n: 2 }],
    provenance: { events: ['e'], notes: [], because: 'testing' },
    ratifiedAt: '2026-07-25T00:00:00.000Z',
    ...over,
  });
  if (isRejected(r)) throw new Error(r.rejected);
  return r;
}

/**
 * A one-row corridor.
 *
 * The player always starts at full health, because `maxHp` is starting hp — a
 * player seeded at 4 has a ceiling of 4 and healing has nowhere to go. To test
 * healing, wound them with a `harm` rule first.
 */
function corridor(opts: { beastAt?: number; wallAt?: number; itemAt?: number } = {}): GameEvent {
  const tiles = new Array<number>(9).fill(FLOOR);
  if (opts.wallAt !== undefined) tiles[opts.wallAt] = WALL;
  return {
    id: 'w', parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: 4, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 9, height: 1, tiles, seed: 3,
      items: opts.itemAt === undefined ? [] : [
        { id: 'item-0', kind: 'edge', pos: { x: opts.itemAt, y: 0 }, grants: { hp: 0, might: 2, wits: 0, speed: 0 } },
      ],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: opts.beastAt === undefined ? [] : [
        { id: 'thing-1', kind: 'thing', pos: { x: opts.beastAt, y: 0 }, stats: { hp: 5, might: 4, wits: 1, speed: 3 }, tags: [] },
      ],
    },
  };
}

/** A world holding one rule, ready to play. */
function playable(world: GameEvent, rules: Rule[]): Position {
  const seeded = append(emptyLog(), null, world);
  let position: Position = { log: seeded.log, head: seeded.event.id };
  for (const r of rules) {
    const done = append(position.log, position.head, ratifyRule(fold(position.log, position.head), r));
    position = { log: done.log, head: done.event.id };
  }
  return position;
}

type Firing = Extract<GameEvent, { type: 'RULE_FIRED' }>;
const fired = (p: Position): Firing[] =>
  chain(p.log, p.head).filter((e): e is Firing => e.type === 'RULE_FIRED');
const hp = (p: Position): number => fold(p.log, p.head).entities[0]!.stats.hp;
const turn = (p: Position): number => fold(p.log, p.head).turn;

describe('every trigger reaches play', () => {
  it('fires on holding still', () => {
    const start = playable(corridor(), [rule({ when: 'WAIT' })]);
    const after = playerWait(start, 'player').position;
    expect(fired(after)).toHaveLength(1);
    expect(hp(after)).toBe(8);
  });

  it('fires on walking into something solid', () => {
    const start = playable(corridor({ wallAt: 1 }), [rule({ when: 'MOVE_BLOCKED' })]);
    const after = playerStep(start, 'player', 1, 0).position;
    expect(fired(after)).toHaveLength(1);
    expect(hp(after)).toBe(8);
  });

  it('fires on striking', () => {
    const start = playable(corridor({ beastAt: 1 }), [rule({ when: 'STRIKE' })]);
    const after = playerStep(start, 'player', 1, 0).position;
    expect(fired(after)).toHaveLength(1);
  });

  it('fires on picking something up', () => {
    const start = playable(corridor({ itemAt: 1 }), [rule({ when: 'ITEM_TAKEN' })]);
    const after = playerStep(start, 'player', 1, 0).position;
    expect(fired(after)).toHaveLength(1);
    expect(hp(after)).toBe(8);
  });

  it('fires nothing at all in a world with no rules', () => {
    const start = playable(corridor(), []);
    expect(fired(playerWait(start, 'player').position)).toHaveLength(0);
  });
});

describe('a rule cannot buy a turn', () => {
  it('leaves a blocked move costing nothing, even when it fires', () => {
    // The turn is decided by the action, never by its consequences. A rule
    // firing on MOVE_BLOCKED must not smuggle back the turn that bug once gave
    // away for free.
    const start = playable(corridor({ wallAt: 1 }), [rule({ when: 'MOVE_BLOCKED' })]);
    const before = turn(start);
    const after = playerStep(start, 'player', 1, 0).position;

    expect(fired(after)).toHaveLength(1);
    expect(turn(after)).toBe(before);
    expect(chain(after.log, after.head).some((e) => e.type === 'TURN_ADVANCED')).toBe(false);
  });

  it('still advances the turn for an action that earned one', () => {
    const start = playable(corridor(), [rule({ when: 'WAIT' })]);
    const after = playerWait(start, 'player').position;
    expect(chain(after.log, after.head).some((e) => e.type === 'TURN_ADVANCED')).toBe(true);
  });

  it('puts the firing before the turn passes, so it belongs to the action', () => {
    const start = playable(corridor(), [rule({ when: 'WAIT' })]);
    const after = playerWait(start, 'player').position;
    const types = chain(after.log, after.head).map((e) => e.type);
    expect(types.indexOf('RULE_FIRED')).toBeLessThan(types.indexOf('TURN_ADVANCED'));
  });
});

describe('whose rule it is', () => {
  it('does not fire the player\'s rules for the things hunting them', () => {
    // The rule the player ratified reads "you lose 2 hit points". Firing it for
    // every creature would make that sentence false.
    //
    // The trigger has to be one a *creature* can actually reach, or this proves
    // nothing: written first against WAIT, it could never have failed, because a
    // waiting creature emits no draft at all and a moving one is not a trigger.
    // Striking is the overlap — both sides do it, through the same code path.
    const start = playable(corridor({ beastAt: 1 }), [rule({ when: 'STRIKE' })]);

    const afterMine = playerWait(start, 'player').position;
    expect(fired(afterMine)).toHaveLength(0);

    // The beast is adjacent, so its turn is a strike.
    const afterTheirs = runWorldTurns(afterMine, 'player');
    const struck = chain(afterTheirs.log, afterTheirs.head).filter((e) => e.type === 'STRIKE');
    expect(struck.length).toBeGreaterThan(0);
    expect(struck.some((e) => e.payload.attackerId !== 'player')).toBe(true);

    expect(fired(afterTheirs)).toHaveLength(0);
  });

  it('names the actor on every firing', () => {
    const start = playable(corridor(), [rule({ when: 'WAIT' })]);
    const after = playerWait(start, 'player').position;
    expect(fired(after)[0]?.payload.actorId).toBe('player');
  });
});

describe('conditions decide at the moment of acting', () => {
  it('holds back a rule whose condition is false', () => {
    const start = playable(
      corridor({ beastAt: 2 }),
      [rule({ when: 'WAIT', require: [{ kind: 'noCreatureWithin', n: 4 }] })],
    );
    expect(fired(playerWait(start, 'player').position)).toHaveLength(0);
  });

  it('fires the same rule once the condition becomes true', () => {
    const start = playable(
      corridor({ beastAt: 8 }),
      [rule({ when: 'WAIT', require: [{ kind: 'noCreatureWithin', n: 4 }] })],
    );
    expect(fired(playerWait(start, 'player').position)).toHaveLength(1);
  });

  it('heals a wound, but never past the ceiling', () => {
    // Wounded first by a rule on walking into the wall, then healed by one on
    // holding still. Both deterministic, so the arithmetic is exact.
    const start = playable(corridor({ wallAt: 1, beastAt: 8 }), [
      rule({ id: 'hurts', when: 'MOVE_BLOCKED', then: [{ kind: 'harm', n: 3 }] }),
      rule({ id: 'mends', when: 'WAIT', then: [{ kind: 'heal', n: 2 }] }),
    ]);

    let p = playerStep(start, 'player', 1, 0).position;   // 10 → 7
    expect(hp(p)).toBe(7);

    p = playerWait(p, 'player').position;                  // 7 → 9
    expect(hp(p)).toBe(9);

    // And however long you hold still, the ceiling holds.
    for (let i = 0; i < 20; i += 1) p = playerWait(p, 'player').position;
    expect(hp(p)).toBe(10);
  });
});

describe('the triggers the widening added', () => {
  it('fires when something strikes you, on somebody else\'s turn', () => {
    // Impossible before: only your own actions could trigger anything, so
    // "when something hits you" — thorns, rage, retaliation — could not exist.
    const start = playable(corridor({ beastAt: 1 }), [
      rule({ id: 'thorns', when: 'STRUCK', then: [{ kind: 'harmOther', n: 2 }] }),
    ]);
    const mine = playerWait(start, 'player').position;
    expect(fired(mine)).toHaveLength(0);

    const theirs = runWorldTurns(mine, 'player');
    const firings = fired(theirs);
    expect(firings.length).toBeGreaterThan(0);
    expect(firings[0]?.payload.ruleId).toBe('thorns');
    // It hurt the beast, not the player.
    expect(firings[0]?.payload.outcomes[0]).toMatchObject({ kind: 'health', entityId: 'thing-1' });
  });

  it('fires on taking a step', () => {
    const start = playable(corridor(), [rule({ when: 'MOVE', then: [{ kind: 'harm', n: 1 }] })]);
    const after = playerStep(start, 'player', 1, 0).position;
    expect(fired(after)).toHaveLength(1);
    expect(hp(after)).toBe(9);
  });

  it('fires once when a full round goes by, not once per creature', () => {
    // Three creatures alive. A rule reading "when a turn goes by" that fired
    // four times a round would be indefensible.
    const start = playable(corridor({ beastAt: 8 }), [
      rule({ when: 'TURN_PASSED', then: [{ kind: 'harm', n: 1 }] }),
    ]);
    let p = playerWait(start, 'player').position;
    p = runWorldTurns(p, 'player');
    const roundsSoFar = fold(p.log, p.head).turn - 1;
    expect(fired(p)).toHaveLength(roundsSoFar);
  });

  it('separates a killing blow from an ordinary one', () => {
    // A blow that finishes something is KILLED and only KILLED — firing both
    // would double every on-strike effect on the turn it mattered most.
    const start = playable(corridor({ beastAt: 1 }), [
      rule({ id: 'on-hit', when: 'STRIKE', then: [{ kind: 'speak', text: 'contact' }] }),
      rule({ id: 'on-kill', when: 'KILLED', then: [{ kind: 'grant', stat: 'might', n: 1 }] }),
    ]);

    let p = start;
    for (let i = 0; i < 40 && fold(p.log, p.head).entities[1]!.stats.hp > 0; i += 1) {
      p = playerStep(p, 'player', 1, 0).position;
      p = runWorldTurns(p, 'player');
      if (fold(p.log, p.head).entities[0]!.stats.hp <= 0) break;
    }

    const byRule = fired(p).map((e) => e.payload.ruleId);
    const kills = byRule.filter((r) => r === 'on-kill').length;
    if (fold(p.log, p.head).entities[1]!.stats.hp === 0) {
      expect(kills).toBe(1);
      // Every landed blow before the last was an ordinary strike.
      expect(byRule.filter((r) => r === 'on-hit').length).toBeGreaterThan(0);
      // And the killing blow did not also count as a strike.
      expect(byRule[byRule.length - 1]).toBe('on-kill');
    }
  });

  it('lets a rule read whether the blow landed', () => {
    const start = playable(corridor({ beastAt: 1 }), [
      rule({ id: 'on-miss', when: 'STRIKE', require: [{ kind: 'blowMissed' }], then: [{ kind: 'harm', n: 1 }] }),
    ]);
    let p = start;
    let sawMiss = false;
    for (let i = 0; i < 30; i += 1) {
      p = playerStep(p, 'player', 1, 0).position;
      const strikes = chain(p.log, p.head).filter((e) => e.type === 'STRIKE' && e.payload.attackerId === 'player');
      const last = strikes[strikes.length - 1];
      if (last !== undefined && last.type === 'STRIKE' && !last.payload.hit) { sawMiss = true; break; }
      p = runWorldTurns(p, 'player');
      if (fold(p.log, p.head).entities[0]!.stats.hp <= 0) break;
    }
    if (sawMiss) expect(fired(p).some((e) => e.payload.ruleId === 'on-miss')).toBe(true);
  });
});
