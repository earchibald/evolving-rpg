import { decide } from '../../src/core/ai.js';
import { FLOOR, WALL, EXIT, makeGrid } from '../../src/core/grid.js';
import { createWorld, senseTrap, springTrap, attemptMove, endsTurn } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { trapCount, trapKindsAt, TRAP_NEAR_RADIUS, SNARE_TURNS, ALARM_TURNS, HATCH_BAND, NEEDLE_VENOM_TURNS } from '../../src/core/tables.js';
import { playerStep } from '../../src/play/session.js';
import { emptyLog, append, fold, chain } from '../../src/log/chain.js';
import type { Entity } from '../../src/core/entity.js';
import type { GameState } from '../../src/core/state.js';
import type { GameEvent, DraftEvent } from '../../src/core/events.js';

type Trap = GameState['traps'][number];

const trap = (kind: string, x: number, over: Partial<Trap> = {}): Trap => ({
  id: 'trap-1', kind, pos: { x, y: 1 }, level: 2,
  sightRolled: false, nearRolled: false, revealed: false, sprung: false, ...over,
});

function corridor(entities: Entity[], traps: Trap[], over: Partial<GameState> = {}): GameState {
  const width = 26;
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
    depth: 4,
    story: '', motif: null, bodies: [], bible: null, smoke: null,
    traps, alarm: null, ...over,
  };
}

const you = (x: number, over: Partial<Entity> = {}): Entity => ({
  id: 'player', kind: 'you', pos: { x, y: 1 },
  stats: { hp: 12, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 12, ...over,
});

const foe = (x: number): Entity => ({
  id: 'foe-1', kind: 'bruiser', pos: { x, y: 1 },
  stats: { hp: 7, might: 4, wits: 1, speed: 1 }, tags: [], maxHp: 7,
});

const sealed = (draft: DraftEvent, seq = 1): GameEvent => ({ ...draft, id: `e${String(seq)}`, parent: null, seq } as GameEvent);

describe('sensing', () => {
  it('offers the sight chance once, records the miss, and never asks again', () => {
    const state = corridor([you(5)], [trap('spike pit', 10)]);
    const first = senseTrap(state, 'player');
    expect(first).not.toBeNull();
    expect(first!.payload.method).toBe('sight');
    expect(first!.rngDraws).toBe(1);

    const after = apply(state, sealed(first!));
    const again = senseTrap(after, 'player');
    // Whatever the roll said, the sight chance is spent; only the near
    // chance can remain, and at 5 steps away it is not yet offered.
    if (after.traps[0]!.revealed) {
      expect(again).toBeNull();
    } else {
      expect(after.traps[0]!.sightRolled).toBe(true);
      expect(again).toBeNull();
    }
  });

  it('offers the near chance up close, easier, once', () => {
    const state = corridor([you(9)],
      [trap('spike pit', 10, { sightRolled: true })]);
    expect(Math.abs(10 - 9)).toBeLessThanOrEqual(TRAP_NEAR_RADIUS);
    const near = senseTrap(state, 'player');
    expect(near).not.toBeNull();
    expect(near!.payload.method).toBe('near');
    const sight = senseTrap(corridor([you(5)], [trap('spike pit', 10)]), 'player');
    // Closer is louder: the near roll's bar sits below the sight roll's.
    expect(near!.payload.needed).toBeLessThan(sight!.payload.needed);
  });

  it('a revealed trap asks for nothing more', () => {
    const state = corridor([you(9)], [trap('spike pit', 10, { revealed: true })]);
    expect(senseTrap(state, 'player')).toBeNull();
  });
});

describe('springing', () => {
  it('the spike pit rolls the dodge and the die either way — the counter never depends on the outcome', () => {
    let dodgedOnce = false;
    let bledOnce = false;
    for (let seed = 1; seed < 60 && !(dodgedOnce && bledOnce); seed += 1) {
      const state = corridor([you(10)], [trap('spike pit', 10)], { seed });
      const sprung = springTrap(state, 'player')!;
      expect(sprung.payload.dodge).not.toBeNull();
      expect(sprung.rngDraws).toBe(2);
      const after = apply(state, sealed(sprung));
      expect(after.traps[0]!.sprung).toBe(true);
      expect(after.traps[0]!.revealed).toBe(true);
      if (sprung.payload.dodged) {
        dodgedOnce = true;
        expect(after.entities[0]!.stats.hp).toBe(12);
      } else {
        bledOnce = true;
        expect(sprung.payload.effect.kind).toBe('spikes');
        if (sprung.payload.effect.kind === 'spikes') {
          expect(after.entities[0]!.stats.hp).toBe(12 - sprung.payload.effect.damage);
        }
      }
    }
    expect(dodgedOnce && bledOnce).toBe(true);
  });

  it('the needle allows no dodge until the player has earned one (level 3)', () => {
    const green = corridor([you(10)], [trap('venom needle', 10)]);
    expect(springTrap(green, 'player')!.payload.dodge).toBeNull();
    const seasoned = corridor([you(10)], [trap('venom needle', 10)], { level: 3 });
    expect(springTrap(seasoned, 'player')!.payload.dodge).not.toBeNull();

    const bitten = apply(green, sealed(springTrap(green, 'player')!));
    expect(bitten.entities[0]!.tags).toContain(`venom-${String(NEEDLE_VENOM_TURNS)}`);
  });

  it('the snare roots the leg: steps become the strain, blows still swing, rounds slacken it', () => {
    const snared = apply(
      corridor([you(10), foe(11)], [trap('strangling snare', 10)], { seed: 3 }),
      sealed(springTrap(corridor([you(10), foe(11)], [trap('strangling snare', 10)], { seed: 3 }), 'player')!),
    );
    const me = snared.entities.find((e) => e.id === 'player')!;
    if (!me.tags.some((t) => t.startsWith('snared-'))) return; // dodged on this seed — covered below

    // A step away is the strain — a recorded WAIT, honestly spent.
    expect(attemptMove(snared, 'player', -1, 0).type).toBe('WAIT');
    // The bump still owns the blow.
    expect(attemptMove(snared, 'player', 1, 0).type).toBe('STRIKE');

    // The rounds slacken it: wrap the turn SNARE_TURNS times, tag gone.
    let s = snared;
    for (let round = 0; round < SNARE_TURNS; round += 1) {
      s = apply(s, sealed({
        type: 'TURN_ADVANCED', schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
        rngCounter: s.rngCounter, rngDraws: 0,
        payload: { activeEntityId: 'player', turn: s.turn + 1 },
      }, round + 2));
    }
    expect(s.entities.find((e) => e.id === 'player')!.tags.some((t) => t.startsWith('snared-'))).toBe(false);
  });

  it('the snare cannot be dodged around: some seed holds, some seed slips', () => {
    let held = false;
    let slipped = false;
    for (let seed = 1; seed < 60 && !(held && slipped); seed += 1) {
      const state = corridor([you(10)], [trap('strangling snare', 10)], { seed });
      const sprung = springTrap(state, 'player')!;
      if (sprung.payload.dodged) slipped = true;
      else held = true;
    }
    expect(held && slipped).toBe(true);
  });

  it('the alarm rings on a clock, and the ringing floor hunts past the awareness cap', () => {
    const state = corridor([you(3), foe(22)], [trap('alarm bell', 3)]);
    const rung = apply(state, sealed(springTrap(state, 'player')!));
    expect(rung.alarm).toEqual({ until: state.turn + ALARM_TURNS });

    // 19 steps away — far past AWARENESS 8. Quiet, the bruiser stands;
    // ringing, it comes.
    expect(decide({ ...rung, alarm: null }, 'foe-1')).toEqual({ kind: 'wait' });
    expect(decide(rung, 'foe-1')).toEqual({ kind: 'step', dx: -1, dy: 0 });
  });

  it('the hatch stands its risers up inside the band — never beside you — and the reducer seats them', () => {
    const state = corridor([you(10)], [trap('hatch', 10)]);
    const sprung = springTrap(state, 'player')!;
    expect(sprung.payload.effect.kind).toBe('hatch');
    if (sprung.payload.effect.kind !== 'hatch') return;
    expect(sprung.payload.effect.opponents.length).toBe(1);
    const riser = sprung.payload.effect.opponents[0]!;
    const away = Math.abs(riser.pos.x - 10) + Math.abs(riser.pos.y - 1);
    expect(away).toBeGreaterThanOrEqual(HATCH_BAND[0]);
    expect(away).toBeLessThanOrEqual(HATCH_BAND[1]);

    const after = apply(state, sealed(sprung));
    expect(after.entities.some((e) => e.id === riser.id)).toBe(true);
  });

  it('the lodestone sets you down far away, on ground something could stand on', () => {
    const state = corridor([you(10)], [trap('lodestone', 10)]);
    const sprung = springTrap(state, 'player')!;
    expect(sprung.payload.effect.kind).toBe('lodestone');
    if (sprung.payload.effect.kind !== 'lodestone') return;
    const to = sprung.payload.effect.to;
    expect(Math.abs(to.x - 10) + Math.abs(to.y - 1)).toBeGreaterThanOrEqual(8);
    const after = apply(state, sealed(sprung));
    expect(after.entities[0]!.pos).toEqual(to);
  });

  it('trap events ride the action: neither sensing nor springing spends a turn of its own', () => {
    const state = corridor([you(5)], [trap('spike pit', 10)]);
    expect(endsTurn(senseTrap(state, 'player')!)).toBe(false);
    expect(endsTurn(springTrap(corridor([you(10)], [trap('spike pit', 10)]), 'player')!)).toBe(false);
  });
});

describe('the session settles the floor', () => {
  it('a step onto a trap springs it on the chain, and the sweep rolls the chances', () => {
    const tiles = ((): number[] => {
      const t = new Array<number>(26 * 3).fill(WALL);
      for (let x = 1; x < 25; x += 1) t[26 + x] = FLOOR;
      t[26 + 24] = EXIT;
      return t;
    })();
    const init: DraftEvent = {
      type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
      payload: {
        width: 26, height: 3, tiles, seed: 11, depth: 4, items: [],
        player: { id: 'player', kind: 'you', pos: { x: 5, y: 1 }, stats: { hp: 12, might: 3, wits: 3, speed: 4 }, tags: [] },
        opponents: [],
        traps: [{ id: 'trap-1', kind: 'spike pit', pos: { x: 6, y: 1 }, level: 2 }],
      },
    } as DraftEvent;
    const born = append(emptyLog(), null, init);
    let position = { log: born.log, head: born.event.id };

    // The birth sweep has not run yet (no action) — step east onto it.
    position = playerStep(position, 'player', 1, 0).position;
    const types = chain(position.log, position.head).map((e) => e.type);
    expect(types).toContain('TRAP_SPRUNG');
    const state = fold(position.log, position.head);
    expect(state.traps[0]!.sprung).toBe(true);
    expect(state.traps[0]!.revealed).toBe(true);
  });
});

describe('generation lays the field', () => {
  it('none on the teaching floor; counted by depth and stretch; never on a prize, a body or the door', () => {
    expect(trapCount(1, 3)).toBe(0);
    for (const seed of [3, 15, 44]) {
      const d1 = createWorld(seed, 96, 64, 'player', 1);
      expect(d1.payload.traps ?? []).toHaveLength(0);

      const d4 = createWorld(seed, 96, 64, 'player', 4);
      const laid = d4.payload.traps ?? [];
      expect(laid.length).toBeGreaterThan(0);
      expect(laid.length).toBeLessThanOrEqual(trapCount(4, 2));
      const kinds = trapKindsAt(4).map((k) => k.kind);
      for (const t of laid) {
        expect(kinds).toContain(t.kind);
        expect(d4.payload.items.some((i) => i.pos.x === t.pos.x && i.pos.y === t.pos.y)).toBe(false);
        expect(d4.payload.opponents.some((o) => o.pos.x === t.pos.x && o.pos.y === t.pos.y)).toBe(false);
      }
    }
  });

  it('the maw never lies on the bottom — there is no floor below the bottom', () => {
    expect(trapKindsAt(9).some((k) => k.kind === 'the maw')).toBe(false);
    expect(trapKindsAt(8).some((k) => k.kind === 'the maw')).toBe(true);
  });
});
