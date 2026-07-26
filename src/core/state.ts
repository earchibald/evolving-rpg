import { WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import type { Entity } from './entity.js';
import type { Item } from './item.js';
import type { Rule } from '../canon/rule.js';
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
  /** The world's identity, decided whole at birth (GESTALT.md), or null for
   *  a world playing without one — every consumer degrades to on-demand. */
  readonly bible: Bible | null;
}

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);
const NO_ITEMS: readonly Item[] = Object.freeze([]);
const NO_RULES: readonly Rule[] = Object.freeze([]);

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
  bible: null,
});
