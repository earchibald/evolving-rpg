import { assayLine, assayName } from '../assay/register.js';

/**
 * The world bible: a world's identity, decided whole at birth.
 *
 * GESTALT.md levels L1–L2. The bible constrains *flavor over the mechanical
 * skeleton* — tables and counted draws still decide every number, spawn and
 * layout, so covenant M1–M6 and replay are untouched by construction. What
 * the bible buys is cross-floor intent: names drawn from one lexicon, a
 * warden that is somebody before you meet it, promises a floor can keep.
 *
 * It lives on the chain as a WORLD_BIBLE event — recorded, content-addressed,
 * forked and replayed like everything else. A fork inherits its world's
 * identity; a wipe loses it; two worlds never share one.
 */

export interface Bible {
  /** What this world is, in 1–3 sentences. Constrains every later ask. */
  readonly anchor: string;
  /** Words the world speaks in — the naming palette. Lowercase, article-free. */
  readonly lexicon: readonly string[];
  /** Who the boss is: a name-shaped identity and one set-piece sentence. */
  readonly warden: { readonly name: string; readonly line: string };
  /** Foreshadowings the gamemaster and later floors may keep. */
  readonly promises: readonly string[];
  /** Tone words for the gamemaster's voice. */
  readonly register: readonly string[];
}

export interface RefusedBible {
  readonly refused: string;
}

export function isRefusedBible(b: Bible | RefusedBible): b is RefusedBible {
  return (b as RefusedBible).refused !== undefined;
}

const MAX_ANCHOR = 400;
// Grown from 24 when the namesmith arrived: composition reuses each word
// across ~30 names, and the research line is that a word visibly recurring
// more than two or three times reads as same-y. Forty gives ~1.5 uses each.
const MAX_LEXICON = 48;
const MAX_WORD = 18;
const MAX_PROMISES = 3;
const MAX_LINE = 160;
const MAX_REGISTER = 6;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null;

/**
 * Validates a model's offered bible into a Bible, or refuses it with a
 * reason. Hard-shelled on purpose: this is model output headed for the
 * permanent log, so everything is capped, everything prose faces the
 * register assay, and the whole palette is checked at once — no duplicate
 * words by construction, batch-checked articles, one voice across every
 * line. A refused bible costs a retry; a bad bible in the log costs the
 * world its identity forever.
 */
export function validateBible(raw: unknown): Bible | RefusedBible {
  if (!isRecord(raw)) return { refused: 'not an object' };

  const anchor = typeof raw['anchor'] === 'string' ? raw['anchor'].trim() : '';
  if (anchor === '') return { refused: 'no anchor — a world must say what it is' };
  if (anchor.length > MAX_ANCHOR) return { refused: `anchor runs past ${String(MAX_ANCHOR)} characters` };
  const anchorRead = assayLine(anchor);
  if (anchorRead.findings.length > 0) return { refused: `anchor breaks register: ${anchorRead.findings.join('; ')}` };

  const lexicon = strings(raw['lexicon']);
  if (lexicon === null || lexicon.length === 0) return { refused: 'no lexicon — the world has no words' };
  if (lexicon.length > MAX_LEXICON) return { refused: `lexicon exceeds ${String(MAX_LEXICON)} words` };
  const seen = new Set<string>();
  for (const word of lexicon) {
    const w = word.trim();
    if (w === '' || w.length > MAX_WORD) return { refused: `lexicon word "${w}" is empty or over ${String(MAX_WORD)} characters` };
    if (w !== w.toLowerCase()) return { refused: `lexicon word "${w}" is not lowercase` };
    if (/\s/u.test(w)) return { refused: `lexicon word "${w}" is more than one word` };
    if (['a', 'an', 'the'].includes(w)) return { refused: 'articles are not lexicon' };
    if (seen.has(w)) return { refused: `lexicon repeats "${w}"` };
    seen.add(w);
  }

  const warden = isRecord(raw['warden']) ? raw['warden'] : null;
  const wardenName = warden !== null && typeof warden['name'] === 'string' ? warden['name'].trim() : '';
  const wardenLine = warden !== null && typeof warden['line'] === 'string' ? warden['line'].trim() : '';
  if (wardenName === '' || wardenLine === '') return { refused: 'the warden has no identity' };
  const wardenRead = assayName(wardenName, []);
  if (!wardenRead.sound) return { refused: `the warden's name breaks the covenant: ${wardenRead.findings.join('; ')}` };
  if (wardenLine.length > MAX_LINE) return { refused: 'the warden\'s line runs long' };
  const wardenLineRead = assayLine(wardenLine);
  if (wardenLineRead.findings.length > 0) return { refused: `the warden's line breaks register: ${wardenLineRead.findings.join('; ')}` };

  const promises = strings(raw['promises']) ?? [];
  if (promises.length > MAX_PROMISES) return { refused: `more than ${String(MAX_PROMISES)} promises` };
  for (const p of promises) {
    if (p.trim() === '' || p.length > MAX_LINE) return { refused: 'a promise is empty or runs long' };
    const read = assayLine(p);
    if (read.findings.length > 0) return { refused: `a promise breaks register: ${read.findings.join('; ')}` };
  }

  const register = strings(raw['register']) ?? [];
  if (register.length > MAX_REGISTER) return { refused: `more than ${String(MAX_REGISTER)} register words` };

  return Object.freeze({
    anchor,
    lexicon: Object.freeze(lexicon.map((w) => w.trim())),
    warden: Object.freeze({ name: wardenName, line: wardenLine }),
    promises: Object.freeze(promises.map((p) => p.trim())),
    register: Object.freeze(register.map((r) => r.trim())),
  });
}
