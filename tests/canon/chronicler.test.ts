import { storyOf, epitaphOf, notable, validateRemembrance, mentionables, remember, rememberedOn } from '../../src/canon/chronicler.js';
import { assayLine } from '../../src/assay/register.js';
import { Oracle } from '../../src/oracle/oracle.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { GameEvent } from '../../src/core/events.js';
import type { GameState } from '../../src/core/state.js';
import type { RunStory } from '../../src/canon/chronicler.js';

/**
 * The Chronicler: the one place the model is asked to do what code cannot —
 * read a finished chain as a story. Everything AROUND the model stays code
 * and stays tested: the facts, the floor epitaph, the notability tier, the
 * gate the text must pass.
 */

const seed = { parent: null, schemaVersion: 1, rngCounter: 0, rngDraws: 0 };

const ev = (id: string, seq: number, type: string, payload: unknown): GameEvent =>
  ({ ...seed, id, seq, type, payload } as unknown as GameEvent);

function runEvents(): GameEvent[] {
  return [
    ev('e0', 0, 'WORLD_INIT', {
      opponents: [
        { id: 'foe-1', kind: 'bruiser', pos: { x: 1, y: 1 }, stats: { hp: 5, might: 4, wits: 1, speed: 1 }, tags: [] },
        { id: 'foe-2', kind: 'stinger', pos: { x: 3, y: 3 }, stats: { hp: 3, might: 2, wits: 2, speed: 3 }, tags: [] },
      ],
    }),
    ev('e1', 1, 'STRIKE', { attackerId: 'player', targetId: 'foe-1', hit: true, damage: 5, roll: 15, needed: 10, crit: false }),
    ev('e2', 2, 'ITEM_USED', { entityId: 'player', kind: 'vital draught', effect: { kind: 'draught', healedTo: 12, ceilingTo: 12 } }),
    ev('e3', 3, 'STRIKE', { attackerId: 'foe-2', targetId: 'player', hit: true, damage: 3, roll: 14, needed: 9, crit: false }),
    ev('e4', 4, 'STRIKE', { attackerId: 'foe-2', targetId: 'player', hit: true, damage: 9, roll: 18, needed: 9, crit: false }),
  ];
}

function endedState(): GameState {
  return {
    ...EMPTY_STATE,
    turn: 41,
    depth: 4,
    level: 3,
    entities: [{
      id: 'player', kind: 'you', pos: { x: 2, y: 2 },
      stats: { hp: 0, might: 3, wits: 3, speed: 4 }, tags: [], maxHp: 12,
      gear: { weapon: { kind: 'keen edge', grants: { hp: 0, might: 2, wits: 0, speed: 0 } } },
    }],
  };
}

const CALLED = {
  creature: (kind: string): string => (kind === 'bruiser' ? 'carp ram' : 'brine wasp'),
  item: (kind: string): string => (kind === 'keen edge' ? 'silt knife' : 'wedge draught'),
};

const story = (): RunStory => storyOf(runEvents(), endedState(), 'main', 'fallen', 3, CALLED);

describe('the story the chronicler is told', () => {
  it('carries the run\'s own facts, in the world\'s own names', () => {
    const s = story();
    expect(s.facts[0]).toBe('this was the third life of this world');
    expect(s.facts).toContain('slain, in order: carp ram');
    expect(s.facts).toContain('the killing blow came from brine wasp');
    expect(s.facts).toContain('worn at the end: silt knife');
    expect(s.facts).toContain('wedge draught was spent');
    expect(s.facts.some((f) => f.includes('41 turns') && f.includes('floor 4'))).toBe(true);
    expect(s.killer).toBe('brine wasp');
    expect(s.killerKind).toBe('stinger');
    expect(s.slain).toEqual(['carp ram']);
  });

  it('names the worst blow, because the reader felt it', () => {
    expect(story().facts).toContain('the worst single blow taken dealt 9');
  });
});

describe('the epitaph — the floor no grave falls below', () => {
  it('is laconic, factual and register-sound', () => {
    const cut = epitaphOf(story());
    expect(cut).toBe('the third life of this world ended on floor 4, turn 41 under the brine wasp\'s blow.');
    expect(assayLine(cut).sound).toBe(true);
  });

  it('stands even when nothing struck the blow', () => {
    const s = { ...story(), killer: null };
    expect(epitaphOf(s)).toBe('the third life of this world ended on floor 4, turn 41.');
  });

  it('inscribes a win as a win', () => {
    const s: RunStory = { ...story(), occasion: 'won', life: 9, turns: 412 };
    expect(epitaphOf(s)).toContain('carried the heart out on turn 412');
    expect(assayLine(epitaphOf(s)).sound).toBe(true);
  });
});

describe('what earns the fuller telling', () => {
  const base = story;

  it('every win, the first life, and every new depth', () => {
    expect(notable({ ...base(), occasion: 'won' }, 9)).toBe(true);
    expect(notable({ ...base(), life: 1 }, 9)).toBe(true);
    expect(notable(base(), 3)).toBe(true); // depth 4 beats the prior 3
  });

  it('warden kills and the deep floors', () => {
    expect(notable({ ...base(), killerKind: 'warden-2' }, 9)).toBe(true);
    expect(notable({ ...base(), depth: 7 }, 9)).toBe(true);
  });

  it('but a routine death keeps the one-line stone', () => {
    expect(notable({ ...base(), depth: 2 }, 5)).toBe(false);
  });
});

describe('the gate the model\'s words must pass', () => {
  const opts = { mustMention: ['brine wasp', 'floor 4'], priorOpenings: [] };
  const sound = 'The one who reached floor 4 fell to the brine wasp, still holding the silt knife. Forty-one turns, and the stone says so.';

  it('admits words that hold the run\'s facts', () => {
    expect(validateRemembrance(sound, opts)).toEqual({ text: sound });
  });

  it('refuses the too-short, the too-long and the shouted', () => {
    expect('refused' in validateRemembrance('brief.', opts)).toBe(true);
    expect('refused' in validateRemembrance(`${'long words '.repeat(60)}`, opts)).toBe(true);
    expect('refused' in validateRemembrance('The one who fell on floor 4 to the brine wasp did so loudly!', opts)).toBe(true);
  });

  it('refuses generic grief — the slop list', () => {
    const slop = 'A testament to the one who reached floor 4 and fell to the brine wasp there.';
    expect(validateRemembrance(slop, opts)).toEqual({ refused: 'slop: "testament"' });
  });

  it('refuses words that name none of the run\'s own facts', () => {
    const generic = 'The one who walked far and fought well is gone, and the halls are quieter for it.';
    expect('refused' in validateRemembrance(generic, opts)).toBe(true);
  });

  it('refuses a stone that opens like an earlier one', () => {
    const prior = ['The one who reached'];
    expect('refused' in validateRemembrance(sound, { ...opts, priorOpenings: prior })).toBe(true);
    expect('refused' in validateRemembrance(sound, { ...opts, priorOpenings: ['A different opening here'] })).toBe(false);
  });

  it('draws its required tokens from the story itself', () => {
    expect(mentionables(story())).toEqual(['brine wasp', 'floor 4', 'carp ram']);
  });
});

describe('asking, and reading back', () => {
  it('hands the model facts and forbidden openings, and gates the answer', async () => {
    const asked: Array<Record<string, unknown>> = [];
    const oracle = new Oracle({
      transport: {
        name: 'capturing',
        ask(q: { context?: Record<string, unknown> }) {
          asked.push(q.context ?? {});
          return Promise.resolve({
            name: 'the third stone',
            line: 'The third life ended on floor 4 under the brine wasp. It had spent the wedge draught two turns too early.',
            model: null, costUsd: 0,
          });
        },
      },
    });

    const got = await remember(oracle, story(), ['Some prior opening here']);
    expect('text' in got).toBe(true);
    expect(asked[0]?.facts).toContain('the killing blow came from brine wasp');
    expect(asked[0]?.avoidOpenings).toEqual(['Some prior opening here']);
  });

  it('turns a broken transport into a quiet refusal', async () => {
    const oracle = new Oracle({ transport: null });
    const got = await remember(oracle, story());
    expect('refused' in got).toBe(true);
  });

  it('reads the newest remembrance off a chain', () => {
    expect(rememberedOn(runEvents())).toBeNull();
    const inscribed = [
      ...runEvents(),
      ev('e5', 5, 'WORLD_REMEMBERED', { text: 'first words.', occasion: 'fallen' }),
      ev('e6', 6, 'WORLD_REMEMBERED', { text: 'fuller words, laid later.', occasion: 'fallen' }),
    ];
    expect(rememberedOn(inscribed)).toEqual({ text: 'fuller words, laid later.', occasion: 'fallen' });
  });
});
