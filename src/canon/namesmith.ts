import { assayName } from '../assay/register.js';
import type { Question } from '../oracle/types.js';

/**
 * The namesmith: names from code, not from a model.
 *
 * The model was picking names one slow, paid call at a time, and the names
 * were not better than composition — the world's identity lives in its
 * PALETTE (the bible's lexicon, one model call at founding), not in which
 * of the palette's words got glued together. So the gluing is code:
 * deterministic, instant, free, and validated by the same register guard
 * that gated the model.
 *
 * The split of labor is deliberate:
 * - the WORLD supplies the modifier words (its lexicon; a drowned mine says
 *   brine and chain, a frost archive says rime and vellum),
 * - the CODE supplies the head noun by what the thing IS (a lunger reads as
 *   a fast animal, a blade as a blade) — so every name ends in a concrete
 *   word a player can point at, and the register's mood-word rule holds by
 *   construction rather than by retry.
 *
 * Determinism: the same world, kind and history of refusals always compose
 * the same name — a reload cannot rename the bestiary. The hash walks a
 * salt when a name collides or is refused, so the veto still works: reject
 * a name and the next composition is genuinely different.
 */

/** Words the unfounded world speaks in — the improviser's palette, same
 *  register the founded worlds are prompted toward. */
export const DEFAULT_WORDS: readonly string[] = Object.freeze([
  'ash', 'iron', 'bone', 'rust', 'salt', 'lead', 'tallow', 'chalk',
  'shale', 'moth', 'wire', 'tar', 'brine', 'soot', 'grey', 'pale',
  'thin', 'cracked', 'sunken', 'crooked', 'marrow', 'cinder', 'felt', 'slate',
]);

/**
 * Head nouns by archetype — the silhouette under the name. Multiple options
 * so two levels of one archetype ("bruiser", "bruiser-2") can wear
 * different bodies, but every option tells the same mechanical truth.
 */
const CREATURE_BODIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  skirmisher: Object.freeze(['hound', 'cur', 'lurcher', 'jack', 'whippet']),
  bruiser: Object.freeze(['ox', 'ram', 'hulk', 'mule', 'boar']),
  stalker: Object.freeze(['adder', 'mantis', 'spider', 'leech', 'cat']),
  warden: Object.freeze(['warden', 'keeper', 'porter', 'sentinel']),
  echo: Object.freeze(['echo', 'shade', 'double']),
});

/** Head nouns by item kind. Unknown kinds fall back to their own last word,
 *  so a relic added to the armory tomorrow names itself without touching
 *  this table. */
const ITEM_BODIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'keen edge': Object.freeze(['knife', 'edge', 'blade', 'cleaver', 'hook']),
  'iron charm': Object.freeze(['charm', 'plate', 'links', 'collar', 'band']),
  'fleet boots': Object.freeze(['boots', 'treads', 'soles', 'shoes']),
  'grey lens': Object.freeze(['lens', 'glass', 'eye', 'prism']),
  'vital draught': Object.freeze(['draught', 'phial', 'flask', 'vial']),
  'still smoke': Object.freeze(['smoke', 'censer', 'pot', 'ember']),
  heart: Object.freeze(['heart']),
});

/** One spoken line per shape of thing — the tell, in words. The name carries
 *  the world's flavor; the line carries the mechanical truth, which is why
 *  these are fixed pools rather than palette compositions: a line that
 *  mis-teaches the verb would be worse than a plain one. */
const CREATURE_LINES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  skirmisher: Object.freeze([
    'It comes low and fast, and the last two steps are one.',
    'It circles just past reach, waiting for you to look away.',
    'The distance between you is smaller than it looks.',
  ]),
  bruiser: Object.freeze([
    'Its blows land like a door slamming, and it walks through what falls.',
    'It does not go around things. It goes through them.',
    'Heavy, slow, and entirely unbothered by either.',
  ]),
  stalker: Object.freeze([
    'It holds so still you could mistake it for furniture. Do not.',
    'It has been watching you since before you saw it.',
    'The first blow is the one it has been saving.',
  ]),
  warden: Object.freeze([
    'It stands where it stands. The door is its whole argument.',
    'It has held this post longer than you have been alive.',
    'It does not chase. It waits for you to come back.',
  ]),
  echo: Object.freeze([
    'It walks the way you walk. That is the worst part.',
    'It remembers being you, and it is not sentimental about it.',
  ]),
});

const ITEM_LINES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'keen edge': Object.freeze([
    'The edge catches before you feel it swing.',
    'It is thin enough to whisper through what it meets.',
  ]),
  'iron charm': Object.freeze([
    'It sits heavy at the throat and turns aside what should have landed.',
    'Cold against the skin, and the skin is glad of it.',
  ]),
  'fleet boots': Object.freeze([
    'The floor seems shorter with them on.',
    'They land where you meant to step, a moment early.',
  ]),
  'grey lens': Object.freeze([
    'Through it, the room admits what it was hiding.',
    'It shows the gap between where a thing is and where it will be.',
  ]),
  'vital draught': Object.freeze([
    'It is warm through the glass, and heavier than it should be.',
    'What it fills, it leaves fuller than before.',
  ]),
  'still smoke': Object.freeze([
    'Break it, and the world remembers you standing somewhere else.',
    'The hunt follows the shape you left in the air.',
  ]),
  heart: Object.freeze([
    'It beats. The floor beats with it.',
  ]),
});

/** FNV-1a, 32-bit — stable, fast, and good enough to spread a few dozen
 *  names across a palette. Not cryptography; just a fair coin that always
 *  lands the same way for the same world. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The archetype under a levelled kind: "bruiser-2" is a bruiser. */
function baseOf(kind: string): string {
  return kind.includes('-') ? kind.slice(0, kind.indexOf('-')) : kind;
}

function bodiesFor(family: string, what: string): readonly string[] {
  if (family === 'creature') {
    return CREATURE_BODIES[baseOf(what)] ?? Object.freeze([baseOf(what)]);
  }
  const listed = ITEM_BODIES[what];
  if (listed !== undefined) return listed;
  const words = what.split(/\s+/u);
  return Object.freeze([words[words.length - 1] ?? what]);
}

function linesFor(family: string, what: string): readonly string[] {
  const pool = family === 'creature' ? CREATURE_LINES[baseOf(what)] : ITEM_LINES[what];
  return pool ?? Object.freeze(['']);
}

/** How many salted recompositions to try before conceding. Deep enough that
 *  a whole bestiary with a rejection history still finds room. */
const TRIES = 24;

/**
 * Composes a name and line for a describe question, or null when every
 * composition collides with what is already taken.
 *
 * `subject` arrives as "creature:bruiser-2" or "item:keen edge" (the
 * describeQuestion shape). Anything else is not the namesmith's to answer.
 */
export function smithName(
  question: Question,
  taken: readonly string[],
  palette: readonly string[],
): { name: string; line: string } | null {
  if (question.intent !== 'describe') return null;
  const split = question.subject.indexOf(':');
  if (split < 0) return null;
  const family = question.subject.slice(0, split);
  if (family !== 'creature' && family !== 'item') return null;
  const what = question.subject.slice(split + 1);

  const words = palette.length > 0 ? palette : DEFAULT_WORDS;
  const bodies = bodiesFor(family, what);
  const lines = linesFor(family, what);
  const spent = new Set(taken.filter((n) => n !== '').map((n) => n.toLowerCase()));
  const seed = `${question.scope ?? ''}|${question.subject}`;

  for (let salt = 0; salt < TRIES; salt += 1) {
    const h = fnv1a(`${seed}|${String(salt)}`);
    const body = bodies[h % bodies.length]!;
    const first = words[(h >>> 3) % words.length]!;
    const second = words[(h >>> 9) % words.length]!;
    // Creatures wear plain adjective+noun — common things sound common.
    // Items sometimes take the reliquary shape ("knife of brine"); its head
    // is a palette word, so the register guard gets the final say, and the
    // salt walks on when it refuses. Three words when the two-word space is
    // running out of room, which is what a climbing salt means.
    const name = ((): string => {
      if (family === 'item' && h % 3 === 0 && body !== first) return `${body} of ${first}`;
      if (salt < 8 || first === second) return `${first} ${body}`;
      return `${first} ${second} ${body}`;
    })();
    if (spent.has(name.toLowerCase())) continue;
    if (!assayName(name, taken).sound) continue;
    return { name, line: lines[h % lines.length]! };
  }
  return null;
}
