import { FLOOR, WALL, SECRET, makeGrid, tileAt } from '../../src/core/grid.js';
import { createWorld, readScroll, takeUnderfoot, endsTurn } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { SCROLLS, scrollsAt, BLINK_CLEAR, TRAP_EATER_REACH, HEART_KIND } from '../../src/core/tables.js';
import { scrollLabel } from '../../src/canon/namesmith.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';

type Trap = GameState['traps'][number];

function room(entities: Entity[], over: Partial<GameState> = {}): GameState {
  const width = 24;
  const height = 12;
  const tiles = new Array<number>(width * height).fill(WALL);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) tiles[y * width + x] = FLOOR;
  }
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
    depth: 4,
    story: '', motif: null, bodies: [], bible: null, smoke: null,
    traps: [], alarm: null, unveiled: [], ...over,
  };
}

const you = (x: number, y: number, over: Partial<Entity> = {}): Entity => ({
  id: 'player', kind: 'you', pos: { x, y },
  stats: { hp: 12, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 12, ...over,
});

const foe = (id: string, x: number, y: number): Entity => ({
  id, kind: 'bruiser', pos: { x, y },
  stats: { hp: 7, might: 4, wits: 1, speed: 1 }, tags: [], maxHp: 7,
});

const holding = (kind: string): Partial<Entity> => ({ scroll: { kind } });

const sealed = (draft: DraftEvent): GameEvent => ({ ...draft, id: 'e', parent: null, seq: 1 } as GameEvent);

const trap = (id: string, x: number, y: number): Trap => ({
  id, kind: 'spike pit', pos: { x, y }, level: 2,
  sightRolled: false, nearRolled: false, revealed: false, sprung: false,
});

describe('reading', () => {
  it('unveiling names every hidden door and every waiting trap, and the reducer keeps both', () => {
    const tiles = room([]).grid.tiles.slice() as number[];
    tiles[5 * 24 + 12] = SECRET;
    const state = room([you(3, 3, holding('scroll of unveiling'))], {
      grid: makeGrid(24, 12, tiles),
      traps: [trap('trap-1', 20, 9)],
    });
    const draft = readScroll(state, 'player')!;
    expect(draft.payload.effect.kind).toBe('unveiling');
    if (draft.payload.effect.kind !== 'unveiling') return;
    expect(draft.payload.effect.secrets).toEqual([{ x: 12, y: 5 }]);
    expect(draft.payload.effect.traps).toEqual(['trap-1']);
    expect(endsTurn(draft)).toBe(true);

    const after = apply(state, sealed(draft));
    expect(after.unveiled).toEqual([{ x: 12, y: 5 }]);
    expect(after.traps[0]!.revealed).toBe(true);
    expect(after.traps[0]!.sprung).toBe(false);
    expect(after.entities[0]!.scroll).toBeUndefined();
  });

  it('the still hour reels everything hostile and breathing — except the hidden lie', () => {
    const state = room([
      you(3, 3, holding('scroll of the still hour')),
      foe('foe-1', 10, 3),
      foe('foe-2', 20, 9),
      { ...foe('mimic-1', 15, 5), kind: 'mimic', tags: ['hidden'], guise: 'vital draught' },
    ]);
    const draft = readScroll(state, 'player')!;
    if (draft.payload.effect.kind !== 'still hour') throw new Error('wrong effect');
    expect(draft.payload.effect.staggered.sort()).toEqual(['foe-1', 'foe-2']);
    const after = apply(state, sealed(draft));
    expect(after.entities.find((e) => e.id === 'foe-1')!.tags).toContain('staggered');
    expect(after.entities.find((e) => e.id === 'mimic-1')!.tags).not.toContain('staggered');
  });

  it('the trap eater eats what it can walk to, and the eaten ground reads as spent', () => {
    const state = room([you(5, 5, holding('scroll of the trap eater'))], {
      traps: [trap('trap-1', 5 + TRAP_EATER_REACH, 5), trap('trap-2', 20, 9)],
    });
    const draft = readScroll(state, 'player')!;
    if (draft.payload.effect.kind !== 'trap eater') throw new Error('wrong effect');
    expect(draft.payload.effect.eaten).toEqual(['trap-1']);
    const after = apply(state, sealed(draft));
    expect(after.traps.find((t) => t.id === 'trap-1')!.sprung).toBe(true);
    expect(after.traps.find((t) => t.id === 'trap-2')!.sprung).toBe(false);
  });

  it('the blink step lands clear of every hostile, drawn and recorded', () => {
    const state = room([
      you(3, 3, holding('scroll of the blink step')),
      foe('foe-1', 4, 3),
    ]);
    const draft = readScroll(state, 'player')!;
    if (draft.payload.effect.kind !== 'blink') throw new Error('wrong effect');
    const to = draft.payload.effect.to;
    expect(draft.rngDraws).toBe(1);
    // Clear of the hostile by at least the clearance, in steps of walking —
    // manhattan is a lower bound on walking, so this is the strict check.
    expect(Math.abs(to.x - 4) + Math.abs(to.y - 3)).toBeGreaterThanOrEqual(BLINK_CLEAR);
    const after = apply(state, sealed(draft));
    expect(after.entities[0]!.pos).toEqual(to);
  });

  it('stone song breaks only plain wall, never the border, and the grid truly opens', () => {
    // Stand beside the border: the song must refuse the outer wall.
    const state = room([you(1, 1, holding('scroll of stone song'))]);
    const draft = readScroll(state, 'player')!;
    if (draft.payload.effect.kind !== 'stone song') throw new Error('wrong effect');
    for (const b of draft.payload.effect.broken) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
    }
    const after = apply(state, sealed(draft));
    for (const b of draft.payload.effect.broken) {
      expect(tileAt(after.grid, b.x, b.y)).toBe(FLOOR);
    }
  });

  it('empty hands read nothing; the heart seals the reading', () => {
    expect(readScroll(room([you(3, 3)]), 'player')).toBeNull();
    const carrying = room([you(3, 3, {
      ...holding('scroll of the blink step'),
      satchel: [{ kind: HEART_KIND }],
    })]);
    expect(readScroll(carrying, 'player')).toBeNull();
  });
});

describe('the scroll hand', () => {
  it('walking fills an empty hand; a held scroll waits for the deliberate swap, which mints the old one down', () => {
    const lying = { id: 'scroll-1', kind: 'scroll of unveiling', pos: { x: 3, y: 3 }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } };
    const bare = room([you(3, 3)], { items: [lying] });
    const took = takeUnderfoot(bare, 'player');
    expect(took?.payload.scroll).toEqual({ swappedOut: null });

    const full = room([you(3, 3, holding('scroll of stone song'))], { items: [lying] });
    expect(takeUnderfoot(full, 'player')).toBeNull();
    const swapped = takeUnderfoot(full, 'player', true)!;
    expect(swapped.payload.scroll).toEqual({ swappedOut: 'scroll of stone song' });

    const after = apply(full, sealed(swapped));
    expect(after.entities[0]!.scroll).toEqual({ kind: 'scroll of unveiling' });
    expect(after.items.some((i) => i.kind === 'scroll of stone song' && i.pos.x === 3 && i.pos.y === 3)).toBe(true);
  });

  it('crosses the stairs like everything carried', () => {
    const born = createWorld(9, 48, 32, 'player', 5, {
      stats: { hp: 12, might: 4, wits: 3, speed: 4 }, maxHp: 14, xp: 80, level: 4,
      scroll: { kind: 'scroll of the blink step' },
    });
    expect(born.payload.playerScroll).toEqual({ kind: 'scroll of the blink step' });
    const folded = apply({ ...room([]), entities: [] } as GameState, sealed(born as DraftEvent));
    expect(folded.entities.find((e) => e.kind === 'you')!.scroll).toEqual({ kind: 'scroll of the blink step' });
  });
});

describe('the shelf and the labels', () => {
  it('floors lay scrolls from depth 2, visible items on honest tiles', () => {
    let laid = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const d1 = createWorld(seed, 96, 64, 'player', 1);
      expect(d1.payload.items.some((i) => i.id === 'scroll-1')).toBe(false);
      const d3 = createWorld(seed, 96, 64, 'player', 3);
      const page = d3.payload.items.find((i) => i.id === 'scroll-1');
      if (page === undefined) continue;
      laid += 1;
      expect(scrollsAt(3).map((s) => s.kind)).toContain(page.kind);
      expect(d3.payload.opponents.some((o) => o.pos.x === page.pos.x && o.pos.y === page.pos.y)).toBe(false);
      expect(d3.payload.traps?.some((t) => t.pos.x === page.pos.x && t.pos.y === page.pos.y) ?? false).toBe(false);
    }
    expect(laid).toBeGreaterThan(4);
  });

  it('labels are per-world, deterministic, and never shared between kinds', () => {
    const shelf = SCROLLS.map((s) => s.kind);
    const here = shelf.map((k) => scrollLabel('root-a', k, shelf));
    const again = shelf.map((k) => scrollLabel('root-a', k, shelf));
    const there = shelf.map((k) => scrollLabel('root-b', k, shelf));
    expect(again).toEqual(here);
    expect(new Set(here).size).toBe(shelf.length);
    // Two fixed worlds wearing identical label SETS would mean the hash
    // ignores the root — worth noticing, like the namesmith's own pin.
    expect(there).not.toEqual(here);
  });

  it('the deeper shelf only ever grows', () => {
    expect(scrollsAt(2).length).toBeGreaterThan(0);
    expect(scrollsAt(4).length).toBeGreaterThanOrEqual(scrollsAt(2).length);
    expect(scrollsAt(9).map((s) => s.kind)).toEqual(SCROLLS.map((s) => s.kind));
  });
});
