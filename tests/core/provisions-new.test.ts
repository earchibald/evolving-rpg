import { apply } from '../../src/core/apply.js';
import { useCarried, attemptMove } from '../../src/core/commands.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameState } from '../../src/core/state.js';
import { FLOOR, EXIT, makeGrid, idx } from '../../src/core/grid.js';
import { provisionsAt, PROVISIONS } from '../../src/core/tables.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { fogAt } from '../../src/ui/fov.js';
import type { Grid } from '../../src/core/grid.js';

/**
 * The pantry widened (designer's word, the 929-second run): three new
 * provisions beside the teaching trio. The ward drinks exactly one blow;
 * the burr staggers exactly who stood beside you; the bell is knowledge,
 * never power. Depth gates keep floor one to the original three.
 */

interface Foe { id: string; x: number; y: number; kind?: string }
interface Opt {
  satchel?: string[];
  tags?: string[];
  foes?: Foe[];
  items?: { id: string; kind: string; x: number; y: number }[];
  exitAt?: number;
  seed?: number;
}

let seq = 0;
function world(opt: Opt = {}): GameState {
  seq += 1;
  const tiles = Array.from({ length: 8 }, (_v, i) => (i === opt.exitAt ? EXIT : FLOOR));
  return apply(EMPTY_STATE, {
    id: `w${String(seq)}`, parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0, rngDraws: 0,
    payload: {
      width: 8, height: 1, tiles, seed: opt.seed ?? 9,
      ...(opt.satchel === undefined ? {} : { playerSatchel: { kinds: opt.satchel } }),
      items: (opt.items ?? []).map((i) => ({ id: i.id, kind: i.kind, pos: { x: i.x, y: i.y }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } })),
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: opt.tags ?? [] },
      opponents: (opt.foes ?? []).map((f) => ({
        id: f.id, kind: f.kind ?? 'bruiser-1', pos: { x: f.x, y: f.y },
        stats: { hp: 6, might: 2, wits: 1, speed: 2 }, tags: [],
      })),
    },
  } as GameEvent);
}

const commit = (s: GameState, d: DraftEvent | null): GameState => {
  expect(d).not.toBeNull();
  return apply(s, { ...d!, id: `e${String((seq += 1))}`, parent: null, seq } as GameEvent);
};
const you = (s: GameState) => s.entities.find((e) => e.id === 'player')!;

describe('the pantry gate', () => {
  it('keeps floor one to the teaching trio', () => {
    expect(provisionsAt(1).map((p) => p.kind)).toEqual(['vital draught', 'still smoke', 'tallow flare']);
  });

  it('opens by depth: ward and bell at two, the burr at three', () => {
    const atTwo = provisionsAt(2).map((p) => p.kind);
    expect(atTwo).toContain('ash ward');
    expect(atTwo).toContain('hollow bell');
    expect(atTwo).not.toContain('iron burr');
    expect(provisionsAt(3).map((p) => p.kind)).toHaveLength(PROVISIONS.length);
  });

  it('gives every kind a positive weight', () => {
    for (const p of PROVISIONS) expect(p.weight).toBeGreaterThan(0);
  });
});

describe('the ward', () => {
  it('is worn when drunk: the tag arrives, the hand empties', () => {
    const s = world({ satchel: ['ash ward'] });
    const drunk = useCarried(s, 'player');
    expect(drunk!.payload.effect).toEqual({ kind: 'ward' });
    const after = commit(s, drunk);
    expect(you(after).tags).toContain('warded');
    expect(you(after).satchel ?? []).toHaveLength(0);
  });

  it('refuses a second warding while the first holds', () => {
    const s = world({ satchel: ['ash ward'], tags: ['warded'] });
    expect(useCarried(s, 'player')).toBeNull();
  });

  it('drinks exactly one landing blow — no wound, no venom, the draw unbroken', () => {
    // A stinger's landed blow against a warded, drawn target: the ward eats
    // the wound AND its consequences, then leaves. Applied from a recorded
    // payload, as replay would see it.
    const s = world({ tags: ['warded', 'drawn'], foes: [{ id: 'foe-1', x: 1, y: 0, kind: 'stinger-2' }] });
    const struck = apply(s, {
      id: 'blow', parent: null, seq: 90,
      type: 'STRIKE', schemaVersion: SCHEMA_VERSIONS.STRIKE, rngCounter: 0, rngDraws: 2,
      payload: { attackerId: 'foe-1', targetId: 'player', mode: 'melee', roll: 18, needed: 10, hit: true, crit: false, damage: 0, warded: true },
    } as GameEvent);
    expect(you(struck).stats.hp).toBe(10);
    expect(you(struck).tags).not.toContain('warded');
    expect(you(struck).tags).toContain('drawn');
    expect(you(struck).tags.some((t) => t.startsWith('venom-'))).toBe(false);
  });

  it('zeroes the recorded damage at command time and says so on the payload', () => {
    // Find a seed whose bump-attack lands, prove the warded twin of the
    // same state records the drink: damage 0, warded said, dice identical.
    for (let seed = 1; seed <= 60; seed += 1) {
      const bare = world({ foes: [{ id: 'foe-1', x: 1, y: 0 }], seed });
      const plain = attemptMove(bare, 'player', 1, 0);
      if (plain.type !== 'STRIKE' || !plain.payload.hit) continue;
      expect(plain.payload.damage).toBeGreaterThan(0);

      const warded = world({ foes: [{ id: 'foe-1', x: 1, y: 0 }], seed });
      const shielded = {
        ...warded,
        entities: warded.entities.map((e) => (e.id === 'foe-1' ? { ...e, tags: ['warded'] } : e)),
      };
      const drunk = attemptMove(shielded, 'player', 1, 0);
      if (drunk.type !== 'STRIKE') throw new Error('the warded twin must still be a blow');
      expect(drunk.payload.roll).toBe(plain.payload.roll);
      expect(drunk.payload.damage).toBe(0);
      expect(drunk.payload.warded).toBe(true);
      return;
    }
    throw new Error('no seed in 60 landed a blow — the fixture is wrong');
  });
});

describe('the burr', () => {
  it('staggers exactly who stood beside you', () => {
    const s = world({
      satchel: ['iron burr'],
      foes: [{ id: 'near-1', x: 1, y: 0 }, { id: 'far-1', x: 5, y: 0 }],
    });
    const cast = useCarried(s, 'player');
    expect(cast!.payload.effect).toEqual({ kind: 'burr', staggered: ['near-1'] });
    const after = commit(s, cast);
    expect(after.entities.find((e) => e.id === 'near-1')!.tags).toContain('staggered');
    expect(after.entities.find((e) => e.id === 'far-1')!.tags).not.toContain('staggered');
  });

  it('casts honestly at empty air — recorded, nobody reels', () => {
    const s = world({ satchel: ['iron burr'], foes: [{ id: 'far-1', x: 6, y: 0 }] });
    const cast = useCarried(s, 'player');
    expect(cast!.payload.effect).toEqual({ kind: 'burr', staggered: [] });
  });
});

describe('the bell', () => {
  it('records where the way out stands and where the prizes lie', () => {
    const s = world({
      satchel: ['hollow bell'],
      exitAt: 7,
      items: [{ id: 'i1', kind: 'keen edge', x: 4, y: 0 }],
    });
    const rung = useCarried(s, 'player');
    expect(rung!.payload.effect).toEqual({ kind: 'bell', exit: { x: 7, y: 0 }, prizes: [{ x: 4, y: 0 }] });
  });

  it('is knowledge the fog reads off the chain: the exit joins SEEN', () => {
    const gridOf = (p: { width: number; height: number; tiles: number[] }): Grid => makeGrid(p.width, p.height, p.tiles);
    // A long corridor: the exit far beyond sight, then the bell rings.
    const tiles = Array.from({ length: 24 }, (_v, i) => (i === 23 ? EXIT : FLOOR));
    const init: DraftEvent = {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 24, height: 1, tiles, seed: 3, items: [],
        playerSatchel: { kinds: ['hollow bell'] },
        player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
      },
    } as DraftEvent;
    const born = append(emptyLog(), null, init);
    const state = apply(EMPTY_STATE, born.event);
    const grid = makeGrid(24, 1, tiles);

    const dark = fogAt(born.log, born.event.id, gridOf);
    expect(dark.seen.has(idx(grid, 23, 0))).toBe(false);

    const rung = useCarried(state, 'player')!;
    const heard = append(born.log, born.event.id, rung);
    const lit = fogAt(heard.log, heard.event.id, gridOf);
    expect(lit.seen.has(idx(grid, 23, 0))).toBe(true);
  });
});
