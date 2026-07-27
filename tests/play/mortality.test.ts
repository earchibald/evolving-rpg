import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { emptyRefs, createRef, getRef, listRefs } from '../../src/log/refs.js';
import { buryIfDead, beginAgain, isGrave, playerStep, playerWait, runWorldTurns } from '../../src/play/session.js';
import { outcome } from '../../src/core/commands.js';
import { FLOOR } from '../../src/core/grid.js';
import type { EventLog } from '../../src/log/chain.js';
import type { Refs } from '../../src/log/refs.js';
import type { GameEvent } from '../../src/core/events.js';

/**
 * A corridor with one very dangerous thing in it and a player who cannot
 * survive it. Purpose-built so death is certain rather than likely — a test
 * that dies most of the time is a test that fails some of the time.
 */
function doomed(playerHp = 1): { log: EventLog; refs: Refs } {
  const world: GameEvent = {
    id: 'w', parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 5, height: 1, tiles: new Array<number>(5).fill(FLOOR), seed: 11,
      items: [{
        id: 'keen-edge', kind: 'a keen edge',
        pos: { x: 1, y: 0 },
        grants: { hp: 0, might: 2, wits: 0, speed: 0 },
      }],
      player: {
        id: 'player', kind: 'you', pos: { x: 0, y: 0 },
        stats: { hp: playerHp, might: 3, wits: 3, speed: 0 }, tags: [],
      },
      opponents: [{
        id: 'thing-1', kind: 'thing', pos: { x: 3, y: 0 },
        // Speed 0 on the player and might 20 here: it hits on 10 + 0 - 20, i.e.
        // always, and one blow is more than enough.
        stats: { hp: 99, might: 20, wits: 1, speed: 9 }, tags: [],
      }],
    },
  };
  const seeded = append(emptyLog(), null, world);
  return {
    log: seeded.log,
    refs: createRef(emptyRefs(), 'main', seeded.event.id, 0, 'opening run'),
  };
}

/** Plays until the player dies, or gives up. `dawdle` takes a different route
 *  to the same end, which matters because an identical route is an identical
 *  history — same events, same ids, same death. */
function untilDead(start: { log: EventLog; refs: Refs }, dawdle = 0): { log: EventLog; refs: Refs } {
  let { log, refs } = start;

  for (let i = 0; i < dawdle; i += 1) {
    const head = getRef(refs, 'main').head;
    if (head === null) break;
    const after = runWorldTurns(playerWait({ log, head }, 'player').position, 'player');
    log = after.log;
    refs = { byName: new Map(refs.byName).set('main', { ...getRef(refs, 'main'), head: after.head }) };
  }

  for (let i = 0; i < 40; i += 1) {
    const head = getRef(refs, 'main').head;
    if (head === null) break;
    if (outcome(fold(log, head)) === 'dead') break;

    const acted = playerStep({ log, head }, 'player', 1, 0);
    const after = runWorldTurns(acted.position, 'player');
    log = after.log;
    refs = { byName: new Map(refs.byName).set('main', { ...getRef(refs, 'main'), head: after.head }) };
  }
  return { log, refs };
}

describe('dying', () => {
  const played = untilDead(doomed());
  const before = { events: played.log.events.size, head: getRef(played.refs, 'main').head };
  const buried = buryIfDead(played.log, played.refs, 'main');

  it('actually kills the player, so the rest of this is about something', () => {
    expect(outcome(fold(played.log, before.head))).toBe('dead');
  });

  it('keeps the branch you died on, under a name that looks like a grave', () => {
    expect(buried.grave).not.toBeNull();
    expect(isGrave(buried.grave ?? '')).toBe(true);
    expect(getRef(buried.refs, buried.grave ?? '').head).toBe(before.head);
  });

  it('leaves you lying where you fell, rather than rewinding out from under you', () => {
    // It used to rewind the instant you died, which made the most significant
    // thing that can happen the one thing you could never look at: a line of
    // text went by and the map was already a fresh run. The body stays until
    // you choose to begin again.
    const head = getRef(buried.refs, 'main').head;
    expect(head).toBe(before.head);
    expect(outcome(fold(played.log, head))).toBe('dead');
    expect(fold(played.log, head).entities[0]?.stats.hp).toBe(0);
  });

  it('does not dig a second grave for a death it has already buried', () => {
    // The ref now stays on the dead state, so this runs again on every render.
    const twice = buryIfDead(played.log, buried.refs, 'main');
    expect(twice.grave).toBe(buried.grave);
    expect(listRefs(twice.refs).filter((r) => isGrave(r.name))).toHaveLength(1);
  });

  it('sends the world back to the beginning when you ask it to', () => {
    const begun = beginAgain(played.log, buried.refs, 'main');
    const head = getRef(begun.refs, 'main').head;
    // Root, then the dead: rebirth is no longer a bare rewind — the grave
    // you just filled rides onto the fresh chain as a WORLD_BODIES fact.
    const events = chain(begun.log, head);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('WORLD_BODIES');
    expect(outcome(fold(begun.log, head))).toBe('playing');
  });

  it('leaves your body on the floor of the run that walks after you', () => {
    const grave = fold(played.log, getRef(buried.refs, buried.grave ?? '').head);
    const fell = grave.entities.find((e) => e.kind === 'you')!.pos;

    const begun = beginAgain(played.log, buried.refs, 'main');
    const reborn = fold(begun.log, getRef(begun.refs, 'main').head);
    expect(reborn.bodies).toEqual([{ x: fell.x, y: fell.y }]);
    // What standing there confers is deliberately undecided (BONES.md) —
    // the fact is on the chain so the Forge can be the one to decide.
  });

  it('deletes nothing — the log is exactly as long as it was', () => {
    expect(buried.refs).not.toBe(played.refs);
    expect(played.log.events.size).toBe(before.events);
  });

  it('leaves the corpse where it fell, still foldable', () => {
    const grave = fold(played.log, getRef(buried.refs, buried.grave ?? '').head);
    expect(outcome(grave)).toBe('dead');
    expect(grave.entities[0]?.stats.hp).toBe(0);
  });

  it('takes back what you were carrying, without taking anything away', () => {
    // The cost is paid by construction. Rewinding re-folds from the root, so
    // the edge is back on the floor and the only version of you that ever held
    // it is the one lying dead on the other branch. No inventory bookkeeping.
    const grave = fold(played.log, getRef(buried.refs, buried.grave ?? '').head);
    const begun = beginAgain(played.log, buried.refs, 'main');
    const living = fold(begun.log, getRef(begun.refs, 'main').head);

    expect(grave.entities[0]?.stats.might).toBe(5);
    expect(grave.items).toHaveLength(0);

    expect(living.entities[0]?.stats.might).toBe(3);
    expect(living.items).toHaveLength(1);
  });

  it('numbers each grave, so dying two different deaths leaves two of them', () => {
    // Begin again first: you cannot die a second time while still lying dead.
    // And die *differently* — see below for why that is not a detail.
    const restarted = beginAgain(played.log, buried.refs, 'main');
    const again = untilDead({ log: restarted.log, refs: restarted.refs }, 2);
    const second = buryIfDead(again.log, again.refs, 'main');

    const graves = listRefs(second.refs).filter((r) => isGrave(r.name));
    expect(graves).toHaveLength(2);
    expect(graves.map((g) => g.name).sort()).toEqual(['main†1', 'main†2']);
  });

  it('digs a second grave for the same path walked after a death, because the world is not the same', () => {
    // This used to converge: same keypresses, same content-addressed ids, same
    // head, one grave. The bodies ended that on purpose — a rebirth carries
    // WORLD_BODIES, so the second walk is a run through a haunted floor, a
    // genuinely different history however identical the fingers were. The
    // one-grave-per-death property lives on at the head level (see "does not
    // dig a second grave"), and the map still shows one body: fallenBodies
    // deduplicates the tile.
    const restarted = beginAgain(played.log, buried.refs, 'main');
    const same = untilDead({ log: restarted.log, refs: restarted.refs });
    const second = buryIfDead(same.log, same.refs, 'main');

    expect(second.grave).not.toBe(buried.grave);
    expect(listRefs(second.refs).filter((r) => isGrave(r.name))).toHaveLength(2);

    // Two deaths on one tile are still one body to stand on.
    const begun = beginAgain(same.log, second.refs, 'main');
    const reborn = fold(begun.log, getRef(begun.refs, 'main').head);
    expect(reborn.bodies).toHaveLength(1);
  });

  it('lets the rewound world walk the same path again without complaint', () => {
    // Convergent history: the reset world repeats moves whose ids already exist.
    // append is idempotent for exactly this, and this is the case that proves it
    // was worth making so. (The rebirth's own log, not the stale one — the
    // bodies event the ceremony appended has to be under the head it named.)
    const begun = beginAgain(played.log, buried.refs, 'main');
    const head = getRef(begun.refs, 'main').head;
    expect(head).not.toBeNull();
    expect(() => playerStep({ log: begun.log, head: head ?? '' }, 'player', 1, 0)).not.toThrow();
  });

  it('does nothing at all while you are alive', () => {
    const alive = doomed(10);
    const untouched = buryIfDead(alive.log, alive.refs, 'main');
    expect(untouched.grave).toBeNull();
    expect(untouched.refs).toBe(alive.refs);
  });
});
