import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { playerVolley, playerWait, runWorldTurns } from '../../src/play/session.js';
import { ratifyRule } from '../../src/core/commands.js';
import { validateRule, isRejected } from '../../src/canon/rule.js';
import { FLOOR } from '../../src/core/grid.js';
import type { Rule } from '../../src/canon/rule.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';

/**
 * The loop closed: one key, two beats, and the world's archers under the
 * same discipline — with the player's law reading shots like any blow.
 */

const sling = { weapon: { kind: 'leaden sling', grants: { hp: 0, might: 1, wits: 0, speed: 0 } } };

function corridor(opts: { slung?: boolean; slingerAt?: number; skirmisherAt?: number } = {}): Position {
  const tiles = new Array<number>(9).fill(FLOOR);
  const opponents = [];
  if (opts.slingerAt !== undefined) {
    opponents.push({ id: 'foe-1', kind: 'slinger', pos: { x: opts.slingerAt, y: 0 }, stats: { hp: 3, might: 2, wits: 2, speed: 2 }, tags: [] });
  }
  if (opts.skirmisherAt !== undefined) {
    opponents.push({ id: 'foe-2', kind: 'skirmisher', pos: { x: opts.skirmisherAt, y: 0 }, stats: { hp: 4, might: 2, wits: 1, speed: 3 }, tags: [] });
  }
  const born: GameEvent = {
    id: 'w', parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 9, height: 1, tiles, seed: 11, items: [],
      ...(opts.slung === true ? { playerGear: sling } : {}),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents,
    },
  } as GameEvent;
  const log = emptyLog();
  const seated = append(log, null, born);
  return { log: seated.log, head: seated.event.id };
}

const types = (p: Position): string[] => chain(p.log, p.head).map((e) => e.type);
const strikes = (p: Position) => chain(p.log, p.head).filter((e) => e.type === 'STRIKE');

describe('playerVolley — one key, two beats', () => {
  it('refuses bare hands without spending a turn', () => {
    const at = corridor({ slingerAt: 3 });
    const { position, draft } = playerVolley(at, 'player');
    expect(draft).toBeNull();
    expect(position.head).toBe(at.head);
  });

  it('draws on the first press, looses on the second', () => {
    const at = corridor({ slung: true, skirmisherAt: 3 });
    const drew = playerVolley(at, 'player');
    expect(drew.draft?.type).toBe('DRAWN');
    // The draw ends the turn: the world moved after it.
    const between = runWorldTurns(drew.position, 'player');
    const loosed = playerVolley(between, 'player');
    expect(loosed.draft?.type).toBe('STRIKE');
    if (loosed.draft?.type === 'STRIKE') {
      expect(loosed.draft.payload.mode).toBe('ranged');
    }
  });

  it('holds the stance through a targetless press — no turn burnt', () => {
    const at = corridor({ slung: true });
    const drew = playerVolley(at, 'player');
    expect(drew.draft?.type).toBe('DRAWN');
    const pressed = playerVolley(drew.position, 'player');
    expect(pressed.draft).toBeNull();
    expect(pressed.position.head).toBe(drew.position.head);
    const held = fold(pressed.position.log, pressed.position.head);
    expect(held.entities.find((e) => e.id === 'player')!.tags).toContain('drawn');
  });
});

describe('the world\'s archers under the discipline', () => {
  it('a slinger draws on one beat and looses on the next, on the chain', () => {
    let at = corridor({ slingerAt: 4 });
    at = runWorldTurns(playerWait(at, 'player').position, 'player');
    expect(types(at)).toContain('DRAWN');
    expect(strikes(at)).toHaveLength(0);
    at = runWorldTurns(playerWait(at, 'player').position, 'player');
    const shot = strikes(at);
    expect(shot).toHaveLength(1);
    expect((shot[0] as Extract<GameEvent, { type: 'STRIKE' }>).payload.mode).toBe('ranged');
  });

  it('the player\'s STRUCK law reads a shot like any blow', () => {
    const thorns = validateRule({
      id: 'thorns',
      when: 'STRUCK',
      require: [],
      then: [{ kind: 'harmOther', n: 1 }],
      provenance: { events: ['e'], notes: [], because: 'testing the far struck' },
      ratifiedAt: '2026-07-28T00:00:00.000Z',
    });
    if (isRejected(thorns)) throw new Error(thorns.rejected);
    let at = corridor({ slingerAt: 4 });
    const lawful = append(at.log, at.head, ratifyRule(fold(at.log, at.head), thorns as Rule));
    at = { log: lawful.log, head: lawful.event.id };
    // Two rounds: the draw, then the shot — and the rule answers the shot.
    at = runWorldTurns(playerWait(at, 'player').position, 'player');
    at = runWorldTurns(playerWait(at, 'player').position, 'player');
    expect(strikes(at)).toHaveLength(1);
    expect(types(at)).toContain('RULE_FIRED');
  });

  it('the whole exchange verifies: hashes, counters, replay', () => {
    let at = corridor({ slung: true, slingerAt: 4 });
    for (let round = 0; round < 6; round += 1) {
      at = runWorldTurns(playerVolley(at, 'player').position, 'player');
      at = runWorldTurns(playerWait(at, 'player').position, 'player');
    }
    expect(verifyChain(at.log, at.head)).toBeNull();
  });
});
