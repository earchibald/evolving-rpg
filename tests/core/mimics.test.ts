import { decide } from '../../src/core/ai.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import { createWorld, endsTurn, shoveAt, shotTarget, useCarried } from '../../src/core/commands.js';
import { attemptMove } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { MIMIC_IN, mimicGuises, threatOf, creatureStats } from '../../src/core/tables.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';

function corridor(entities: Entity[]): GameState {
  const width = 20;
  const height = 3;
  const tiles = new Array<number>(width * height).fill(WALL);
  for (let x = 1; x < width - 1; x += 1) tiles[width + x] = FLOOR;
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
    depth: 3,
    story: '', motif: null, bodies: [], bible: null, smoke: null, traps: [], alarm: null,
  };
}

const mimic = (x: number, hidden = true): Entity => ({
  id: 'mimic-1', kind: 'mimic', pos: { x, y: 1 },
  stats: { ...creatureStats('mimic', 1)! }, tags: hidden ? ['hidden'] : ['ambush'],
  maxHp: creatureStats('mimic', 1)!.hp, guise: 'vital draught',
});

const you = (x: number, satchel?: { kind: string }[]): Entity => ({
  id: 'player', kind: 'you', pos: { x, y: 1 },
  stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 10,
  ...(satchel === undefined ? {} : { satchel }),
});

const sealed = (draft: DraftEvent): GameEvent => ({ ...draft, id: 'e', parent: null, seq: 1 } as GameEvent);

describe('the mimic', () => {
  it('is unmasked by the walk, never struck through its guise', () => {
    const state = corridor([you(5), mimic(6)]);
    const draft = attemptMove(state, 'player', 1, 0);
    expect(draft.type).toBe('UNMASKED');
    expect(endsTurn(draft)).toBe(true);

    const after = apply(state, sealed(draft));
    const it = after.entities.find((e) => e.id === 'mimic-1')!;
    expect(it.tags).not.toContain('hidden');
    expect(it.tags).toContain('ambush');
    // The player did not move: the reach was the whole turn.
    expect(after.entities.find((e) => e.id === 'player')!.pos.x).toBe(5);
  });

  it('holds perfectly still while hidden, whatever stands beside it', () => {
    const state = corridor([mimic(6), you(5)]);
    expect(decide(state, 'mimic-1')).toEqual({ kind: 'wait' });
  });

  it('gets the first strike one band harder — the stalker\'s own spring, recorded', () => {
    // Scan seeds until the unmasked mimic's blow lands: the payload must
    // say ambush, the spring spent by the reducer like any stalker's.
    for (let seed = 1; seed < 80; seed += 1) {
      const state = { ...corridor([mimic(6, false), you(5)]), seed };
      const draft = attemptMove(state, 'mimic-1', -1, 0);
      if (draft.type !== 'STRIKE' || !draft.payload.hit) continue;
      expect(draft.payload.ambush).toBe(true);
      const after = apply(state, sealed(draft));
      expect(after.entities.find((e) => e.id === 'mimic-1')!.tags).not.toContain('ambush');
      return;
    }
    throw new Error('no seed landed the mimic\'s first blow');
  });

  it('reads as furniture to every tool: no shove, no mark, no burr', () => {
    const state = corridor([you(5, [{ kind: 'iron burr' }]), mimic(6)]);
    expect(shoveAt(state, 'player', 1, 0)).toBeNull();
    expect(shotTarget(state, 'player')).toBeNull();
    const burr = useCarried(state, 'player', 0);
    expect(burr?.type).toBe('ITEM_USED');
    if (burr?.type === 'ITEM_USED' && burr.payload.effect.kind === 'burr') {
      expect(burr.payload.effect.staggered).toEqual([]);
    } else {
      throw new Error('burr did not resolve');
    }
  });

  it('pays feign-priced XP when it dies — the disguise is threat, threat is reward', () => {
    const stats = creatureStats('mimic', 1)!;
    expect(threatOf(stats, 'mimic')).toBeGreaterThan(threatOf(stats));
  });
});

describe('generation deals the lie', () => {
  it('never on the teaching floor; rarely, at most once, past it — wearing a plausible kind', () => {
    let held = 0;
    const trials = 60;
    for (let seed = 1; seed <= trials; seed += 1) {
      const d1 = createWorld(seed, 96, 64, 'player', 1);
      expect(d1.payload.opponents.some((o) => o.guise !== undefined)).toBe(false);

      const d3 = createWorld(seed, 96, 64, 'player', 3);
      const lies = d3.payload.opponents.filter((o) => o.guise !== undefined);
      expect(lies.length).toBeLessThanOrEqual(1);
      if (lies.length === 0) continue;
      held += 1;
      const it = lies[0]!;
      expect(it.tags).toContain('hidden');
      expect(mimicGuises(3)).toContain(it.guise!);
      // Never on a real prize's tile: the mimic IS the item of its square.
      expect(d3.payload.items.some((i) => i.pos.x === it.pos.x && i.pos.y === it.pos.y)).toBe(false);
      // The floor admits a lie exists — like the secret room, never where.
      expect(d3.payload.story).toContain('not what it seems');
    }
    // 1-in-MIMIC_IN over 60 floors: mean 10 — the band is loose on purpose,
    // it exists to catch the rate collapsing to 0 or exploding.
    expect(held).toBeGreaterThanOrEqual(3);
    expect(held).toBeLessThanOrEqual(Math.ceil((trials / MIMIC_IN) * 2));
  });
});
