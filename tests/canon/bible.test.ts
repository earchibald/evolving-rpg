import { validateBible, isRefusedBible } from '../../src/canon/bible.js';
import { foundWorld, createWorld, outcome } from '../../src/core/commands.js';
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createRef, emptyRefs, getRef } from '../../src/log/refs.js';
import { playerStep, descend, beginAgain } from '../../src/play/session.js';
import { FLOOR, EXIT } from '../../src/core/grid.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import type { Position } from '../../src/play/session.js';
import type { Bible } from '../../src/canon/bible.js';

/**
 * The bible is model output headed for the permanent log, so the validator is
 * hard-shelled and these are its teeth. The carry tests are the rules
 * pattern's: identity crosses the stairs and survives rebirth, because the
 * floor changes and what the world is does not.
 */

const GOOD = {
  anchor: 'A mine the water took back. The galleries remember being worked.',
  lexicon: ['gristle', 'tallow', 'shale', 'rust', 'lantern', 'brine'],
  warden: { name: 'tally keeper', line: 'It counts what the mine still owes.' },
  promises: ['Something below is counting.', 'The water is not rising; you are descending.'],
  register: ['cold', 'patient', 'wet'],
};

describe('validateBible', () => {
  it('accepts a sound bible, trimmed and frozen', () => {
    const b = validateBible(GOOD);
    if (isRefusedBible(b)) throw new Error(b.refused);
    expect(b.anchor).toContain('mine');
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.lexicon)).toBe(true);
    expect(b.warden.name).toBe('tally keeper');
  });

  it.each([
    ['no anchor', { ...GOOD, anchor: '' }, /no anchor/u],
    ['a shouting anchor', { ...GOOD, anchor: 'THE MINE! It is AMAZING!' }, /register/u],
    ['no lexicon', { ...GOOD, lexicon: [] }, /no lexicon/u],
    ['an uppercase lexicon word', { ...GOOD, lexicon: ['Shale'] }, /lowercase/u],
    ['a two-word lexicon entry', { ...GOOD, lexicon: ['wet shale'] }, /more than one word/u],
    ['an article in the lexicon', { ...GOOD, lexicon: ['the'] }, /articles/u],
    ['a repeated lexicon word', { ...GOOD, lexicon: ['shale', 'shale'] }, /repeats/u],
    ['a warden with no identity', { ...GOOD, warden: { name: '', line: '' } }, /warden/u],
    ['a warden named with an article', { ...GOOD, warden: { name: 'the keeper', line: 'It waits.' } }, /covenant/u],
    ['four promises', { ...GOOD, promises: ['a.', 'b.', 'c.', 'd.'] }, /promises/u],
    ['a shouting promise', { ...GOOD, promises: ['IT COMES!!'] }, /register/u],
  ])('refuses %s', (_what, raw, why) => {
    const b = validateBible(raw);
    expect(isRefusedBible(b)).toBe(true);
    if (isRefusedBible(b)) expect(b.refused).toMatch(why);
  });

  it('refuses what is not an object at all', () => {
    for (const raw of [null, 7, 'a mine', ['x']]) {
      expect(isRefusedBible(validateBible(raw))).toBe(true);
    }
  });
});

const bible = ((): Bible => {
  const b = validateBible(GOOD);
  if (isRefusedBible(b)) throw new Error(b.refused);
  return b;
})();

/** A one-row corridor whose far end is the way out — escapable in a walk. */
function stairsWorld(): GameEvent {
  const tiles = new Array<number>(9).fill(FLOOR);
  tiles[8] = EXIT;
  return {
    id: 'w', parent: null, seq: 0,
    type: 'WORLD_INIT', schemaVersion: SCHEMA_VERSIONS.WORLD_INIT, rngCounter: 0, rngDraws: 0,
    payload: {
      width: 9, height: 1, tiles, seed: 3, items: [],
      player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      opponents: [],
    },
  } as GameEvent;
}

function founded(): Position {
  const born = append(emptyLog(), null, stairsWorld());
  const done = append(born.log, born.event.id, foundWorld(fold(born.log, born.event.id), bible));
  return { log: done.log, head: done.event.id };
}

describe('the bible on the chain', () => {
  it('folds into state, and the chain still verifies', () => {
    const p = founded();
    expect(fold(p.log, p.head).bible?.anchor).toBe(bible.anchor);
    expect(verifyChain(p.log, p.head)).toBeNull();
  });

  it('is null for a world never founded', () => {
    const born = append(emptyLog(), null, createWorld(5, 12, 8));
    expect(fold(born.log, born.event.id).bible).toBeNull();
  });

  it('crosses the stairs, like the rules do', () => {
    let p = founded();
    for (let i = 0; i < 10 && outcome(fold(p.log, p.head)) === 'playing'; i += 1) {
      p = playerStep(p, 'player', 1, 0).position;
    }
    expect(outcome(fold(p.log, p.head))).toBe('escaped');

    const refs = createRef(emptyRefs(), 'main', p.head, 0, 'opening');
    const down = descend(p.log, refs, 'main', { width: 12, height: 8 });
    expect(down).not.toBeNull();
    const head = getRef(down!.refs, 'main').head!;
    const below = fold(down!.log, head);
    expect(below.depth).toBe(2);
    expect(below.bible?.warden.name).toBe('tally keeper');
    expect(verifyChain(down!.log, head)).toBeNull();
  });

  it('survives beginning again, ahead of the law', () => {
    const p = founded();
    let refs = createRef(emptyRefs(), 'main', p.head, 0, 'opening');
    const again = beginAgain(p.log, refs, 'main');
    const head = getRef(again.refs, 'main').head!;
    expect(fold(again.log, head).bible?.anchor).toBe(bible.anchor);
    // Identity is re-appended right after the root, before any rules.
    const types = chain(again.log, head).map((e) => e.type);
    expect(types[0]).toBe('WORLD_INIT');
    expect(types[1]).toBe('WORLD_BIBLE');
  });
});
