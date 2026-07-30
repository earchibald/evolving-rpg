# Godot Phase 2 — The Sim Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the remaining ~6,900 lines of deterministic TypeScript engine into `godot/sim/` as pure typed GDScript, proven by the golden run folding to the identical `finalStateHash` the TypeScript engine signed.

**Architecture:** `godot/sim/` is a Node-free, signal-free, `Engine`-free GDScript twin of `src/core/` + `src/canon/{rule,interpret}` + `src/log/{chain,upcast,refs}`. State is **plain `Dictionary`/`Array` data mirroring the TS interfaces key-for-key** — never classes — because the fold hash is a canonical encoding of the whole state object, so a renamed or extra key is a forked chain. Functions live as `static` methods on `RefCounted` classes. Randomness enters only as `SimRng.u32/float01/int_between(seed, counter, …)`.

**Tech Stack:** Godot 4.7.1 (GDScript only, typed), GUT 9.7.1, `godot/test.sh` as the sole runner, the frozen TS engine at tag `ts-baseline` + `tsx` as the fixture oracle.

**Parent plan:** `docs/superpowers/plans/2026-07-29-godot-migration-master-plan.md` (Phase 2 charter).
**Corrected spec:** `docs/superpowers/specs/2026-07-29-godot-migration-spec.md`.

## What the gates do NOT cover (measured, and load-bearing on how you work)

The fold gate is the strongest assertion in this migration, and it is also narrower than it looks. Measured against the fixture and independently confirmed by review during Task 2.B4:

> **The golden run's 451 events exercise only 5 of the 25 event types.**
> `WORLD_INIT` v15, `MOVE` v2, `STRIKE` v5, `TURN_ADVANCED` v2, `ITEM_TAKEN` v5.

The other **20 have no witness in any parity gate**: `WORLD_BIBLE`, `WORLD_BODIES`, `MOVE_BLOCKED`, `WAIT`, `DRAWN`, `ITEM_REFUSED`, `ITEM_USED`, `SCROLL_READ`, `GOLD_MOVED`, `RULE_RATIFIED`, `RULE_FIRED`, `VIGIL_KEPT`, `WORLD_STIRRED`, `SHOVE`, `BRACED`, `CALLED`, `WORLD_REMEMBERED`, `UNMASKED`, `TRAP_SENSED`, `TRAP_SPRUNG`.

What follows from this, and it is not optional:

- **Passing 2.F1 does not mean `apply.gd` is right.** It means five of its twenty-five cases are right. The remaining twenty rest *entirely* on the ported unit suites — `tests/core/{apply,traps,scrolls,secrets,mimics,pockets,loot,purse,player-verbs,new-verbs,dispositions}` and friends. Those suites are therefore not a nice-to-have alongside the gate; for 80% of the reducer they **are** the verification. Port them completely and do not thin them.
- **The same hole covers four entity fields.** `route`, `scroll`, `pocket` and `satchel` never appear in the golden run's entities either, so the absent-key law is unwitnessed for exactly the fields most likely to get it wrong.
- **A "green gates" report must say which gates.** When a task claims parity, it says what its evidence covers. "The fold gate passes" is true and insufficient; "the fold gate passes, and these N event types are covered only by ported unit tests" is the honest form.
- Extending the golden fixture to exercise more types would close this, but regenerating it is a **designer-signed ceremony** (`ALLOW_GOLDEN_REGEN=1`, seed probing, the works) and is explicitly not in this plan's scope. It is on the record as an open question for the designer.

## Exit gates (all three must hold)

| Gate | Assertion | Task |
|---|---|---|
| **Fold parity** | `sha256(SimCanonical.encode(fold(golden.head)))` == `2272ed6ecd7e36e007c2514867a96aa7e3cb0778965405f2356100b5db260056` | 2.F1 |
| **Verify parity** | `verify_chain(golden.head)` returns `null` — hash + schema-version + seq + rng-counter accounting all agree | 2.F2 |
| **Suite parity** | Every ported GUT suite green; `./godot/test.sh` exit 0 with the script-count guard satisfied | 2.F3 |

Chain parity (`head` == `4821a3c9…`) already holds from Phase 1 and must never regress.

---

## Global Constraints

Every task's requirements implicitly include this section. These are inherited verbatim from the master plan plus the ones Phase 2 adds.

- **Engine:** Godot 4.7.1 standard CLI is the backbone. `project.godot` `config/features` stays pinned to `"4.6"` (Xogot 1.6.5 embeds 4.6.2.rc; the project must load in both). GDScript only — no C#. Typed GDScript everywhere (`func f(x: int) -> int`).
- **Purity of `godot/sim/`:** `RefCounted`/static classes only. No `Node`, no signals, no autoload access, no `Engine`/`Time`/`OS` reads, no `randi()`/`RandomNumberGenerator`. Sim files load nothing from `res://` except via arguments.
- **Covenant M4 (replay is exact):** state is folded from the chain; nothing re-decides recorded history or consumes unrecorded randomness.
- **Fixtures are law:** `godot/test/fixtures/*` and `tests/fixtures/golden-run.json` are committed and **never regenerated to make a failing test pass**. Regeneration requires designer sign-off and happens only from `ts-baseline`.
- **TS freeze:** `src/` is bugfix-only. Any TS change re-runs `npm run fixtures` and is called out to the designer.
- **Test runner:** `./godot/test.sh` only. It counts `test_*.gd` on disk and fails if fewer ran — a parse error is a skipped script, not a failing test, and GUT exits 0 on those. Never work around this guard.
- **GUT idiom: never `assert_ne(x, null)`.** GUT 9.7.1's comparator cannot diff against `null`; it pushes `"cannot set differences"` / `"Only Arrays and Dictionaries are supported"`, which GUT counts as an *unexpected error* and fails the test even when the assertion's intent holds. Use `assert_not_null(x)` / `assert_null(x)`. This bites on every port of a TS `expect(x).not.toBeNull()` or `toBeDefined()`, which is most suites — and the failure message points at the comparator, not at your test, so it costs a debugging session each time.
- **Already proven, do not re-litigate:** GDScript reproduces the state-hash recipe (`sha256` over `SimCanonical.encode(state)`) against the reference's own golden final state — see `godot/test/unit/test_state_shape.gd`. So when the 2.F1 fold gate fails, the encoder and the hash are *not* the suspects; `apply` is.
- **Mutation-proof discipline:** every ported suite gets at least one mutation spot-check — break the implementation guard, confirm the ported test fails, restore. Use `scripts/mutate-sim.py` (Task 2.A0). A mutation that turns out to be an *equivalent rewrite* is reported as a null result, not as a pass.
- **Behavioural doubt:** consult the TS source at tag `ts-baseline` (`git show ts-baseline:src/core/apply.ts`), never memory of it.
- **Repo voice:** commits are a single evocative line in the existing style plus `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- **No behaviour changes.** This is a port. A bug faithfully reproduced is a success; a bug fixed is a forked chain. Anything that looks wrong gets recorded in NIGHTLOG for the designer, and ported as-is.

---

## THE ABSENT-KEY LAW (read this before writing any state code)

The fold gate hashes **the entire GameState object**, canonically encoded:

```ts
finalStateHash: bytesToHex(sha256(new TextEncoder().encode(canonicalJson(finalState))))
```

`canonicalJson` sorts keys and **drops any key whose value is `undefined`** (`src/log/canonical.ts:38`). GDScript has no `undefined`. Therefore:

> **A TypeScript field that is `undefined` must be an ABSENT KEY in the GDScript Dictionary. It must NOT be `null`.**
> `null` encodes as `null` and changes the bytes. Absent encodes as nothing at all.

Conversely, a TS field explicitly set to `null` (`motif`, `bible`, `smoke`, `alarm`, `activeEntityId`) **must be present with value `null`**.

**This is measured, not inferred.** Task 2.A0's `state-shape.json` dump was read against the golden run, and these are the facts it reports:

- `GameState` has exactly **20 keys**: `activeEntityId alarm bible bodies depth entities gold grid items level motif rngCounter rules seed smoke story traps turn unveiled xp`.
- In the golden final state, **`alarm`, `bible` and `smoke` are present with value `null`**. (`motif` and `activeEntityId` are nullable in the type and null in `EMPTY_STATE`, but carry values by the end of this run — so all five must be *present*, and their value is whatever the fold produces.)
- The golden run's four entities use this key union: `disposition gear id kind maxHp pos post stats tags`. **`disposition` is present on 2 of 4 and `gear` on 1 of 4** — absent on the rest, **not null**. Those two are the discriminating cases: get them wrong and the fold hash misses while every individual entity still looks plausible.
- `route`, `scroll`, `pocket` and `satchel` never appear in this run at all. They are still absent-when-unset fields — they just aren't exercised by golden, so **no gate will catch a mistake in them.** Wave E's suites are the only thing that will.

| Interface | Fields that must be ABSENT when unset |
|---|---|
| `Entity` (`src/core/entity.ts:14`) | **All nine, verified exhaustive against `ts-baseline` during Task 2.A2 and confirmed by review:** `post`, `disposition`, `route`, `leg`, `guise`, `scroll`, `pocket`, `gear`, `satchel`. The six always-present fields are `id`, `kind`, `pos`, `stats`, `tags`, `maxHp`. |
| `Blow` (`src/canon/interpret.ts:37`) | all fields (defaults to `{}`) |

**`gear` is a dict keyed by slot**, not a list like `satchel`. The law very likely applies one level down — an unworn slot is an absent key *inside* `gear`, not a `null` — but that is inference, not measurement: the golden run has one entity with `gear` and it does not exercise an empty slot. Whichever task first writes `gear` must check the reference and settle it.

**A warning about the absent-key tests themselves.** The entity-level test given in Task 2.A2 (`test_optional_fields_are_absent_not_null`) is **tautological, and known to be** — it hand-builds a Dictionary literal without the optional keys and then asserts the literal lacks them, which is true by construction. Nothing in `entity.gd` can fail it, because `entity.gd` has no builder. It is kept as executable documentation of the law, not as a guard. **The real guard has to live where entities are first CONSTRUCTED — `apply.gd`'s `WORLD_INIT` case, Task 2.C1.** That task must add a non-tautological regression test: build an entity through the actual reducer path, then assert the constructed entity has no `null`-valued keys and that its absent optionals are absent. Without that, the law is asserted nowhere that could ever break.

**Enforcement:** Task 2.B2 ships `SimState.assert_shape(state)` and every wave from B onward calls it in tests. `test_state_shape.gd` (shipped in 2.A0) already pins the oracle itself, so a drifting dump is caught before anything is measured against it.

A second, quieter trap: **integers**. Every number in the state is an integer. `SimCanonical.encode` refuses fractional floats and folds integral floats to int form, but a GDScript division (`/`) yields float. Use integer division (`floori`, or `int(a / b)` only where the TS used `Math.floor`) and match the TS rounding exactly.

---

## What Phase 1 already delivered (consume these exactly as named)

```gdscript
SimRng.u32(seed: int, counter: int) -> int
SimRng.float01(seed: int, counter: int) -> float
SimRng.int_between(seed: int, counter: int, min_v: int, max_v: int) -> int
SimRng.imul32(a: int, b: int) -> int

SimCanonical.encode(value: Variant) -> String          # sorted keys, no whitespace

SimHash.hash_event(draft: Dictionary, parent: Variant, seq: int) -> String

SimLog.new()                                            # RefCounted
SimLog.events: Dictionary                               # id -> sealed event
SimLog.append(head: Variant, draft: Dictionary) -> Dictionary
SimLog.chain(head: Variant) -> Array                    # root-first
# Phase 2 ADDS to this class: fold(), verify_chain()

FixtureLoader.load_json(path: String) -> Variant          # chain/state: fractional REFUSED
FixtureLoader.load_table_json(path: String) -> Variant    # tables: fractional coefficients KEPT
FixtureLoader.normalize(value: Variant, allow_fractional := false) -> Variant
```

**Which loader, and why it matters.** Both fold integral floats to `int`, so an integer is always an `int`. They differ only on fractional numbers: `load_json` crashes (in a chain or state fixture a fraction is corruption), `load_table_json` keeps them. **`tables.json` genuinely contains nine fractional numbers** — `VERB_THREAT` prices verbs at 1.1–1.3, and `bountyStretch((S+1)/2)` returns 1.5 and 2.5. Those are the data; rounding them would hide the integer-division bug class their rows exist to catch. So **`tables.json` must be read with `load_table_json`**; every other fixture uses `load_json`. Nothing fractional ever reaches `SimCanonical`, because the state stores the integer *results* of these coefficients, never the coefficients.

Files: `godot/sim/{rng,canonical,hashing,log}.gd`, `godot/test/support/fixture_loader.gd`.

---

## File Structure (target at end of Phase 2)

```
godot/sim/
├── rng.gd canonical.gd hashing.gd log.gd   # Phase 1 (log.gd gains fold/verify_chain)
├── grid.gd            # Wave A — SimGrid
├── entity.gd          # Wave A — SimEntity
├── item.gd            # Wave A — SimItem
├── rule.gd            # Wave A — SimRule (R2 vocabulary + validation)
├── tables.gd          # Wave B — SimTables (the bestiary and the math)
├── state.gd           # Wave B — SimState (EMPTY_STATE + shape assertion)
├── events.gd          # Wave B — SimEvents (SCHEMA_VERSIONS + draft builders)
├── upcast.gd          # Wave B — SimUpcast
├── refs.gd            # Wave B — SimRefs
├── interpret.gd       # Wave B — SimInterpret (holds/fireRules/applyResolved)
├── apply.gd           # Wave C — SimApply  (OPUS AUTHORS OR LINE-REVIEWS)
├── mapgen.gd          # Wave D — SimMapgen
├── reachability.gd    # Wave D — SimReach   (verbatim; AStarGrid2D FORBIDDEN)
├── sight.gd           # Wave D — SimSight   (verbatim)
├── turns.gd           # Wave E — SimTurns
├── ai.gd              # Wave E — SimAi
└── commands.gd        # Wave E — SimCommands (split across 5 subagent tasks)
godot/test/unit/       # test_*.gd, one per sim file plus the gates
godot/test/fixtures/   # extended per wave by scripts/export-fixtures.ts
scripts/mutate-sim.py  # Task 2.A0 — mutation harness with per-target assert count
```

---

# Wave A — the leaves (parallel: A1–A4 independent after A0)

Nothing here reads state; these are the value types and the rule vocabulary.

### Task 2.A0: The mutation harness and the TS shape oracle

**Files:**
- Create: `scripts/mutate-sim.py`
- Modify: `scripts/export-fixtures.ts` (add the state-shape dump)
- Create (generated, committed): `godot/test/fixtures/state-shape.json`

**Interfaces:**
- Produces: `python3 scripts/mutate-sim.py <name> [restore]` — applies one named mutation to one sim file, asserting exactly one occurrence. Every later task's mutation step calls it.
- Produces: `godot/test/fixtures/state-shape.json` — `{"emptyState": <keys>, "goldenFinal": <the full folded state>}`. Task 2.B2 and the Wave F gate assert against it.

- [ ] **Step 1: Write the mutation harness**

```python
#!/usr/bin/env python3
"""Apply one named mutation to a sim file, with a per-target assert count.

Two silent no-op edits in this repo's history taught the assert: a mutation
proof that silently failed to mutate is a proof that proves nothing.

Usage:  python3 scripts/mutate-sim.py <name>
        python3 scripts/mutate-sim.py <name> restore
"""
import sys

# name -> (path, original, mutant). Add one row per mutation proof; keep the
# row after the proof lands so the next porter can re-run it.
MUTATIONS = {
    "canonical-sort": (
        "godot/sim/canonical.gd",
        "\t\t\tkeys.sort()",
        "\t\t\tkeys.sort_custom(func(x, y): return str(x).to_lower() < str(y).to_lower())",
    ),
}

name = sys.argv[1]
restore = len(sys.argv) > 2 and sys.argv[2] == "restore"
path, original, mutant = MUTATIONS[name]
src = open(path).read()
find, put = (mutant, original) if restore else (original, mutant)
count = src.count(find)
assert count == 1, f"{name}: expected exactly 1 occurrence in {path}, found {count}"
open(path, "w").write(src.replace(find, put))
print(f"{'restored' if restore else 'mutated'}: {name} in {path}")
```

- [ ] **Step 2: Add the state-shape dump to the exporter**

Append to `scripts/export-fixtures.ts` (before the `copyFileSync` line), adding the two imports at the top:

```ts
import { emptyLog, append, chain, fold } from '../src/log/chain.js';
import { EMPTY_STATE } from '../src/core/state.js';
import goldenRun from '../tests/fixtures/golden-run.json' with { type: 'json' };
```

```ts
// state-shape: the exact GameState the golden chain folds to, plus the empty
// baseline. The fold gate hashes canonicalJson(state), so the GDScript state
// dict must match this object KEY FOR KEY — including which optional keys are
// absent rather than null. Dumping it makes that comparison mechanical.
let shapeLog = emptyLog();
let shapeHead: string | null = null;
for (const raw of goldenRun.events as unknown[]) {
  const e = raw as { type: string; schemaVersion: number; rngCounter: number; rngDraws: number; payload: unknown };
  const appended = append(shapeLog, shapeHead, e as never);
  shapeLog = appended.log;
  shapeHead = appended.event.id;
}
writeFileSync(
  `${OUT}/state-shape.json`,
  JSON.stringify({
    emptyState: EMPTY_STATE,
    emptyStateKeys: Object.keys(EMPTY_STATE).sort(),
    goldenFinal: fold(shapeLog, shapeHead),
    goldenChainLength: chain(shapeLog, shapeHead).length,
  }, null, 2),
);
```

- [ ] **Step 3: Run and confirm the dump agrees with the recorded hash**

Run: `npm run fixtures && npx tsx -e 'x'` — no: write `.scratch-shape.ts` at the repo root:

```ts
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalJson } from './src/log/canonical.js';
const shape = JSON.parse(readFileSync('godot/test/fixtures/state-shape.json', 'utf8'));
const golden = JSON.parse(readFileSync('tests/fixtures/golden-run.json', 'utf8'));
const h = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(shape.goldenFinal))));
console.log(h === golden.finalStateHash ? 'OK  shape dump reproduces finalStateHash' : `MISMATCH ${h}`);
console.log('chain length', shape.goldenChainLength, 'want', golden.events.length);
```

Run: `npx tsx .scratch-shape.ts && rm .scratch-shape.ts`
Expected: `OK  shape dump reproduces finalStateHash` and `chain length 451 want 451`.
**If MISMATCH: STOP.** The dump is not the state the fixture recorded; nothing downstream can be trusted against it.

- [ ] **Step 4: Commit** — `git add scripts/mutate-sim.py scripts/export-fixtures.ts godot/test/fixtures/state-shape.json`

### Task 2.A1: `sim/grid.gd`

**Files:**
- Create: `godot/sim/grid.gd`, `godot/test/unit/test_grid.gd`
- Port from: `src/core/grid.ts` (50 lines), `tests/core/grid.test.ts` (9 tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
```gdscript
class_name SimGrid
const FLOOR := 0
const WALL := 1
const EXIT := 2
const SECRET := 3
static func make(width: int, height: int, tiles: Array) -> Dictionary   # {"width","height","tiles"}
static func idx(grid: Dictionary, x: int, y: int) -> int
static func in_bounds(grid: Dictionary, x: int, y: int) -> bool
static func tile_at(grid: Dictionary, x: int, y: int) -> int
static func is_passable(grid: Dictionary, x: int, y: int) -> bool
```
  A grid is the Dictionary `{"width": int, "height": int, "tiles": Array[int]}` — those three key names exactly, because `GameState.grid` is hashed.

- [ ] **Step 1: Read the reference** — `git show ts-baseline:src/core/grid.ts` and `git show ts-baseline:tests/core/grid.test.ts`.

- [ ] **Step 2: Port the test suite first.** One GUT `func test_*` per TS `it(...)`, keeping the TS test's wording in the function name so the two suites can be diffed by eye. Add this shape assertion, which the TS suite has no need for:

```gdscript
func test_grid_is_the_three_hashed_keys_and_nothing_else() -> void:
	var g := SimGrid.make(2, 1, [SimGrid.FLOOR, SimGrid.WALL])
	var keys: Array = g.keys()
	keys.sort()
	assert_eq(keys, ["height", "tiles", "width"], "GameState.grid is hashed; extra keys fork the chain")
```

- [ ] **Step 3: Run to RED** — `./godot/test.sh`. Expected: the guard reports fewer scripts than files, and `Identifier "SimGrid" not declared`.

- [ ] **Step 4: Port the implementation.** `tile_at` must return `WALL` out of bounds if that is what the TS does — check, do not assume. `is_passable` treats `WALL` and `SECRET` per the reference; an untrodden secret is impassable to sight but passable to feet, and getting that backwards changes every hunt.

- [ ] **Step 5: Run to GREEN** — `./godot/test.sh`, exit 0, script count satisfied.

- [ ] **Step 6: Mutation spot-check.** Add a `grid-bounds` row to `MUTATIONS` that flips `in_bounds`'s `<` to `<=`; confirm at least one test fails; restore.

- [ ] **Step 7: Commit.**

### Task 2.A2: `sim/entity.gd`

**Files:**
- Create: `godot/sim/entity.gd`, `godot/test/unit/test_entity.gd`
- Port from: `src/core/entity.ts` (80 lines), `tests/core/entity.test.ts` (6 tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
```gdscript
class_name SimEntity
static func find(entities: Array, id: String) -> Variant      # the Dictionary, or null when absent
static func is_alive(entity: Dictionary) -> bool
```
  An entity is a plain Dictionary mirroring `Entity` key-for-key. A `Pos` is `{"x": int, "y": int}`. `Stats` is `{"hp": int, "might": int, "wits": int, "speed": int}`.

- [ ] **Step 1: Read `git show ts-baseline:src/core/entity.ts` IN FULL** and write down every `?`-marked field. Those are the absent-key fields.

- [ ] **Step 2: Port the test suite,** plus this one, which is the absent-key law made executable:

```gdscript
func test_optional_fields_are_absent_not_null() -> void:
	## TS canonicalJson DROPS undefined keys. A GDScript null would encode as
	## `null` and fork every chain that folds an entity without a satchel.
	var plain := {"id": "p1", "kind": "player", "pos": {"x": 1, "y": 1},
		"stats": {"hp": 3, "might": 1, "wits": 1, "speed": 1}}
	assert_false(plain.has("route"), "route is absent, never null")
	assert_false(plain.has("scroll"), "scroll is absent, never null")
	assert_false(plain.has("pocket"), "pocket is absent, never null")
	assert_false(plain.has("satchel"), "satchel is absent, never null")
	assert_false(SimCanonical.encode(plain).contains("null"),
		"a plain entity encodes with no nulls at all")
```

- [ ] **Step 3: Run to RED. Step 4: Implement. Step 5: Run to GREEN.**

- [ ] **Step 6: Mutation spot-check** — make `is_alive` ignore the hp check; confirm failure; restore. **Step 7: Commit.**

### Task 2.A3: `sim/item.gd`

**Files:**
- Create: `godot/sim/item.gd`, `godot/test/unit/test_item.gd`
- Port from: `src/core/item.ts` (32 lines), `tests/core/equipment.test.ts` (6 tests — item parts only)

**Interfaces:**
- Consumes: nothing.
- Produces:
```gdscript
class_name SimItem
const NOTHING := {"hp": 0, "might": 0, "wits": 0, "speed": 0}
static func granted(stats: Dictionary, grants: Dictionary) -> Dictionary   # stat-wise sum, new dict
static func at(items: Array, x: int, y: int) -> Variant                    # the Dictionary, or null
```
  An item is `{"id": String, "kind": String, "pos": {"x","y"}, "grants": Stats}`.

- [ ] **Step 1: Read the reference.** `granted` sums stat-wise and must **not** clamp — the heavy edge rides negative (`Relic.costs`), and clamping would silently buff it.

- [ ] **Step 2: Port the suite,** including a negative-grant case:

```gdscript
func test_grants_ride_negative_because_the_heavy_edge_costs() -> void:
	var out := SimItem.granted({"hp": 4, "might": 2, "wits": 2, "speed": 3},
		{"hp": 0, "might": 3, "wits": 0, "speed": -1})
	assert_eq(out["might"], 5)
	assert_eq(out["speed"], 2, "a cost is subtracted, never clamped to zero")
```

- [ ] **Step 3: RED. Step 4: Implement. Step 5: GREEN. Step 6: Mutation** — clamp `granted` at 0, confirm the negative case fails, restore. **Step 7: Commit.**

### Task 2.A4: `sim/rule.gd` — the R2 vocabulary

**Files:**
- Create: `godot/sim/rule.gd`, `godot/test/unit/test_rule.gd`, `godot/test/unit/test_vocabulary.gd`
- Port from: `src/canon/rule.ts` (492 lines), `tests/canon/rule.test.ts` (20), `tests/canon/vocabulary.test.ts` (33)

**Interfaces:**
- Consumes: nothing.
- Produces:
```gdscript
class_name SimRule
const TRIGGERS: Array[String] = [...]        # exact list from rule.ts:30
const STATS: Array[String] = ["might", "speed", "wits", "maxHp"]
const MOTIF_NAMES: Array[String] = ["door", "warren", "halls"]
const CONDITION_KINDS: Array[String] = [...] # rule.ts:169
const EFFECT_KINDS: Array[String] = [...]    # rule.ts:177
const BLOW_CONDITIONS: Array[String] = ["blowLanded", "blowMissed"]
const STAT_KINDS: Array[String] = ["statAtLeast", "grant", "drain"]
const MOTIF_KINDS: Array[String] = ["motifIs"]
const MAX_CONDITIONS := 4
const MAX_EFFECTS := 3
const MAX_TEXT := 120
const MAX_BECAUSE := 240
const MAX_RULES := 16
static func range_of(kind: String) -> Variant           # [min, max] Array, or null
static func takes_stat(kind: String) -> bool
static func takes_motif(kind: String) -> bool
static func takes_number(kind: String) -> bool
static func needs_triggers(kind: String) -> Variant     # Array[String], or null
static func validate(raw: Variant) -> Dictionary        # a Rule dict, or {"rejected": String}
static func is_rejected(r: Dictionary) -> bool
static func read_rule(rule: Dictionary) -> String       # the human sentence
```

- [ ] **Step 1: Read `git show ts-baseline:src/canon/rule.ts` in full.** Every constant is a balance decision the assay depends on; copy the numbers, do not re-derive them.

- [ ] **Step 2: Port both suites.** `validateRule` takes untrusted input and its *rejection strings* are asserted by the TS tests — port them character-for-character, because the Forge shows them to the player.

- [ ] **Step 3: RED. Step 4: Implement.** `validate` returns either a Rule dict or `{"rejected": "<reason>"}`; there is no exception path. **Step 5: GREEN.**

- [ ] **Step 6: Mutation** — raise `MAX_CONDITIONS` to 5; confirm a bounds test fails; restore. **Step 7: Commit.**

---

# Wave B — state, events and the interpreter (B1 first, then B2–B5 parallel)

### Task 2.B1: extend the fixture export for tables and mapgen

**Files:**
- Modify: `scripts/export-fixtures.ts`
- Create (generated, committed): `godot/test/fixtures/tables.json`, `godot/test/fixtures/mapgen.json`

**Interfaces:**
- Produces: `tables.json` — `{damageDice, neededToHit, chanceIn20, critFloor, threatOf, creatureStats, xpToReach, levelForXp, growthAt, sizeStretch, bountyStretch}`, each an array of `{args, value}` rows. `mapgen.json` — a full `generateMap` result for seeds 17, 99 and 12345 at 48×32 and 96×64.
- Consumed by: Task 2.B3 (tables) and Task 2.D1 (mapgen). **Both are blocked on this task.**

- [ ] **Step 1: Add the dumps.** Cover every exported numeric function in `src/core/tables.ts` across its whole meaningful domain (might 0–20, wits 0–20, levels 1–12, every `BESTIARY` kind at levels 1–10, board sizes 48×32 / 96×64 / 128×96). Dump `BESTIARY` itself verbatim so the GDScript table is diffable rather than retyped-and-hoped.

- [ ] **Step 2: Run `npm run fixtures`** and confirm both files are non-empty and that `mapgen.json`'s boards have `width*height` tiles.

- [ ] **Step 3: Commit.**

### Task 2.B2: `sim/state.gd` — EMPTY_STATE and the shape law

**Files:**
- Create: `godot/sim/state.gd`, `godot/test/unit/test_state.gd`
- Port from: `src/core/state.ts` (111 lines)

**Interfaces:**
- Consumes: `SimGrid`.
- Produces:
```gdscript
class_name SimState
static func empty() -> Dictionary        # a fresh EMPTY_STATE-equivalent dict, NOT shared/frozen
static func assert_shape(state: Dictionary) -> void   # keys match the TS interface exactly
const STATE_KEYS: Array[String] = [...]  # the 20 keys, sorted
```
  `empty()` returns a new Dictionary each call. The TS `EMPTY_STATE` is a frozen shared singleton; in GDScript a shared frozen dict would force every reducer to copy anyway, so returning fresh is simpler and equivalent — **but the key set and values must be identical**.

- [ ] **Step 1: Port the state shape.** The 20 keys, from `src/core/state.ts:13`: `grid, entities, items, turn, activeEntityId, seed, rngCounter, rules, xp, level, depth, gold, story, motif, bodies, bible, smoke, traps, alarm, unveiled`.

- [ ] **Step 1b: Adopt the three tests Task 2.A2 deferred to you.** `tests/core/entity.test.ts` has a `describe('EMPTY_STATE', …)` block whose three cases belong to `state.ts`, not `entity.ts`, and could not be ported before `SimState` existed. Port them here — they are otherwise lost coverage:
  1. *"has no entities and no active turn"*
  2. *"is a solid one-tile grid, so nothing is walkable before a world exists"* (exercises `SimGrid.is_passable` against the empty state's 1×1 WALL grid)
  3. *"is frozen, so a reducer mutating its accumulator fails loudly instead of corrupting every later replay"* — note that `SimState.empty()` deliberately returns a **fresh** Dictionary rather than a shared frozen one, so this test cannot port literally. Port its *intent*: assert that mutating the result of one `empty()` call cannot be observed through a later `empty()` call.

- [ ] **Step 2: Write the test that pins it against the TS dump**

```gdscript
extends GutTest


func test_empty_state_matches_the_reference_key_for_key() -> void:
	var shape: Dictionary = FixtureLoader.load_json("res://test/fixtures/state-shape.json")
	var mine: Dictionary = SimState.empty()
	var mine_keys: Array = mine.keys()
	mine_keys.sort()
	assert_eq(mine_keys, shape["emptyStateKeys"], "the state's key set is hashed")
	assert_eq(SimCanonical.encode(mine), SimCanonical.encode(shape["emptyState"]),
		"EMPTY_STATE encodes to the identical bytes")


func test_nullable_fields_are_present_and_null() -> void:
	var s: Dictionary = SimState.empty()
	for key: String in ["activeEntityId", "motif", "bible", "smoke", "alarm"]:
		assert_true(s.has(key), "%s is present" % key)
		assert_eq(s[key], null, "%s is null, not absent" % key)


func test_assert_shape_rejects_a_stray_key() -> void:
	## The M9 mistake made executable: a stored gold total beside the folded one.
	## assert_shape uses assert(), which GUT surfaces as an engine error — so the
	## test must actually CALL it and catch that error. Asserting only that
	## STATE_KEYS lacks the key would be a static fact about a constant, proving
	## nothing about assert_shape; the same tautology the entity-level absent-key
	## test fell into, and worth not repeating.
	var s: Dictionary = SimState.empty()
	s["playerGold"] = 3
	SimState.assert_shape(s)
	assert_engine_error("playerGold")
```

- [ ] **Step 3: RED. Step 4: Implement. Step 5: GREEN.** The `encode` equality is the real gate here — if it fails, diff the two encodings and find the key.

- [ ] **Step 6: Commit.**

### Task 2.B3: `sim/tables.gd` — the bestiary and the math

**Files:**
- Create: `godot/sim/tables.gd`, `godot/test/unit/test_tables.gd`
- Port from: `src/core/tables.ts` (1,077 lines), `tests/core/tables.test.ts` (31), `tests/core/leveling.test.ts` (9), `tests/core/size.test.ts` (12), `tests/core/motifs.test.ts` (11)
- **Blocked by:** 2.B1.

**Interfaces:**
- Consumes: `SimRng` (for the draw-taking helpers), `godot/test/fixtures/tables.json`.
- Produces: `class_name SimTables` with every export from `src/core/tables.ts`, snake_cased, same values:
```gdscript
const CRIT := 20
const CRIT_FLOOR_LIMIT := 18
const WHIFF := 1
const NEEDED_FLOOR := 4
const NEEDED_CEILING := 17
const XP_TO_REACH: Array[int] = [0, 0, 16, 40, 72, 112, 160, 224, 304, 400]
const LURK_RANGE := 3
const AMBUSH_MIGHT_BONUS := 2
const AMBUSH_FROM_DEPTH := 2
const VENOM_TURNS := 3
const VENOM_HARM := 1
const CALL_RANGE := 6
const CALL_RISERS := 2
const CALL_DISTANCE := 6
const SHOT_RANGE := 5
const SLAM_DAMAGE := 1
const VIGIL_LEASH := 5
const GUARD_LEASH := 4
const WANDER_FROM_DEPTH := 2
const MIMIC_IN := 6
const MIMIC_FROM_DEPTH := 2
const ROUTE_STOPS: Array[int] = [2, 4]
const MAX_BOARD_DIM := 256
const BESTIARY: Array = [...]              # verbatim from the fixture dump
const VERB_THREAT: Dictionary = {...}
static func crit_floor(wits: int) -> int
static func needed_to_hit(attacker_might: int, target_speed: int) -> int
static func chance_in_20(needed: int) -> int
static func damage_dice(might: int) -> Dictionary
static func mean_damage(might: int) -> float
static func xp_to_reach(level: int, stretch: int = 1) -> Variant     # int, or null past the ladder
static func level_for_xp(xp: int, stretch: int = 1) -> int
static func growth_at(level: int) -> Dictionary
static func archetype(kind: String) -> Variant                      # Dictionary, or null
static func creature_stats(kind: String, level: int) -> Variant      # Dictionary, or null
static func archetype_of(kind: String) -> String
static func verb_of(kind: String) -> Variant                        # String, or null
static func mimic_guises(depth: int) -> Array
static func brace_wall(wits: int) -> int
static func threat_of(stats: Dictionary, kind: String = "") -> int
static func size_stretch(width: int, height: int) -> int
static func bounty_stretch(stretch: int) -> int
static func value_of(kind: String) -> int                           # M9: relic/scroll 2, provision 1, else 0
static func dominates(a: Dictionary, b: Dictionary) -> bool
```
  Check the full export list at `ts-baseline` — the list above is complete as of that tag, but read the file, do not trust this table alone.

- [ ] **Step 1: Read the reference in full.** This file is where the game's balance lives; `threatOf`'s verb multipliers (×1.1–1.3) are load-bearing — unpriced verbs once collapsed depth-5 survival to 0/20.

- [ ] **Step 2: Port the test suites, and add the fixture sweep**

```gdscript
func test_every_numeric_table_matches_the_reference() -> void:
	# load_table_json, NOT load_json: this file legitimately holds fractional
	# coefficients (VERB_THREAT 1.1-1.3, bountyStretch 1.5/2.5) and the strict
	# loader would crash on them. See the loader note in the delivered interfaces.
	var fx: Dictionary = FixtureLoader.load_table_json("res://test/fixtures/tables.json")
	for row: Dictionary in fx["neededToHit"]:
		assert_eq(SimTables.needed_to_hit(row["args"][0], row["args"][1]), row["value"],
			"needed_to_hit%s" % [row["args"]])
	for row: Dictionary in fx["threatOf"]:
		assert_eq(SimTables.threat_of(row["args"][0], row["args"][1]), row["value"],
			"threat_of%s" % [row["args"]])
	# ...one loop per dumped function; none may be skipped.


func test_the_bestiary_is_the_reference_bestiary() -> void:
	var fx: Dictionary = FixtureLoader.load_table_json("res://test/fixtures/tables.json")
	assert_eq(SimCanonical.encode(SimTables.BESTIARY), SimCanonical.encode(fx["bestiary"]),
		"a retyped table is a forked game")
```

**The fixture's actual shape, as delivered by Task 2.B1** — use these key names, not the ones this plan guessed before the dump existed:

```
tables.json  = { 23 function keys, each [{args:[…], value:…}]
                 + bestiary, verbThreat, motifs      # dumped verbatim
               }                                      # 26 top-level keys total
```
**Every exported numeric function is covered — port all 23 against their rows, and transcribe none by hand.** Row counts to assert against, so a silently truncated dump is caught:

| key | rows | key | rows | key | rows |
|---|---|---|---|---|---|
| `damageDice` | 23 | `bountyStretch` | 6 | `valueOf` | 20 |
| `neededToHit` | 441 | `meanDamage` | 23 | `draughtCeiling` | 11 |
| `chanceIn20` | 31 | `braceWall` | 23 | `smokeTurns` | 11 |
| `critFloor` | 23 | `spawnBudget` | 44 | `trapCount` | 44 |
| `threatOf` | 168 | `wardenLevel` | 11 | `trapLevelAt` | 11 |
| `creatureStats` | 84 | `sightAt` | 11 | `alarmTurns` | 4 |
| `xpToReach` | 42 | `grantValue` | 73 | `bestiary` | 8 |
| `levelForXp` | 84 | `growthAt` | 14 | `verbThreat` | 8 |
| `sizeStretch` | 7 | | | `motifs` | 3 |

**`tables.json` now holds 30 genuinely fractional numbers**, not 9: `meanDamage` returns means, and its rows are fractional by nature. This is exactly why `load_table_json` exists — reach for it, never `load_json`, and do **not** round a mean to make a comparison tidy.

**Two conventions inside this file, local to it and NOT the absent-key law:** a `null` in `args` means an omitted optional argument (only `threatOf`'s `kind` is optional), and a `null` in `value` means the reference returned `undefined` (`xpToReach` past the ladder, `creatureStats` for an unknown kind). No listed function ever legitimately receives or returns `null`, which is what makes the convention unambiguous.

**`threatOf` is dumped three ways on identical stats** — priced (kind passed), unpriced (kind `null`), and with an unmapped kind string. The gap between the priced and unpriced rows for the same `(kind, level)` **is** the verb multiplier, made a fact in the fixture instead of a claim in a comment. Assert all three groups; the unmapped-kind group must price exactly like no kind at all.

- [ ] **Step 3: RED. Step 4: Implement.** Watch integer division: `xpToReach`/`levelForXp`/`growthAt` use `Math.floor` semantics. **Step 5: GREEN.**

- [ ] **Step 6: Mutation** — change one `VERB_THREAT` multiplier; confirm the fixture sweep fails; restore. **Step 7: Commit.**

### Task 2.B4: `sim/events.gd` — the schema table and draft builders

**Files:**
- Create: `godot/sim/events.gd`, `godot/test/unit/test_events.gd`
- Port from: `src/core/events.ts` (511 lines)

**Interfaces:**
- Consumes: nothing.
- Produces:
```gdscript
class_name SimEvents
const SCHEMA_VERSIONS := {
	"WORLD_INIT": 15, "WORLD_BIBLE": 1, "WORLD_BODIES": 1, "MOVE": 2,
	"MOVE_BLOCKED": 2, "TURN_ADVANCED": 2, "STRIKE": 5, "WAIT": 1, "DRAWN": 1,
	"ITEM_TAKEN": 5, "ITEM_REFUSED": 1, "ITEM_USED": 2, "SCROLL_READ": 1,
	"GOLD_MOVED": 1, "RULE_RATIFIED": 1, "RULE_FIRED": 1, "VIGIL_KEPT": 1,
	"WORLD_STIRRED": 1, "SHOVE": 1, "BRACED": 1, "CALLED": 1,
	"WORLD_REMEMBERED": 1, "UNMASKED": 1, "TRAP_SENSED": 1, "TRAP_SPRUNG": 1,
}
static func draft(type: String, rng_counter: int, rng_draws: int, payload: Dictionary) -> Dictionary
```
  A draft is `{"type", "schemaVersion", "rngCounter", "rngDraws", "payload"}` — five keys. `schemaVersion` comes from the table, never from the caller.

- [ ] **Step 1: Port the table verbatim** (25 entries, values above — re-read at `ts-baseline` to confirm none moved).

- [ ] **Step 2: Write the test**

```gdscript
func test_the_schema_table_covers_every_type_the_golden_run_uses() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	for event: Dictionary in golden["events"]:
		var t: String = event["type"]
		assert_true(SimEvents.SCHEMA_VERSIONS.has(t), "schema table knows %s" % t)
		assert_eq(SimEvents.SCHEMA_VERSIONS[t], event["schemaVersion"],
			"%s version agrees with the recorded chain" % t)


func test_a_draft_carries_exactly_the_five_hashed_and_recorded_keys() -> void:
	var d := SimEvents.draft("WAIT", 3, 0, {"entityId": "p1"})
	var keys: Array = d.keys()
	keys.sort()
	assert_eq(keys, ["payload", "rngCounter", "rngDraws", "schemaVersion", "type"])
	assert_eq(d["schemaVersion"], 1, "the version comes from the table, not the caller")
```

- [ ] **Step 3: RED. Step 4: Implement. Step 5: GREEN. Step 6: Commit.**

### Task 2.B5: `sim/upcast.gd` and `sim/refs.gd`

**Files:**
- Create: `godot/sim/upcast.gd`, `godot/sim/refs.gd`, `godot/test/unit/test_upcast.gd`, `godot/test/unit/test_refs.gd`
- Port from: `src/log/upcast.ts` (199), `src/log/refs.ts` (95), `tests/log/upcast.test.ts` (12), `tests/log/refs.test.ts` (19)

**Interfaces:**
- Consumes: `SimEvents.SCHEMA_VERSIONS`, `SimLog`.
- Produces:
```gdscript
class_name SimUpcast
static func upcast_event(raw: Variant) -> Dictionary                 # a current-version draft
static func upcast_chain(raw_events: Array) -> Dictionary            # {"log": SimLog, "head": Variant}

class_name SimRefs
static func empty() -> Dictionary
static func create(refs: Dictionary, name: String, head: Variant) -> Dictionary
static func get_ref(refs: Dictionary, name: String) -> Dictionary
static func set_head(refs: Dictionary, name: String, head: Variant) -> Dictionary
static func is_ancestor(log: SimLog, head: Variant, candidate: String) -> bool
static func fork(log: SimLog, refs: Dictionary, name: String, from: Variant) -> Dictionary
static func reset(log: SimLog, refs: Dictionary, name: String, to_hash: Variant) -> Dictionary
static func list_refs(refs: Dictionary) -> Array
```
  Read `refs.ts` at `ts-baseline` for the exact `fork`/`create` parameter lists — they take more than the sketch above shows.

- [ ] **Step 1: Read both references.** Upcasting is where "absence reads legacy" lives: WORLD_INIT walked v9→v15 in one night, and every step's default matters. An upcaster that invents a `null` where the old event simply had no key will fork every saved run.

- [ ] **Step 2: Port both suites,** plus:

```gdscript
func test_upcasting_the_golden_chain_changes_nothing() -> void:
	## Golden is already at current versions, so upcast must be the identity.
	## If it is not, an upcaster is firing when it should not.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	for event: Dictionary in golden["events"]:
		var up: Dictionary = SimUpcast.upcast_event(event)
		assert_eq(up["schemaVersion"], event["schemaVersion"], "%s untouched" % event["type"])
		assert_eq(SimCanonical.encode(up["payload"]), SimCanonical.encode(event["payload"]),
			"%s payload untouched" % event["type"])
```

- [ ] **Step 3: RED. Step 4: Implement. Step 5: GREEN. Step 6: Mutation** — make one upcaster fire unconditionally; confirm the identity test fails; restore. **Step 7: Commit.**

### Task 2.B6: `sim/interpret.gd` — the R2 interpreter

**Files:**
- Create: `godot/sim/interpret.gd`, `godot/test/unit/test_interpret.gd`, `godot/test/unit/test_rules_in_log.gd`
- Port from: `src/canon/interpret.ts` (260), `tests/canon/interpret.test.ts` (22), `tests/canon/rules-in-log.test.ts` (11)

**Interfaces:**
- Consumes: `SimRule`, `SimState`, `SimTables`.
- Produces:
```gdscript
class_name SimInterpret
static func holds(condition: Dictionary, state: Dictionary, actor_id: String, blow: Dictionary = {}) -> bool
static func fire_rules(...) -> Array          # read interpret.ts:204 for the exact parameter list
static func apply_resolved(state: Dictionary, outcomes: Array) -> Dictionary
```
  A `Blow` is a Dictionary whose fields are **all optional** — default `{}`, and an unset field is an absent key.

- [ ] **Step 1: Read `git show ts-baseline:src/canon/interpret.ts`.** This is *sim*, not AI: the reducer folds `RULE_FIRED`, so the interpreter must be byte-faithful.

- [ ] **Step 1b: Adopt the 19 test cases Task 2.A4 deferred to you.** Of the 54 cases across `tests/canon/rule.test.ts` and `tests/canon/vocabulary.test.ts`, 2.A4 ported 34, dropped 1 (a JavaScript prototype-pollution case with no GDScript equivalent — `__proto__` is not a vector for a GDScript Dictionary), and deferred **19** to you: 10 drive `holds`, 9 drive `fireRules`/`applyResolved`. Review verified each deferral is genuine — the `rule()`/`refused()` calls inside them are fixture scaffolding, not the subject. **The list of 19 is committed in `godot/test/unit/test_vocabulary.gd`'s own docstring** — read it there rather than re-deriving it, and account for all 19 in this task. 34 + 19 + 1 = 54; if your count does not reconcile, a case is being lost.

- [ ] **Step 2: Port both suites. Step 3: RED. Step 4: Implement. Step 5: GREEN.**

- [ ] **Step 6: Mutation** — invert one condition kind in `holds`; confirm failures; restore. **Step 7: Commit.**

---

# Wave C — the reducer (sequential; Opus authors or line-reviews every line)

### Task 2.C1: `sim/apply.gd` — the reducer

**Files:**
- Create: `godot/sim/apply.gd`, `godot/test/unit/test_apply.gd`, `godot/test/unit/test_leveling.gd`, `godot/test/unit/test_dispositions.gd`
- Port from: `src/core/apply.ts` (847 lines), `tests/core/apply.test.ts` (17), `tests/core/leveling.test.ts` (9), `tests/core/dispositions.test.ts` (12)
- **Blocked by:** all of Waves A and B.

**Interfaces:**
- Consumes: everything from Waves A and B.
- Produces: `class_name SimApply` / `static func apply(state: Dictionary, event: Dictionary) -> Dictionary` — pure; returns a new state, never mutates its argument.

**This task is Opus's.** A silent drift here forks every chain. Sonnet may port the three test suites as a separate reviewed hand-off, but the reducer body is authored or line-reviewed by Opus.

- [ ] **Step 1: Read `git show ts-baseline:src/core/apply.ts` in full — all 847 lines, all 25 event cases.** Do not port case-by-case from memory of the type names.

- [ ] **Step 2: Port the three suites first.**

- [ ] **Step 3: RED. Step 4: Port the reducer, one event case at a time,** running the suite after each case so a divergence is attributable to the case that introduced it. Hazards, each of which has already cost this repo a debugging session:
  - **Purity, and GDScript has removed your safety net.** `state.duplicate(true)` then mutate the copy, or build fresh. A reducer that mutates its accumulator corrupts every later replay and fails far from the cause. **In TypeScript, `EMPTY_STATE` is `Object.freeze`d, so an in-place mutation of the fold's accumulator threw at the mutation site.** `SimState.empty()` returns a fresh Dictionary instead, which structurally eliminates the *shared-baseline* corruption — but it also means an in-place mutation now fails **silently**, surfacing only as a hash mismatch hundreds of events later. That is precisely the "far from the cause" failure the freeze existed to prevent, and closing it is this task's job. Do both:
    1. Add a test that calls `apply(state, event)` and then asserts `SimCanonical.encode(state)` is **unchanged** — the input state is not the reducer's to touch. Do this for at least one event of every kind that mutates a nested structure (entities, items, traps, rules).
    2. Call `SimState.assert_shape(result)` on the returned state in tests, for every event type. Note what `assert_shape` does NOT check (see below), so you know what it is not doing for you.
  - **`assert_shape` is key-set-only, by design.** It inspects `state.keys()` and catches a missing key, an extra key, or a nullable field dropped to absent. It does **not** look at values: a state with `turn` holding a string, or a non-nullable field wrongly `null` while still keyed, passes it. Nested content — entities, items, traps — is entirely unchecked. Those are this task's responsibility, not the shape assertion's.
  - **`xp`, `level` and `gold` are DERIVED, never stored.** `xp` folds from kill history, `gold` sums `GOLD_MOVED` deltas (covenant M9). Do not add a stored total.
  - **`TURN_ADVANCED` does real work:** venom ticks (`VENOM_HARM` per round for `VENOM_TURNS`), and `creditKills`. See the `creditKills` precedent in the TS.
  - **`dropPockets` sits beside `creditKills` at *every* death site.** Miss one and pockets vanish on that path only.
  - **Absent-key discipline** on every entity field the reducer sets or clears. Clearing `DRAWN` means *removing* the key, not setting it null, if that is what the TS does — check each one.
  - **Do NOT call `SimItem.granted` here — inline the arithmetic, as the reference does.** Established during Task 2.A3's review by direct tracing: `git grep -n "granted("` over `ts-baseline` returns exactly one hit, `item.ts`'s own definition. `apply.ts`'s `ITEM_TAKEN` case (`apply.ts:279-367`) calls neither `granted` nor `itemAt`; it inlines its own id-based `items.find` and its own stat arithmetic (`e.stats.might - off.might + p.grants.might`). `granted` and `NOTHING` are **dead code in the reference**. Routing `apply.gd` through `SimItem.granted` would be a refactor, not a port, and any difference between the two formulations forks the chain. Port the inlined arithmetic verbatim.
  - **This task owns the absent-key law's only real guard.** See the warning in the absent-key section: the entity-level test in 2.A2 is tautological because `entity.gd` has no builder. `WORLD_INIT` here is where entities are actually constructed, so add a test that builds entities through the reducer and asserts (a) no constructed entity carries a `null`-valued key, and (b) the optional fields that should be unset are absent rather than null. Also settle the open `gear` question: is an unworn slot an absent key *inside* `gear`, or is `gear` itself absent? Check the reference and record the answer.
  - **`WORLD_INIT` replaces state wholesale** and opens a new rng-counter epoch.

- [ ] **Step 5: GREEN on all three suites.**

- [ ] **Step 6: Mutation, three of them** — break the stairs-carry of `gold`, break the `xp` fold, and price provisions as relics. The TS history records that the third one *initially caught nothing* because every assertion was an inequality against a ceiling; if your ported band test also catches nothing, you have reproduced the gap, and the fix is to pin the band's shape.

- [ ] **Step 7: Commit.**

### Task 2.C2: `SimLog.fold` and `SimLog.verify_chain`

**Files:**
- Modify: `godot/sim/log.gd`
- Create: `godot/test/unit/test_chain.gd`
- Port from: `src/log/chain.ts:106-204`, `tests/log/chain.test.ts` (21)
- **Blocked by:** 2.C1.

**Interfaces:**
- Consumes: `SimApply.apply`, `SimState.empty`, `SimEvents.SCHEMA_VERSIONS`, `SimHash.hash_event`.
- Produces, added to `SimLog`:
```gdscript
func fold(head: Variant) -> Dictionary
func verify_chain(head: Variant) -> Variant    # null when sound, else {"seq": int, "eventId": String, "reason": String}
const FOLD_CACHE_LIMIT := 200000
```

- [ ] **Step 1: Port `fold` with its memo.** Walk back to the nearest cached ancestor, apply forward, cache every intermediate. Clear the cache **wholesale** when `size + pending > FOLD_CACHE_LIMIT` — the TS does exactly that, and a smarter eviction policy is a behaviour change. `fold(null)` returns the empty state. Cycles raise.

- [ ] **Step 2: Port `verify_chain` in the reference's exact order,** because the order decides which divergence gets reported first:
  1. recompute the hash; mismatch → `"hash mismatch, recomputed <id>"`
  2. unknown type → `"unknown event type <t>"`
  3. wrong schema version → `"<T> is schemaVersion <n>, this engine implements <m>"`
  4. sequence gap → `"sequence gap: expected seq <n>"`
  5. **rng counter, with the WORLD_INIT exception** → `"rng counter recorded as <a> but state is at <b>"`

  The `WORLD_INIT` exception is not an optimisation. A fresh floor draws from a fresh seed addressed from zero; demanding continuity across the stairs refused every saved run that had ever descended, and a player lost a session to `"diverges at seq 120"` where seq 120 was floor 2 being born. Port the exception and port the comment.

- [ ] **Step 2b: Adopt the fold-dependent tests Task 2.B5 deferred to you.** `fold()` and `verify_chain()` did not exist when upcast and refs were ported, so two suites left assertions parked, marked in place with comments:
  - `test_upcast.gd` — **4 of the 6 `upcastChain` cases** need `fold`/`verify_chain`; the deferral is recorded in that file's header.
  - `test_refs.gd` — **3 of its 19 tests** have fold-dependent assertions deferred inline. `refs.test.ts`'s own `build()` helper drives the reducer *and* `commands.gd`, so the ported suite substituted a hand-built structural chain (mirroring `test_log.gd`'s existing no-reducer pattern). Now that `fold` exists, restore the deferred assertions; anything still needing `commands.gd` moves on to Wave E, named.

  Grep both files for the deferral comments and reconcile the counts — `refs.gd` itself never needed `fold`, only its tests did.

- [ ] **Step 3: Write the tests,** porting `tests/log/chain.test.ts` and adding one per divergence reason — five hand-built broken chains, each asserting the exact reason string.

- [ ] **Step 4: RED → implement → GREEN.**

- [ ] **Step 5: Mutation** — drop the `WORLD_INIT` counter exception; confirm the golden chain starts diverging at its first descent; restore. **Step 6: Commit.**

---

# Wave D — generation and perception (parallel: D1–D3 independent)

**AStarGrid2D is FORBIDDEN in `sim/`** (spec §3). `reachability` and `sight` feed `decide()`, whose choices become recorded events; a different tie-break is a different game. These are verbatim ports. `AStarGrid2D` is permitted only for cosmetic stage-side motion, in Phase 7.

### Task 2.D1: `sim/mapgen.gd`

**Files:**
- Create: `godot/sim/mapgen.gd`, `godot/test/unit/test_mapgen.gd`, `godot/test/unit/test_path_pull.gd`
- Port from: `src/core/mapgen.ts` (632), `tests/core/mapgen.test.ts` (11), `tests/core/path-pull.test.ts` (5)
- **Blocked by:** 2.B1 (mapgen fixtures), 2.A1, 2.B3.

**Interfaces:**
- Consumes: `SimGrid`, `SimRng`, `SimTables`, `godot/test/fixtures/mapgen.json`.
- Produces: `class_name SimMapgen` with:
```gdscript
static func pick_spawn_points(...) -> Dictionary
static func generate_map(...) -> Dictionary        # {grid, rooms, ...} — read mapgen.ts:70 for MapGenResult
static func walk_distances(grid: Dictionary, start: Dictionary) -> Dictionary   # idx -> steps
static func farthest_from(grid: Dictionary, start: Dictionary) -> Dictionary
static func choose_exit(...) -> Dictionary
static func walk_path(...) -> Array
static func walk_distance(grid: Dictionary, from: Dictionary, to: Dictionary) -> int
static func with_exit(grid: Dictionary, exit: Dictionary) -> Dictionary
static func seal_secret_room(...) -> Dictionary
static func repair_with_secret(grid: Dictionary, start: Dictionary) -> Dictionary
const EXIT_BANDS: Array = [...]     # the long way [0.8,1] weight 6, middle [0.45,0.8) weight 3, close weight 1
const MIN_EXIT_WALK := 8
```
  Read the exact parameter lists at `ts-baseline`; the sketch omits them deliberately rather than guessing.

- [ ] **Step 1: Read the reference.** The draw stream is the whole game here: **every counted draw, including rejected ones, advances the counter.** `chooseExit` spends exactly two draws per floor. Get the count wrong and every seed generates a different world.

- [ ] **Step 2: Port the suites, and add the board-identity sweep** — the strongest test in Phase 2:

**The fixture's actual shape, as delivered by Task 2.B1:**

```
mapgen.json = { tileConstants, defaultMotif,
                cases: [ { seed, width, height, counterIn, drawsConsumed,
                           result: { grid, start, rooms, counterAfter, story } } ] }
```
Six cases: seeds 17 / 99 / 12345 × 48×32 and 96×64. `counterIn` is 0 throughout; `drawsConsumed` is `counterAfter - counterIn`. All numbers are integers, so this file uses the strict `load_json`.

```gdscript
func test_generates_the_reference_boards_tile_for_tile() -> void:
	var fx: Dictionary = FixtureLoader.load_json("res://test/fixtures/mapgen.json")
	var cases: Array = fx["cases"]
	assert_eq(cases.size(), 6, "all six recorded boards")
	for c: Dictionary in cases:
		var want: Dictionary = c["result"]
		var got: Dictionary = SimMapgen.generate_map(...)   # per the case's recorded args
		assert_eq(SimCanonical.encode(got["grid"]), SimCanonical.encode(want["grid"]),
			"seed %d at %dx%d" % [c["seed"], c["width"], c["height"]])
		assert_eq(got["counterAfter"], want["counterAfter"],
			"the draw stream spent the same randomness")
```

**`counterAfter` is the stronger assertion, not the weaker one.** Two different generators can coincidentally agree on a board while spending different randomness — and then diverge on the very next draw, somewhere far away and much later. Matching draw counts cannot be faked that way. If the board matches but `counterAfter` does not, the port is wrong even though it looks right; treat that as a hard failure, never a rounding issue.

- [ ] **Step 3: RED. Step 4: Implement. Step 5: GREEN.** If a board diverges, bisect by counter: dump the TS draw sequence for that seed and compare draw-by-draw to find the first extra or missing draw. **This debugging is Opus work.**

- [ ] **Step 6: Mutation** — skip one rejected draw's counter increment; confirm the board sweep fails; restore. **Step 7: Commit.**

### Task 2.D2: `sim/reachability.gd`

**Files:**
- Create: `godot/sim/reachability.gd`, `godot/test/unit/test_reachability.gd`
- Port from: `src/core/reachability.ts` (34), `tests/core/reachability.test.ts` (5)

**Interfaces:**
- Consumes: `SimGrid`.
- Produces:
```gdscript
class_name SimReach
static func reachable_from(grid: Dictionary, x: int, y: int) -> Dictionary   # idx -> true (a set)
static func floor_count(grid: Dictionary) -> int
```
  A GDScript `Dictionary` stands in for the TS `Set<number>`; iteration order of a set never reaches a decision in the reference, but **verify that claim against `reachableFrom`'s consumers before relying on it** — if any consumer iterates, the order is load-bearing and must be made explicit.

- [ ] **Step 1: Port verbatim.** Neighbours are bounds-checked **before** being keyed by `y*width+x`. The reference carries a fixed bug here: OOB neighbours keyed before bounds-checking made a quarry at `x=0` read reachable one step east off the map. Keep the fix; keep its comment.

- [ ] **Step 2: Port the suite, plus the total-connectivity mutation proof** the repo already relies on. **Step 3: RED → implement → GREEN. Step 4: Commit.**

### Task 2.D3: `sim/sight.gd`

**Files:**
- Create: `godot/sim/sight.gd`, `godot/test/unit/test_sight.gd`
- Port from: `src/core/sight.ts` (71), `tests/core/sight.test.ts` (8)

**Interfaces:**
- Consumes: `SimGrid`, `SimEntity`.
- Produces:
```gdscript
class_name SimSight
static func within_reach(from: Dictionary, to: Dictionary, radius: int) -> bool
static func clear_shot(grid: Dictionary, entities: Array, from: Dictionary, to: Dictionary) -> bool
```

- [ ] **Step 1: Port verbatim.** Integer supercover. Walls, secrets and living bodies block. **Two walls kissing at a corner block.** The reach disc is `dx*dx + dy*dy <= 30`, not a radius comparison — port the inequality, not an equivalent-looking distance check.

- [ ] **Step 2: Port the suite. Step 3: RED → implement → GREEN.**

- [ ] **Step 4: Mutation** — let corner-kissing walls pass; confirm failure; restore. **Step 5: Commit.**

---

# Wave E — turns, brain, and the verbs (E1 → E2 → E3a–E3e)

### Task 2.E1: `sim/turns.gd`

**Files:**
- Create: `godot/sim/turns.gd`, `godot/test/unit/test_turns.gd`
- Port from: `src/core/turns.ts` (33), `tests/core/turns.test.ts` (10)

**Interfaces:**
- Consumes: `SimEntity`.
- Produces:
```gdscript
class_name SimTurns
static func initiative_order(entities: Array) -> Array      # Array[String] of ids
static func next_active(...) -> Variant                     # read turns.ts:19 for the parameter list
```
  Initiative order is a recorded consequence: a different tie-break is a different chain. Port the comparator exactly, including how it breaks ties.

- [ ] **Step 1: Port. Step 2: RED → implement → GREEN. Step 3: Mutation** — reverse the tie-break; confirm failure; restore. **Step 4: Commit.**

### Task 2.E2: `sim/ai.gd`

**Files:**
- Create: `godot/sim/ai.gd`, `godot/test/unit/test_ai.gd`
- Port from: `src/core/ai.ts` (271), `tests/core/ai.test.ts` (16)
- **Blocked by:** 2.D2, 2.D3, 2.C1.

**Interfaces:**
- Consumes: `SimReach`, `SimSight`, `SimTables`, `SimState`, `SimEntity`.
- Produces:
```gdscript
class_name SimAi
const AWARENESS := 8
static func decide(state: Dictionary, entity_id: String) -> Dictionary   # an Action; see ai.ts:16
```
  An `Action` is a Dictionary tagged by kind, mirroring the TS union member-for-member.

- [ ] **Step 1: Read the reference.** `decide` is the single most consequential pure function in the game: its output becomes a recorded event. Hunts path by **BFS walking distance 8** — a wall a creature cannot walk through, it cannot smell through. Dispositions: guards return to POST-anchored leashes (`GUARD_LEASH` 4), wanderers walk recorded routes advancing forward only, the warden is leashed by role.

- [ ] **Step 2: Port the suite. Step 3: RED → implement → GREEN.**

- [ ] **Step 4: Mutation** — raise `AWARENESS` by one; confirm failure; restore. **Step 5: Commit.**

### Tasks 2.E3a–2.E3e: `sim/commands.gd`, split by verb family

`src/core/commands.ts` is 1,907 lines — too large for one task and too large for one file. Split into `godot/sim/commands/` with a thin `commands.gd` facade that re-exports the family entry points, so callers (the stage, autoplay) see one surface.

**All five are blocked by:** 2.C1, 2.C2, 2.D1, 2.D3, 2.E1, 2.E2. Within the wave they are independent **except** that 2.E3a ships the shared `resolve_strike` path every other family calls, so **2.E3a goes first**, then b–e in parallel.

| Task | File | Verbs | Suites to port |
|---|---|---|---|
| **2.E3a** | `commands/movement.gd` | create_world, move, strike (`resolve_strike` — the ONE blow path), descend | `tests/core/commands.test.ts` (32), `verbs.test.ts` (24) |
| **2.E3b** | `commands/items.gd` | take/take_or_refuse, use, satchel (two hands), scrolls, equipment/dual-wield | `loot` (15), `scrolls` (11), `satchel-two` (7), `dual-wield` (8), `provisions-new` (11), `equipment` |
| **2.E3c** | `commands/hazards.gd` | traps, secrets, mimics, pockets | `traps` (17), `secrets` (10), `mimics` (6), `pockets` (6) |
| **2.E3d** | `commands/stances.gd` | shove, brace, call, drawn/volley | `player-verbs` (14), `new-verbs` (11), `volley-stance` (12), `volley-commands` (12), `volley-mind` (5) |
| **2.E3e** | `commands/purse.gd` | the economy verbs (`GOLD_MOVED` producers) | `purse` (13) |

**Interfaces (2.E3a produces; b–e consume):**
```gdscript
class_name SimCommands
static func create_world(...) -> Dictionary        # {log, head} — read commands.ts for the parameter list
static func resolve_strike(...) -> Dictionary      # THE one blow path, melee and ranged alike
static func outcome(state: Dictionary) -> String   # 'escaped' | 'won' | 'died' | ...
```
Every command function returns **drafts, not state** — the caller appends them through the log. That is what keeps authority in the chain and lets the stage be a projection.

**Each of 2.E3a–e follows the same step shape:**

- [ ] **Step 1:** Read that family's TS at `ts-baseline`, and read `tests/` for its suites.
- [ ] **Step 2:** Port the suites listed in the row.
- [ ] **Step 3:** Run to RED.
- [ ] **Step 4:** Port the implementation. Family-specific hazards:
  - **2.E3a:** every blow, melee or ranged, resolves through the ONE `resolve_strike`. `STRIKE` v5 carries `mode` (`'melee'`/`'ranged'`, absent reads melee) and `warded` (the ash ward drinks one landing blow whole — resolved at command time, damage recorded 0). Adjacency refuses shots; the bump owns range 1.
  - **2.E3b:** the dominance rule — walking takes only strict upgrades (`SimTables.dominates`); tradeoffs wait for the deliberate key. `ITEM_TAKEN` v5 records `gearSlot` and `shed`. Ranged relics route BY TRAIT to the `sling` slot. The satchel holds two; full hands refuse out loud.
  - **2.E3c:** traps get **two recorded wits chances each** (sight then near, once ever, misses silent). Hatch risers are **level-1 bodies**, not floor-band. Snared steps become recorded `WAIT` strains or bots deadlock. The mimic's lie lives render-side; the bump `UNMASK`s and loads the stalker's `ambush` spring.
  - **2.E3d:** `SHOVE`/`BRACED` spend **zero draws**. Staggered things spend their next action as a recorded `WAIT` — the only creature wait that reaches the chain. `DRAWN` is one stance per body, held through `WAIT`s, lost to any other act, any damage, any stagger.
  - **2.E3e:** gold is folded from `GOLD_MOVED` deltas — **never a stored total** (M9). `value_of(kind)` is derived from the kind, never stored on the item: two iron ores cannot be worth different amounts. Nothing spends gold yet; increments B–D are Phase 6.
- [ ] **Step 5:** Run to GREEN.
- [ ] **Step 6:** One mutation spot-check for the family; record the row in `scripts/mutate-sim.py`.
- [ ] **Step 7:** Commit.

### Task 2.E4: `tests/balance/sawtooth` port

**Files:**
- Create: `godot/test/unit/test_sawtooth.gd`
- Port from: `tests/balance/sawtooth.test.ts` (8 tests, 35 seconds in TS)
- **Blocked by:** all of Wave E.

- [ ] **Step 1: Port the eight pins** — vale: door gentle, d3 fighter 13 v runner ~2, d5 in [1,16]; expanse: door 10/10 gentle, d3 fighter 7 over runner 4, deep 4/10. Read the current numbers at `ts-baseline`; the comments in that file record why each moved.
- [ ] **Step 2: Run.** This suite is slow by nature — it plays hundreds of floors. If it exceeds 120s headless, record the runtime in the commit and leave it; do not thin the sample to make it fast, because the sample size *is* the test.
- [ ] **Step 3: Commit.**

---

# Wave F — the gates (sequential, after everything)

### Task 2.F1: The fold gate

**Files:**
- Create: `godot/test/unit/test_golden_fold.gd`

- [ ] **Step 1: Write the gate, verbatim**

```gdscript
extends GutTest
## Phase 2's headline gate: replaying the golden chain through the ported
## reducer reproduces the exact state the TypeScript engine signed.
##
## The recipe is sha256(canonicalJson(state)) — the WHOLE state object, so this
## passes only if every key, every absent optional, and every integer in the
## folded state matches the reference. It is the strictest assertion in the
## migration, and the reason the absent-key law exists.

const FINAL_STATE_HASH := "2272ed6ecd7e36e007c2514867a96aa7e3cb0778965405f2356100b5db260056"


func _rebuild() -> Array:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var log := SimLog.new()
	var head: Variant = null
	for event: Dictionary in golden["events"]:
		head = (log.append(head, event) as Dictionary)["id"]
	return [log, head, golden]


func test_golden_chain_folds_to_the_recorded_final_state_hash() -> void:
	var built := _rebuild()
	var log: SimLog = built[0]
	var state: Dictionary = log.fold(built[1])
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(SimCanonical.encode(state).to_utf8_buffer())
	assert_eq(ctx.finish().hex_encode(), FINAL_STATE_HASH, "golden final state hash")
	assert_eq(FINAL_STATE_HASH, (built[2] as Dictionary)["finalStateHash"],
		"the pin above still matches the fixture")


func test_the_folded_state_matches_the_reference_dump_key_for_key() -> void:
	## Same proof, but it NAMES the divergence instead of just denying the hash.
	## When F1 fails, this is the test that tells you which key to look at.
	var built := _rebuild()
	var mine: Dictionary = (built[0] as SimLog).fold(built[1])
	var shape: Dictionary = FixtureLoader.load_json("res://test/fixtures/state-shape.json")
	var theirs: Dictionary = shape["goldenFinal"]
	var my_keys: Array = mine.keys(); my_keys.sort()
	var their_keys: Array = theirs.keys(); their_keys.sort()
	assert_eq(my_keys, their_keys, "the state's key set")
	for key: String in their_keys:
		assert_eq(SimCanonical.encode(mine[key]), SimCanonical.encode(theirs[key]),
			"state key '%s'" % key)
```

- [ ] **Step 2: Run.** Expected: PASS. **If the hash mismatches**, the second test names the key. Work outward from it: a `null` where the reference has an absent key, an extra key, a float where the reference has an int, or a derived value (`xp`/`gold`/`level`) computed differently. **This debugging is Opus work by definition.**

- [ ] **Step 3: Commit** — this is the moment the ported reducer is proven a true twin; the commit line should know it.

### Task 2.F2: The verify gate

**Files:**
- Create: `godot/test/unit/test_golden_verify.gd`

- [ ] **Step 1: Write the gate**

```gdscript
extends GutTest


func test_golden_chain_verifies_with_no_divergence() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var log := SimLog.new()
	var head: Variant = null
	for event: Dictionary in golden["events"]:
		head = (log.append(head, event) as Dictionary)["id"]
	var divergence: Variant = log.verify_chain(head)
	assert_eq(divergence, null,
		"golden verifies clean; got %s" % [divergence])


func test_verify_still_catches_a_tampered_chain() -> void:
	## A gate that cannot fail proves nothing. Build a chain whose recorded id
	## does not match its content and confirm verify names it.
	var log := SimLog.new()
	var a: Dictionary = log.append(null, SimEvents.draft("WAIT", 0, 0, {"entityId": "p1"}))
	var forged: Dictionary = (a as Dictionary).duplicate(true)
	forged["payload"] = {"entityId": "someone-else"}
	log.events[a["id"]] = forged        # same id, different content
	var d: Variant = log.verify_chain(a["id"])
	assert_not_null(d, "tampering is caught")
	assert_true((d as Dictionary)["reason"].begins_with("hash mismatch"))
```

- [ ] **Step 2: Run to PASS. Step 3: Commit.**

### Task 2.F3: Phase 2 completion

- [ ] **Step 1: Full verification (superpowers:verification-before-completion).** Run and paste all three:
  - `./godot/test.sh` — exit 0, script count satisfied, zero failures
  - `npm run test` — 993 tests, still green (the TS reference must be untouched)
  - `npm run typecheck` — exit 0

- [ ] **Step 2: Perf pass.** Time `fold` of the 451-event golden chain headless; the charter's budget is **< 1s**. If it misses, profile before optimising, and never trade the memo's wholesale-clear semantics for speed.

- [ ] **Step 3: Re-run every mutation in `scripts/mutate-sim.py`** and record the caught/null tally in the NIGHTLOG entry. A mutation that has become a null result since it was written means a test has weakened.

- [ ] **Step 4: NIGHTLOG entry** — one stamped entry addressed to the designer: what the fold gate proved, what the mutation tally was, any behaviour that looked wrong and was ported faithfully anyway (with its location, so the designer can rule on it).

- [ ] **Step 5: Commit.**

---

## Self-review notes (writing-plans checklist, applied)

- **Charter coverage:** every module in the master plan's wave table maps to a task — Wave A → 2.A1–A4, B → 2.B2–B6, C → 2.C1–C2, D → 2.D1–D3, E → 2.E1–E4, F → 2.F1–F3. The charter's three exit gates map to 2.F1 (fold), 2.F2 (verify_chain), 2.F3 (suites green). Its five standing instructions are hoisted into Global Constraints and the absent-key law rather than repeated per task.
- **Two tasks the charter did not name, added deliberately:** 2.A0 (the mutation harness plus the TS state-shape oracle) and 2.B1 (fixture extension for tables and mapgen). The charter asks for fixture extension "before wave B/D starts" without giving it a task; without 2.A0's shape dump, a fold-hash mismatch has to be bisected by hand instead of named by a test.
- **`commands.ts` split:** the charter says "4–6 subagent tasks"; this plan uses five, and puts them in `godot/sim/commands/` behind a facade rather than one 1,900-line file, per the skill's guidance on focused files. 2.E3a is sequenced first because it owns the shared `resolve_strike`.
- **Placeholders:** the plan gives verbatim code for every gate test, every shape/identity assertion, the mutation harness and the fixture exporter — the artifacts a porter cannot derive. Where it says "read the exact parameter list at `ts-baseline`" it is refusing to invent a signature I have not read in full (`mapgen.generate_map`, `interpret.fire_rules`, `turns.next_active`, `refs.fork`, the `commands` entry points). That is deliberate: a guessed signature in a plan is worse than an instruction to go read the real one, because it gets copied.
- **Type consistency:** `SimGrid`/`SimEntity`/`SimItem`/`SimRule`/`SimTables`/`SimState`/`SimEvents`/`SimUpcast`/`SimRefs`/`SimInterpret`/`SimApply`/`SimMapgen`/`SimReach`/`SimSight`/`SimTurns`/`SimAi`/`SimCommands` — each named once at its defining task and used under that name everywhere after. `SimLog.fold`/`verify_chain` are added to the Phase 1 class rather than a new one, matching the master plan's interface list.
- **Known risk, stated:** Wave E is over half the remaining lines and its gate is the whole-state fold hash, so a divergence introduced anywhere in E surfaces only at 2.F1. The per-key naming test in 2.F1 is the mitigation; if it proves insufficient, the fallback is to fold-and-hash after each of E3a–e against a per-family TS dump, which would need 2.B1 extended again.
