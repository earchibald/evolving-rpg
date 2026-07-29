import { apply } from '../../src/core/apply.js';
import { drawStance, shotTarget, looseShot, STRIKE_DRAWS } from '../../src/core/commands.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameState } from '../../src/core/state.js';
import { FLOOR, WALL } from '../../src/core/grid.js';
import { neededToHit, braceWall } from '../../src/core/tables.js';
import { emptyLog, append, fold } from '../../src/log/chain.js';

/**
 * The volley commands: draw, mark, loose. Command-time gates are covenant
 * M7 (the line, the reach) and M8 (no shot unfired stances) made real.
 */

interface Seed {
  id: string; kind: string; x: number; y: number;
  hp?: number; tags?: string[];
  gear?: Record<string, { kind: string; grants: { hp: number; might: number; wits: number; speed: number } }>;
}

let seq = 0;
function world(seeds: Seed[], rows?: readonly string[]): GameState {
  const width = rows?.[0]?.length ?? 8;
  const height = rows?.length ?? 1;
  const tiles = rows === undefined
    ? Array.from({ length: width * height }, () => FLOOR)
    : rows.flatMap((row) => [...row].map((c) => (c === '#' ? WALL : FLOOR)));
  seq += 1;
  const [player, ...opponents] = seeds;
  const init: GameEvent = {
    id: `w${String(seq)}`, parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0, rngDraws: 0,
    payload: {
      width, height, tiles, seed: 41, items: [],
      ...(player!.gear === undefined ? {} : { playerGear: player!.gear }),
      player: { id: player!.id, kind: player!.kind, pos: { x: player!.x, y: player!.y }, stats: { hp: player!.hp ?? 10, might: 3, wits: 3, speed: 4 }, tags: player!.tags ?? [] },
      opponents: opponents.map((o) => ({
        id: o.id, kind: o.kind, pos: { x: o.x, y: o.y },
        stats: { hp: o.hp ?? 4, might: 2, wits: 2, speed: 2 }, tags: o.tags ?? [],
      })),
    },
  } as GameEvent;
  return apply(EMPTY_STATE, init);
}

const sling = { weapon: { kind: 'leaden sling', grants: { hp: 0, might: 1, wits: 0, speed: 0 } } };

describe('drawStance — who may even lift the thing', () => {
  it('a slinger may; a skirmisher may not', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 4, y: 0 },
      { id: 'foe-2', kind: 'skirmisher', x: 6, y: 0 },
    ]);
    expect(drawStance(s, 'foe-1')?.type).toBe('DRAWN');
    expect(drawStance(s, 'foe-2')).toBeNull();
  });

  it('the bare player may not; the slung player may; a drawn one is done drawing', () => {
    const bare = world([{ id: 'player', kind: 'you', x: 0, y: 0 }]);
    expect(drawStance(bare, 'player')).toBeNull();
    const armed = world([{ id: 'player', kind: 'you', x: 0, y: 0, gear: sling }]);
    expect(drawStance(armed, 'player')?.type).toBe('DRAWN');
    const held = world([{ id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags: ['drawn'] }]);
    expect(drawStance(held, 'player')).toBeNull();
  });
});

describe('shotTarget — the mark, chosen the same way forever', () => {
  it('picks the nearest hostile in the disc with a clear line', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling },
      { id: 'far', kind: 'slinger', x: 5, y: 0 },
      { id: 'near', kind: 'skirmisher', x: 3, y: 0 },
    ]);
    expect(shotTarget(s, 'player')?.id).toBe('near');
  });

  it('refuses the adjacent — the bump owns range 1', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling },
      { id: 'close', kind: 'skirmisher', x: 1, y: 0 },
    ]);
    expect(shotTarget(s, 'player')).toBeNull();
  });

  it('a body on the line disqualifies the one behind it', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling },
      { id: 'shield', kind: 'bruiser', x: 2, y: 0 },
      { id: 'behind', kind: 'slinger', x: 4, y: 0 },
    ]);
    // The shield itself is a legal mark (range 2); the one behind is not.
    expect(shotTarget(s, 'player')?.id).toBe('shield');
  });

  it('a wall on the line refuses; past the disc refuses', () => {
    const walled = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling },
      { id: 'hidden', kind: 'slinger', x: 4, y: 0 },
    ], ['..#.....']);
    expect(shotTarget(walled, 'player')).toBeNull();
    const past = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling },
      { id: 'distant', kind: 'slinger', x: 6, y: 0 },
    ]);
    expect(shotTarget(past, 'player')).toBeNull();
  });

  it('breaks a tie of distance by birth order', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 2, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 0, y: 0 },
      { id: 'foe-2', kind: 'slinger', x: 4, y: 0 },
    ]);
    expect(shotTarget(s, 'foe-1')?.id).toBe('player');
    expect(shotTarget(s, 'player')?.id).toBe('foe-1');
  });
});

describe('looseShot — the shot itself', () => {
  const armedWorld = (tags: string[] = ['drawn']): GameState => world([
    { id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags },
    { id: 'foe-1', kind: 'slinger', x: 3, y: 0 },
  ]);

  it('refuses the undrawn — covenant M8\'s gate', () => {
    expect(looseShot(armedWorld([]), 'player', 'foe-1')).toBeNull();
  });

  it('flies on the shared dice, two draws, mode ranged, no movement riders', () => {
    const draft = looseShot(armedWorld(), 'player', 'foe-1');
    expect(draft).not.toBeNull();
    expect(draft!.type).toBe('STRIKE');
    expect(draft!.rngDraws).toBe(STRIKE_DRAWS);
    const p = draft!.payload;
    expect(p.mode).toBe('ranged');
    expect(p.needed).toBe(neededToHit(3, 2));
    expect(p.attackerTo).toBeUndefined();
    expect(p.targetTo).toBeUndefined();
  });

  it('faces the raised bar of a set guard', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags: ['drawn'] },
      { id: 'foe-1', kind: 'slinger', x: 3, y: 0, tags: ['braced'] },
    ]);
    const p = looseShot(s, 'player', 'foe-1')!.payload;
    expect(p.needed).toBe(neededToHit(3, 2) + braceWall(2));
  });

  it('refuses the adjacent, the blocked, and the out-of-reach', () => {
    const adjacent = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags: ['drawn'] },
      { id: 'foe-1', kind: 'slinger', x: 1, y: 0 },
    ]);
    expect(looseShot(adjacent, 'player', 'foe-1')).toBeNull();
    const blocked = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags: ['drawn'] },
      { id: 'foe-1', kind: 'slinger', x: 4, y: 0 },
    ], ['..#.....']);
    expect(looseShot(blocked, 'player', 'foe-1')).toBeNull();
    const far = world([
      { id: 'player', kind: 'you', x: 0, y: 0, gear: sling, tags: ['drawn'] },
      { id: 'foe-1', kind: 'slinger', x: 6, y: 0 },
    ]);
    expect(looseShot(far, 'player', 'foe-1')).toBeNull();
  });

  it('through the chain: a killing shot pays XP, and the stance is spent', () => {
    // Seat the state on a chain so the shot folds like live play.
    const log = emptyLog();
    const born = append(log, null, {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
      rngCounter: 0, rngDraws: 0,
      payload: {
        width: 8, height: 1, tiles: Array.from({ length: 8 }, () => FLOOR), seed: 41, items: [],
        playerGear: sling,
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 9, wits: 3, speed: 4 }, tags: ['drawn'] },
        opponents: [{ id: 'foe-1', kind: 'slinger', pos: { x: 2, y: 0 }, stats: { hp: 1, might: 2, wits: 2, speed: 2 }, tags: [] }],
      },
    } as Extract<GameEvent, { type: 'WORLD_INIT' }>);
    const state = fold(born.log, born.event.id);
    const draft = looseShot(state, 'player', 'foe-1');
    expect(draft).not.toBeNull();
    // might 9 damage floor is 5 — the shot kills whatever the roll, unless it misses;
    // walk the possibility honestly instead: apply and accept either branch.
    const done = append(born.log, born.event.id, draft!);
    const after = fold(done.log, done.event.id);
    expect(after.entities.find((e) => e.id === 'player')!.tags).not.toContain('drawn');
    if (draft!.payload.hit) {
      expect(after.entities.find((e) => e.id === 'foe-1')!.stats.hp).toBe(0);
      expect(after.xp).toBeGreaterThan(0);
    } else {
      expect(after.entities.find((e) => e.id === 'foe-1')!.stats.hp).toBe(1);
    }
  });
});
