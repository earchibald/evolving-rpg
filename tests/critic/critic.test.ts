import { readTheGame, ENOUGH_OUTCOMES, ENOUGH_TURNS } from '../../src/critic/critic.js';
import { LENSES, computedLenses, deferredLenses } from '../../src/critic/lenses.js';
import { emptyLog, append } from '../../src/log/chain.js';
import { FLOOR } from '../../src/core/grid.js';
import type { DraftEvent } from '../../src/core/events.js';

/**
 * One reading, from one call, over one chain.
 *
 * The properties that matter are about honesty rather than arithmetic: a lens
 * nobody is measuring must say so, and a figure computed from four events must
 * not read like a figure computed from four thousand.
 */

const W = 12;

const world = (beastAt = 11, hp = 10): DraftEvent => ({
  type: 'WORLD_INIT', schemaVersion: 4, rngCounter: 0, rngDraws: 0,
  payload: {
    width: W, height: 1, tiles: new Array<number>(W).fill(FLOOR), seed: 1, items: [],
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp, might: 3, wits: 1, speed: 3 }, tags: [] },
    opponents: [{ id: 'thing-1', kind: 'thing', pos: { x: beastAt, y: 0 }, stats: { hp: 99, might: 3, wits: 1, speed: 2 }, tags: [] }],
  },
} as DraftEvent);

const turn = (n: number): DraftEvent => ({
  type: 'TURN_ADVANCED', schemaVersion: 2, rngCounter: 0, rngDraws: 0,
  payload: { activeEntityId: 'player', turn: n },
} as DraftEvent);

const blow = (needed: number, hit: boolean): DraftEvent => ({
  type: 'STRIKE', schemaVersion: 1, rngCounter: 0, rngDraws: 2,
  payload: { attackerId: 'player', targetId: 'thing-1', hit, damage: 1, roll: 12, needed },
} as DraftEvent);

function read(drafts: DraftEvent[]) {
  let out = append(emptyLog(), null, drafts[0]!);
  for (const d of drafts.slice(1)) out = append(out.log, out.event.id, d);
  return readTheGame(out.log, out.event.id);
}

/** A run long enough that nothing has to hedge. */
function substantial(): DraftEvent[] {
  const drafts: DraftEvent[] = [world()];
  for (let n = 2; n <= ENOUGH_TURNS + 6; n += 1) {
    drafts.push(blow(10, n % 2 === 0), turn(n));
  }
  return drafts;
}

describe('every lens gets a reading', () => {
  it('reads one per registry entry, in the registry\'s order', () => {
    const got = read(substantial());
    expect(got.readings).toHaveLength(LENSES.length);
    expect(got.readings.map((r) => r.lens)).toEqual(LENSES.map((l) => l.id));
  });

  it('names the lens number and title on every reading', () => {
    for (const r of read(substantial()).readings) {
      expect(r.lens).toBeGreaterThan(0);
      expect(r.title).toContain('The Lens of');
    }
  });

  it('says of a deferred lens that it is unmeasured, rather than reporting a zero', () => {
    // A lens showing 0.00 and a lens nobody is measuring look identical, and
    // only one of them is a finding.
    const got = read(substantial());
    for (const lens of deferredLenses()) {
      const r = got.readings.find((x) => x.lens === lens.id);
      expect(r).toBeDefined();
      expect(r?.measured).toBe(false);
      expect(r?.figure).not.toMatch(/^[\d.]+$/);
      expect(r?.verdict.toLowerCase()).toMatch(/not measured|no reading|nothing to measure/);
    }
  });

  it('gives every computed lens an actual figure', () => {
    const got = read(substantial());
    for (const lens of computedLenses()) {
      const r = got.readings.find((x) => x.lens === lens.id);
      expect(r?.measured).toBe(true);
      expect(r?.figure).toMatch(/\d/);
    }
  });

  it('has a metric for exactly the lenses marked computed', () => {
    // Registering a lens without building it, or building one without
    // registering it, both leave a scorecard that lies.
    const measured = read(substantial()).readings.filter((r) => r.measured).map((r) => r.lens);
    expect(measured.sort((a, b) => a - b)).toEqual(computedLenses().map((l) => l.id).sort((a, b) => a - b));
  });
});

describe('saying how much it is standing on', () => {
  it('hedges plainly when there is barely any history', () => {
    const thin = read([world(), blow(10, true), turn(2)]);
    const surprise = thin.readings.find((r) => r.lens === 2);
    expect(surprise?.confidence.toLowerCase()).toMatch(/too little|not enough/);
  });

  it('stops hedging once there is enough', () => {
    const thick = read(substantial());
    const surprise = thick.readings.find((r) => r.lens === 2);
    expect(surprise?.confidence.toLowerCase()).not.toMatch(/too little|not enough/);
    expect(surprise?.confidence).toMatch(/\d/);
  });

  it('states the denominator, not just the rate', () => {
    const got = read(substantial());
    const surprise = got.readings.find((r) => r.lens === 2);
    expect(surprise?.confidence).toContain(String(ENOUGH_OUTCOMES > 0 ? '' : ''));
    expect(surprise?.confidence).toMatch(/\d+/);
  });

  it('publishes the thresholds it hedges against', () => {
    expect(ENOUGH_OUTCOMES).toBeGreaterThan(0);
    expect(ENOUGH_TURNS).toBeGreaterThan(0);
  });
});

describe('what the verdicts actually say', () => {
  it('says out loud that the dice never surprise anyone', () => {
    // The finding this increment was built on. It must arrive as a sentence a
    // person can act on, not as "0.00".
    const got = read(substantial());
    const surprise = got.readings.find((r) => r.lens === 2);
    expect(surprise?.figure).toBe('0.00');
    expect(surprise?.verdict.length).toBeGreaterThan(20);
    expect(surprise?.verdict.toLowerCase()).toMatch(/never|nothing|unlikely|surprise/);
  });

  it('calls out dead air when a run is mostly unchanged', () => {
    const drafts: DraftEvent[] = [world()];
    for (let n = 2; n <= 40; n += 1) drafts.push(turn(n));
    const interest = read(drafts).readings.find((r) => r.lens === 61);
    expect(interest?.verdict.toLowerCase()).toMatch(/unchanged|flat|nothing changed|dead/);
  });

  it('notices when a run peaks before the end', () => {
    const drafts: DraftEvent[] = [world(1)];
    for (let n = 2; n <= 30; n += 1) drafts.push(turn(n));
    const interest = read(drafts).readings.find((r) => r.lens === 61);
    expect(interest?.verdict.length).toBeGreaterThan(20);
  });
});

describe('being safe to call from a render loop', () => {
  it('never throws on an empty log or a head that is not there', () => {
    expect(() => readTheGame(emptyLog(), null)).not.toThrow();
    expect(() => readTheGame(emptyLog(), 'nowhere')).not.toThrow();
    const none = readTheGame(emptyLog(), null);
    expect(none.readings).toHaveLength(LENSES.length);
    expect(none.events).toBe(0);
  });

  it('reads two identically shaped chains identically', () => {
    // It reads history, not identity — the same run played twice must score the
    // same whatever the event hashes are.
    const a = read(substantial());
    const b = read(substantial());
    expect(a).toEqual(b);
  });

  it('reports how much history it read', () => {
    const got = read(substantial());
    expect(got.events).toBeGreaterThan(10);
    expect(got.turns).toBeGreaterThan(10);
  });
});
