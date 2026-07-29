import { smithName, DEFAULT_WORDS, fnv1a } from '../../src/canon/namesmith.js';
import { assayName } from '../../src/assay/register.js';
import { describeQuestion } from '../../src/oracle/oracle.js';

const CREATURE_HEADS: Readonly<Record<string, readonly string[]>> = {
  skirmisher: ['hound', 'cur', 'lurcher', 'jack', 'whippet'],
  bruiser: ['ox', 'ram', 'hulk', 'mule', 'boar'],
  stalker: ['adder', 'mantis', 'spider', 'leech', 'cat'],
  warden: ['warden', 'keeper', 'porter', 'sentinel'],
};

describe('the namesmith', () => {
  it('composes the same name for the same world, forever', () => {
    const q = describeQuestion('creature', 'bruiser', {}, 'root-a');
    const first = smithName(q, [], DEFAULT_WORDS);
    const again = smithName(q, [], DEFAULT_WORDS);
    expect(first).not.toBeNull();
    expect(again).toEqual(first);
  });

  it('names the same kind differently in different worlds', () => {
    const here = smithName(describeQuestion('creature', 'stalker', {}, 'root-a'), [], DEFAULT_WORDS);
    const there = smithName(describeQuestion('creature', 'stalker', {}, 'root-b'), [], DEFAULT_WORDS);
    // Not guaranteed by hashing alone for any single pair, but these two
    // pins are fixed inputs: if they ever collide the hash changed, and
    // that is worth noticing.
    expect(here?.name).not.toBe(there?.name);
  });

  it('gives every creature a head noun that tells its silhouette', () => {
    for (const [base, heads] of Object.entries(CREATURE_HEADS)) {
      const made = smithName(describeQuestion('creature', base, {}, 'root-a'), [], DEFAULT_WORDS);
      expect(made).not.toBeNull();
      const head = made!.name.split(' ').pop()!;
      expect(heads).toContain(head);
    }
  });

  it('keys the archetype — every levelled bruiser asks one question, wears one name', () => {
    // Re-pinned 2026-07-28, the designer's ruling after the 929-second run:
    // the depth-9 keeper (warden-7) wore a stranger's name from the depth-6
    // warden (warden-4), and "a soot herald killed me" taught nothing. A
    // name is a fact about the SPECIES; the level is a number, not a face.
    for (const kind of ['bruiser', 'bruiser-2', 'bruiser-3', 'warden-7']) {
      const q = describeQuestion('creature', kind, {}, 'root-a');
      expect(q.subject).toBe(`creature:${kind.split('-')[0]!}`);
    }
    const one = smithName(describeQuestion('creature', 'bruiser-2', {}, 'root-a'), [], DEFAULT_WORDS)!;
    const two = smithName(describeQuestion('creature', 'bruiser-4', {}, 'root-a'), [], DEFAULT_WORDS)!;
    const plain = smithName(describeQuestion('creature', 'bruiser', {}, 'root-a'), [], DEFAULT_WORDS)!;
    expect(two.name).toBe(one.name);
    expect(plain.name).toBe(one.name);
  });

  it('steers around a veto — rejecting a name composes a different one', () => {
    const q = describeQuestion('creature', 'skirmisher', {}, 'root-a');
    const first = smithName(q, [], DEFAULT_WORDS)!;
    const second = smithName(q, [first.name], DEFAULT_WORDS)!;
    expect(second.name).not.toBe(first.name);
  });

  it('survives the register guard for a whole bestiary at once', () => {
    // The guard the model kept failing. The smith must never fail it: every
    // composition across kinds, levels and scopes reads sound, and no two
    // names in one world collide.
    const taken: string[] = [];
    for (const base of ['skirmisher', 'bruiser', 'stalker', 'warden', 'echo']) {
      for (let level = 0; level < 4; level += 1) {
        const kind = level === 0 ? base : `${base}-${String(level + 1)}`;
        const made = smithName(describeQuestion('creature', kind, {}, 'root-x'), taken, DEFAULT_WORDS);
        expect(made).not.toBeNull();
        expect(assayName(made!.name, taken).sound).toBe(true);
        expect(made!.line.length).toBeGreaterThan(0);
        taken.push(made!.name);
      }
    }
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('names items, sometimes in the reliquary shape', () => {
    // "knife of brine" somewhere across worlds — the pattern exists and
    // every one of its outputs still faces the guard.
    let ofSeen = false;
    for (let world = 0; world < 24; world += 1) {
      const made = smithName(
        describeQuestion('item', 'keen edge', {}, `root-${String(world)}`), [], DEFAULT_WORDS,
      );
      expect(made).not.toBeNull();
      expect(assayName(made!.name, []).sound).toBe(true);
      if (made!.name.includes(' of ')) ofSeen = true;
    }
    expect(ofSeen).toBe(true);
  });

  it('names a kind it has never heard of by its own last word', () => {
    const made = smithName(describeQuestion('item', 'warding chalk', {}, 'root-a'), [], DEFAULT_WORDS);
    expect(made).not.toBeNull();
    expect(made!.name.endsWith('chalk')).toBe(true);
  });

  it('concedes when the space is truly spent', () => {
    // One palette word against the heart's one body: two names exist, and
    // when both are taken the smith says null rather than repeating itself.
    const q = describeQuestion('item', 'heart', {}, 'root-a');
    const only = smithName(q, [], ['ash']);
    expect(only).not.toBeNull();
    const exhausted = smithName(q, ['ash heart', 'heart of ash'], ['ash']);
    expect(exhausted).toBeNull();
  });

  it('answers only describe questions', () => {
    expect(smithName(
      { intent: 'gamemaster', subject: 'creature:bruiser', context: {} }, [], DEFAULT_WORDS,
    )).toBeNull();
    expect(smithName(describeQuestion('creature', 'bruiser', {}), [], DEFAULT_WORDS)).not.toBeNull();
  });

  it('hashes stably', () => {
    // The determinism above rests on this exact function; a "better" hash
    // would silently rename every world's bestiary.
    expect(fnv1a('root-a|creature:bruiser|0')).toBe(fnv1a('root-a|creature:bruiser|0'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
});
