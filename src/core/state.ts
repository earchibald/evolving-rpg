import { WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import type { Entity, Pos } from './entity.js';
import type { Item } from './item.js';
import type { Rule, MotifName } from '../canon/rule.js';
import type { Bible } from '../canon/bible.js';

/** `readonly` throughout, matching `Grid`'s convention, because `apply()` is
 *  required to be pure — the type should refuse in-place mutation rather than
 *  rely on every future reducer remembering not to. `readonly Entity[]` still
 *  permits `map`, `find` and spread; it removes only `push`, `splice` and
 *  index assignment. */
export interface GameState {
  readonly grid: Grid;
  readonly entities: readonly Entity[];
  readonly items: readonly Item[];
  readonly turn: number;
  readonly activeEntityId: string | null;
  readonly seed: number;
  readonly rngCounter: number;
  /** The R2 rules this world plays under, in ratification order. Derived
   *  entirely from RULE_RATIFIED events on this chain, which is what makes a
   *  fork's ruleset differ from its sibling's without anything copying it. */
  readonly rules: readonly Rule[];
  /** The player's experience, derived from kill history — never evented, so
   *  the log and the level cannot disagree. XP is the threat value of what
   *  the player has finished. */
  readonly xp: number;
  readonly level: number;
  /** How deep this floor lies. The first is 1. */
  readonly depth: number;
  /** The generator's plain-words account of this floor's shape — covenant L1.
   *  Empty for logs that predate the telling. */
  readonly story: string;
  /** The cut this floor was shaped to, recorded at birth (WORLD_INIT v7), or
   *  null on floors that never said — old floors do not retroactively acquire
   *  a shape, so `motifIs` is simply false there. */
  readonly motif: MotifName | null;
  /** Where this world's dead lie on this floor — the player's past falls,
   *  recorded by WORLD_BODIES when a run is born or descends. What standing
   *  there CONFERS is deliberately undecided (BONES.md); this makes it
   *  *expressible*, so the Forge can be the one to answer. */
  readonly bodies: readonly Pos[];
  /** The world's identity, decided whole at birth (GESTALT.md), or null for
   *  a world playing without one — every consumer degrades to on-demand. */
  readonly bible: Bible | null;
  /** Smoke in the air: until this turn, hunts path to `at` — where you stood
   *  when it rose — instead of to you. `unfooled` are the creatures that had
   *  you in their claws when it rose (adjacent then), recorded so replay and
   *  the brain can never disagree about who was fooled. Null air is clear. */
  readonly smoke: { readonly until: number; readonly at: Pos; readonly unfooled: readonly string[] } | null;
}

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);
const NO_ITEMS: readonly Item[] = Object.freeze([]);
const NO_RULES: readonly Rule[] = Object.freeze([]);
export const NO_BODIES: readonly Pos[] = Object.freeze([]);

/** What a fold starts from. A WORLD_INIT event replaces it wholesale.
 *  Frozen as well as typed readonly: every fold in the process shares this one
 *  object, so a reducer that mutated its accumulator in place would corrupt the
 *  baseline for every later replay and fail somewhere far from the cause. */
export const EMPTY_STATE: GameState = Object.freeze({
  grid: makeGrid(1, 1, [WALL]),
  entities: NO_ENTITIES,
  items: NO_ITEMS,
  turn: 0,
  activeEntityId: null,
  seed: 0,
  rngCounter: 0,
  rules: NO_RULES,
  xp: 0,
  level: 1,
  depth: 1,
  story: '',
  motif: null,
  bodies: NO_BODIES,
  bible: null,
  smoke: null,
});
