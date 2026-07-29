# Combat at Every Distance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ranged combat (the volley discipline) for player and creatures through the existing shared strike resolution, magic-ready via an open attack-mode field.

**Architecture:** One new pure-core module (`sight.ts`, the honest line), one new event type (`DRAWN`), one optional field on `STRIKE` (v4 `mode`), a seventh archetype (slinger, verb `volley`), a ranged relic (leaden sling, trait `'ranged'`), and stance rules in the reducer. Everything resolves at command time and replays verbatim; creature decisions stay drawless.

**Tech Stack:** TypeScript, Vitest, the repo's own event-sourced engine. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-combat-system-design.md`

## Global Constraints

- Branch: `increment-1-core-and-log`. Run everything from repo root `~/Code/evolving-rpg`.
- Covenant first: M7/M8 land before the facilities they bind (AGENTS.md rule).
- Every tuned number lives in `src/core/tables.ts` with its reason (`SHOT_RANGE = 5`).
- All randomness via counted draws; shots cost `STRIKE_DRAWS = 2` hit or miss; `decide()` stays drawless.
- New-event payload text obeys the register: lowercase, article-free kinds (`slinger`, `leaden sling`).
- Tests are mutation-proofed where the suite's idiom does it (prove the guard by breaking it in a sibling assertion or a dedicated test).
- Suite must end green: `npx vitest run`; types: `npm run typecheck`.
- Fixture churn is expected (new archetype moves every spawn draw): regenerate golden (`npm run golden`), keep sawtooth bands (d1 ≥ 14/20 brawler; d3 < d1, in [6,17], fighter over runner; d5 in [1,10]) by tuning slinger stats / weight / `VERB_THREAT.volley` — bands are law, exact counts are not.

---

### Task 1: Covenant M7 + M8

**Files:**
- Modify: `src/assay/covenant.ts` (append to `COVENANT` array)
- Test: `tests/assay/` or wherever `grep -rln "COVENANT" tests/` points (update any enforcer-listing test)

**Interfaces:**
- Produces: `invariant('M7')`, `invariant('M8')` defined.

- [ ] **Step 1: Failing test** — extend the existing covenant test (find with `grep -rln "invariant\|COVENANT" tests/`) with:

```ts
it('binds distance: M7 and M8 are stated with named enforcers', () => {
  for (const id of ['M7', 'M8']) {
    const inv = invariant(id);
    expect(inv).toBeDefined();
    expect(inv!.register).toBe('mechanical');
    expect(inv!.enforcedBy.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2:** `npx vitest run tests/assay` → FAIL (M7 undefined).
- [ ] **Step 3: Implement** — append to `COVENANT`:

```ts
Object.freeze({
  id: 'M7',
  register: 'mechanical' as const,
  statement: 'Distance is honest. A blow from afar flies only along a recorded straight line that walls, secrets and living bodies do not cross, within a stated reach, on the same bounded dice as every blow — and reach is priced into threat.',
  enforcedBy: 'clearShot/withinReach gates in looseShot; STRIKE v4 mode; VERB_THREAT.volley; sawtooth pins',
}),
Object.freeze({
  id: 'M8',
  register: 'mechanical' as const,
  statement: 'No shot without a warning. Every ranged blow, anyone\'s, is preceded by a visibly drawn stance at least one full action earlier; moving, striking, flinching or reeling spends the shot unfired.',
  enforcedBy: 'the drawn-tag gate in looseShot; the reducer\'s stance clearing; the stance tests',
}),
```

- [ ] **Step 4:** rerun → PASS. **Step 5:** `git add -A && git commit -m "Covenant M7, M8: distance is honest, and announced"`

---

### Task 2: The honest line — `src/core/sight.ts`

**Files:**
- Create: `src/core/sight.ts`
- Modify: `src/core/tables.ts` (add `SHOT_RANGE`)
- Test: `tests/core/sight.test.ts`

**Interfaces:**
- Produces: `withinReach(from: Pos, to: Pos, radius: number): boolean`; `clearShot(grid: Grid, entities: readonly Entity[], from: Pos, to: Pos): boolean`; `SHOT_RANGE = 5` (tables).

- [ ] **Step 1: Failing tests** (`tests/core/sight.test.ts`) — build a small grid via `makeGrid` with FLOOR/WALL/SECRET tiles; entities hand-built. Cases:

```ts
// reach: the fog's own disc
expect(withinReach({x:0,y:0}, {x:5,y:0}, 5)).toBe(true);   // 25 <= 30
expect(withinReach({x:0,y:0}, {x:4,y:4}, 5)).toBe(false);  // 32 > 30
expect(withinReach({x:0,y:0}, {x:5,y:2}, 5)).toBe(true);   // 29 <= 30
// open floor: clear both ways (symmetry)
// a wall square on the line blocks; so does SECRET
// a living body between blocks; a dead one does not; attacker/target tiles never block
// the kissing corner: diagonal shot with BOTH flanking cells wall → blocked;
//   one flanking wall only → clear (mutation proof of the both-rule)
// endpoint exclusion: target standing in wall-adjacent nook still hittable straight on
```

Write each as a real `it(...)` with explicit tile arrays (width 7, height 7 grids are enough).

- [ ] **Step 2:** `npx vitest run tests/core/sight.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/core/sight.ts`:

```ts
import { WALL, SECRET, tileAt, inBounds } from './grid.js';
import { isAlive } from './entity.js';
import type { Grid } from './grid.js';
import type { Entity, Pos } from './entity.js';

/** The reach disc, exactly the circle the fog draws (fov.ts): dx²+dy² ≤ r²+r. */
export function withinReach(from: Pos, to: Pos, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy <= radius * radius + radius;
}

/**
 * Whether a straight shot from `from` to `to` flies clear — covenant M7.
 * Integer supercover walk, center to center, symmetric by construction.
 * Walls and secrets block (an illusory wall is real enough to stop a stone,
 * both ways); living bodies block where the line truly crosses their tile;
 * a corner crossed exactly blocks only when BOTH flanking cells are solid.
 */
export function clearShot(grid: Grid, entities: readonly Entity[], from: Pos, to: Pos): boolean {
  const solid = (x: number, y: number): boolean => {
    if (!inBounds(grid, x, y)) return true;
    const t = tileAt(grid, x, y);
    return t === WALL || t === SECRET;
  };
  const stands = (x: number, y: number): boolean =>
    entities.some((e) => isAlive(e) && e.pos.x === x && e.pos.y === y
      && !(x === from.x && y === from.y) && !(x === to.x && y === to.y));

  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);

  let x = from.x;
  let y = from.y;
  let i = 0;
  let j = 0;
  while (i < dx || j < dy) {
    const tX = i < dx ? (2 * i + 1) * dy : Number.POSITIVE_INFINITY;
    const tY = j < dy ? (2 * j + 1) * dx : Number.POSITIVE_INFINITY;
    if (tX === tY) {
      if (solid(x + sx, y) && solid(x, y + sy)) return false;
      x += sx; y += sy; i += 1; j += 1;
    } else if (tX < tY) {
      x += sx; i += 1;
    } else {
      y += sy; j += 1;
    }
    if (x === to.x && y === to.y) break;
    if (solid(x, y) || stands(x, y)) return false;
  }
  return true;
}
```

And in `tables.ts` (the verbs section):

```ts
/** How far a loosed shot reaches, as the sight disc counts (dx²+dy² ≤ r²+r) —
 *  inside the deepest floor's sight (7), so nothing shoots out of the dark.
 *  Adjacency is refused separately: the bump owns range 1. */
export const SHOT_RANGE = 5;
```

- [ ] **Step 4:** rerun → PASS. **Step 5:** commit `"The honest line — supercover sight for shots"`.

---

### Task 3: Tables — the slinger, the volley, the leaden sling

**Files:**
- Modify: `src/core/tables.ts`
- Test: `tests/core/tables.test.ts` (or nearest existing tables test — `grep -rln "VERB_THREAT" tests/`)

**Interfaces:**
- Produces: `Verb` includes `'volley'`; `verbOf('slinger') === 'volley'`; `BESTIARY` slinger `{base 3/2/2/2, growth +1/+1/+1/0, weight 2, fromDepth 2}` placed after `caller`, before `warden`; `VERB_THREAT.volley = 1.25`; `ARMORY` gains `{kind:'leaden sling', grants:'might', base:1, per:3, weight:2}` appended last; `RELIC_TRAITS['leaden sling'] = 'ranged'` with the trait union widened to `'stagger-crit' | 'hold-ground' | 'ranged'` (also in `wearsTrait`'s parameter type).

- [ ] **Step 1: Failing tests**:

```ts
it('the slinger volleys, priced and gated below the teaching floor', () => {
  expect(verbOf('slinger')).toBe('volley');
  expect(verbOf('slinger-2')).toBe('volley');
  expect(VERB_THREAT.volley).toBeGreaterThan(1);      // priced, or floors overdraw
  const arch = archetype('slinger')!;
  expect(arch.fromDepth).toBe(2);                     // the first lesson stays melee
  expect(threatOf(creatureStats('slinger', 1)!, 'slinger'))
    .toBeGreaterThan(threatOf(creatureStats('slinger', 1)!));  // mutation proof of pricing
});
it('the leaden sling is the ranged trait and never dominates the keen edge', () => {
  expect(RELIC_TRAITS['leaden sling']).toBe('ranged');
  const sling = ARMORY.find((r) => r.kind === 'leaden sling')!;
  const edge = ARMORY.find((r) => r.kind === 'keen edge')!;
  expect(dominates(relicGrant(sling, 3), relicGrant(edge, 3))).toBe(false); // sword-or-sling is chosen, not walked into
  expect(wearsTrait({ weapon: { kind: 'leaden sling' } }, 'ranged')).toBe(true);
});
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement per Interfaces (slinger bestiary comment: *"the slinger: the fight starts before you arrive — its verb is the ground between you"*). **Step 4:** run → PASS (whole suite may drift — fixture churn lands in Task 8; run only the tables/sight tests here). **Step 5:** commit `"The slinger and the leaden sling — distance enters the tables"`.

---

### Task 4: Events and the reducer — STRIKE v4, DRAWN v1, stance law

**Files:**
- Modify: `src/core/events.ts`, `src/core/apply.ts`
- Test: `tests/core/apply.test.ts` (append a `describe('the volley discipline')`)

**Interfaces:**
- Produces: `SCHEMA_VERSIONS.STRIKE = 4`, `SCHEMA_VERSIONS.DRAWN = 1`; `StrikePayload.mode?: 'melee' | 'ranged'` (absence reads melee — the `motif` precedent, no upcaster; the field is an open string-union door for magic modes later); `DrawnPayload { entityId: string }`; `DraftEvent` gains the `DRAWN` arm.
- Reducer law: `DRAWN` writes tag `drawn` (replacing any `braced`); `BRACED` now also strips `drawn` (one stance per body); `staggered()` strips `drawn` (the flinch); a landed damaging `STRIKE` strips the target's `drawn`; miss-vs-brace staggers the attacker **only when `(p.mode ?? 'melee') === 'melee'`**; `WAIT` keeps `drawn` (still clears braced/staggered); `unbraced` is renamed/extended to `unstanced` clearing both tags for every acting path that used it (MOVE, STRIKE attacker, SHOVE shover, ITEM_USED).

- [ ] **Step 1: Failing tests** (hand-built states, the suite's existing idiom in `apply.test.ts`):

```ts
// DRAWN writes the tag and evicts a brace; BRACED evicts a draw
// a MOVE by the holder drops the draw; a WAIT holds it (assert tag survives)
// a landed blow with damage strips the target's draw; a miss leaves it
// SHOVE's stagger strips the draw (the flinch, via staggered())
// ranged miss vs a braced target does NOT stagger the shooter (mode gate);
//   melee miss vs braced still does (mutation proof both directions)
// STRIKE with mode:'ranged' still: reduces hp, credits kills/XP, honors crit
// an event stream with STRIKE lacking `mode` folds exactly as before (v3 reads melee)
```

Each as real `it(...)` with explicit before/after assertions.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement:

In `events.ts`: bump STRIKE to 4 with doc line *"v4, the modes: how far the blow flew. Absent reads melee (the motif precedent). An open door: later modes (bolt, blast) are new values, not new machinery."*; add `DRAWN: 1`; add payload + arm.

In `apply.ts`:

```ts
/** A stance ends the moment its holder acts — both stances, one law.
 *  WAIT is the deliberate exception for the draw: an archer may stand
 *  at full draw as long as they dare stand still. */
function unstanced(entities: readonly Entity[], actorId: string): readonly Entity[] {
  const held = entities.find((e) => e.id === actorId);
  if (held === undefined || (!held.tags.includes('braced') && !held.tags.includes('drawn'))) return entities;
  return entities.map((e) =>
    e.id === actorId ? { ...e, tags: e.tags.filter((t) => t !== 'braced' && t !== 'drawn') } : e,
  );
}

/** Reeling, at most once — and the reel shakes any drawn shot loose. */
function staggered(tags: string[]): string[] {
  const shaken = tags.filter((t) => t !== 'drawn');
  return shaken.includes('staggered') ? shaken : [...shaken, 'staggered'];
}
```

`DRAWN` arm:

```ts
case 'DRAWN': {
  const p = event.payload;
  return {
    ...state,
    entities: state.entities.map((e) =>
      e.id === p.entityId
        ? { ...e, tags: [...e.tags.filter((t) => t !== 'braced' && t !== 'drawn'), 'drawn'] }
        : e,
    ),
  };
}
```

`BRACED` arm mirrors (filter `drawn` and `braced`, then add `braced`). `STRIKE` arm: replace `unbraced(state.entities, p.attackerId)` with `unstanced(...)`; gate the guarded-miss stagger with `(p.mode ?? 'melee') === 'melee'`; in the target's landed branch, when `p.damage > 0`, filter `'drawn'` from tags before venom/stagger handling. MOVE/SHOVE/ITEM_USED swap `unbraced` → `unstanced`. WAIT arm unchanged.

- [ ] **Step 4:** `npx vitest run tests/core/apply.test.ts` → PASS. **Step 5:** commit `"STRIKE v4 and DRAWN — the stance law in the reducer"`.

---

### Task 5: Commands — draw, target, loose

**Files:**
- Modify: `src/core/commands.ts`
- Test: `tests/core/commands.test.ts` (append `describe('the volley')`)

**Interfaces:**
- Consumes: `clearShot`, `withinReach` (sight.js), `SHOT_RANGE`, `wearsTrait`, `verbOf` (tables.js).
- Produces:
  - `drawStance(state: GameState, entityId: string): Extract<DraftEvent, {type:'DRAWN'}> | null` — null unless alive and armed for distance (player: `wearsTrait(gear,'ranged')`; creature: `verbOf(kind)==='volley'`) and not already drawn.
  - `shotTarget(state: GameState, entityId: string): Entity | null` — nearest eligible hostile (alive, `manhattan !== 1`, `withinReach(..., SHOT_RANGE)`, `clearShot`), nearest by squared distance, ties to earlier entity order.
  - `looseShot(state: GameState, entityId: string, targetId: string): Extract<DraftEvent, {type:'STRIKE'}> | null` — null unless drawn and target eligible (same gates); resolves via the existing `resolveStrike`, `rngDraws: STRIKE_DRAWS`, `mode: 'ranged'`, never any movement rider.
  - Both melee STRIKE drafts (`attemptMove` bump, `lungeStrike`) now write `mode: 'melee'` explicitly.

- [ ] **Step 1: Failing tests** — hand-built states (grids via `makeGrid`, entities placed):

```ts
// drawStance: a slinger may; a skirmisher may not; the bare player may not;
//   the player wearing the leaden sling may; a drawn one returns null
// shotTarget: picks the nearest in the disc with a clear line; refuses the
//   orthogonally-adjacent; a body on the line disqualifies; tie → entity order
// looseShot: null when undrawn (M8's gate — mutation proof); resolves on the
//   shared dice (assert roll/needed match neededToHit incl. a braced target's
//   braceWall); rngDraws === STRIKE_DRAWS; mode === 'ranged'; no attackerTo/targetTo
// full circle: DRAWN then looseShot through append/fold — the shot kills, XP credits
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement (place after `braceSelf`; `canVolley` helper reads player-vs-creature armament; targeting comment: *"nearest by the disc, first by birth order — deterministic, and the UI says which"*). **Step 4:** run → PASS. **Step 5:** commit `"Draw, mark, loose — the volley commands"`.

---

### Task 6: The slinger's mind — `decide()`

**Files:**
- Modify: `src/core/ai.ts`
- Test: `tests/core/ai.test.ts` (append)

**Interfaces:**
- Consumes: `clearShot`, `withinReach`, `SHOT_RANGE`.
- Produces: `Action` union gains `{ kind: 'draw' }` and `{ kind: 'shoot'; targetId: string }`. Ladder for `verb === 'volley'`, inside the existing `!fooled` block, after adjacency-strike and lunge: if quarry in disc with a clear line → `shoot` when drawn else `draw`; otherwise fall through to the hunt. No retreat branch, ever.

- [ ] **Step 1: Failing tests**:

```ts
// adjacent slinger strikes (the club, not the sling)
// in range + clear line, undrawn → draw; drawn → shoot at the quarry
// line blocked by a wall/body → hunts (steps); smoke-fooled → walks the scent, never draws
// staggered slinger waits (existing law holds over the new verb)
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement:

```ts
// The volley: the fight starts before you arrive. Undrawn it draws — the
// tell everyone sees — and drawn it looses. No retreat ever: the tradition
// regrets dancing AI, and the slinger's menace is that it stands there.
if (verb === 'volley' && manhattan(self, quarry) !== 1
  && withinReach(self.pos, quarry.pos, SHOT_RANGE)
  && clearShot(state.grid, state.entities, self.pos, quarry.pos)) {
  return self.tags.includes('drawn')
    ? { kind: 'shoot', targetId: quarry.id }
    : { kind: 'draw' };
}
```

- [ ] **Step 4:** run → PASS. **Step 5:** commit `"The slinger stands and draws — volley in the creature's mind"`.

---

### Task 7: The session — draftFor, playerVolley, the loop closed

**Files:**
- Modify: `src/play/session.ts`
- Test: `tests/play/session.test.ts` (append; `ls tests/play/` to confirm the file name)

**Interfaces:**
- Consumes: `drawStance`, `looseShot`, `shotTarget` (commands.js).
- Produces: `draftFor` arms — `'draw'` → `drawStance(state, entityId)`, `'shoot'` → `looseShot(state, entityId, action.targetId)`; `playerVolley(position: Position, playerId: string): { position: Position; draft: DraftEvent | null }` — undrawn: draw (a turn) or quiet refusal when unarmed; drawn: loose at `shotTarget` (a turn) or quiet refusal holding the stance.

- [ ] **Step 1: Failing tests**:

```ts
// playerVolley without the sling: null draft, position unchanged (mispress)
// with the sling: first call → DRAWN on the chain, turn passed;
//   second call with a target → STRIKE mode 'ranged', turn passed
// drawn with no eligible target: null, stance still held, no turn burnt
// a slinger across runWorldTurns: draws on its beat, looses on the next —
//   the player's STRUCK rules fire on the shot (ratify a thorns rule, assert RULE_FIRED)
// replay: fold(chain) of the whole exchange re-folds bit-identical (verifyChain null)
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement (playerVolley mirrors `playerBrace`'s shape; the two-beat flow in one key is the volley's whole interface). **Step 4:** run → PASS. **Step 5:** commit `"One key, two beats — playerVolley and the loop closed"`.

---

### Task 8: Fixtures, sawtooth, sweeps — the re-pin

**Files:**
- Modify: `tests/balance/sawtooth.test.ts` (only if a band-internal count is asserted exactly), `tests/fixtures/golden-run.json` (regenerated), possibly slinger tuning in `src/core/tables.ts`
- Test: the whole suite

- [ ] **Step 1:** `npx vitest run` — expect fixture-dependent failures (spawn draws moved; the stinger/caller precedent).
- [ ] **Step 2:** `npm run golden` to regenerate; inspect the diff summary (`git diff --stat tests/fixtures/`).
- [ ] **Step 3:** `npx vitest run tests/balance/sawtooth.test.ts`. If a band breaches: tune in this order — slinger `weight` 2→1, `fromDepth` 2→3, growth row, `VERB_THREAT.volley` — re-running between. Bands, not exact counts, are the law. Record final counts for the NIGHTLOG.
- [ ] **Step 4:** `npm run balance` and `npm run play -- --policy all --seeds 12 --json` — read the ensemble; confirm depth-1 gentle and no survival collapse at 3/5.
- [ ] **Step 5:** `npx vitest run` → all green. `npm run typecheck` → clean. Commit `"The floors pay for the volley — golden and sawtooth re-pinned"`.

---

### Task 9: The player can see it — UI, words, names, docs

**Files:**
- Modify: `src/ui/debug.ts` (key `f`, KEYMAP entry, rail line, journal narration for DRAWN + ranged strikes, drawn-target highlight), `src/ui/words.ts` (volley swings + player shot pool), `src/canon/namesmith.ts` (bodies), `index.html` only if the help sheet needs static copy, `MANUAL.md`, `AGENTS.md`, `docs/design/BALANCE.md`
- Test: `tests/ui/words.test.ts` (append); live check in the browser pane

**Interfaces:**
- Consumes: `playerVolley`, `shotTarget`; `Blow` gains `ranged?: boolean`.

- [ ] **Step 1: words test:**

```ts
// a ranged mine-blow line mentions the stone, not the swing; volley swings exist;
// same seq asks answer the same line twice (existing idempotence law holds for the new pool)
```

- [ ] **Step 2:** implement words: `SWINGS.volley = ['stings', 'cracks']`; in `strikeLine`, when `blow.mine && blow.ranged`, use a shot pool (miss `your stone goes wide ${roll}` / `${them} leans off the line ${roll}`; hit `your stone takes ${them} for ${damage} ${roll}` / `you strike ${them} from afar — ${damage} ${roll}`; crit `the stone finds the seam — ${damage}, doubled ${roll}`; kill `${them} drops at distance — ${damage}, and the floor is quieter ${roll}`); creature shots reuse the shared templates with the volley swing word.
- [ ] **Step 3:** namesmith: `slinger: ['slinger', 'pelter', 'hurler']` in CREATURE_BODIES; `'leaden sling': ['sling', 'strap', 'cord']` in ITEM_BODIES. Run `npx vitest run tests/canon/namesmith.test.ts` (a register test may enumerate kinds).
- [ ] **Step 4:** debug.ts — mirror the `z`/brace wiring for `f` (clear `shoveArmed`, call the volley action); KEYMAP: `{ shown: 'f', what: 'draw the sling · loose the shot' }`; rail line adds `· drawn — a shot is coming` for creatures with the tag and, for the player, the chosen target's name while drawn; narration: DRAWN events say `the <name> draws` / `you draw — the sling waits on your stillness`; STRIKE mode ranged routes `ranged: true` into `strikeLine`; render the drawn player's `shotTarget` tile with a highlight class.
- [ ] **Step 5: Live verification** (memory's rule: verify UI in the browser pane; vite plugin changes need restart, forge dialog swallows keys — close it first): `npm run dev` via the preview tool, force navigate, play to a floor-2 slinger; confirm the draw tell in rail + journal, `f` flow with the sling, target highlight; screenshot for the record.
- [ ] **Step 6: Docs** — MANUAL.md jargon-free section (*draw, loose, and what stops a stone*: the f key, the two beats, the five answers to a drawn creature); AGENTS.md known-shape paragraph (the volley discipline, M7/M8, slinger, leaden sling); BALANCE.md rows (slinger line in the bestiary table, volley pricing note, sling in the armory table, SHOT_RANGE prose).
- [ ] **Step 7:** full suite + typecheck green. Commit `"The volley, seen and said — keys, words, names, manual"`.

---

### Task 10: The night log

- [ ] **Step 1:** run `date` (its own prior call — the six-drifts rule), then append the NIGHTLOG entry: the goal, the discipline in two sentences, the re-pinned numbers, what the live check showed.
- [ ] **Step 2:** commit `"Nightlog: combat at every distance"`.

## Self-review

- Spec coverage: modes/one-resolution (T4, T5), honest line (T2), volley stances (T4–T7), slinger (T3, T6), sling + f key (T3, T5, T7, T9), covenant-first (T1), pricing + re-pin (T3, T8), legibility (T9), magic door (T4 mode field, open union). Out-of-scope list untouched. ✓
- No placeholders: every step names its file, code, or command. ✓
- Type consistency: `drawStance`/`shotTarget`/`looseShot` signatures identical in T5 (producer) and T6/T7 (consumers); `mode` optional everywhere; `unstanced` only inside apply.ts. ✓
