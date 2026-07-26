/**
 * The lenses this game is judged by.
 *
 * From Jesse Schell's *The Art of Game Design*, which is where the numbering
 * and the titles come from. The registry exists so the Critic can cite a real
 * lens — "#61, and here is the curve" — rather than asserting a vibe and
 * hoping it sounds like design.
 *
 * **What is deliberately not here: Schell's text.** Each entry carries the lens
 * number, its title, and *our* sentence about what this codebase computes for
 * it. Copying a hundred lenses and their question lists into the repository
 * would reproduce a substantial part of a copyrighted book; citing numbers and
 * titles is referencing one. A human wanting the actual lens should read it in
 * the book — `LENS_SOURCE` says where the copy lives.
 *
 * A deferred lens stays listed rather than being left out. A lens absent from
 * the scorecard and a lens that passed look identical on screen, and only one
 * of those is honest.
 */

/** Where the book is, for a person to consult. Never read at runtime. */
export const LENS_SOURCE = '~/Code/maze-solver/artOfGameDesign.md';

export interface Lens {
  readonly id: number;
  readonly title: string;
  /** What this codebase computes for it. Our words, not the book's. */
  readonly measures: string;
  readonly state: 'computed' | 'ensemble' | 'deferred';
  /** Why it is not measured yet. Empty for the ones that are. */
  readonly why: string;
}

export const LENSES: readonly Lens[] = Object.freeze([
  Object.freeze({
    id: 2,
    title: 'The Lens of Surprise',
    measures:
      'The share of recorded outcomes whose probability was under 0.15 — known exactly, '
      + 'since every blow records the die roll and the number it needed.',
    state: 'computed' as const,
    why: '',
  }),
  Object.freeze({
    id: 33,
    title: 'The Lens of Triangularity',
    measures:
      'How many archetypal approaches — the fighter, the runner, the coward — win '
      + 'often enough across harness runs to be genuinely worth taking.',
    state: 'ensemble' as const,
    why: '',
  }),
  Object.freeze({
    id: 61,
    title: 'The Lens of the Interest Curve',
    measures:
      'Tension turn by turn across a run — how hurt you are and how close the nearest '
      + 'living thing is — and the shape that makes: where it peaks, how flat it goes.',
    state: 'computed' as const,
    why: '',
  }),
  Object.freeze({
    id: 71,
    title: 'The Lens of Freedom',
    measures:
      'How many meaningfully different places the approaches lead, by clustering '
      + 'their observed outcome distributions — never by counting options off the map.',
    state: 'ensemble' as const,
    why: '',
  }),
]);

export function lensById(id: number): Lens | undefined {
  return LENSES.find((l) => l.id === id);
}

export function computedLenses(): readonly Lens[] {
  return LENSES.filter((l) => l.state === 'computed');
}

export function deferredLenses(): readonly Lens[] {
  return LENSES.filter((l) => l.state === 'deferred');
}

/** Measured across many runs by the balance harness, not per chain. */
export function ensembleLenses(): readonly Lens[] {
  return LENSES.filter((l) => l.state === 'ensemble');
}
