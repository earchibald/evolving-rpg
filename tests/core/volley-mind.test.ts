import { apply } from '../../src/core/apply.js';
import { decide } from '../../src/core/ai.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameState } from '../../src/core/state.js';
import { FLOOR, WALL } from '../../src/core/grid.js';

/** The slinger's ladder: club when reached, draw when it sees you, loose
 *  when drawn, hunt when the line refuses. Never a step backward. */

interface Seed { id: string; kind: string; x: number; y: number; hp?: number; tags?: string[] }

let seq = 0;
function world(seeds: Seed[], rows?: readonly string[]): GameState {
  const width = rows?.[0]?.length ?? 8;
  const height = rows?.length ?? 1;
  const tiles = rows === undefined
    ? Array.from({ length: width * height }, () => FLOOR)
    : rows.flatMap((row) => [...row].map((c) => (c === '#' ? WALL : FLOOR)));
  seq += 1;
  const [player, ...opponents] = seeds;
  return apply(EMPTY_STATE, {
    id: `w${String(seq)}`, parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0, rngDraws: 0,
    payload: {
      width, height, tiles, seed: 5, items: [],
      player: { id: player!.id, kind: player!.kind, pos: { x: player!.x, y: player!.y }, stats: { hp: player!.hp ?? 10, might: 3, wits: 3, speed: 4 }, tags: player!.tags ?? [] },
      opponents: opponents.map((o) => ({
        id: o.id, kind: o.kind, pos: { x: o.x, y: o.y },
        stats: { hp: o.hp ?? 3, might: 2, wits: 2, speed: 2 }, tags: o.tags ?? [],
      })),
    },
  } as GameEvent);
}

describe('the slinger\'s mind', () => {
  it('clubs what stands beside it — the sling wants ground the bump owns', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 1, y: 0 },
    ]);
    expect(decide(s, 'foe-1')).toEqual({ kind: 'strike', targetId: 'player' });
  });

  it('draws when it sees you in reach, and looses once drawn', () => {
    const cold = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 3, y: 0 },
    ]);
    expect(decide(cold, 'foe-1')).toEqual({ kind: 'draw' });
    const held = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 3, y: 0, tags: ['drawn'] },
    ]);
    expect(decide(held, 'foe-1')).toEqual({ kind: 'shoot', targetId: 'player' });
  });

  it('hunts when a wall breaks the line — and the hunt is a step, never a retreat', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 1 },
      { id: 'foe-1', kind: 'slinger', x: 4, y: 1 },
    ], [
      '........',
      '..#.....',
      '........',
    ]);
    const act = decide(s, 'foe-1');
    expect(act.kind).toBe('step');
    // Toward, not away: the step closes distance around the wall.
    expect(act).not.toEqual({ kind: 'step', dx: 1, dy: 0 });
  });

  it('walks a smoked floor\'s stale trail rather than drawing on what it cannot see', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 4, y: 0 },
    ]);
    const fooled: GameState = { ...s, smoke: { until: s.turn + 5, at: { x: 7, y: 0 }, unfooled: [] } };
    const act = decide(fooled, 'foe-1');
    expect(act.kind).toBe('step');
  });

  it('spends a stagger reeling like everything else', () => {
    const s = world([
      { id: 'player', kind: 'you', x: 0, y: 0 },
      { id: 'foe-1', kind: 'slinger', x: 3, y: 0, tags: ['staggered'] },
    ]);
    expect(decide(s, 'foe-1')).toEqual({ kind: 'wait' });
  });
});
