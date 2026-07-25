# Increment 1: Core + Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A character you can walk around a seeded grid, where every action is an event in a hash-linked append-only log that replays byte-identical.

**Architecture:** Two modules with a hard boundary. `core/` holds pure game logic — grid, entities, turn order, a counter-addressable RNG, and `apply(state, event)`, which is the *only* way state ever changes. `log/` holds the event chain: canonical JSON, SHA-256 event identity, parent links, named refs for forking and reset, and `fold()` which derives state by reducing the chain. Randomness is resolved in a **command** layer and recorded in event payloads, so `apply()` never calls the RNG and replay is faithful by construction.

**Tech Stack:** TypeScript (strict), Vite, Vitest, `@noble/hashes` for SHA-256, `tsx` for scripts. Node 20+.

## Global Constraints

- `apply()` must be pure: no RNG, no clock, no network, no I/O. Copied from spec: *"State changes exactly one way: `apply(state, event) → state`."*
- `apply()` is total over **validated** events. "Validated" is a conjunction: the event's hash verifies, *and* its payload came from the command layer. Only the first half is checkable at fold time — `verifyChain` re-derives hashes; nothing can re-derive provenance, which rests on the command layer being the sole writer of payloads.
- A payload that is type-valid but internally inconsistent with the `Grid` it describes throws out of `makeGrid`. That covers **both** of its preconditions — a tile count disagreeing with the declared size, and a non-positive width or height — and is not an exhaustive list of blessed exceptions but a single rule: an inconsistent grid payload is a corrupted log, and a corrupted log must fail loudly rather than fold into a nonsense state. `fold` alone does not validate, so do not fold a log you have not verified.
- All randomness resolves at command time and is recorded in the event payload. Events carry `rngCounter` = the counter value **before** the event ran.
- Every event type carries a `schemaVersion`. Changing an existing type's meaning requires bumping it and writing an upcaster — never edit in place.
- No test may touch the network.
- Canonical JSON: object keys sorted, no whitespace, arrays keep order. Hashes are byte-equality dependent.
- Tie-breaks must be deterministic everywhere. Turn order breaks Speed ties by ascending `id`.
- Grid is square tiles, 4-direction movement. One tile per move in this increment.
- Four stats only: `hp`, `might`, `wits`, `speed`.
- **Anything shared by reference across snapshots must be immutable.** Copying a `Map` duplicates structure, not values, so every holder sees the same value objects. Flat records of primitives get `readonly` fields; nested data gets `Object.freeze`. This is not optional hardening — a mutation through a shared alias produces a different, plausible, *wrong* derived state with no error, which is the one failure mode this project cannot tolerate. It applies at minimum to `EMPTY_STATE`, sealed events, and `Ref` records. Written down only after the same defect was found three separate times in this plan.
- `core/` and `log/` are the never-regress modules; they carry the test weight.

---

### Task 1: Project skeleton and the seeded RNG

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `src/version.ts`, `src/core/rng.ts`
- Test: `tests/core/rng.test.ts`, `tests/log/hash-vector.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `u32(seed: number, counter: number): number`, `float01(seed: number, counter: number): number`, `intBetween(seed: number, counter: number, min: number, max: number): number`, `ENGINE_VERSION: string`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "evolving-rpg",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "golden": "tsx scripts/generate-golden.ts"
  },
  "dependencies": {
    "@noble/hashes": "1.4.0"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"],
    "noEmit": true
  },
  "include": ["src", "tests", "scripts", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `src/version.ts`**

```ts
/** Bumped by hand when engine behaviour changes. Recorded on every ref so a
 *  replay can be labelled faithful (same version) or reinterpreted (newer). */
export const ENGINE_VERSION = '0.1.0';
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 6: Write the hash test vector, to confirm the `@noble/hashes` import path**

This is checked first because the import path differs between major versions of
the library, and every later task depends on it. `sha256("abc")` has a published
value, so a wrong import fails loudly here instead of silently later.

Create `tests/log/hash-vector.test.ts`:

```ts
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

describe('sha256 library wiring', () => {
  it('matches the published test vector for "abc"', () => {
    const digest = bytesToHex(sha256(new TextEncoder().encode('abc')));
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

- [ ] **Step 7: Run it**

Run: `npx vitest run tests/log/hash-vector.test.ts`
Expected: PASS.

If it fails with a module-resolution error, the installed version exposes the
newer path. Change both imports to `@noble/hashes/sha2` (for `sha256`) and
`@noble/hashes/utils` (unchanged), rerun, and use that path everywhere below.

- [ ] **Step 8: Write the failing RNG test**

Create `tests/core/rng.test.ts`:

```ts
import { u32, float01, intBetween } from '../../src/core/rng.js';

describe('u32', () => {
  it('is deterministic for the same seed and counter', () => {
    expect(u32(42, 7)).toBe(u32(42, 7));
  });

  it('gives different values for adjacent counters', () => {
    expect(u32(42, 7)).not.toBe(u32(42, 8));
  });

  it('gives different values for different seeds at the same counter', () => {
    expect(u32(1, 0)).not.toBe(u32(2, 0));
  });

  it('stays inside unsigned 32-bit range', () => {
    for (let c = 0; c < 500; c++) {
      const v = u32(99, c);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('float01', () => {
  it('stays in [0, 1)', () => {
    for (let c = 0; c < 500; c++) {
      const v = float01(7, c);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('intBetween', () => {
  it('respects inclusive bounds', () => {
    for (let c = 0; c < 500; c++) {
      const v = intBetween(3, c, 5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('reaches every value in a small range', () => {
    const seen = new Set<number>();
    for (let c = 0; c < 2000; c++) seen.add(intBetween(11, c, 0, 9));
    expect(seen.size).toBe(10);
  });

  it('returns the only possible value when min equals max', () => {
    expect(intBetween(5, 0, 4, 4)).toBe(4);
  });

  it('throws when max is below min', () => {
    expect(() => intBetween(5, 0, 9, 2)).toThrow(/max/);
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run tests/core/rng.test.ts`
Expected: FAIL — cannot resolve `../../src/core/rng.js`.

- [ ] **Step 10: Implement `src/core/rng.ts`**

```ts
const GAMMA = 0x9e3779b9;

/**
 * splitmix32, addressed by counter rather than held as a stream. Any draw is
 * reproducible from (seed, counter) alone, which is what makes a recorded
 * counter enough to verify a replay.
 */
export function u32(seed: number, counter: number): number {
  let a = (seed + Math.imul(counter, GAMMA)) | 0;
  a = (a + GAMMA) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return t >>> 0;
}

export function float01(seed: number, counter: number): number {
  return u32(seed, counter) / 4294967296;
}

/**
 * Inclusive on both ends. Uses modulo, which is biased — at the span sizes this
 * game uses (under a few hundred against 2^32) the bias is around 1e-8 relative
 * and not worth the counter-accounting that rejection sampling would need.
 */
export function intBetween(seed: number, counter: number, min: number, max: number): number {
  if (max < min) throw new Error(`intBetween: max ${max} is below min ${min}`);
  const span = max - min + 1;
  return min + (u32(seed, counter) % span);
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: both test files PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts src/version.ts src/core/rng.ts tests/core/rng.test.ts tests/log/hash-vector.test.ts
git commit -m "feat: project skeleton and counter-addressable seeded RNG"
```

---

### Task 2: Grid and reachability

**Files:**
- Create: `src/core/grid.ts`, `src/core/reachability.ts`
- Test: `tests/core/grid.test.ts`, `tests/core/reachability.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `FLOOR: 0`, `WALL: 1`, `interface Grid { readonly width: number; readonly height: number; readonly tiles: readonly number[] }`, `makeGrid(width, height, tiles): Grid`, `idx(grid, x, y): number`, `inBounds(grid, x, y): boolean`, `tileAt(grid, x, y): number`, `isPassable(grid, x, y): boolean`, `reachableFrom(grid, x, y): Set<number>`, `floorCount(grid): number`.

Tiles are a plain `number[]`, not a typed array, because state gets serialised
to canonical JSON for hashing and a `Uint8Array` does not round-trip cleanly.

- [ ] **Step 1: Write the failing grid test**

Create `tests/core/grid.test.ts`:

```ts
import { FLOOR, WALL, makeGrid, idx, inBounds, tileAt, isPassable } from '../../src/core/grid.js';

const tiles = [
  FLOOR, FLOOR, WALL,
  FLOOR, WALL, FLOOR,
];
const grid = makeGrid(3, 2, tiles);

describe('makeGrid', () => {
  it('rejects a tile count that does not match the dimensions', () => {
    expect(() => makeGrid(3, 2, [FLOOR])).toThrow(/expected 6 tiles/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => makeGrid(0, 4, [])).toThrow(/bad size/);
  });

  it('copies the tiles so later mutation of the input cannot leak in', () => {
    const input = [FLOOR, FLOOR];
    const g = makeGrid(2, 1, input);
    input[0] = WALL;
    expect(tileAt(g, 0, 0)).toBe(FLOOR);
  });

  it('freezes what it returns, so a shared grid cannot be written through', () => {
    // readonly typing stops nothing at runtime; a cast or JSON-sourced data
    // writes straight through it. EMPTY_STATE.grid is shared by every fold.
    const g = makeGrid(2, 1, [FLOOR, FLOOR]);
    expect(Object.isFrozen(g)).toBe(true);
    expect(Object.isFrozen(g.tiles)).toBe(true);
  });
});

describe('idx', () => {
  it('maps coordinates row-major', () => {
    expect(idx(grid, 0, 0)).toBe(0);
    expect(idx(grid, 2, 0)).toBe(2);
    expect(idx(grid, 0, 1)).toBe(3);
    expect(idx(grid, 2, 1)).toBe(5);
  });
});

describe('inBounds', () => {
  it('accepts inside and rejects outside', () => {
    expect(inBounds(grid, 0, 0)).toBe(true);
    expect(inBounds(grid, 2, 1)).toBe(true);
    expect(inBounds(grid, -1, 0)).toBe(false);
    expect(inBounds(grid, 3, 0)).toBe(false);
    expect(inBounds(grid, 0, 2)).toBe(false);
  });
});

describe('tileAt', () => {
  it('reads the stored tile', () => {
    expect(tileAt(grid, 1, 0)).toBe(FLOOR);
    expect(tileAt(grid, 2, 0)).toBe(WALL);
  });

  it('treats everything outside the grid as solid', () => {
    expect(tileAt(grid, -1, 0)).toBe(WALL);
    expect(tileAt(grid, 99, 99)).toBe(WALL);
  });
});

describe('isPassable', () => {
  it('is true only for floor inside the grid', () => {
    expect(isPassable(grid, 0, 0)).toBe(true);
    expect(isPassable(grid, 1, 1)).toBe(false);
    expect(isPassable(grid, -1, -1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/grid.test.ts`
Expected: FAIL — cannot resolve `../../src/core/grid.js`.

- [ ] **Step 3: Implement `src/core/grid.ts`**

```ts
export const FLOOR = 0;
export const WALL = 1;

export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

export function makeGrid(width: number, height: number, tiles: readonly number[]): Grid {
  if (width <= 0 || height <= 0) throw new Error(`makeGrid: bad size ${width}x${height}`);
  if (tiles.length !== width * height) {
    throw new Error(`makeGrid: expected ${width * height} tiles, got ${tiles.length}`);
  }
  // Frozen as well as copied. EMPTY_STATE.grid is the one grid every fold in
  // the process shares as its baseline, and `readonly` alone stops nothing at
  // runtime — a cast, or JSON-sourced data, writes straight through it.
  return Object.freeze({ width, height, tiles: Object.freeze([...tiles]) });
}

export function idx(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** Outside the grid reads as solid, so callers never need a bounds check first. */
export function tileAt(grid: Grid, x: number, y: number): number {
  if (!inBounds(grid, x, y)) return WALL;
  return grid.tiles[idx(grid, x, y)] ?? WALL;
}

export function isPassable(grid: Grid, x: number, y: number): boolean {
  return tileAt(grid, x, y) === FLOOR;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/core/grid.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing reachability test**

Create `tests/core/reachability.test.ts`:

```ts
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import { reachableFrom, floorCount } from '../../src/core/reachability.js';

describe('reachableFrom', () => {
  it('finds the whole open grid', () => {
    const grid = makeGrid(3, 3, new Array(9).fill(FLOOR));
    expect(reachableFrom(grid, 1, 1).size).toBe(9);
  });

  it('does not cross a full wall, so a sealed room stays sealed', () => {
    // column x=1 is solid, splitting the grid in two
    const grid = makeGrid(3, 3, [
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
      FLOOR, WALL, FLOOR,
    ]);
    expect(reachableFrom(grid, 0, 0).size).toBe(3);
    expect(reachableFrom(grid, 2, 0).size).toBe(3);
  });

  it('does not move diagonally', () => {
    // (0,0) and (1,1) touch only at a corner
    const grid = makeGrid(2, 2, [
      FLOOR, WALL,
      WALL, FLOOR,
    ]);
    expect(reachableFrom(grid, 0, 0).size).toBe(1);
  });

  it('returns nothing when the start is not standable', () => {
    const grid = makeGrid(2, 1, [WALL, FLOOR]);
    expect(reachableFrom(grid, 0, 0).size).toBe(0);
  });
});

describe('floorCount', () => {
  it('counts only floor tiles', () => {
    const grid = makeGrid(2, 2, [FLOOR, WALL, FLOOR, FLOOR]);
    expect(floorCount(grid)).toBe(3);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/core/reachability.test.ts`
Expected: FAIL — cannot resolve `../../src/core/reachability.js`.

- [ ] **Step 7: Implement `src/core/reachability.ts`**

```ts
import { FLOOR, idx, isPassable } from './grid.js';
import type { Grid } from './grid.js';

/** Flood fill over passable tiles, 4-directional. Returns tile indices. */
export function reachableFrom(grid: Grid, x: number, y: number): Set<number> {
  const seen = new Set<number>();
  if (!isPassable(grid, x, y)) return seen;

  const stack: Array<readonly [number, number]> = [[x, y]];
  seen.add(idx(grid, x, y));

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const [cx, cy] = current;
    const neighbours: Array<readonly [number, number]> = [
      [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (!isPassable(grid, nx, ny)) continue;
      const i = idx(grid, nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export function floorCount(grid: Grid): number {
  let n = 0;
  for (const t of grid.tiles) if (t === FLOOR) n += 1;
  return n;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/core/grid.ts src/core/reachability.ts tests/core/grid.test.ts tests/core/reachability.test.ts
git commit -m "feat: grid primitives and 4-directional reachability"
```

---

### Task 3: Seeded map generation

**Files:**
- Create: `src/core/mapgen.ts`
- Test: `tests/core/mapgen.test.ts`

**Interfaces:**
- Consumes: `intBetween` (Task 1); `Grid`, `makeGrid`, `FLOOR`, `WALL` (Task 2); `reachableFrom` (Task 2). Not `floorCount` — the guard measures against the whole grid, so surviving-floor counts play no part.
- Produces: `interface MapGenResult { grid: Grid; start: { x: number; y: number }; counterAfter: number }`, `generateMap(seed, counter, width, height, wallCount): MapGenResult`.

The retry loop matters beyond map quality: a variable number of draws makes the
recorded RNG counter non-trivial, which is what turns the replay check in
Task 9 into a real assertion rather than a formality.

- [ ] **Step 1: Write the failing test**

Create `tests/core/mapgen.test.ts`:

```ts
import { generateMap } from '../../src/core/mapgen.js';
import { isPassable } from '../../src/core/grid.js';
import { reachableFrom } from '../../src/core/reachability.js';

describe('generateMap', () => {
  it('is deterministic for the same seed and counter', () => {
    const a = generateMap(1234, 0, 24, 16, 60);
    const b = generateMap(1234, 0, 24, 16, 60);
    expect(a.grid.tiles).toEqual(b.grid.tiles);
    expect(a.start).toEqual(b.start);
    expect(a.counterAfter).toBe(b.counterAfter);
  });

  it('produces different maps for different seeds', () => {
    const a = generateMap(1, 0, 24, 16, 60);
    const b = generateMap(2, 0, 24, 16, 60);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('always leaves the start standable', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, start } = generateMap(seed, 0, 24, 16, 60);
      expect(isPassable(grid, start.x, start.y)).toBe(true);
    }
  });

  it('keeps most of the whole grid walkable and connected', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, start } = generateMap(seed, 0, 24, 16, 60);
      const reachable = reachableFrom(grid, start.x, start.y);
      // Measured against every tile, not against surviving floor: a fraction of
      // floor is trivially satisfied by a map that is almost entirely wall.
      expect(reachable.size).toBeGreaterThanOrEqual(24 * 16 * 0.6);
    }
  });

  it('advances the counter past every draw it made', () => {
    const { counterAfter } = generateMap(7, 0, 24, 16, 60);
    // 2 draws per wall, plus 2 for the start, on at least one attempt
    expect(counterAfter).toBeGreaterThanOrEqual(60 * 2 + 2);
  });

  it('respects a non-zero starting counter', () => {
    const a = generateMap(7, 0, 24, 16, 60);
    const b = generateMap(7, 500, 24, 16, 60);
    expect(b.counterAfter).toBeGreaterThan(500);
    expect(a.grid.tiles).not.toEqual(b.grid.tiles);
  });

  it('has the right tile count and only known tile values', () => {
    const { grid } = generateMap(9, 0, 12, 8, 20);
    expect(grid.tiles.length).toBe(96);
    for (const t of grid.tiles) expect([0, 1]).toContain(t);
  });

  it('gives up loudly rather than returning a map you cannot walk in', () => {
    // Enough wall requests to bury a 6x6 grid. Only the forced start survives as
    // floor, so one reachable tile against a bar of 36 * 0.6 — every attempt is
    // rejected and the generator must say so rather than hand back a cell.
    expect(() => generateMap(3, 0, 6, 6, 100000)).toThrow(/no acceptable layout/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/mapgen.test.ts`
Expected: FAIL — cannot resolve `../../src/core/mapgen.js`.

- [ ] **Step 3: Implement `src/core/mapgen.ts`**

```ts
import { FLOOR, WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import { intBetween } from './rng.js';
import { reachableFrom } from './reachability.js';

export interface MapGenResult {
  grid: Grid;
  start: { x: number; y: number };
  counterAfter: number;
}

/** Share of the WHOLE grid that must be walkable and connected to the start.
 *  Measured against every tile rather than against surviving floor, because a
 *  fraction of floor is trivially satisfied by a map that is nearly all wall —
 *  one floor tile is 100% connected to itself and tells you nothing. */
const MIN_REACHABLE_FRACTION = 0.6;
const MAX_ATTEMPTS = 20;

/**
 * Scatters walls at random, then keeps the layout only if most of the grid can
 * be walked to from the start. Deliberately crude — better generation is a
 * later increment. Retries consume extra counters, which is wanted.
 */
export function generateMap(
  seed: number,
  counter: number,
  width: number,
  height: number,
  wallCount: number,
): MapGenResult {
  let c = counter;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const tiles = new Array<number>(width * height).fill(FLOOR);

    for (let i = 0; i < wallCount; i += 1) {
      const wx = intBetween(seed, c, 0, width - 1); c += 1;
      const wy = intBetween(seed, c, 0, height - 1); c += 1;
      tiles[wy * width + wx] = WALL;
    }

    const sx = intBetween(seed, c, 0, width - 1); c += 1;
    const sy = intBetween(seed, c, 0, height - 1); c += 1;
    tiles[sy * width + sx] = FLOOR;

    const grid = makeGrid(width, height, tiles);
    if (reachableFrom(grid, sx, sy).size >= width * height * MIN_REACHABLE_FRACTION) {
      return { grid, start: { x: sx, y: sy }, counterAfter: c };
    }
  }

  throw new Error(
    `generateMap: no acceptable layout in ${MAX_ATTEMPTS} attempts (seed ${seed}, ${width}x${height}, ${wallCount} walls)`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/mapgen.ts tests/core/mapgen.test.ts
git commit -m "feat: seeded map generation with a reachability floor"
```

---

### Task 4: Entities, stats, and game state

**Files:**
- Create: `src/core/entity.ts`, `src/core/state.ts`
- Test: `tests/core/entity.test.ts`

**Interfaces:**
- Consumes: `Grid`, `makeGrid`, `WALL` (Task 2).
- Produces: `interface Pos { x: number; y: number }`, `interface Stats { hp: number; might: number; wits: number; speed: number }`, `interface Entity { id: string; kind: string; pos: Pos; stats: Stats; tags: string[] }`, `findEntity(entities: readonly Entity[], id: string): Entity | undefined`, `isAlive(entity: Entity): boolean`, `interface GameState { readonly grid: Grid; readonly entities: readonly Entity[]; readonly turn: number; readonly activeEntityId: string | null; readonly seed: number; readonly rngCounter: number }`, `EMPTY_STATE: GameState` (frozen).

- [ ] **Step 1: Write the failing test**

Create `tests/core/entity.test.ts`:

```ts
import { findEntity, isAlive } from '../../src/core/entity.js';
import type { Entity } from '../../src/core/entity.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { isPassable } from '../../src/core/grid.js';

function entity(id: string, hp: number): Entity {
  return { id, kind: 'test', pos: { x: 0, y: 0 }, stats: { hp, might: 1, wits: 1, speed: 1 }, tags: [] };
}

describe('findEntity', () => {
  it('finds by id', () => {
    const list = [entity('a', 5), entity('b', 5)];
    expect(findEntity(list, 'b')?.id).toBe('b');
  });

  it('returns undefined for an unknown id', () => {
    expect(findEntity([entity('a', 5)], 'zz')).toBeUndefined();
  });
});

describe('isAlive', () => {
  it('is true above zero hp and false at or below', () => {
    expect(isAlive(entity('a', 1))).toBe(true);
    expect(isAlive(entity('a', 0))).toBe(false);
    expect(isAlive(entity('a', -3))).toBe(false);
  });
});

describe('EMPTY_STATE', () => {
  it('has no entities and no active turn', () => {
    expect(EMPTY_STATE.entities).toEqual([]);
    expect(EMPTY_STATE.activeEntityId).toBeNull();
    expect(EMPTY_STATE.turn).toBe(0);
    expect(EMPTY_STATE.rngCounter).toBe(0);
  });

  it('is a solid one-tile grid, so nothing is walkable before a world exists', () => {
    expect(isPassable(EMPTY_STATE.grid, 0, 0)).toBe(false);
  });

  it('is frozen, so a reducer mutating its accumulator fails loudly instead of corrupting every later replay', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.entities)).toBe(true);
    // The grid too: it is a separate object, and freezing the state around it
    // leaves it writable. Every fold in the process shares this one grid.
    expect(Object.isFrozen(EMPTY_STATE.grid)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.grid.tiles)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/entity.test.ts`
Expected: FAIL — cannot resolve `../../src/core/entity.js`.

- [ ] **Step 3: Implement `src/core/entity.ts`**

```ts
export interface Pos {
  x: number;
  y: number;
}

/** Four stats, each with a distinct job. Speed drives both turn order and range. */
export interface Stats {
  hp: number;
  might: number;
  wits: number;
  speed: number;
}

export interface Entity {
  id: string;
  kind: string;
  pos: Pos;
  stats: Stats;
  tags: string[];
}

export function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

export function isAlive(entity: Entity): boolean {
  return entity.stats.hp > 0;
}
```

- [ ] **Step 4: Implement `src/core/state.ts`**

```ts
import { WALL, makeGrid } from './grid.js';
import type { Grid } from './grid.js';
import type { Entity } from './entity.js';

/** `readonly` throughout, matching `Grid`'s convention, because `apply()` is
 *  required to be pure — the type should refuse in-place mutation rather than
 *  rely on every future reducer remembering not to. `readonly Entity[]` still
 *  permits `map`, `find` and spread; it removes only `push`, `splice` and
 *  index assignment. */
export interface GameState {
  readonly grid: Grid;
  readonly entities: readonly Entity[];
  readonly turn: number;
  readonly activeEntityId: string | null;
  readonly seed: number;
  readonly rngCounter: number;
}

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

/** What a fold starts from. A WORLD_INIT event replaces it wholesale.
 *  Frozen as well as typed readonly: every fold in the process shares this one
 *  object, so a reducer that mutated its accumulator in place would corrupt the
 *  baseline for every later replay and fail somewhere far from the cause. */
export const EMPTY_STATE: GameState = Object.freeze({
  grid: makeGrid(1, 1, [WALL]),
  entities: NO_ENTITIES,
  turn: 0,
  activeEntityId: null,
  seed: 0,
  rngCounter: 0,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/entity.ts src/core/state.ts tests/core/entity.test.ts
git commit -m "feat: entity, stats and game state types"
```

---

### Task 5: Turn order

**Files:**
- Create: `src/core/turns.ts`
- Test: `tests/core/turns.test.ts`

**Interfaces:**
- Consumes: `Entity`, `isAlive` (Task 4).
- Produces: `initiativeOrder(entities: readonly Entity[]): string[]`, `nextActive(entities: readonly Entity[], currentId: string | null): { activeEntityId: string | null; wrapped: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/turns.test.ts`:

```ts
import { initiativeOrder, nextActive } from '../../src/core/turns.js';
import type { Entity } from '../../src/core/entity.js';

function entity(id: string, speed: number, hp = 5): Entity {
  return { id, kind: 'test', pos: { x: 0, y: 0 }, stats: { hp, might: 1, wits: 1, speed }, tags: [] };
}

describe('initiativeOrder', () => {
  it('orders by speed, fastest first', () => {
    const order = initiativeOrder([entity('slow', 1), entity('fast', 9), entity('mid', 5)]);
    expect(order).toEqual(['fast', 'mid', 'slow']);
  });

  it('breaks speed ties by ascending id, so order never depends on input order', () => {
    const forwards = initiativeOrder([entity('a', 4), entity('b', 4), entity('c', 4)]);
    const backwards = initiativeOrder([entity('c', 4), entity('b', 4), entity('a', 4)]);
    expect(forwards).toEqual(['a', 'b', 'c']);
    expect(backwards).toEqual(['a', 'b', 'c']);
  });

  it('leaves out the dead', () => {
    expect(initiativeOrder([entity('alive', 3), entity('dead', 9, 0)])).toEqual(['alive']);
  });

  it('does not mutate its input', () => {
    const list = [entity('slow', 1), entity('fast', 9)];
    initiativeOrder(list);
    expect(list.map((e) => e.id)).toEqual(['slow', 'fast']);
  });
});

describe('nextActive', () => {
  const roster = [entity('a', 9), entity('b', 5), entity('c', 1)];

  it('starts at the fastest when nobody is active', () => {
    expect(nextActive(roster, null)).toEqual({ activeEntityId: 'a', wrapped: false });
  });

  it('steps down the order without wrapping', () => {
    expect(nextActive(roster, 'a')).toEqual({ activeEntityId: 'b', wrapped: false });
    expect(nextActive(roster, 'b')).toEqual({ activeEntityId: 'c', wrapped: false });
  });

  it('wraps after the last, which is what ends a round', () => {
    expect(nextActive(roster, 'c')).toEqual({ activeEntityId: 'a', wrapped: true });
  });

  it('restarts the order and reports a wrap when the active entity has left', () => {
    expect(nextActive(roster, 'gone')).toEqual({ activeEntityId: 'a', wrapped: true });
  });

  it('has nobody active when everyone is dead', () => {
    expect(nextActive([entity('a', 9, 0)], 'a')).toEqual({ activeEntityId: null, wrapped: false });
  });

  it('stays on the only survivor and reports a wrap each time', () => {
    expect(nextActive([entity('solo', 4)], 'solo')).toEqual({ activeEntityId: 'solo', wrapped: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/turns.test.ts`
Expected: FAIL — cannot resolve `../../src/core/turns.js`.

- [ ] **Step 3: Implement `src/core/turns.ts`**

```ts
import { isAlive } from './entity.js';
import type { Entity } from './entity.js';

/** Speed descending, id ascending on ties. Ties must break the same way every
 *  run or two replays of one log can disagree about whose turn it is. */
export function initiativeOrder(entities: readonly Entity[]): string[] {
  return entities
    .filter(isAlive)
    .slice()
    .sort((a, b) => {
      if (b.stats.speed !== a.stats.speed) return b.stats.speed - a.stats.speed;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .map((e) => e.id);
}

export function nextActive(
  entities: readonly Entity[],
  currentId: string | null,
): { activeEntityId: string | null; wrapped: boolean } {
  const order = initiativeOrder(entities);
  const first = order[0];
  if (first === undefined) return { activeEntityId: null, wrapped: false };
  if (currentId === null) return { activeEntityId: first, wrapped: false };

  const at = order.indexOf(currentId);
  if (at === -1) return { activeEntityId: first, wrapped: true };

  const next = (at + 1) % order.length;
  return { activeEntityId: order[next] ?? first, wrapped: next === 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/turns.ts tests/core/turns.test.ts
git commit -m "feat: deterministic initiative order and turn advance"
```

---

### Task 6: Event types and the apply reducer

**Files:**
- Create: `src/core/events.ts`, `src/core/apply.ts`
- Test: `tests/core/apply.test.ts`

**Interfaces:**
- Consumes: `Pos`, `Stats` (Task 4); `GameState`, `EMPTY_STATE` (Task 4); `makeGrid` (Task 2).
- Produces: `SCHEMA_VERSIONS`, `type EventType`, `WorldInitPayload`, `MovePayload`, `MoveBlockedPayload`, `TurnAdvancedPayload`, `type DraftEvent`, `type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number }`, `apply(state: GameState, event: GameEvent): GameState`.

`apply` is the load-bearing function of the whole project. It must never call
the RNG or read a clock. It is total over *validated* events; a payload that is
internally inconsistent with the `Grid` it describes throws, deliberately —
see the Global Constraints for what that means and why. `rngCounter` on an event
is the counter *before* it ran; only `WORLD_INIT` advances the stored counter,
using its own recorded `counterAfter`.

- [ ] **Step 1: Implement `src/core/events.ts`**

Types first — there is nothing to test in a type declaration, and the reducer
test in Step 2 needs them to compile.

```ts
import type { Pos, Stats } from './entity.js';

/** Per event type. Bump when a type's meaning changes, and write an upcaster. */
export const SCHEMA_VERSIONS = {
  WORLD_INIT: 1,
  MOVE: 1,
  MOVE_BLOCKED: 1,
  TURN_ADVANCED: 1,
} as const;

export type EventType = keyof typeof SCHEMA_VERSIONS;

export interface WorldInitPayload {
  width: number;
  height: number;
  tiles: number[];
  seed: number;
  counterAfter: number;
  player: { id: string; kind: string; pos: Pos; stats: Stats; tags: string[] };
}

export interface MovePayload {
  entityId: string;
  from: Pos;
  to: Pos;
}

export interface MoveBlockedPayload {
  entityId: string;
  attempted: Pos;
  reason: 'wall' | 'out-of-bounds' | 'occupied';
}

export interface TurnAdvancedPayload {
  activeEntityId: string | null;
  turn: number;
}

/** An event before it has been hashed and linked into a chain. */
export type DraftEvent =
  | { type: 'WORLD_INIT'; schemaVersion: number; rngCounter: number; payload: WorldInitPayload }
  | { type: 'MOVE'; schemaVersion: number; rngCounter: number; payload: MovePayload }
  | { type: 'MOVE_BLOCKED'; schemaVersion: number; rngCounter: number; payload: MoveBlockedPayload }
  | { type: 'TURN_ADVANCED'; schemaVersion: number; rngCounter: number; payload: TurnAdvancedPayload };

export type GameEvent = DraftEvent & { id: string; parent: string | null; seq: number };
```

- [ ] **Step 2: Write the failing reducer test**

Create `tests/core/apply.test.ts`:

```ts
import { apply } from '../../src/core/apply.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { GameEvent } from '../../src/core/events.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR, WALL, tileAt } from '../../src/core/grid.js';

const worldInit: GameEvent = {
  id: 'e0', parent: null, seq: 0,
  type: 'WORLD_INIT',
  schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
  rngCounter: 0,
  payload: {
    width: 3, height: 2,
    tiles: [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR],
    seed: 99,
    counterAfter: 128,
    player: { id: 'player', kind: 'you', pos: { x: 0, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
  },
};

const started = apply(EMPTY_STATE, worldInit);

describe('apply WORLD_INIT', () => {
  it('installs the grid', () => {
    expect(started.grid.width).toBe(3);
    expect(tileAt(started.grid, 2, 0)).toBe(WALL);
  });

  it('places the player and makes them active on turn 1', () => {
    expect(started.entities).toHaveLength(1);
    expect(started.entities[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(started.activeEntityId).toBe('player');
    expect(started.turn).toBe(1);
  });

  it('records the seed and the counter the generator finished on', () => {
    expect(started.seed).toBe(99);
    expect(started.rngCounter).toBe(128);
  });

  it('copies the player, so mutating the event payload cannot reach into state', () => {
    // Every nested part, not just position: stats and tags are separate objects
    // in the payload too, and aliasing any of them would let a later event
    // rewrite history that has already been folded.
    worldInit.payload.player.pos.x = 999;
    worldInit.payload.player.stats.hp = 999;
    worldInit.payload.player.tags.push('injected');

    expect(started.entities[0]?.pos.x).toBe(0);
    expect(started.entities[0]?.stats.hp).toBe(10);
    expect(started.entities[0]?.tags).toEqual([]);

    worldInit.payload.player.pos.x = 0;
    worldInit.payload.player.stats.hp = 10;
    worldInit.payload.player.tags.length = 0;
  });
});

describe('apply MOVE', () => {
  const moved = apply(started, {
    id: 'e1', parent: 'e0', seq: 1,
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: 128,
    payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
  });

  it('moves the named entity to the recorded destination', () => {
    expect(moved.entities[0]?.pos).toEqual({ x: 1, y: 0 });
  });

  it('leaves the previous state untouched', () => {
    expect(started.entities[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('does not advance the rng counter, because a move draws nothing', () => {
    expect(moved.rngCounter).toBe(128);
  });

  it('ignores the event own rngCounter, so only WORLD_INIT can move it', () => {
    // A deliberately mismatched counter. verifyChain would reject this event,
    // but apply must not read the field at all: if it copied the counter from
    // the event, the replay check that compares them would be circular and
    // would pass while proving nothing.
    const bogus = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 999999,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    });
    expect(bogus.rngCounter).toBe(128);
  });

  it('leaves every entity alone when the id matches nobody', () => {
    const nobody = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: 128,
      payload: { entityId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    });
    expect(nobody.entities).toEqual(started.entities);
    expect(nobody.rngCounter).toBe(started.rngCounter);
  });
});

describe('apply MOVE_BLOCKED', () => {
  const blocked = apply(started, {
    id: 'e1', parent: 'e0', seq: 1,
    type: 'MOVE_BLOCKED',
    schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
    rngCounter: 128,
    payload: { entityId: 'player', attempted: { x: 2, y: 0 }, reason: 'wall' },
  });

  it('changes nothing but is still recorded as something that happened', () => {
    expect(blocked.entities[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(blocked.turn).toBe(started.turn);
  });

  it('returns the very same state object, not a copy of it', () => {
    // Identity, not equality: a rewrite that returned {...state} would still
    // pass a value check while quietly making every blocked move allocate.
    expect(blocked).toBe(started);
  });
});

describe('apply TURN_ADVANCED', () => {
  it('takes the turn number and active entity straight from the payload', () => {
    const advanced = apply(started, {
      id: 'e1', parent: 'e0', seq: 1,
      type: 'TURN_ADVANCED',
      schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
      rngCounter: 128,
      payload: { activeEntityId: 'player', turn: 2 },
    });
    expect(advanced.turn).toBe(2);
    expect(advanced.activeEntityId).toBe('player');
  });
});

describe('apply with an event it cannot reduce', () => {
  it('throws rather than falling off the switch and returning undefined', () => {
    // This is the only test that pins the default arm. verifyChain rejects
    // unknown types before apply ever sees them, so every other test passes
    // with the arm deleted — and then fold() silently returns undefined while
    // still typed GameState. Confirmed: with the arm removed, all 142 other
    // tests stay green.
    const alien = {
      id: 'x', parent: null, seq: 0,
      type: 'STRIKE',
      schemaVersion: 1,
      rngCounter: 0,
      payload: { attacker: 'player', target: 'goblin', damage: 3 },
    } as unknown as GameEvent;

    expect(() => apply(EMPTY_STATE, alien)).toThrow(/unknown event type STRIKE/);
  });
});

describe('apply', () => {
  it('is deterministic — same state and event give an identical result', () => {
    const a = apply(EMPTY_STATE, worldInit);
    const b = apply(EMPTY_STATE, worldInit);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/apply.test.ts`
Expected: FAIL — cannot resolve `../../src/core/apply.js`.

- [ ] **Step 4: Implement `src/core/apply.ts`**

```ts
import { makeGrid } from './grid.js';
import type { GameEvent } from './events.js';
import type { GameState } from './state.js';

/**
 * The only way state changes. Pure: no RNG, no clock, no network. Everything
 * random was resolved when the command ran and is recorded in the payload,
 * which is what makes a replay faithful rather than merely similar.
 *
 * Total over *validated* events. A WORLD_INIT payload that is internally
 * inconsistent with the grid it describes — a tile count disagreeing with the
 * declared size, or a non-positive width or height — throws out of makeGrid.
 * That is deliberate rather than a gap: it happens only to a corrupted log,
 * where failing loudly beats folding nonsense. Verify an untrusted log with
 * verifyChain before folding it.
 */
export function apply(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'WORLD_INIT': {
      const p = event.payload;
      return {
        grid: makeGrid(p.width, p.height, p.tiles),
        entities: [{
          id: p.player.id,
          kind: p.player.kind,
          pos: { x: p.player.pos.x, y: p.player.pos.y },
          stats: { ...p.player.stats },
          tags: [...p.player.tags],
        }],
        turn: 1,
        activeEntityId: p.player.id,
        seed: p.seed,
        rngCounter: p.counterAfter,
      };
    }

    case 'MOVE': {
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId ? { ...e, pos: { x: p.to.x, y: p.to.y } } : e,
        ),
      };
    }

    case 'MOVE_BLOCKED':
      return state;

    case 'TURN_ADVANCED':
      return { ...state, turn: event.payload.turn, activeEntityId: event.payload.activeEntityId };

    default: {
      // Exhaustive at compile time — the never assignment is what proves it —
      // and loud at runtime. Without this arm the switch falls off the end and
      // returns undefined while still typed GameState, so a log carrying an
      // event type this engine does not know folds to nothing and every later
      // read dereferences it. A log from a newer engine is an expected input,
      // not an exotic one, which is exactly why this must throw rather than
      // quietly return the state unchanged.
      const unhandled: never = event;
      throw new Error(`apply: unknown event type ${String((unhandled as { type: unknown }).type)}`);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/events.ts src/core/apply.ts tests/core/apply.test.ts
git commit -m "feat: event types and the pure apply reducer"
```

---

### Task 7: Commands — where randomness and rules live

**Files:**
- Create: `src/core/commands.ts`
- Test: `tests/core/commands.test.ts`

**Interfaces:**
- Consumes: `generateMap` (Task 3); `GameState` (Task 4); `findEntity`, `isAlive` (Task 4); `inBounds`, `isPassable` (Task 2); `nextActive` (Task 5); `SCHEMA_VERSIONS`, `DraftEvent` (Task 6).
- Produces: `createWorld(seed, width, height, wallCount, playerId?): DraftEvent`, `attemptMove(state, entityId, dx, dy): DraftEvent`, `advanceTurn(state): DraftEvent`.

Commands decide *what happened*; `apply` only records it. This is the split that
keeps replay faithful: change a command later and old logs still fold correctly,
because the outcome is stored rather than recomputed.

- [ ] **Step 1: Write the failing test**

Create `tests/core/commands.test.ts`:

```ts
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { apply } from '../../src/core/apply.js';
import { generateMap } from '../../src/core/mapgen.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { FLOOR, WALL, makeGrid } from '../../src/core/grid.js';
import type { GameEvent } from '../../src/core/events.js';
import type { GameState } from '../../src/core/state.js';
import type { Entity } from '../../src/core/entity.js';

function seal(draft: ReturnType<typeof createWorld>): GameEvent {
  return { ...draft, id: 'x', parent: null, seq: 0 } as GameEvent;
}

describe('createWorld', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(createWorld(4242, 24, 16, 60)))
      .toBe(JSON.stringify(createWorld(4242, 24, 16, 60)));
  });

  it('starts from counter zero and records the counter generation actually reached', () => {
    const draft = createWorld(4242, 24, 16, 60);
    expect(draft.rngCounter).toBe(0);
    // Tied to the generator's real output rather than merely positive: a
    // hardcoded constant satisfies a > 0 check while silently breaking replay.
    expect(draft.payload.counterAfter).toBe(generateMap(4242, 0, 24, 16, 60).counterAfter);
  });

  it('gives the player the four stats', () => {
    const { player } = createWorld(1, 12, 8, 10).payload;
    expect(player.stats).toEqual({ hp: 10, might: 3, wits: 3, speed: 4 });
  });

  it('folds into a state whose player stands on the recorded start', () => {
    const draft = createWorld(77, 24, 16, 60);
    const state = apply(EMPTY_STATE, seal(draft));
    expect(state.entities[0]?.pos).toEqual(draft.payload.player.pos);
  });
});

// A hand-built 3x2 world: floor everywhere except (2,0). Extra entities are
// passed in rather than pushed afterwards, because GameState.entities is
// readonly — the type refuses in-place mutation on purpose.
function fixture(extra: Entity[] = []): GameState {
  return {
    grid: makeGrid(3, 2, [FLOOR, FLOOR, WALL, FLOOR, FLOOR, FLOOR]),
    entities: [
      { id: 'player', kind: 'you', pos: { x: 1, y: 0 }, stats: { hp: 10, might: 3, wits: 3, speed: 4 }, tags: [] },
      ...extra,
    ],
    turn: 1,
    activeEntityId: 'player',
    seed: 5,
    rngCounter: 40,
  };
}

describe('attemptMove', () => {
  it('produces a MOVE into open floor', () => {
    const draft = attemptMove(fixture(), 'player', -1, 0);
    expect(draft.type).toBe('MOVE');
    expect(draft.payload).toMatchObject({ entityId: 'player', from: { x: 1, y: 0 }, to: { x: 0, y: 0 } });
  });

  it('blocks on a wall and says so', () => {
    const draft = attemptMove(fixture(), 'player', 1, 0);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ attempted: { x: 2, y: 0 }, reason: 'wall' });
  });

  it('blocks at the edge of the grid', () => {
    const draft = attemptMove(fixture(), 'player', 0, -1);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ reason: 'out-of-bounds' });
  });

  it('blocks on another living entity', () => {
    const state = fixture([
      { id: 'other', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    const draft = attemptMove(state, 'player', -1, 0);
    expect(draft.type).toBe('MOVE_BLOCKED');
    expect(draft.payload).toMatchObject({ reason: 'occupied' });
  });

  it('walks through the dead', () => {
    const state = fixture([
      { id: 'corpse', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 0, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    expect(attemptMove(state, 'player', -1, 0).type).toBe('MOVE');
  });

  it('carries the current rng counter without advancing it', () => {
    expect(attemptMove(fixture(), 'player', -1, 0).rngCounter).toBe(40);
  });

  it('rejects anything but a single orthogonal step', () => {
    expect(() => attemptMove(fixture(), 'player', 1, 1)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 2, 0)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 0, 0)).toThrow(/single orthogonal step/);
  });

  it('rejects a fractional half-step that happens to sum to one', () => {
    // Both of these pass a magnitude-only check: 0.5 + 0.5 and 0.25 + 0.75 are
    // each exactly 1. Without an integer guard the player ends up between tiles.
    expect(() => attemptMove(fixture(), 'player', 0.5, 0.5)).toThrow(/single orthogonal step/);
    expect(() => attemptMove(fixture(), 'player', 0.25, -0.75)).toThrow(/single orthogonal step/);
  });

  it('carries the counter unchanged on every branch, not just the successful one', () => {
    // The fixture sits at counter 40. A hardcoded 0 in any one blocked branch
    // would otherwise pass unnoticed, and replay verification would then fail
    // far from the cause.
    const occupied = fixture([
      { id: 'other', kind: 'thing', pos: { x: 0, y: 0 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    expect(attemptMove(fixture(), 'player', -1, 0).rngCounter).toBe(40);
    expect(attemptMove(fixture(), 'player', 1, 0).rngCounter).toBe(40);
    expect(attemptMove(fixture(), 'player', 0, -1).rngCounter).toBe(40);
    expect(attemptMove(occupied, 'player', -1, 0).rngCounter).toBe(40);
    expect(advanceTurn(fixture()).rngCounter).toBe(40);
  });

  it('rejects an unknown entity', () => {
    expect(() => attemptMove(fixture(), 'nobody', 1, 0)).toThrow(/no entity/);
  });
});

describe('advanceTurn', () => {
  it('keeps the turn number when the round has not wrapped', () => {
    const state = fixture([
      { id: 'zzz', kind: 'thing', pos: { x: 2, y: 1 }, stats: { hp: 4, might: 1, wits: 1, speed: 1 }, tags: [] },
    ]);
    const draft = advanceTurn(state);
    expect(draft.payload).toEqual({ activeEntityId: 'zzz', turn: 1 });
  });

  it('increments the turn when the order wraps', () => {
    const draft = advanceTurn(fixture());
    expect(draft.payload).toEqual({ activeEntityId: 'player', turn: 2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/commands.test.ts`
Expected: FAIL — cannot resolve `../../src/core/commands.js`.

- [ ] **Step 3: Implement `src/core/commands.ts`**

```ts
import { generateMap } from './mapgen.js';
import { inBounds, isPassable } from './grid.js';
import { findEntity, isAlive } from './entity.js';
import { nextActive } from './turns.js';
import { SCHEMA_VERSIONS } from './events.js';
import type { DraftEvent } from './events.js';
import type { GameState } from './state.js';

const STARTING_STATS = { hp: 10, might: 3, wits: 3, speed: 4 } as const;

export function createWorld(
  seed: number,
  width: number,
  height: number,
  wallCount: number,
  playerId = 'player',
): Extract<DraftEvent, { type: 'WORLD_INIT' }> {
  const generated = generateMap(seed, 0, width, height, wallCount);
  return {
    type: 'WORLD_INIT',
    schemaVersion: SCHEMA_VERSIONS.WORLD_INIT,
    rngCounter: 0,
    payload: {
      width,
      height,
      tiles: [...generated.grid.tiles],
      seed,
      counterAfter: generated.counterAfter,
      player: {
        id: playerId,
        kind: 'you',
        pos: { x: generated.start.x, y: generated.start.y },
        stats: { ...STARTING_STATS },
        tags: [],
      },
    },
  };
}

export function attemptMove(state: GameState, entityId: string, dx: number, dy: number): DraftEvent {
  // Integers as well as magnitude: (0.5, 0.5) sums to exactly 1, so a
  // magnitude-only guard would land the player between tiles — and from a
  // fractional position every later move reads as blocked, because a
  // non-integer array index resolves to undefined.
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) {
    throw new Error(`attemptMove: expected a single orthogonal step, got (${dx}, ${dy})`);
  }
  const mover = findEntity(state.entities, entityId);
  if (mover === undefined) throw new Error(`attemptMove: no entity ${entityId}`);

  const to = { x: mover.pos.x + dx, y: mover.pos.y + dy };

  if (!inBounds(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      payload: { entityId, attempted: to, reason: 'out-of-bounds' },
    };
  }
  if (!isPassable(state.grid, to.x, to.y)) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      payload: { entityId, attempted: to, reason: 'wall' },
    };
  }
  const occupied = state.entities.some(
    (o) => o.id !== entityId && isAlive(o) && o.pos.x === to.x && o.pos.y === to.y,
  );
  if (occupied) {
    return {
      type: 'MOVE_BLOCKED',
      schemaVersion: SCHEMA_VERSIONS.MOVE_BLOCKED,
      rngCounter: state.rngCounter,
      payload: { entityId, attempted: to, reason: 'occupied' },
    };
  }

  return {
    type: 'MOVE',
    schemaVersion: SCHEMA_VERSIONS.MOVE,
    rngCounter: state.rngCounter,
    payload: { entityId, from: { x: mover.pos.x, y: mover.pos.y }, to },
  };
}

export function advanceTurn(state: GameState): Extract<DraftEvent, { type: 'TURN_ADVANCED' }> {
  const { activeEntityId, wrapped } = nextActive(state.entities, state.activeEntityId);
  return {
    type: 'TURN_ADVANCED',
    schemaVersion: SCHEMA_VERSIONS.TURN_ADVANCED,
    rngCounter: state.rngCounter,
    payload: { activeEntityId, turn: wrapped ? state.turn + 1 : state.turn },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/commands.ts tests/core/commands.test.ts
git commit -m "feat: command layer for world creation, movement and turn advance"
```

---

### Task 8: Canonical JSON and event hashing

**Files:**
- Create: `src/log/canonical.ts`, `src/log/hash.ts`
- Test: `tests/log/canonical.test.ts`, `tests/log/hash.test.ts`

**Interfaces:**
- Consumes: `DraftEvent` (Task 6).
- Produces: `canonicalJson(value: unknown): string`, `hashEvent(draft: DraftEvent, parent: string | null, seq: number): string`.

- [ ] **Step 1: Write the failing canonical JSON test**

Create `tests/log/canonical.test.ts`:

```ts
import { canonicalJson } from '../../src/log/canonical.js';

describe('canonicalJson', () => {
  it('sorts object keys, so declaration order cannot change a hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('keeps array order, because order is meaningful there', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: [1, 2], b: { c: 3 } })).toBe('{"a":[1,2],"b":{"c":3}}');
  });

  it('handles the primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(-0.5)).toBe('-0.5');
    expect(canonicalJson('hi "there"')).toBe('"hi \\"there\\""');
  });

  it('skips undefined properties rather than emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses values that cannot round-trip', () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(() => 1)).toThrow(/unsupported/);
  });

  it('refuses objects that are not plain, rather than collapsing them to {}', () => {
    // None of these has own enumerable keys, so without the prototype guard
    // every one of them serialises to `{}` — two different Dates would hash
    // identically to each other and to an empty object.
    expect(() => canonicalJson(new Date(0))).toThrow(/only plain objects/);
    expect(() => canonicalJson(new Map([['a', 1]]))).toThrow(/only plain objects/);
    expect(() => canonicalJson(new Set([1]))).toThrow(/only plain objects/);
  });

  it('accepts a null-prototype object, which is still plain data', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.b = 1;
    bare.a = 2;
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/log/canonical.test.ts`
Expected: FAIL — cannot resolve `../../src/log/canonical.js`.

- [ ] **Step 3: Implement `src/log/canonical.ts`**

```ts
/**
 * Deterministic JSON: keys sorted, no whitespace, arrays left alone. Event
 * identity is a hash of these bytes, so if key order drifted between engine
 * versions every existing chain would fail to verify.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean' || t === 'string') return JSON.stringify(value);

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalJson: non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }

  if (t === 'undefined') throw new Error('canonicalJson: undefined is not serialisable');

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }

  if (t === 'object') {
    // Plain objects only. A Date, Map, Set or class instance has no own
    // enumerable keys, so it would serialise to `{}` — two different Dates
    // hashing identically to each other and to an empty object. In a
    // tamper-evident chain, refusing is far better than collapsing silently.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(
        `canonicalJson: only plain objects are serialisable, got ${Object.prototype.toString.call(value)}`,
      );
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',');
    return `{${body}}`;
  }

  throw new Error(`canonicalJson: unsupported type ${t}`);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/log/canonical.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hash test**

Create `tests/log/hash.test.ts`:

```ts
import { hashEvent } from '../../src/log/hash.js';
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { DraftEvent } from '../../src/core/events.js';

const draft: DraftEvent = {
  type: 'MOVE',
  schemaVersion: SCHEMA_VERSIONS.MOVE,
  rngCounter: 12,
  payload: { entityId: 'player', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
};

describe('hashEvent', () => {
  it('returns a 64-character lowercase hex digest', () => {
    expect(hashEvent(draft, null, 0)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical inputs', () => {
    expect(hashEvent(draft, 'abc', 3)).toBe(hashEvent(draft, 'abc', 3));
  });

  it('changes when the parent changes, which is what links the chain', () => {
    expect(hashEvent(draft, 'aaa', 3)).not.toBe(hashEvent(draft, 'bbb', 3));
  });

  it('changes when the sequence number changes', () => {
    expect(hashEvent(draft, 'aaa', 3)).not.toBe(hashEvent(draft, 'aaa', 4));
  });

  it('changes when the payload changes', () => {
    const other: DraftEvent = {
      ...draft,
      payload: { entityId: 'player', from: { x: 1, y: 1 }, to: { x: 1, y: 2 } },
    };
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent(other, null, 0));
  });

  it('changes when the schema version changes', () => {
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent({ ...draft, schemaVersion: 2 }, null, 0));
  });

  it('changes when only the type changes', () => {
    // Built with a cast on purpose. The discriminated union forbids a type that
    // disagrees with its payload, so this value cannot arise in play — the test
    // is checking hashEvent's field coverage, not a reachable event. Without it,
    // dropping `type` from the hashed material passes every other case here,
    // and a future event type reusing an existing payload shape would hash
    // identically to the event it was meant to be distinct from.
    const retyped = { ...draft, type: 'MOVE_BLOCKED' } as unknown as DraftEvent;
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent(retyped, null, 0));
  });

  it('changes when only the rng counter changes', () => {
    // Guards against rngCounter being left out of the hashed material. Without
    // this test, dropping the field entirely still passes every other case here
    // — and then a counter could be altered without altering the event id,
    // costing verifyChain half its teeth.
    expect(hashEvent(draft, null, 0)).not.toBe(hashEvent({ ...draft, rngCounter: 13 }, null, 0));
  });

  it('does not depend on the key order of the payload object', () => {
    const reordered: DraftEvent = {
      payload: { to: { y: 1, x: 2 }, from: { y: 1, x: 1 }, entityId: 'player' },
      rngCounter: 12,
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      type: 'MOVE',
    };
    expect(hashEvent(reordered, null, 0)).toBe(hashEvent(draft, null, 0));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/log/hash.test.ts`
Expected: FAIL — cannot resolve `../../src/log/hash.js`.

- [ ] **Step 7: Implement `src/log/hash.ts`**

Use whichever `@noble/hashes` import path Task 1 Step 7 confirmed.

```ts
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalJson } from './canonical.js';
import type { DraftEvent } from '../core/events.js';

/** Identity is content plus position: same event at a different point in the
 *  chain is a different event. */
export function hashEvent(draft: DraftEvent, parent: string | null, seq: number): string {
  const material = canonicalJson({
    type: draft.type,
    schemaVersion: draft.schemaVersion,
    rngCounter: draft.rngCounter,
    payload: draft.payload,
    parent,
    seq,
  });
  return bytesToHex(sha256(new TextEncoder().encode(material)));
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/log/canonical.ts src/log/hash.ts tests/log/canonical.test.ts tests/log/hash.test.ts
git commit -m "feat: canonical JSON and content-addressed event hashing"
```

---

### Task 9: The event chain — append, fold, verify

**Files:**
- Create: `src/log/chain.ts`
- Test: `tests/log/chain.test.ts`

**Interfaces:**
- Consumes: `DraftEvent`, `GameEvent` (Task 6); `apply` (Task 6); `GameState`, `EMPTY_STATE` (Task 4); `hashEvent` (Task 8); `createWorld`, `attemptMove`, `advanceTurn` (Task 7).
- Produces: `interface EventLog { events: Map<string, GameEvent> }`, `emptyLog(): EventLog`, `append(log, head, draft): { log: EventLog; event: GameEvent }`, `chain(log, head): GameEvent[]`, `fold(log, head): GameState`, `interface Divergence { seq: number; eventId: string; reason: string }`, `verifyChain(log, head): Divergence | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/log/chain.test.ts`:

```ts
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import type { EventLog } from '../../src/log/chain.js';
import type { GameEvent } from '../../src/core/events.js';

/** Builds a short but real run: a world, then a few steps. */
function build(): { log: EventLog; head: string } {
  let log = emptyLog();
  const first = append(log, null, createWorld(2026, 16, 12, 30));
  log = first.log;
  let head = first.event.id;

  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const state = fold(log, head);
    const moved = append(log, head, attemptMove(state, 'player', dx, dy));
    log = moved.log;
    head = moved.event.id;

    const turned = append(log, head, advanceTurn(fold(log, head)));
    log = turned.log;
    head = turned.event.id;
  }
  return { log, head };
}

describe('append', () => {
  it('links the first event to no parent at sequence zero', () => {
    const { event } = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    expect(event.parent).toBeNull();
    expect(event.seq).toBe(0);
    expect(event.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('increments the sequence and points at the previous head', () => {
    const first = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    const state = fold(first.log, first.event.id);
    const second = append(first.log, first.event.id, attemptMove(state, 'player', 1, 0));
    expect(second.event.seq).toBe(1);
    expect(second.event.parent).toBe(first.event.id);
  });

  it('does not mutate the log it was given', () => {
    // Starts from a log that already holds an event, so the assertion has
    // something to detect: against an empty log, a mutating append would look
    // identical to a copying one.
    const first = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    const sizeBefore = first.log.events.size;
    append(first.log, first.event.id, attemptMove(fold(first.log, first.event.id), 'player', 1, 0));
    expect(first.log.events.size).toBe(sizeBefore);
  });

  it('freezes the event it seals, so no holder can rewrite shared history', () => {
    // Log copies share event objects by reference, and fold does no hash check,
    // so an unfrozen event would let one holder silently derive a wrong state
    // for every fork descending from it.
    const { event } = append(emptyLog(), null, createWorld(1, 12, 8, 10));
    if (event.type !== 'WORLD_INIT') throw new Error('fixture problem: expected WORLD_INIT');

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.player.pos)).toBe(true);
    expect(Object.isFrozen(event.payload.tiles)).toBe(true);

    // No cast: the payload's fields are not declared readonly, so the type
    // system permits this write and only the freeze refuses it. That is the
    // hazard being closed — a plain typed assignment, no cast required.
    expect(() => {
      event.payload.seed = 999;
    }).toThrow(TypeError);
  });

  it('rejects a head it has never seen', () => {
    expect(() => append(emptyLog(), 'nope', createWorld(1, 12, 8, 10))).toThrow(/unknown head/);
  });

  it('returns the existing event and an unchanged log for a repeat append', () => {
    // Same content plus same position is the same event, not corruption.
    // Convergent history is ordinary once refs exist — undo a move and redo it,
    // or make the same move in two forks — so this must be idempotent.
    const draft = createWorld(1, 12, 8, 10);
    const first = append(emptyLog(), null, draft);
    const again = append(first.log, null, draft);

    expect(again.event).toBe(first.event);
    expect(again.log.events.size).toBe(first.log.events.size);
    expect(again.log).toBe(first.log);
  });

  it('lets a world redo a move it reset away', () => {
    // The regression that shipped: reset moves a head back, and the next press
    // of the same key reproduces an id already in the log. This threw, and the
    // debug view has no try/catch, so that key silently stopped working.
    const first = append(emptyLog(), null, createWorld(20260724, 24, 16, 60));
    let log = first.log;

    const moveOnce = (head: string): string => {
      const moved = append(log, head, attemptMove(fold(log, head), 'player', 1, 0));
      log = moved.log;
      return moved.event.id;
    };

    const afterFirst = moveOnce(first.event.id);
    // Rewind to before that move, then make exactly the same move again.
    expect(() => moveOnce(first.event.id)).not.toThrow();
    expect(moveOnce(first.event.id)).toBe(afterFirst);
  });
});

describe('chain', () => {
  it('is empty for a null head', () => {
    expect(chain(emptyLog(), null)).toEqual([]);
  });

  it('returns events root-first with contiguous sequence numbers', () => {
    const { log, head } = build();
    const events = chain(log, head);
    expect(events).toHaveLength(9); // 1 world init + 4 moves + 4 turn advances
    expect(events[0]?.type).toBe('WORLD_INIT');
    events.forEach((e, i) => expect(e.seq).toBe(i));
  });

  it('reports a missing event rather than returning a short chain', () => {
    const { log, head } = build();
    const broken: EventLog = { events: new Map(log.events) };
    const victim = chain(log, head)[4];
    if (victim === undefined) throw new Error('fixture problem: no event at index 4');
    broken.events.delete(victim.id);
    expect(() => chain(broken, head)).toThrow(/missing event/);
  });

  it('refuses a cycle rather than walking forever', () => {
    // Content addressing makes a real cycle unreachable by appending, so this
    // is a hand-forged log: two events made to point at each other. Without the
    // guard the walk never terminates and the process dies on memory rather
    // than reporting a corrupt log.
    const { log, head } = build();
    const events = chain(log, head);
    const earlier = events[1];
    const later = events[2];
    if (earlier === undefined || later === undefined) throw new Error('fixture problem');

    const looped: EventLog = { events: new Map(log.events) };
    looped.events.set(earlier.id, { ...earlier, parent: later.id } as GameEvent);

    expect(() => chain(looped, later.id)).toThrow(/cycle/);
  });
});

describe('fold', () => {
  it('gives the empty state for a null head', () => {
    expect(fold(emptyLog(), null)).toEqual(EMPTY_STATE);
  });

  it('is deterministic — two folds of one chain are identical', () => {
    const { log, head } = build();
    expect(JSON.stringify(fold(log, head))).toBe(JSON.stringify(fold(log, head)));
  });

  it('reaches a state where the player exists and turns have passed', () => {
    const { log, head } = build();
    const state = fold(log, head);
    expect(state.entities).toHaveLength(1);
    expect(state.turn).toBeGreaterThanOrEqual(2);
    expect(state.rngCounter).toBeGreaterThan(0);
  });

  it('folding a prefix gives the state as it was then', () => {
    const { log, head } = build();
    const events = chain(log, head);
    const third = events[2];
    if (third === undefined) throw new Error('fixture problem: no event at index 2');
    expect(fold(log, third.id).turn).toBeLessThanOrEqual(fold(log, head).turn);
  });
});

describe('verifyChain', () => {
  it('passes a chain built honestly', () => {
    const { log, head } = build();
    expect(verifyChain(log, head)).toBeNull();
  });

  it('passes an empty chain', () => {
    expect(verifyChain(emptyLog(), null)).toBeNull();
  });

  it('refuses an event type it cannot reduce, instead of folding to nothing', () => {
    // An alien type hashes perfectly well — hashing proves integrity, never
    // intelligibility. Before this check, fold() returned undefined while
    // verifyChain reported the log sound, which is precisely what the spec says
    // must never happen: abort and report, never silently continue. A log
    // written by a newer engine is the expected way this arrives.
    const alien = {
      type: 'STRIKE',
      schemaVersion: 1,
      rngCounter: 0,
      payload: { attacker: 'player', target: 'goblin', damage: 3 },
    } as unknown as DraftEvent;

    const { log, event } = append(emptyLog(), null, alien);
    const divergence = verifyChain(log, event.id);

    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/unknown event type STRIKE/);
  });

  it('refuses an event whose schemaVersion this engine does not implement', () => {
    const future = {
      type: 'MOVE',
      schemaVersion: 99,
      rngCounter: 0,
      payload: { entityId: 'player', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    } as unknown as DraftEvent;

    const { log, event } = append(emptyLog(), null, future);
    const divergence = verifyChain(log, event.id);

    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/schemaVersion 99/);
  });

  it('catches a tampered payload', () => {
    const { log, head } = build();
    const tampered: EventLog = { events: new Map(log.events) };
    const target = chain(log, head).find((e) => e.type === 'MOVE');
    if (target === undefined) throw new Error('fixture problem: no MOVE event');
    const forged = {
      ...target,
      payload: { ...target.payload, to: { x: 99, y: 99 } },
    } as GameEvent;
    tampered.events.set(target.id, forged);

    const divergence = verifyChain(tampered, head);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/hash mismatch/);
    expect(divergence?.seq).toBe(target.seq);
  });

  it('catches an rng counter that does not line up with the state', () => {
    // Built honestly, so every hash is valid and the counter check is the only
    // thing that can fire. The move claims a counter the state never reached.
    const first = append(emptyLog(), null, createWorld(555, 12, 8, 10));
    const state = fold(first.log, first.event.id);
    const player = state.entities[0];
    if (player === undefined) throw new Error('fixture problem: no player');

    const second = append(first.log, first.event.id, {
      type: 'MOVE',
      schemaVersion: SCHEMA_VERSIONS.MOVE,
      rngCounter: state.rngCounter + 999,
      payload: { entityId: 'player', from: { ...player.pos }, to: { ...player.pos } },
    });

    const divergence = verifyChain(second.log, second.event.id);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/rng counter/);
    expect(divergence?.seq).toBe(1);
  });
});
```

That last test needs two more imports at the top of the file:

```ts
import { SCHEMA_VERSIONS } from '../../src/core/events.js';
import type { DraftEvent } from '../../src/core/events.js';
```

`GameEvent` is already imported as a type and is still used by the tamper test above.
`DraftEvent` is needed by the two rejection tests, which cast synthetic events
past the union deliberately — they exercise what `verifyChain` does with input
the type system cannot vouch for, which is the only kind of input that matters
for a log read off disk.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/log/chain.test.ts`
Expected: FAIL — cannot resolve `../../src/log/chain.js`.

- [ ] **Step 3: Implement `src/log/chain.ts`**

```ts
import { apply } from '../core/apply.js';
import { EMPTY_STATE } from '../core/state.js';
import type { GameState } from '../core/state.js';
import type { DraftEvent, GameEvent } from '../core/events.js';
import { SCHEMA_VERSIONS } from '../core/events.js';
import { hashEvent } from './hash.js';

export interface EventLog {
  events: Map<string, GameEvent>;
}

export function emptyLog(): EventLog {
  return { events: new Map() };
}

/**
 * Freezes an event and everything reachable inside it.
 *
 * A log copy shares its event objects by reference — `new Map(log.events)`
 * duplicates the structure, not the values. Without this, one holder could
 * write `chain(log, head)[2].payload.to.x = 999` with no cast and silently
 * rewrite history for every fork sharing that event. `fold` performs no hash
 * check, so the result would be a different, plausible, wrong state rather
 * than an error, and `verifyChain` would only catch it if someone re-ran it.
 *
 * Note this reaches the caller's draft as well: `{ ...draft }` is a shallow
 * spread, so `event.payload` and `draft.payload` are one object. A caller that
 * keeps a draft and edits it after appending gets a TypeError thrown far from
 * its cause. Build a fresh draft per append instead of reusing one.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** Appends without mutating: returns a new log alongside the sealed event. */
export function append(
  log: EventLog,
  head: string | null,
  draft: DraftEvent,
): { log: EventLog; event: GameEvent } {
  let seq = 0;
  if (head !== null) {
    const parent = log.events.get(head);
    if (parent === undefined) throw new Error(`append: unknown head ${head}`);
    seq = parent.seq + 1;
  }

  const id = hashEvent(draft, head, seq);

  // Idempotent, not fatal. Identity is content plus position, so an id already
  // present means this exact event at this exact point in history already
  // exists — which is a legitimate, ordinary occurrence once refs exist:
  // reset a world and redo the move you just undid, or make the same move in
  // two forks of one state. Convergent history is a feature of content
  // addressing, and returning the existing event keeps the log append-only
  // while letting all three work.
  const existing = log.events.get(id);
  if (existing !== undefined) return { log, event: existing };

  const event = deepFreeze({ ...draft, id, parent: head, seq } as GameEvent);
  const events = new Map(log.events);
  events.set(id, event);
  return { log: { events }, event };
}

/** Ordered root first. Walks parent links backwards, then reverses. */
export function chain(log: EventLog, head: string | null): GameEvent[] {
  const out: GameEvent[] = [];
  const seen = new Set<string>();
  let cursor = head;

  while (cursor !== null) {
    if (seen.has(cursor)) throw new Error(`chain: cycle at ${cursor}`);
    seen.add(cursor);
    const event = log.events.get(cursor);
    if (event === undefined) throw new Error(`chain: missing event ${cursor}`);
    out.push(event);
    cursor = event.parent;
  }

  return out.reverse();
}

export function fold(log: EventLog, head: string | null): GameState {
  return chain(log, head).reduce(apply, EMPTY_STATE);
}

export interface Divergence {
  seq: number;
  eventId: string;
  reason: string;
}

/**
 * Recomputes every hash and checks each event's recorded counter against the
 * state it is about to be applied to. Returns null when the chain is sound.
 * Never repairs anything — a divergence is a fact to report, not to smooth over.
 */
export function verifyChain(log: EventLog, head: string | null): Divergence | null {
  // Treated as a runtime lookup table rather than a typed record, because the
  // whole point here is that the input is untrusted: an event's `type` is
  // `EventType` to the compiler but an arbitrary string in a log read off disk.
  const known: Record<string, number> = SCHEMA_VERSIONS;

  let state = EMPTY_STATE;
  let expectedSeq = 0;

  for (const event of chain(log, head)) {
    // `hashEvent` reads only type, schemaVersion, rngCounter and payload, and
    // GameEvent is DraftEvent plus its position fields, so the event goes
    // straight in. A hand-rolled projection here would be a second encoding of
    // "what gets hashed" — and forgetting to update it after adding a hashed
    // field would make every honest chain start failing verification.
    const recomputed = hashEvent(event, event.parent, event.seq);
    if (recomputed !== event.id) {
      return { seq: event.seq, eventId: event.id, reason: `hash mismatch, recomputed ${recomputed}` };
    }

    // Reject unreducible events *before* apply sees them. An alien type hashes
    // perfectly well — hashing proves integrity, never intelligibility.
    const version = known[event.type];
    if (version === undefined) {
      return { seq: event.seq, eventId: event.id, reason: `unknown event type ${String(event.type)}` };
    }
    if (event.schemaVersion !== version) {
      return {
        seq: event.seq,
        eventId: event.id,
        reason: `${event.type} is schemaVersion ${event.schemaVersion}, this engine implements ${version}`,
      };
    }

    if (event.seq !== expectedSeq) {
      return { seq: event.seq, eventId: event.id, reason: `sequence gap: expected seq ${expectedSeq}` };
    }
    expectedSeq += 1;

    if (state.rngCounter !== event.rngCounter) {
      return {
        seq: event.seq,
        eventId: event.id,
        reason: `rng counter recorded as ${event.rngCounter} but state is at ${state.rngCounter}`,
      };
    }

    state = apply(state, event);
  }

  return null;
}
```

- [ ] **Step 4: Run the chain tests**

Run: `npx vitest run tests/log/chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/log/chain.ts tests/log/chain.test.ts
git commit -m "feat: append-only event chain with fold and integrity verification"
```

---

### Task 10: Refs — worlds, forking, reset

**Files:**
- Create: `src/log/refs.ts`
- Test: `tests/log/refs.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `chain` (Task 9); `ENGINE_VERSION` (Task 1).
- Produces: `interface Ref { name: string; head: string | null; engineVersion: string; createdAtSeq: number; note: string }`, `interface Refs { byName: Map<string, Ref> }`, `emptyRefs(): Refs`, `createRef(refs, name, head, createdAtSeq, note): Refs`, `getRef(refs, name): Ref`, `setHead(refs, name, head): Refs`, `fork(log, refs, fromName, newName, atHash, note): Refs`, `reset(log, refs, name, toHash): Refs`, `listRefs(refs): Ref[]`, `isAncestor(log, head, candidate): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/log/refs.test.ts`:

```ts
import { emptyLog, append, chain, fold } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs, isAncestor } from '../../src/log/refs.js';
import { EMPTY_STATE } from '../../src/core/state.js';
import { ENGINE_VERSION } from '../../src/version.js';
import type { EventLog } from '../../src/log/chain.js';

function build(): { log: EventLog; head: string } {
  let log = emptyLog();
  const first = append(log, null, createWorld(31337, 16, 12, 30));
  log = first.log;
  let head = first.event.id;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 0], [0, 1]] as const) {
    const moved = append(log, head, attemptMove(fold(log, head), 'player', dx, dy));
    log = moved.log; head = moved.event.id;
    const turned = append(log, head, advanceTurn(fold(log, head)));
    log = turned.log; head = turned.event.id;
  }
  return { log, head };
}

describe('createRef and getRef', () => {
  it('stores a named ref stamped with the engine version', () => {
    const { head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, 'first run');
    const ref = getRef(refs, 'Ashfall');
    expect(ref.head).toBe(head);
    expect(ref.engineVersion).toBe(ENGINE_VERSION);
    expect(ref.note).toBe('first run');
  });

  it('refuses to overwrite an existing name', () => {
    const refs = createRef(emptyRefs(), 'Ashfall', null, 0, '');
    expect(() => createRef(refs, 'Ashfall', null, 0, '')).toThrow(/already exists/);
  });

  it('throws for a name it does not know', () => {
    expect(() => getRef(emptyRefs(), 'nowhere')).toThrow(/unknown ref/);
  });

  it('does not mutate the refs it was given', () => {
    const refs = emptyRefs();
    createRef(refs, 'Ashfall', null, 0, '');
    expect(refs.byName.size).toBe(0);
  });
});

describe('isAncestor', () => {
  it('is true for any event on the chain, including the head itself', () => {
    const { log, head } = build();
    const events = chain(log, head);
    const root = events[0];
    const middle = events[3];
    if (root === undefined || middle === undefined) throw new Error('fixture problem');
    expect(isAncestor(log, head, root.id)).toBe(true);
    expect(isAncestor(log, head, middle.id)).toBe(true);
    expect(isAncestor(log, head, head)).toBe(true);
  });

  it('is false for something not on the chain', () => {
    const { log, head } = build();
    expect(isAncestor(log, head, 'f'.repeat(64))).toBe(false);
  });
});

describe('fork', () => {
  it('creates a second world sharing the prefix, with no events copied', () => {
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem');

    const before = log.events.size;
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', at.id, 'what if');

    expect(log.events.size).toBe(before);
    expect(getRef(refs, 'Ashfall').head).toBe(head);
    expect(getRef(refs, 'Ashfall-b').head).toBe(at.id);
  });

  it('forks at the current head when no hash is given', () => {
    const { log, head } = build();
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', null, '');
    expect(getRef(refs, 'Ashfall-b').head).toBe(head);
  });

  it('records the fork point sequence, not the source head sequence', () => {
    // Every other fork test checks only .head, so dropping the `- 1` from the
    // seq arithmetic would ship silently.
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem: no event at index 4');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', at.id, '');

    expect(at.seq).toBe(4);
    expect(getRef(refs, 'Ashfall-b').createdAtSeq).toBe(4);
  });

  it('forks a ref whose head is null into another empty world', () => {
    const { log } = build();
    let refs = createRef(emptyRefs(), 'Unstarted', null, 0, '');
    refs = fork(log, refs, 'Unstarted', 'Unstarted-b', null, '');
    expect(getRef(refs, 'Unstarted-b').head).toBeNull();
    expect(getRef(refs, 'Unstarted-b').createdAtSeq).toBe(0);
  });

  it('the two worlds then diverge independently', () => {
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem');
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Ashfall-b', at.id, '');

    const forkHead = getRef(refs, 'Ashfall-b').head;
    const grown = append(log, forkHead, attemptMove(fold(log, forkHead), 'player', 0, 1));
    refs = setHead(refs, 'Ashfall-b', grown.event.id);

    expect(getRef(refs, 'Ashfall-b').head).not.toBe(getRef(refs, 'Ashfall').head);
    expect(fold(grown.log, getRef(refs, 'Ashfall').head).turn).toBeGreaterThanOrEqual(1);
  });

  it('rejects a fork point absent from the log', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => fork(log, refs, 'Ashfall', 'Ashfall-b', 'a'.repeat(64), '')).toThrow(/not on the chain/);
  });

  it('rejects a fork point that is in the log but on another branch', () => {
    // The case above proves less than it appears to: a hash absent from the log
    // is refused by chain()'s missing-event guard even with the ancestry check
    // removed, so it never exercises that check. This one uses a hash that is
    // genuinely in the log, just not an ancestor of the ref being forked.
    const { log, head } = build();
    const at = chain(log, head)[4];
    if (at === undefined) throw new Error('fixture problem: no event at index 4');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = fork(log, refs, 'Ashfall', 'Sidetrack', at.id, '');

    // Grow the fork so it holds an event Ashfall's own chain does not.
    const sideHead = getRef(refs, 'Sidetrack').head;
    const grown = append(log, sideHead, attemptMove(fold(log, sideHead), 'player', 0, 1));
    refs = setHead(refs, 'Sidetrack', grown.event.id);

    expect(() => fork(grown.log, refs, 'Ashfall', 'Bogus', grown.event.id, ''))
      .toThrow(/not on the chain/);
  });

  it('rejects a name already in use', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => fork(log, refs, 'Ashfall', 'Ashfall', null, '')).toThrow(/already exists/);
  });
});

describe('reset', () => {
  it('moves a head backwards without destroying anything', () => {
    const { log, head } = build();
    const target = chain(log, head)[2];
    if (target === undefined) throw new Error('fixture problem');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    const sizeBefore = log.events.size;
    refs = reset(log, refs, 'Ashfall', target.id);

    expect(getRef(refs, 'Ashfall').head).toBe(target.id);
    expect(log.events.size).toBe(sizeBefore);
  });

  it('can be undone, because the abandoned events are still there', () => {
    const { log, head } = build();
    const target = chain(log, head)[2];
    if (target === undefined) throw new Error('fixture problem');

    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = reset(log, refs, 'Ashfall', target.id);

    // The name of this test claims the events survive, so check that rather
    // than only that a pointer can be reassigned. Restoring a string would
    // pass even if reset had deleted everything it abandoned.
    expect(chain(log, head)).toHaveLength(9);
    expect(fold(log, head).turn).toBeGreaterThan(fold(log, target.id).turn);

    refs = setHead(refs, 'Ashfall', head);
    expect(getRef(refs, 'Ashfall').head).toBe(head);
    expect(fold(log, getRef(refs, 'Ashfall').head).turn).toBe(fold(log, head).turn);
  });

  it('refuses a target that is not an ancestor of the current head', () => {
    const { log, head } = build();
    const refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    expect(() => reset(log, refs, 'Ashfall', 'b'.repeat(64))).toThrow(/not on the chain/);
  });

  it('resets all the way back to nothing', () => {
    // A null target skips ancestry validation, since there is no chain to be on.
    // Folding the result returns the empty state, and the log keeps every event.
    const { log, head } = build();
    let refs = createRef(emptyRefs(), 'Ashfall', head, 8, '');
    refs = reset(log, refs, 'Ashfall', null);

    expect(getRef(refs, 'Ashfall').head).toBeNull();
    expect(fold(log, getRef(refs, 'Ashfall').head)).toEqual(EMPTY_STATE);
    expect(log.events.size).toBe(9);
  });
});

describe('listRefs', () => {
  it('lists by name, so display order never wobbles', () => {
    let refs = createRef(emptyRefs(), 'Zephyr', null, 0, '');
    refs = createRef(refs, 'Ashfall', null, 0, '');
    expect(listRefs(refs).map((r) => r.name)).toEqual(['Ashfall', 'Zephyr']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/log/refs.test.ts`
Expected: FAIL — cannot resolve `../../src/log/refs.js`.

- [ ] **Step 3: Implement `src/log/refs.ts`**

```ts
import { chain } from './chain.js';
import type { EventLog } from './chain.js';
import { ENGINE_VERSION } from '../version.js';

/** `readonly` throughout: `createRef` and `setHead` copy the Map but share every
 *  Ref they are not touching, so an in-place write would silently corrupt every
 *  other snapshot holding that same object. Fields are all primitives, so
 *  readonly closes it completely — no freeze traversal needed. */
export interface Ref {
  readonly name: string;
  readonly head: string | null;
  readonly engineVersion: string;
  readonly createdAtSeq: number;
  readonly note: string;
}

export interface Refs {
  byName: Map<string, Ref>;
}

export function emptyRefs(): Refs {
  return { byName: new Map() };
}

export function createRef(
  refs: Refs,
  name: string,
  head: string | null,
  createdAtSeq: number,
  note: string,
): Refs {
  if (refs.byName.has(name)) throw new Error(`createRef: ref ${name} already exists`);
  const byName = new Map(refs.byName);
  byName.set(name, { name, head, engineVersion: ENGINE_VERSION, createdAtSeq, note });
  return { byName };
}

export function getRef(refs: Refs, name: string): Ref {
  const ref = refs.byName.get(name);
  if (ref === undefined) throw new Error(`getRef: unknown ref ${name}`);
  return ref;
}

export function setHead(refs: Refs, name: string, head: string | null): Refs {
  const ref = getRef(refs, name);
  const byName = new Map(refs.byName);
  byName.set(name, { ...ref, head });
  return { byName };
}

/** True when `candidate` lies on the chain ending at `head`, head included. */
export function isAncestor(log: EventLog, head: string | null, candidate: string): boolean {
  if (head === null) return false;
  return chain(log, head).some((e) => e.id === candidate);
}

/**
 * A fork is a new name pointing at a hash that already exists. Nothing is
 * copied — both worlds share every event up to the fork point.
 */
export function fork(
  log: EventLog,
  refs: Refs,
  fromName: string,
  newName: string,
  atHash: string | null,
  note: string,
): Refs {
  const source = getRef(refs, fromName);
  if (refs.byName.has(newName)) throw new Error(`fork: ref ${newName} already exists`);

  const at = atHash ?? source.head;
  if (at !== null && !isAncestor(log, source.head, at)) {
    throw new Error(`fork: ${at} is not on the chain of ${fromName}`);
  }

  const seq = at === null ? 0 : chain(log, at).length - 1;
  return createRef(refs, newName, at, seq, note);
}

/**
 * Moves a ref backwards along its own chain. Non-destructive: the abandoned
 * events stay in the log, so the reset can itself be undone.
 */
export function reset(log: EventLog, refs: Refs, name: string, toHash: string | null): Refs {
  const ref = getRef(refs, name);
  if (toHash !== null && !isAncestor(log, ref.head, toHash)) {
    throw new Error(`reset: ${toHash} is not on the chain of ${name}`);
  }
  return setHead(refs, name, toHash);
}

export function listRefs(refs: Refs): Ref[] {
  return [...refs.byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/log/refs.ts tests/log/refs.test.ts
git commit -m "feat: named refs with free forking and undoable reset"
```

---

### Task 11: The golden replay test

**Files:**
- Create: `scripts/generate-golden.ts`, `tests/fixtures/golden-run.json` (generated, then committed), `tests/log/golden-replay.test.ts`
- Test: `tests/log/golden-replay.test.ts`

This script is the repo's first use of Node builtins (`node:fs`, `node:path`,
`node:url`), so it needs `@types/node` — already in Task 1's devDependencies for
that reason. Without it `tsc --noEmit` fails on the imports.

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: a committed fixture and the regression test that guards it.

**This is the most important test in the repo.** It is a *snapshot*: the fixture
is generated once, committed, and then treated as fixed. When it fails, that
means either a real regression or a deliberate behaviour change that needs a
`schemaVersion` bump and an upcaster. **Never regenerate the fixture to make the
test pass** — that silently deletes the guarantee the project rests on.

- [ ] **Step 1: Write the generator script**

Create `scripts/generate-golden.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../src/core/commands.js';
import { canonicalJson } from '../src/log/canonical.js';
import { ENGINE_VERSION } from '../src/version.js';

// A red golden-replay test means a real regression, or a deliberate behaviour
// change needing a schemaVersion bump and an upcaster. It does not mean the
// fixture is stale. Regenerating is the one action that silently destroys the
// guarantee this whole project rests on, and it was previously a single
// frictionless command — so it now requires saying so out loud.
if (process.env.ALLOW_GOLDEN_REGEN !== '1') {
  console.error(
    'Refusing to regenerate tests/fixtures/golden-run.json.\n\n' +
      'If the golden test is failing, diagnose the regression — do not replace\n' +
      'the fixture. If you genuinely intend to replace it, and have bumped the\n' +
      'affected schemaVersion and written any upcaster needed:\n\n' +
      '  ALLOW_GOLDEN_REGEN=1 npm run golden\n',
  );
  process.exit(1);
}

const SEED = 12345;
const WIDTH = 24;
const HEIGHT = 16;
const WALLS = 60;

/** Fixed, hand-written input script — 100 steps. Not generated, so it never drifts. */
const SCRIPT = 'NNEESSWWNESWNNWWSSEE'.repeat(5);

const STEPS: Record<string, readonly [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
};

let log = emptyLog();
const first = append(log, null, createWorld(SEED, WIDTH, HEIGHT, WALLS));
log = first.log;
let head = first.event.id;

for (const key of SCRIPT) {
  const step = STEPS[key];
  if (step === undefined) throw new Error(`bad script character ${key}`);
  const moved = append(log, head, attemptMove(fold(log, head), 'player', step[0], step[1]));
  log = moved.log;
  head = moved.event.id;

  const turned = append(log, head, advanceTurn(fold(log, head)));
  log = turned.log;
  head = turned.event.id;
}

const finalState = fold(log, head);
const fixture = {
  note: 'Generated once and committed. Never regenerate to make a failing test pass.',
  engineVersion: ENGINE_VERSION,
  seed: SEED,
  width: WIDTH,
  height: HEIGHT,
  walls: WALLS,
  script: SCRIPT,
  head,
  finalStateHash: bytesToHex(sha256(new TextEncoder().encode(canonicalJson(finalState)))),
  events: chain(log, head),
};

// fileURLToPath rather than import.meta.dirname, which needs Node 20.11+.
const out = fileURLToPath(new URL('../tests/fixtures/golden-run.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

console.log(`wrote ${out}`);
console.log(`events: ${fixture.events.length}`);
console.log(`head: ${head}`);
console.log(`finalStateHash: ${fixture.finalStateHash}`);
```

- [ ] **Step 2: Generate the fixture**

Run: `ALLOW_GOLDEN_REGEN=1 npm run golden`
Expected: prints `events: 201`, plus a head hash and a final state hash.

The env var is required by the guard above. This is the one time it should be
used — after this, a bare `npm run golden` refuses, which is the point.

- [ ] **Step 3: Write the golden replay test**

Create `tests/log/golden-replay.test.ts`:

```ts
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import fixture from '../fixtures/golden-run.json';
import { emptyLog, append, chain, fold, verifyChain } from '../../src/log/chain.js';
import { createWorld, attemptMove, advanceTurn } from '../../src/core/commands.js';
import { canonicalJson } from '../../src/log/canonical.js';
import { hashEvent } from '../../src/log/hash.js';
import type { EventLog } from '../../src/log/chain.js';
import type { DraftEvent, GameEvent } from '../../src/core/events.js';

const STEPS: Record<string, readonly [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
};

function logFromFixture(): EventLog {
  const events = new Map<string, GameEvent>();
  for (const event of fixture.events as unknown as GameEvent[]) events.set(event.id, event);
  return { events };
}

describe('golden replay', () => {
  it('has the expected shape', () => {
    expect(fixture.events).toHaveLength(201);
    expect(fixture.script).toHaveLength(100);
  });

  it('verifies: every hash recomputes and every rng counter lines up', () => {
    expect(verifyChain(logFromFixture(), fixture.head)).toBeNull();
  });

  it('folds to a state whose canonical hash matches the recorded one', () => {
    const state = fold(logFromFixture(), fixture.head);
    const digest = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(state))));
    expect(digest).toBe(fixture.finalStateHash);
  });

  it('folds identically twice', () => {
    const log = logFromFixture();
    expect(canonicalJson(fold(log, fixture.head))).toBe(canonicalJson(fold(log, fixture.head)));
  });

  it('rebuilds byte-identically from the seed and the script, so the whole pipeline is reproducible', () => {
    let log = emptyLog();
    const first = append(log, null, createWorld(fixture.seed, fixture.width, fixture.height, fixture.walls));
    log = first.log;
    let head = first.event.id;

    for (const key of fixture.script) {
      const step = STEPS[key];
      if (step === undefined) throw new Error(`bad script character ${key}`);
      const moved = append(log, head, attemptMove(fold(log, head), 'player', step[0], step[1]));
      log = moved.log;
      head = moved.event.id;
      const turned = append(log, head, advanceTurn(fold(log, head)));
      log = turned.log;
      head = turned.event.id;
    }

    expect(head).toBe(fixture.head);
    const rebuilt = chain(log, head);
    const recorded = fixture.events as unknown as GameEvent[];
    expect(rebuilt).toHaveLength(recorded.length);
    rebuilt.forEach((event, i) => {
      expect(canonicalJson(event)).toBe(canonicalJson(recorded[i]));
    });
  });

  it('detects a counter that disagrees with the state, even when the event hashes correctly', () => {
    // The flipped-tile case below can only ever fire the hash check, because
    // rngCounter is itself hashed — so no payload tamper can reach the counter
    // comparison, and deleting that whole branch would break nothing. This
    // forges the case the counter check actually exists for: an event that is
    // internally self-consistent but disagrees with the state the events before
    // it produce. A spliced or regrafted event looks exactly like this.
    const log = logFromFixture();
    const events = chain(log, fixture.head);
    const last = events[events.length - 1];
    if (last === undefined) throw new Error('fixture problem: empty chain');

    const drifted = { ...last, rngCounter: last.rngCounter + 1 };
    const reHashed = {
      ...drifted,
      id: hashEvent(
        {
          type: drifted.type,
          schemaVersion: drifted.schemaVersion,
          rngCounter: drifted.rngCounter,
          payload: drifted.payload,
        } as DraftEvent,
        drifted.parent,
        drifted.seq,
      ),
    } as GameEvent;
    log.events.set(reHashed.id, reHashed);

    const divergence = verifyChain(log, reHashed.id);
    expect(divergence).not.toBeNull();
    expect(divergence?.reason).toMatch(/rng counter/);
    expect(divergence?.seq).toBe(last.seq);
  });

  it('detects a single flipped tile in the recorded world', () => {
    const log = logFromFixture();
    const root = chain(log, fixture.head)[0];
    if (root === undefined || root.type !== 'WORLD_INIT') throw new Error('fixture problem: bad root');
    const tiles = [...root.payload.tiles];
    tiles[0] = tiles[0] === 0 ? 1 : 0;
    log.events.set(root.id, { ...root, payload: { ...root.payload, tiles } } as GameEvent);

    expect(verifyChain(log, fixture.head)).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/log/golden-replay.test.ts`
Expected: PASS, six tests.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-golden.ts tests/fixtures/golden-run.json tests/log/golden-replay.test.ts
git commit -m "test: golden replay fixture guarding byte-identical determinism"
```

---

### Task 12: Debug view — actually playable

**Files:**
- Create: `index.html`, `src/ui/debug.ts`, `src/ui/debug.css`
- Modify: none

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: nothing other tasks depend on. This is a temporary harness, replaced
  by the designed interface in a later increment. Keep it plain.

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>evolving-rpg — debug view</title>
    <link rel="stylesheet" href="/src/ui/debug.css" />
  </head>
  <body>
    <main id="app">
      <h1>debug view</h1>
      <p class="hint">Arrow keys or WASD to move. Everything you do becomes an event.</p>
      <div id="grid" class="grid" role="img" aria-label="game grid"></div>
      <dl id="readout" class="readout"></dl>
      <div class="controls">
        <button id="verify" type="button">Verify chain</button>
        <button id="fork" type="button">Fork here</button>
        <button id="rewind" type="button">Reset back 10 events</button>
      </div>
      <p id="status" class="status" role="status"></p>
      <ul id="refs" class="refs"></ul>
    </main>
    <script type="module" src="/src/ui/debug.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/ui/debug.css`**

```css
:root {
  --ground: #14161a;
  --ink: #e8e9ec;
  --soft: #9aa2b2;
  --wall: #2c3038;
  --floor: #1b1e24;
  --player: #f0ad3c;
  --rule: #333842;
}

body {
  margin: 0;
  padding: 2rem 1.5rem;
  background: var(--ground);
  color: var(--ink);
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

main { max-width: 60rem; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
h1 { font-size: 1rem; letter-spacing: .12em; text-transform: uppercase; color: var(--soft); margin: 0; }
.hint { margin: 0; color: var(--soft); }

.grid { display: grid; gap: 1px; width: max-content; overflow-x: auto; }
.cell { width: 20px; height: 20px; background: var(--floor); }
.cell.wall { background: var(--wall); }
.cell.player { background: var(--player); }

.readout { display: grid; grid-template-columns: max-content 1fr; gap: .2rem 1rem; margin: 0; }
.readout dt { color: var(--soft); }
.readout dd { margin: 0; font-variant-numeric: tabular-nums; }

.controls { display: flex; gap: .5rem; flex-wrap: wrap; }
button {
  font: inherit; color: var(--ground); background: var(--ink);
  border: 1px solid var(--ink); border-radius: 3px; padding: .35rem .8rem; cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--player); outline-offset: 2px; }

.status { margin: 0; min-height: 1.5em; color: var(--player); }
.refs { margin: 0; padding-left: 1.2rem; color: var(--soft); }
```

- [ ] **Step 3: Create `src/ui/debug.ts`**

```ts
import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld, attemptMove, advanceTurn } from '../core/commands.js';
import { WALL, idx } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { Refs } from '../log/refs.js';

const SEED = 20260724;
const WIDTH = 24;
const HEIGHT = 16;
const WALLS = 60;
const MAIN = 'main';

let log: EventLog = emptyLog();
let refs: Refs = emptyRefs();
let active = MAIN;
let forkCount = 0;

const first = append(log, null, createWorld(SEED, WIDTH, HEIGHT, WALLS));
log = first.log;
refs = createRef(refs, MAIN, first.event.id, 0, 'opening run');

const KEYS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node;
}

function say(message: string): void {
  el('status').textContent = message;
}

function render(): void {
  const head = getRef(refs, active).head;
  const state = fold(log, head);
  const player = state.entities[0];

  const grid = el('grid');
  grid.style.gridTemplateColumns = `repeat(${state.grid.width}, 20px)`;
  grid.textContent = '';
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (state.grid.tiles[idx(state.grid, x, y)] === WALL) cell.classList.add('wall');
      if (player !== undefined && player.pos.x === x && player.pos.y === y) cell.classList.add('player');
      grid.appendChild(cell);
    }
  }

  const rows: Array<readonly [string, string]> = [
    ['world', active],
    ['turn', String(state.turn)],
    ['position', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`],
    ['hp / might / wits / speed', player === undefined ? '—'
      : `${player.stats.hp} / ${player.stats.might} / ${player.stats.wits} / ${player.stats.speed}`],
    ['seed', String(state.seed)],
    ['rng counter', String(state.rngCounter)],
    ['events in chain', String(chain(log, head).length)],
    ['events in log', String(log.events.size)],
  ];
  const readout = el('readout');
  readout.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    readout.append(dt, dd);
  }

  const list = el('refs');
  list.textContent = '';
  for (const ref of listRefs(refs)) {
    const li = document.createElement('li');
    const marker = ref.name === active ? '→ ' : '  ';
    li.textContent = `${marker}${ref.name} @ ${String(ref.head).slice(0, 10)} (engine ${ref.engineVersion})`;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => { active = ref.name; say(`switched to ${ref.name}`); render(); });
    list.appendChild(li);
  }
}

function step(dx: number, dy: number): void {
  const head = getRef(refs, active).head;
  const moved = append(log, head, attemptMove(fold(log, head), 'player', dx, dy));
  log = moved.log;
  refs = setHead(refs, active, moved.event.id);

  const turned = append(log, moved.event.id, advanceTurn(fold(log, moved.event.id)));
  log = turned.log;
  refs = setHead(refs, active, turned.event.id);

  say(moved.event.type === 'MOVE_BLOCKED'
    ? `blocked: ${moved.event.payload.reason}`
    : '');
  render();
}

window.addEventListener('keydown', (event) => {
  const move = KEYS[event.key];
  if (move === undefined) return;
  event.preventDefault();
  step(move[0], move[1]);
});

el('verify').addEventListener('click', () => {
  const divergence = verifyChain(log, getRef(refs, active).head);
  say(divergence === null
    ? 'chain verified: every hash recomputes, every counter lines up'
    : `divergence at seq ${divergence.seq}: ${divergence.reason}`);
});

el('fork').addEventListener('click', () => {
  forkCount += 1;
  const name = `${active}-${forkCount}`;
  refs = fork(log, refs, active, name, null, 'forked from the debug view');
  active = name;
  say(`forked to ${name} — no events were copied`);
  render();
});

el('rewind').addEventListener('click', () => {
  const events = chain(log, getRef(refs, active).head);
  const target = events[Math.max(0, events.length - 11)];
  if (target === undefined) { say('nothing to rewind to'); return; }
  refs = reset(log, refs, active, target.id);
  say(`reset to seq ${target.seq} — the abandoned events are still in the log`);
  render();
});

render();
say('ready');
```

- [ ] **Step 4: Start the dev server and confirm it plays**

Run: `npm run dev`

Then open the printed URL and check, in order:

1. A grid draws with dark walls and one amber cell for the player.
2. Arrow keys move the player; walls refuse and the status line says `blocked: wall`.
3. `turn` and `events in chain` climb as you move. **`rng counter` must stay put** —
   only world creation draws from the generator, and a move consuming no
   randomness is exactly what makes a replay verifiable. If that number moves
   while you walk, the bug is in `apply`, not in the readout.
4. **Verify chain** reports the chain verified.
5. **Fork here** adds a second world to the list; the event count in the log does
   not jump, because forking copies nothing.
6. Clicking between worlds in the list swaps which one you are playing.
7. **Reset back 10 events** lowers the turn count while `events in log` stays put.

- [ ] **Step 5: Typecheck and run the whole suite once more**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; every test passes.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/debug.ts src/ui/debug.css
git commit -m "feat: debug view making the grid, forking and reset playable"
```

---

## Increment 1 done when

- `npx vitest run` is green and `npx tsc --noEmit` is clean.
- You can walk a character around a seeded grid in the browser.
- The golden fixture verifies, folds to its recorded hash, and rebuilds byte-identically from seed plus script.
- Forking creates a second world without copying a single event; reset moves a head back and can be undone.
