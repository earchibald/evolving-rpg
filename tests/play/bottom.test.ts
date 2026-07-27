import { emptyLog, append, fold } from '../../src/log/chain.js';
import { createWorld, outcome, heartHeld, takeUnderfoot, useCarried, stirWorld } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { autoplay } from '../../src/play/autoplay.js';
import { rusher } from '../../src/play/policies.js';
import { BOTTOM_DEPTH, HEART_KIND } from '../../src/core/tables.js';
import { EXIT, FLOOR, tileAt } from '../../src/core/grid.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { DraftEvent, GameEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';
import type { Pos } from '../../src/core/entity.js';

/**
 * The bottom: the world has a floor, the floor has a heart, and the ending
 * is the reversal — seize it, and carry it back out through a world that
 * stirs against you.
 */

function bottomCorridor(opts: { bodies?: Pos[]; satchel?: { kind: string }; heartAt?: number } = {}): Position {
  const width = 12;
  const tiles = new Array<number>(width).fill(FLOOR);
  tiles[0] = EXIT; // the stair you came down by
  const draft: DraftEvent = {
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width, height: 1, tiles, seed: 4, depth: BOTTOM_DEPTH,
      ...(opts.satchel === undefined ? {} : { playerSatchel: opts.satchel }),
      items: [{
        id: 'heart-1', kind: HEART_KIND,
        pos: { x: opts.heartAt ?? width - 1, y: 0 },
        grants: { hp: 0, might: 0, wits: 0, speed: 0 },
      }],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as DraftEvent;
  let opened = append(emptyLog(), null, draft);
  if (opts.bodies !== undefined && opts.bodies.length > 0) {
    const laid = append(opened.log, opened.event.id, {
      type: 'WORLD_BODIES', schemaVersion: SCHEMA_VERSIONS.WORLD_BODIES,
      rngCounter: 0, rngDraws: 0, payload: { bodies: opts.bodies },
    } as DraftEvent);
    opened = laid;
  }
  return { log: opened.log, head: opened.event.id };
}

const asEvent = (draft: DraftEvent): GameEvent => ({ ...draft, id: 'x', parent: null, seq: 0 } as GameEvent);

describe('the shape of the ninth floor', () => {
  const born = createWorld(11, 48, 32, 'player', BOTTOM_DEPTH);
  const state = apply(fold(emptyLog(), null), asEvent(born));

  it('turns around: the way out is the stair you came down by', () => {
    const you = state.entities[0]!;
    expect(tileAt(state.grid, you.pos.x, you.pos.y)).toBe(EXIT);
  });

  it('keeps its heart at the far end, and says so', () => {
    const heart = state.items.find((i) => i.kind === HEART_KIND);
    expect(heart).toBeDefined();
    expect(heart!.pos).not.toEqual(state.entities[0]!.pos);
    expect(state.story).toContain('the bottom');
    expect(state.story).toContain('the heart');
  });

  it('posts the keeper beside the heart, not beside the stair', () => {
    const heart = state.items.find((i) => i.kind === HEART_KIND)!;
    const keeper = state.entities.find((e) => e.kind.startsWith('warden'));
    expect(keeper).toBeDefined();
    expect(Math.abs(keeper!.pos.x - heart.pos.x) + Math.abs(keeper!.pos.y - heart.pos.y)).toBe(1);
  });

  it('tells the first floor how deep the world runs', () => {
    const first = createWorld(11, 48, 32, 'player', 1);
    expect(first.payload.story).toContain(`${BOTTOM_DEPTH} floors deep`);
  });
});

describe('standing on the ninth floor\'s stair', () => {
  it('means nothing empty-handed, and everything with the heart', () => {
    const empty = fold(bottomCorridor().log, bottomCorridor().head);
    expect(outcome(empty)).toBe('playing');

    const carrying = fold(bottomCorridor({ satchel: { kind: HEART_KIND } }).log, bottomCorridor({ satchel: { kind: HEART_KIND } }).head);
    expect(heartHeld(carrying)).toBe(true);
    expect(outcome(carrying)).toBe('won');
  });
});

describe('the heart in hand', () => {
  it('fills and seals the satchel — nothing else taken, nothing usable', () => {
    const p = bottomCorridor({ satchel: { kind: 'still smoke' }, heartAt: 0 });
    const state = fold(p.log, p.head);
    // Standing on the heart (heartAt 0 = under the player), take it.
    const took = takeUnderfoot(state, 'player');
    expect(took).not.toBeNull();
    expect(took!.payload.satchel).toEqual({ swappedOut: 'still smoke' });

    const after = apply(state, asEvent(took!));
    expect(after.entities[0]?.satchel).toEqual({ kind: HEART_KIND });
    // The shoved-out smoke lies where the heart lay.
    expect(after.items.some((i) => i.kind === 'still smoke')).toBe(true);
    // Sealed: not a tool, and no provision may displace it.
    expect(useCarried(after, 'player')).toBeNull();
    const provisioned = {
      ...after,
      items: [...after.items, { id: 'p2', kind: 'vital draught', pos: { x: 0, y: 0 }, grants: { hp: 0, might: 0, wits: 0, speed: 0 } }],
    };
    expect(takeUnderfoot(provisioned, 'player')).toBeNull();
  });
});

describe('the world stirs against the carrier', () => {
  it('raises your echoes from the bodies, once, wearing your whole strength', () => {
    const p = bottomCorridor({ satchel: { kind: HEART_KIND }, bodies: [{ x: 6, y: 0 }] });
    const state = fold(p.log, p.head);
    const stirred = stirWorld(state, 'player');
    expect(stirred).not.toBeNull();
    const echoes = stirred!.payload.opponents.filter((o) => o.kind === 'echo');
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.pos).toEqual({ x: 6, y: 0 });
    expect(echoes[0]!.stats.hp).toBe(state.entities[0]!.maxHp);

    // Once: with an echo already standing, later stirs raise no more of
    // them — whatever else the far dark sends.
    const after = apply(state, asEvent(stirred!));
    const again = stirWorld(after, 'player');
    if (again !== null) {
      expect(again.payload.opponents.filter((o) => o.kind === 'echo')).toHaveLength(0);
    }
  });

  it('never raises anything within reach — arrivals are chases, not ambushes', () => {
    const p = bottomCorridor({ satchel: { kind: HEART_KIND } });
    const state = fold(p.log, p.head);
    // 12 tiles, carrier at 0: nothing lies 8+ away that is passable and
    // un-stood except the far tiles; any riser must be at least 8 out.
    const stirred = stirWorld(state, 'player');
    if (stirred !== null) {
      for (const o of stirred.payload.opponents) {
        expect(Math.abs(o.pos.x - 0) + Math.abs(o.pos.y - 0)).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

describe('a run can actually win', () => {
  it('the rusher walks in, takes the heart, walks out — won', () => {
    const done = autoplay(bottomCorridor(), rusher, 60);
    expect(done.ended).toBe('won');
    expect(heartHeld(done.state)).toBe(true);
  });
});
