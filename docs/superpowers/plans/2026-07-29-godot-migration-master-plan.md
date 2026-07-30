# Godot Migration — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move evolving-rpg from the TypeScript/Vite/CSS-grid engine to Godot 4.x (GDScript) while preserving the content-addressed event log, exact replay, and every Covenant invariant — proven by golden parity against the frozen TS reference.

**Architecture:** A `godot/` project inside this repo with a hard **sim/stage split**: `godot/sim/` is a pure, Node-free GDScript port of the deterministic engine (rng → canonical → hash → log → state/apply → tables/mapgen/sight/reachability → turns/ai/commands, plus `canon/rule` + `canon/interpret` which the reducer needs); `godot/stage/` is a presentation layer (TileMapLayer board, Control HUD, tweens/lights/particles) that reads folds and listens to signals from a `Chronicle` autoload — the only writer. Full rationale and corrections to the source proposal: `docs/superpowers/specs/2026-07-29-godot-migration-spec.md`.

**Tech Stack:** Godot 4.4+ (GDScript only, typed), GUT 9.x for tests, the frozen TS engine (tag `ts-baseline`) + `tsx` as the fixture/reference oracle, Node sidecar for the Oracle LLM proxy.

## Who executes what (read this first)

This master plan is executed across **multiple sessions and two model tiers**. It contains *fully detailed* tasks for Phase 0 and Phase 1, and *phase charters* for Phases 2–8. Each charter ends with a plan-authoring task: **Opus reads the charter's inputs and writes that phase's detailed plan** (via superpowers:writing-plans), then orchestrates it (via superpowers:subagent-driven-development) with **Sonnet subagents** executing tasks.

| Work | Model | Rationale |
|---|---|---|
| Phase plans, task review gates, parity-mismatch debugging | **Opus** (orchestrator session) | Judgement-heavy, cross-cutting |
| `canonical.gd`, `hashing.gd`, `apply.gd`, `commands.gd` port reviews | **Opus** (review stage) | A silent drift here forks every chain |
| Module ports with an existing test suite, stage scenes, juice items, tooling, docs | **Sonnet** subagents | Well-specified, independently verifiable |
| Art licensing, BYOK distribution, any redesign of a shipped decision | **The designer (human)** | AGENTS.md reserves these |

**Escalation rules:** a parity mismatch that survives one Sonnet attempt escalates to Opus; any question about *changing* game behaviour (not porting it) escalates to the designer. Dispatch parallel Sonnet subagents only where a wave table below says the tasks are independent; one subagent per task otherwise (fresh context each).

## Global Constraints

Every task's requirements implicitly include this section.

- **Engine:** Godot **4.4 or later stable 4.x** (TileMapLayer requires ≥ 4.3). Record the exact version in NIGHTLOG.md when Phase 1 installs it. GDScript only — no C#, even though Xogot for Mac would allow it (iPad compatibility). Typed GDScript everywhere (`func f(x: int) -> int`).
- **Two editors, one truth:** Xogot for Mac is installed (`/Applications/Xogot.app`) with its `xo` CLI broker (`/Applications/Xogot.app/Contents/MacOS/xo`) — agents may drive a running Xogot instance with it (scene/node/tilemap/script authoring, `eval`, editor screenshots) during stage/juice work. Xogot is **not** the automation backbone: it has no headless mode, so all tests, fixtures, autoplay, golden generation, and CI run on the standard Godot CLI. Committed `.tscn`/`.gd` files are the only truth; the project must stay loadable in both editors (pin `project.godot` features to the older of the two engine versions, recorded in NIGHTLOG at Phase 1).
- **Test framework:** GUT 9.x, pinned at install (Task 1.1); run headless via `godot/test.sh`.
- **Purity of `godot/sim/`:** `RefCounted`/static classes only. No `Node`, no signals, no autoload access, no `Engine`/`Time`/`OS` reads, no `randi()`/`RandomNumberGenerator`. Randomness enters *only* as `SimRng.u32/float01/int_between(seed, counter, …)` with counted draws. Sim files may load nothing from `res://` except via arguments.
- **Covenant M4 (replay is exact):** state is folded from the chain; nothing re-decides recorded history or consumes unrecorded randomness. Signals repaint; they never decide.
- **Fixtures are law:** `tests/fixtures/golden-run.json` and `godot/test/fixtures/*` are committed and **never regenerated to make a failing test pass**. Regeneration requires designer sign-off and happens only from the `ts-baseline` tag.
- **TS freeze:** after Phase 0, `src/` is bugfix-only. Any TS change re-runs `npm run fixtures` and is called out to the designer.
- **Art:** `watermarked_img_*.png` is designer-generated (Gemini Nano Banana, clarified 2026-07-29 — no third-party licence gate), but it is a *presentation image*, not an atlas: irregular ~128 px cells, baked-in captions, visible watermark pixels. It stays gitignored (a 6.3 MB mood board consumed by nothing) and is never sliced into a TileSet. Shipped art arrives per-entity through the `docs/design/SPRITES.md` pipeline: regenerate with the documented prompt formula, key backgrounds to alpha, snap nearest-neighbour, build the atlas + generated manifest. Placeholder flat colours until then.
- **Repo voice:** commits are a single evocative line in the existing style (see `git log --oneline`), plus the standard `Co-Authored-By` trailer. Executors read `AGENTS.md` and `openwiki/quickstart.md` before their first task.
- **Mutation-proof discipline carries over:** when porting a test suite, spot-check at least one test by temporarily reverting its implementation guard and confirming the ported test fails (`openwiki/operations/testing-runbook.md`).

## File Structure (target)

```
godot/
├── project.godot
├── test.sh                       # headless GUT runner
├── sim/                          # Phase 1–2: rng.gd canonical.gd hashing.gd log.gd
│                                 #   grid.gd entity.gd item.gd rule.gd tables.gd
│                                 #   state.gd events.gd interpret.gd apply.gd upcast.gd
│                                 #   refs.gd mapgen.gd reachability.gd sight.gd
│                                 #   turns.gd ai.gd commands.gd
├── autoload/                     # Phase 3+: Chronicle.gd  Oracle.gd
├── stage/                        # Phase 3: board/ hud/ input/ turn_manager.gd …
├── tools/                        # Phase 4: autoplay.gd golden.gd feedback.gd
├── test/
│   ├── fixtures/                 # exported by scripts/export-fixtures.ts (committed)
│   ├── support/fixture_loader.gd
│   └── unit/                     # test_*.gd — GUT ports of the vitest suites
└── addons/gut/                   # pinned GUT checkout
scripts/export-fixtures.ts        # Phase 0: TS → fixture dump
server/oracle-standalone.ts       # Phase 5: sidecar proxy
```

---

# Phase 0 — Freeze the baseline (Sonnet, sequential)

The port needs a fixed reference. Nothing in `godot/` may begin until the TS tree is green, committed, tagged, and exporting fixtures.

### Task 0.1: Land the in-flight tree and tag `ts-baseline`

**Files:**
- Modify: `.gitignore`
- Commit: the entire in-flight working tree

**Interfaces:**
- Produces: git tag `ts-baseline` — the permanent reference commit for every fixture and parity check in this migration.

- [ ] **Step 1: Read the ground rules** — `AGENTS.md`, `openwiki/quickstart.md`, `docs/superpowers/specs/2026-07-29-godot-migration-spec.md` (the corrected spec this plan implements).

- [ ] **Step 2: Verify the tree is green**

Run: `npm run typecheck && npm run test`
Expected: both exit 0.
**If red: STOP.** The tree is mid-increment (economy/purse work per `docs/superpowers/specs/2026-07-30-economy-mining-and-sprites.md`). Finishing that increment happens under *its* spec, not this plan — report to the designer and pause the migration at this gate.

- [ ] **Step 3: Gitignore the unlicensed preview and Godot cache**

Append to `.gitignore`:

```
# Designer's Nano Banana mood board — reference only; shipped art comes from
# the SPRITES.md per-entity pipeline (migration spec §4)
watermarked_img_*.png

# Godot import cache
godot/.godot/
```

- [ ] **Step 4: Commit everything else and tag**

```bash
git add -A
git status   # confirm watermarked_img_*.png is NOT staged
git commit -m "The engine sits for its portrait — the tree lands whole before the crossing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git tag ts-baseline
```

- [ ] **Step 5: Record which economy increments landed.** Append one line to NIGHTLOG.md naming the increments of the 2026-07-30 staging that are now in `ts-baseline` (grep `GOLD_MOVED`, `purse` tests). Phase 6 reads this line to know what remains Godot-native work.

### Task 0.2: Export ground-truth fixtures from the reference engine

**Files:**
- Create: `scripts/export-fixtures.ts`
- Modify: `package.json` (add script)
- Create (generated, committed): `godot/test/fixtures/{rng,canonical,hashes}.json`, `godot/test/fixtures/golden-run.json`

**Interfaces:**
- Consumes: `src/core/rng.ts` (`u32`, `intBetween`), `src/log/canonical.ts` (`canonicalJson`), `src/log/hash.ts` (`hashEvent`), `tests/fixtures/golden-run.json`.
- Produces: the four fixture files above — every Phase 1–2 GUT suite asserts against them.

- [ ] **Step 1: Write the exporter**

```ts
// scripts/export-fixtures.ts — dumps ground truth from the frozen TS engine
// for the GDScript port to assert against. Run only from the ts-baseline tag.
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { u32, intBetween } from '../src/core/rng.js';
import { canonicalJson } from '../src/log/canonical.js';
import { hashEvent } from '../src/log/hash.js';
import type { DraftEvent } from '../src/core/events.js';

const OUT = 'godot/test/fixtures';
mkdirSync(OUT, { recursive: true });

// rng: a grid over 32-bit edge seeds and representative counters.
const u32Rows: { seed: number; counter: number; u32: number }[] = [];
for (const seed of [0, 1, 17, 123456789, -5, 2147483647, -2147483648]) {
  for (const counter of [0, 1, 2, 3, 10, 100, 1000, 65535, 1000000]) {
    u32Rows.push({ seed, counter, u32: u32(seed, counter) });
  }
}
const intRows: { seed: number; counter: number; min: number; max: number; value: number }[] = [];
for (const [min, max] of [[1, 6], [0, 0], [5, 300], [-3, 3]] as const) {
  for (const counter of [0, 7, 99]) {
    intRows.push({ seed: 17, counter, min, max, value: intBetween(17, counter, min, max) });
  }
}
writeFileSync(`${OUT}/rng.json`, JSON.stringify({ u32: u32Rows, intBetween: intRows }, null, 2));

// canonical: [input, expected] pairs. Inputs must survive a JSON round-trip,
// so `undefined`-dropping is asserted TS-side only (see canonical.test.ts);
// the GDScript convention is "omit the key".
const canonicalCases: unknown[] = [
  null, true, false, 0, -7, 2, 4294967295,
  'two', 'quote " back \\ slash \n newline',
  [], [1, 'two', null, [2]],
  {}, { b: [1, 'two', null], a: { z: true, m: 2 } },
  { Z: 2, a: 1 },          // sort is code-point order: "Z" (90) before "a" (97)
  { keep: 1, drop: null }, // null survives; only undefined is dropped
];
writeFileSync(
  `${OUT}/canonical.json`,
  JSON.stringify(canonicalCases.map((input) => ({ input, expected: canonicalJson(input) })), null, 2),
);

// hashes: hashEvent reads only {type, schemaVersion, rngCounter, payload} +
// (parent, seq) — payload shape is opaque to it, so synthetic payloads are fine.
const hashCases = [
  { draft: { type: 'WAIT', schemaVersion: 1, rngCounter: 3, payload: { entityId: 'p1' } }, parent: null as string | null, seq: 0 },
  { draft: { type: 'WAIT', schemaVersion: 1, rngCounter: 3, payload: { entityId: 'p1' } }, parent: 'abc123', seq: 4 },
  { draft: { type: 'MOVE', schemaVersion: 2, rngCounter: 0, payload: { entityId: 'p1', nested: { a: [1, 2], b: 'x' } } }, parent: null as string | null, seq: 0 },
];
writeFileSync(
  `${OUT}/hashes.json`,
  JSON.stringify(hashCases.map(({ draft, parent, seq }) => ({ draft, parent, seq, id: hashEvent(draft as unknown as DraftEvent, parent, seq) })), null, 2),
);

copyFileSync('tests/fixtures/golden-run.json', `${OUT}/golden-run.json`);
console.log(`fixtures written to ${OUT}`);
```

- [ ] **Step 2: Add the npm script** — in `package.json` scripts: `"fixtures": "tsx scripts/export-fixtures.ts"`.

- [ ] **Step 3: Run and eyeball**

Run: `npm run fixtures && ls -la godot/test/fixtures`
Expected: the four JSON files, non-empty; `rng.json` contains 63 u32 rows; spot-check `u32(17,0) = 1341360728`.

- [ ] **Step 4: Commit**

```bash
git add scripts/export-fixtures.ts package.json godot/test/fixtures
git commit -m "The reference engine writes its own examination paper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase 1 — The skeleton and the deterministic kernel (Opus, with one Sonnet pair-task max)

Everything downstream leans on these four files being *byte-exact* twins of the TS kernel. Opus implements or closely reviews each. **Exit gate: the golden chain re-hashes to its recorded `head` in GDScript.**

### Task 1.1: Godot project scaffold, GUT, headless runner

**Files:**
- Create: `godot/project.godot`, `godot/test.sh`, `godot/addons/gut/` (vendored), `godot/test/unit/test_smoke.gd`

**Interfaces:**
- Produces: `./godot/test.sh` — the single command every later task uses to run the suite headlessly. `$GODOT` env var overrides the binary path.

- [ ] **Step 1: Verify the toolchain (both halves already installed, 2026-07-29)** — standard Godot came in via Homebrew: `godot` resolves to `/opt/homebrew/bin/godot`, version **4.7.1.stable.official**; Xogot for Mac sits at `/Applications/Xogot.app` (its `xo` broker at `Contents/MacOS/xo`). The proposal's `brew install xogot-engine` does not exist (spec §1); Xogot has no headless mode, so the standard CLI is what `test.sh`, fixtures, autoplay, and CI run on. Verify `godot --version` still prints ≥ 4.7.1, record it in NIGHTLOG.md alongside the Godot version Xogot embeds (Xogot's about screen, or `xo project` against a running instance), and pin `project.godot` `config/features` to the older of the two.

- [ ] **Step 2: Write `godot/project.godot`**

```ini
; Engine expects this file at the project root. Godot rewrites it on first
; editor open; keep it minimal and let the editor own the rest.
config_version=5

[application]
config/name="Evolving RPG"
; 4.7 = the installed standard Godot (4.7.1). Lower this to Xogot's embedded
; version if that turns out older — the both-editors rule in Global Constraints.
config/features=PackedStringArray("4.7")

[rendering]
renderer/rendering_method="forward_plus"
textures/canvas_textures/default_texture_filter=0
```

(`default_texture_filter=0` = Nearest — pixel art stays crisp, per the proposal's one uncontested setup note.)

- [ ] **Step 3: Vendor GUT (pinned)**

```bash
git clone --depth 1 --branch v9.3.0 https://github.com/bitwes/Gut.git /tmp/gut-checkout
mkdir -p godot/addons
cp -R /tmp/gut-checkout/addons/gut godot/addons/gut
```

(If the installed Godot minor needs a newer GUT, take the latest 9.x release tag instead and record which in the commit.)

- [ ] **Step 4: Write `godot/test.sh`**

```bash
#!/usr/bin/env bash
# Headless test entry — the only way tests are run in this repo.
# Default: Homebrew's `godot` on PATH (4.7.1 at plan time); CI overrides $GODOT.
set -euo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")"
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true   # refresh .godot cache
exec "$GODOT" --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://test -ginclude_subdirs -gexit "$@"
```

`chmod +x godot/test.sh`

- [ ] **Step 5: Smoke test** — `godot/test/unit/test_smoke.gd`:

```gdscript
extends GutTest


func test_the_lights_are_on() -> void:
	assert_eq(1 + 1, 2)
```

Run: `./godot/test.sh`
Expected: 1 test, 1 passing, exit 0.

- [ ] **Step 6: Commit** — `git add godot && git commit -m "A stage is raised beside the theatre ..."` (single line, repo voice, plus trailer — same for every commit below).

### Task 1.2: Fixture loader

**Files:**
- Create: `godot/test/support/fixture_loader.gd`, `godot/test/unit/test_fixture_loader.gd`

**Interfaces:**
- Produces: `FixtureLoader.load_json(path: String) -> Variant` — parses JSON and **normalizes every integral float to int**, recursively. All numbers in this game's chains are integers; Godot's JSON parser may hand them back as floats, and this is the one place that artifact is corrected.

- [ ] **Step 1: Failing test**

```gdscript
extends GutTest


func test_normalizes_integral_floats_and_loads_golden() -> void:
	assert_eq(FixtureLoader.normalize(2.0), 2)
	assert_eq(typeof(FixtureLoader.normalize(2.0)), TYPE_INT)
	assert_eq(FixtureLoader.normalize([1.0, {"a": 3.0}]), [1, {"a": 3}])
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	assert_true(golden["events"].size() > 0, "golden events present")
	assert_eq(typeof(golden["seed"]), TYPE_INT)
```

Run: `./godot/test.sh`  → Expected: FAIL (FixtureLoader not found).

- [ ] **Step 2: Implement**

```gdscript
class_name FixtureLoader
## Loads a JSON fixture and folds JSON-parser float artifacts back to int.
## Every number in this game's chains is an integer; a fractional number in
## a fixture is a corruption worth crashing on, not smoothing over.


static func load_json(path: String) -> Variant:
	var f := FileAccess.open(path, FileAccess.READ)
	assert(f != null, "missing fixture: " + path)
	return normalize(JSON.parse_string(f.get_as_text()))


static func normalize(value: Variant) -> Variant:
	match typeof(value):
		TYPE_FLOAT:
			var fv := value as float
			assert(fv == floorf(fv), "non-integral number in fixture: %s" % fv)
			return int(fv)
		TYPE_ARRAY:
			var arr: Array = []
			for v: Variant in value:
				arr.append(normalize(v))
			return arr
		TYPE_DICTIONARY:
			var out: Dictionary = {}
			for k: Variant in value:
				out[k] = normalize(value[k])
			return out
		_:
			return value
```

- [ ] **Step 3: Run to green, commit.**

### Task 1.3: `sim/rng.gd` — splitmix32, counter-addressed

The subtle part: JS `Math.imul` is a 32-bit truncated multiply; GDScript ints are 64-bit, and a naive `a * b` of two 32-bit values overflows 64 bits. The split-multiply below is the standard emulation.

**Files:**
- Create: `godot/sim/rng.gd`, `godot/test/unit/test_rng.gd`

**Interfaces:**
- Produces: `SimRng.u32(seed: int, counter: int) -> int`, `SimRng.float01(seed, counter) -> float`, `SimRng.int_between(seed, counter, min_v, max_v) -> int` — the *only* randomness source permitted anywhere in `sim/`.

- [ ] **Step 1: Failing test (pinned values are ground truth, computed from the live TS engine on 2026-07-29)**

```gdscript
extends GutTest


func test_pinned_reference_values() -> void:
	assert_eq(SimRng.u32(17, 0), 1341360728)
	assert_eq(SimRng.u32(17, 1), 355572909)
	assert_eq(SimRng.u32(17, 2), 877023582)
	assert_eq(SimRng.u32(123456789, 41), 570345708)
	assert_eq(SimRng.u32(-5, 7), 3645567351)   # negative seed wraps like (x | 0)
	assert_eq(SimRng.int_between(17, 5, 1, 6), 5)


func test_matches_reference_fixtures() -> void:
	var fx: Dictionary = FixtureLoader.load_json("res://test/fixtures/rng.json")
	for row: Dictionary in fx["u32"]:
		assert_eq(SimRng.u32(row["seed"], row["counter"]), row["u32"],
			"u32(%d, %d)" % [row["seed"], row["counter"]])
	for row: Dictionary in fx["intBetween"]:
		assert_eq(
			SimRng.int_between(row["seed"], row["counter"], row["min"], row["max"]),
			row["value"])
```

Run: `./godot/test.sh` → Expected: FAIL (SimRng not found).

- [ ] **Step 2: Implement**

```gdscript
class_name SimRng
## splitmix32, addressed by (seed, counter) — the byte-twin of src/core/rng.ts.
## Any draw is reproducible from (seed, counter) alone, which is what makes a
## recorded counter enough to verify a replay.

const GAMMA := 0x9E3779B9
const MASK32 := 0xFFFFFFFF


## Math.imul: 32-bit truncated multiply. Split so no intermediate exceeds
## 2^48 — a straight a*b of two 32-bit values would overflow 64-bit int.
static func imul32(a: int, b: int) -> int:
	a &= MASK32
	b &= MASK32
	var lo := a * (b & 0xFFFF)
	var hi := ((a * (b >> 16)) & 0xFFFF) << 16
	return (lo + hi) & MASK32


static func u32(seed: int, counter: int) -> int:
	var a := (seed + imul32(counter, GAMMA)) & MASK32
	a = (a + GAMMA) & MASK32
	var t := a ^ (a >> 16)
	t = imul32(t, 0x21F0AAAD)
	t = t ^ (t >> 15)
	t = imul32(t, 0x735A2D97)
	t = t ^ (t >> 15)
	return t & MASK32


static func float01(seed: int, counter: int) -> float:
	return u32(seed, counter) / 4294967296.0


## Inclusive on both ends. Modulo bias accepted at this game's span sizes —
## the same account the reference gives itself.
static func int_between(seed: int, counter: int, min_v: int, max_v: int) -> int:
	assert(max_v >= min_v, "int_between: max %d is below min %d" % [max_v, min_v])
	var span := max_v - min_v + 1
	return min_v + (u32(seed, counter) % span)
```

(Why the masks make this exact: every JS intermediate is a 32-bit pattern — `| 0` reads it signed, `>>> k` reads it unsigned. Keeping the *unsigned* pattern in a 64-bit int and masking after every add/multiply preserves the identical bits; `>>` on a non-negative int is a logical shift.)

- [ ] **Step 3: Run to green.** All 63 fixture rows and 6 pins must pass. **Step 4: Commit.**

### Task 1.4: `sim/canonical.gd` — deterministic JSON

**Files:**
- Create: `godot/sim/canonical.gd`, `godot/test/unit/test_canonical.gd`

**Interfaces:**
- Consumes: nothing.
- Produces: `SimCanonical.encode(value: Variant) -> String` — keys sorted, no whitespace, integral floats rendered as ints, fractional floats refused loudly. The TS `undefined` convention translates as: *omit the key entirely* (GDScript has no undefined; `null` encodes as `null` exactly like TS).

- [ ] **Step 1: Failing test**

```gdscript
extends GutTest


func test_pinned_encoding() -> void:
	assert_eq(
		SimCanonical.encode({"b": [1, "two", null], "a": {"z": true, "m": 2}}),
		'{"a":{"m":2,"z":true},"b":[1,"two",null]}')
	assert_eq(SimCanonical.encode(2.0), "2")   # parser artifact folds to int form


func test_matches_reference_fixtures() -> void:
	var cases: Array = FixtureLoader.load_json("res://test/fixtures/canonical.json")
	for c: Dictionary in cases:
		assert_eq(SimCanonical.encode(c["input"]), c["expected"])
```

Run: `./godot/test.sh` → Expected: FAIL.

- [ ] **Step 2: Implement**

```gdscript
class_name SimCanonical
## Deterministic JSON: keys sorted, no whitespace, arrays left alone — the
## byte twin of src/log/canonical.ts. Event identity is a hash of these
## bytes, so any drift here forks every chain ever written.


static func encode(value: Variant) -> String:
	if value == null:
		return "null"
	match typeof(value):
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			# JS renders integral doubles bare ("2", never "2.0"). This game's
			# payloads are integers; an integral float here is a JSON-parse
			# artifact. A fractional float has no agreed cross-language
			# rendering — refuse loudly rather than fork chains quietly.
			var fv := value as float
			assert(fv == floorf(fv) and absf(fv) <= 9007199254740992.0,
				"SimCanonical: non-integral number %s" % fv)
			return str(int(fv))
		TYPE_STRING:
			return JSON.stringify(value)
		TYPE_ARRAY:
			var parts := PackedStringArray()
			for v: Variant in value:
				parts.append(encode(v))
			return "[%s]" % ",".join(parts)
		TYPE_DICTIONARY:
			var keys: Array = (value as Dictionary).keys()
			for k: Variant in keys:
				assert(k is String, "SimCanonical: non-string key %s" % [k])
			keys.sort()   # code-point order — same total order as JS sort()
			var parts := PackedStringArray()
			for k: String in keys:
				parts.append("%s:%s" % [JSON.stringify(k), encode(value[k])])
			return "{%s}" % ",".join(parts)
	assert(false, "SimCanonical: unsupported type %d" % typeof(value))
	return ""
```

- [ ] **Step 3: Run to green** (the escaped-string fixture case is the one most likely to argue — if Godot's `JSON.stringify` escaping ever disagrees with the fixture's expected bytes, write the escaper by hand; do **not** change the fixture). **Step 4: Commit.**

### Task 1.5: `sim/hashing.gd` — event identity

**Files:**
- Create: `godot/sim/hashing.gd`, `godot/test/unit/test_hashing.gd`

**Interfaces:**
- Consumes: `SimCanonical.encode`.
- Produces: `SimHash.hash_event(draft: Dictionary, parent: Variant, seq: int) -> String` (64-char lowercase hex). Reads only `type/schemaVersion/rngCounter/payload` from the draft — extra keys (like a fixture event's own `id`) are ignored, exactly as in TS.

- [ ] **Step 1: Failing test**

```gdscript
extends GutTest

const DRAFT := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 3, "payload": {"entityId": "p1"}}


func test_pinned_reference_hashes() -> void:
	assert_eq(SimHash.hash_event(DRAFT, null, 0),
		"4d6a00dcb9dca40a6b390de584de90f0328c5443d028811081ebd8866a1b1da9")
	assert_eq(SimHash.hash_event(DRAFT, "abc123", 4),
		"54a8660bbcbd5ad4cfa2af8f5a249e0d450b67a87f584ec6ff19e9690823a4e7")


func test_matches_reference_fixtures() -> void:
	var cases: Array = FixtureLoader.load_json("res://test/fixtures/hashes.json")
	for c: Dictionary in cases:
		assert_eq(SimHash.hash_event(c["draft"], c["parent"], c["seq"]), c["id"])
```

Run: `./godot/test.sh` → Expected: FAIL.

- [ ] **Step 2: Implement**

```gdscript
class_name SimHash
## Identity is content plus position: same event at a different point in the
## chain is a different event — twin of src/log/hash.ts.


static func hash_event(draft: Dictionary, parent: Variant, seq: int) -> String:
	var material := SimCanonical.encode({
		"type": draft["type"],
		"schemaVersion": draft["schemaVersion"],
		"rngCounter": draft["rngCounter"],
		"payload": draft["payload"],
		"parent": parent,
		"seq": seq,
	})
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(material.to_utf8_buffer())
	return ctx.finish().hex_encode()
```

- [ ] **Step 3: Run to green. Step 4: Commit.**

### Task 1.6: `sim/log.gd` — append and chain

Fold and the rng-counter half of `verifyChain` need `apply`; they arrive in Phase 2. Phase 1 ships append/chain plus deep-freezing, which Godot 4 can express natively via `make_read_only()`.

**Files:**
- Create: `godot/sim/log.gd`, `godot/test/unit/test_log.gd`

**Interfaces:**
- Consumes: `SimHash.hash_event`.
- Produces: `SimLog` (RefCounted) with `events: Dictionary`, `append(head: Variant, draft: Dictionary) -> Dictionary` (returns the sealed, read-only event; idempotent on convergent history), `chain(head: Variant) -> Array` (root-first). Phase 2 adds `fold(head)` and `verify_chain(head)`.

- [ ] **Step 1: Failing test.** Check `ls tests/` for an existing TS log/chain suite; if one exists, port its cases. Otherwise these three behaviours (from the TS doc-comments) are the contract:

```gdscript
extends GutTest

const DRAFT_A := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 0, "payload": {"n": 1}}
const DRAFT_B := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 1, "payload": {"n": 2}}


func test_append_seals_position_and_chains_root_first() -> void:
	var log := SimLog.new()
	var a: Dictionary = log.append(null, DRAFT_A)
	var b: Dictionary = log.append(a["id"], DRAFT_B)
	assert_eq(a["seq"], 0)
	assert_eq(b["seq"], 1)
	assert_eq(b["parent"], a["id"])
	var events: Array = log.chain(b["id"])
	assert_eq(events.size(), 2)
	assert_eq(events[0]["id"], a["id"])


func test_convergent_history_is_idempotent() -> void:
	var log := SimLog.new()
	var a1: Dictionary = log.append(null, DRAFT_A)
	var a2: Dictionary = log.append(null, DRAFT_A)
	assert_eq(a1["id"], a2["id"])
	assert_eq(log.events.size(), 1)


func test_sealed_events_are_read_only() -> void:
	var log := SimLog.new()
	var a: Dictionary = log.append(null, DRAFT_A)
	assert_true(a.is_read_only())
	assert_true((a["payload"] as Dictionary).is_read_only())
```

Run: `./godot/test.sh` → Expected: FAIL.

- [ ] **Step 2: Implement**

```gdscript
class_name SimLog
extends RefCounted
## Content-addressed append-only log — twin of src/log/chain.ts. Sealed
## events are deep-frozen: one holder mutating shared history was the
## reference engine's hardest lesson, and make_read_only() is Godot's way
## to keep it learned. fold() and verify_chain() join in Phase 2 with apply.

var events: Dictionary = {}


func append(head: Variant, draft: Dictionary) -> Dictionary:
	var seq := 0
	if head != null:
		assert(events.has(head), "append: unknown head %s" % head)
		seq = (events[head] as Dictionary)["seq"] + 1
	var id := SimHash.hash_event(draft, head, seq)
	if events.has(id):
		return events[id]   # convergent history: same content, same position
	var event: Dictionary = draft.duplicate(true)
	event["id"] = id
	event["parent"] = head
	event["seq"] = seq
	_deep_freeze(event)
	events[id] = event
	return event


func chain(head: Variant) -> Array:
	var out: Array = []
	var seen: Dictionary = {}
	var cursor: Variant = head
	while cursor != null:
		assert(not seen.has(cursor), "chain: cycle at %s" % cursor)
		seen[cursor] = true
		assert(events.has(cursor), "chain: missing event %s" % cursor)
		out.append(events[cursor])
		cursor = (events[cursor] as Dictionary)["parent"]
	out.reverse()
	return out


static func _deep_freeze(value: Variant) -> void:
	match typeof(value):
		TYPE_DICTIONARY:
			for k: Variant in value:
				_deep_freeze(value[k])
			(value as Dictionary).make_read_only()
		TYPE_ARRAY:
			for v: Variant in value:
				_deep_freeze(v)
			(value as Array).make_read_only()
```

- [ ] **Step 3: Run to green. Step 4: Commit.**

### Task 1.7: The Phase 1 gate — the golden chain re-hashes to its head

**Files:**
- Create: `godot/test/unit/test_golden_chain.gd`

**Interfaces:**
- Consumes: `SimHash`, `FixtureLoader`, `godot/test/fixtures/golden-run.json` (125-action brawler run; `head` = `4821a3c9…`).

- [ ] **Step 1: Write the gate test**

```gdscript
extends GutTest
## The migration's first hard gate: every recorded event of the committed
## golden run re-hashes, in GDScript, to the identical chain — closing on
## the same head the TypeScript engine signed. No reducer involved yet;
## this proves rng-counter envelopes, canonical bytes and SHA-256 agree.


func test_golden_chain_rehashes_to_recorded_head() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var parent: Variant = null
	var seq := 0
	for event: Dictionary in golden["events"]:
		parent = SimHash.hash_event(event, parent, seq)
		seq += 1
	assert_eq(seq, (golden["events"] as Array).size())
	assert_eq(parent, golden["head"], "golden chain head")
```

- [ ] **Step 2: Run** — `./godot/test.sh`
Expected: PASS. If the head mismatches, bisect by hashing event-by-event against a TS-side dump (`npx tsx` one-liner over the fixture calling `hashEvent`) to find the first diverging seq — the culprit is almost certainly string escaping or a float artifact in `SimCanonical`. **This debugging is Opus work by definition.**

- [ ] **Step 3: Commit.** — this is the moment the two engines first agree about history; the commit line should know it.

- [ ] **Step 4: Verify phase completion (superpowers:verification-before-completion):** run `./godot/test.sh` end-to-end and `npm run test` (TS untouched, still green); paste both summaries into the session log / NIGHTLOG entry.

---

# Phase 2 — The sim port (Opus plans & reviews; Sonnet fans out per module)

**Charter.** Port the remaining deterministic engine into `godot/sim/`, suite by suite, in dependency waves. ~2,600 lines of core TS plus `canon/rule` + `canon/interpret` (the reducer folds `RULE_FIRED`, so the R2 interpreter is *sim*, not AI). **Exit gates:** (a) replaying the golden chain through `apply.gd` reproduces `finalStateHash` = `2272ed6e…` exactly; (b) every ported GUT suite green; (c) full `verify_chain` (hash + schema-version + seq + rng-counter accounting, with the WORLD_INIT counter-epoch exception) passes on golden.

**Dependency waves** (tasks within a wave are independent → parallel Sonnet subagents; waves are sequential):

| Wave | Modules (TS → GD) | Test suites to port |
|---|---|---|
| A | `grid.ts→grid.gd`, `entity.ts→entity.gd`, `item.ts→item.gd`, `canon/rule.ts→rule.gd` | `tests/core/grid`, `entity`, `equipment` (item parts), `tests/canon/rule`, `vocabulary` |
| B | `tables.ts→tables.gd`, `state.ts+events.ts→state.gd+events.gd` (+`SCHEMA_VERSIONS`), `log/upcast.ts→upcast.gd`, `log/refs.ts→refs.gd`, `canon/interpret.ts→interpret.gd` | `tests/canon/interpret`, `rules-in-log`, table-adjacent cases inside core suites |
| C | `apply.ts→apply.gd` (**Opus authors or line-reviews**), then `SimLog.fold` + full `verify_chain` + fold memo (`FOLD_CACHE_LIMIT` 200k, cleared wholesale) | `tests/core/apply`, `leveling`, `dispositions` (apply half) |
| D | `mapgen.ts→mapgen.gd`, `reachability.ts→reachability.gd`, `sight.ts→sight.gd` — **verbatim ports; AStarGrid2D is forbidden in sim (spec §3)** | `tests/core/mapgen`, `path-pull`, sight cases |
| E | `turns.ts→turns.gd`, `ai.ts→ai.gd`, then `commands.ts→commands.gd` **split by verb family into 4–6 subagent tasks** (movement/strike; items/satchel/scrolls; traps/secrets/mimics; shove/brace/call/volley; purse/economy verbs) | `tests/core/ai`, `commands`, `verbs`, `player-verbs`, `new-verbs`, `dual-wield`, `traps`, `scrolls`, `secrets`, `mimics`, `pockets`, `loot`, `motifs`, `provisions-new`, `purse`, `tests/balance/sawtooth` |
| F | Golden fold gate + `verify_chain` gate + perf pass (fold of 48×32 golden chain < 1s headless) | `test_golden_fold.gd` (new) |

**Standing instructions for every module task (the plan Opus writes must inline these into each task):**
1. Port the *test suite first*, assert against exported fixtures where numeric tables are involved (extend `scripts/export-fixtures.ts` per wave — e.g. dump `tables.ts` damage/trap/loot draws and a full `mapgen` board for seeds {17, 99, 12345} before wave B/D starts).
2. State stays **plain data**: `Dictionary`/`Array` mirroring the TS shapes key-for-key (canonical hashing sees these keys — a renamed key is a forked chain). No classes for state; `RefCounted` statics for functions.
3. TS `undefined`-vs-`null` translates as absent-key vs `null` — never invent a `null` where TS omitted.
4. Mutation-proof spot check per suite (Global Constraints).
5. Any behavioural doubt: consult the TS source *at tag `ts-baseline`*, never trust memory of it.

- [ ] **Task 2.0 (Opus): author `docs/superpowers/plans/…-godot-phase-2-sim-port.md`** via superpowers:writing-plans. Inputs: this charter; the wave table; `src/core/*.ts`, `src/canon/{rule,interpret}.ts`, `src/log/{upcast,refs}.ts` at `ts-baseline`; the full `tests/` inventory (`ls -R tests`); Phase 1's delivered interfaces (SimRng/SimCanonical/SimHash/SimLog/FixtureLoader, exactly as named above). The plan must give every subagent task: exact file pairs, the Interfaces block, complete signatures for anything a later wave consumes, and the gate tests verbatim.
- [ ] **Task 2.1–2.n: execute the waves** per superpowers:subagent-driven-development — Sonnet subagents within waves, Opus review between waves (two-stage review on wave C and the `commands.gd` family).
- [ ] **Task 2.G: the gates** — `test_golden_fold.gd` asserts `SimCanonical`-hashed final state equals `finalStateHash` (port the exact state-hash recipe from `scripts/generate-golden.ts`); full `verify_chain` on golden returns null-divergence; `./godot/test.sh` fully green.

---

# Phase 3 — The stage: a playable presentation MVP (Sonnet, Opus reviews the Chronicle)

**Charter.** A human can play a full floor in Godot with keyboard input, placeholder art, and the same verbs as the web debug UI. **Authority stays in sim**: the stage calls command functions, appends the returned drafts through `Chronicle`, and repaints from folds/signals.

Scope (one task each unless noted):
- `autoload/Chronicle.gd` — owns `{SimLog, head}`; `commit(draft)` appends + emits `event_appended(event, state)`; exposes `state() -> Dictionary` (current fold). **Opus reviews this file** — it is the only writer and the seam the whole stage hangs on.
- `stage/board/` — TileMapLayer painted from `state.grid` (flat-colour TileSet matching the web palette in `src/ui/debug.css`); repaint on WORLD_INIT, incremental on tile-affecting events.
- `stage/entities/` — one Node2D per entity keyed by id; position = grid cell; guise rendering for mimics (the lie stays render-side, exactly as in TS).
- `stage/input/` — keymap derived from `src/ui/debug.ts`'s key handler + `MANUAL.md` (movement, wait, take, use, read, shove, brace, call, draw/volley, descend); each key → the matching `commands.gd` function → `Chronicle.commit`.
- `stage/turn_manager.gd` — the proposal's state machine (`PLAYER_TURN → ENEMY_TURN → …`) as a *shell*: it sequences whose command function gets called (enemy turns via `ai.gd` decisions), never resolves outcomes itself; `await` only for input and animation pacing.
- `stage/hud/` — hp/might/wits/speed, xp/level (the ladder readout), depth, gold, satchel, scroll belt slot, message log with async Oracle slots left as plain-text fallbacks this phase.
- Fog/FOV from `sight.gd`; Camera2D follow; minimap (TextureRect painted per tile, replacing the web 2px canvas).
- Persistence: save/load `{events, head}` JSON to `user://runs/` (port the shape `play/store.ts` uses, so web-era runs remain loadable).

**Workflow note:** stage tasks may drive a running Xogot instance through `xo` (`launch`, `scene`, `node`, `tilemap`, `script`, `eval`, `editor` screenshots) to author scenes and *visually verify* them — the committed `.tscn`/`.gd` files remain the deliverable, and every gate still runs through the headless standard CLI.

**Exit gate:** a scripted 20-input session (documented keystroke list) plays identically to the same session on the web UI at `ts-baseline` — verified by comparing resulting chain heads. Plus: window resize sanity, 60fps on the 48×32 board.

- [ ] **Task 3.0 (Opus): author the Phase 3 plan.** Inputs: this charter; `src/ui/debug.ts`, `debug.css`, `src/play/{session,store}.ts`, `MANUAL.md`; Phase 2's `commands.gd`/`ai.gd` surfaces. Every scene task gets a node-tree sketch and the signal contract.
- [ ] **Task 3.1–3.n: execute** (Sonnet; board/entities/hud/input are parallelizable after Chronicle lands).

---

# Phase 4 — Headless tooling and agent parity (Sonnet)

**Charter.** The repo's agentic playtest culture must survive the migration: `playtester` and `listener` agents, the golden generator, and feedback packets all keep working against the Godot build.

Scope:
- `godot/tools/autoplay.gd` (SceneTree script): port `src/play/{autoplay,policies}.ts` — brawler/coward/greed policies driving `commands.gd` headlessly: `$GODOT --headless --path godot -s tools/autoplay.gd -- --seed 17 --policy brawler --max-actions 220`.
- `godot/tools/golden.gd`: port `scripts/generate-golden.ts` (same JSON shape, same state-hash recipe). Verify it reproduces `golden-run.json` byte-meaningfully (same head/finalStateHash) from seed 17.
- **Bidirectional gate:** a fresh Godot-generated run must pass TS `verifyChain` — add `scripts/verify-run.ts` (thin wrapper over `src/log/chain.ts#verifyChain` reading a run JSON path) and run it on Godot output.
- `godot/tools/feedback.gd`: emit `runs/feedback/`-shaped reports + `index.jsonl` lines so the `listener`/`playtester` agents read Godot runs unchanged; update `.claude/agents/{playtester,listener}.md` and `.claude/skills/playtest/SKILL.md` command lines to invoke the Godot tools.
- CI: `.github/workflows/godot-tests.yml` — download pinned Linux Godot (`GODOT_VERSION` env, `linux.x86_64` headless), vendor path for GUT already in-repo, run `./godot/test.sh`; keep the existing vitest job for the frozen reference.
- `.claude/launch.json`: add a `godot-editor` configuration note (attach-style; the Godot editor is launched by the human, dev server config stays for the reference UI).

**Exit gate:** `playtest` skill completes a sweep against the Godot build; bidirectional golden passes both directions.

- [ ] **Task 4.0 (Opus): author the Phase 4 plan.** Inputs: charter; `scripts/{generate-golden,play,trial,loop,balance}.ts`; `src/play/`; `runs/feedback/index.jsonl` shape; the two agent definitions.
- [ ] **Task 4.1–4.n: execute** (Sonnet; autoplay → golden → bidirectional are sequential; feedback/CI/launch parallel after).

---

# Phase 5 — The Oracle bridge and the canon/critic/assay port (Opus designs the bridge; Sonnet ports the pure logic)

**Charter.** LLM integration returns, key-safe; the remaining pure-TS subsystems port.

Scope:
- `server/oracle-standalone.ts`: extract the CLI-proxy logic from `server/oracle-plugin.ts` into a standalone Node HTTP sidecar (localhost, port from env; reuses `src/oracle/transports.ts`). Keys live in the sidecar's environment, never in GDScript (spec: BYOK-vs-hosted is a *distribution* decision, recorded and deferred).
- `autoload/Oracle.gd`: HTTPRequest wrapper porting `src/oracle/oracle.ts` semantics — non-blocking `ask`/`consult` queue, timeout, graceful stub fallback; mechanics never await it (Covenant: prose arrives late or not at all, play never stalls).
- Sonnet ports (pure logic + prompt templates, one subagent each): `canon/{bible,namesmith,rulesmith,chronicler}.ts`, `assay/{covenant,register,ruleAssay}.ts`, `critic/{lenses,interest,surprise,memo,ensemble,critic}.ts`, `channels/channels.ts` — with their suites (`tests/canon/*`, `tests/assay/*`, `tests/channels/*`). Opus reviews the prompt-bearing files (rulesmith, chronicler) for template fidelity.
- Re-point the `rules-warden` agent's assay CLI to the Godot/sidecar equivalents.

**Exit gate:** a live-Oracle session produces R0 improvisation → R1 record → R2 ratification end-to-end in Godot; assay trials run headless; all ported suites green.

- [ ] **Task 5.0 (Opus): author the Phase 5 plan.** Inputs: charter; `server/oracle-plugin.ts`, `src/oracle/`, `src/canon/`, `src/assay/`, `src/critic/`, `src/channels/`; `openwiki/integrations/oracle-channels.md`.
- [ ] **Task 5.1–5.n: execute.**

---

# Phase 6 — Economy and mining, Godot-native (Opus plans; Sonnet builds)

**Charter.** Implement the **corrected** economy/mining design — `docs/superpowers/specs/2026-07-30-economy-mining-and-sprites.md` §III's staged increments — natively in the Godot sim, *minus whatever Phase 0 recorded as already landed in TS* (those arrived via the Phase 2 port). Non-negotiables inherited from that review and the migration spec: gold is chain-derived (`GOLD_MOVED`), the suspended-floor "state stack" is chain events (suspend/resume/riser events — never scene-tree snapshots), Deep Echo risers are events injected on the suspended floor's chain, dice notation becomes named table bands with counted draws, and new event types get schema versions + upcasters + golden coverage.

**Exit gate:** the 2026-07-30 spec's own per-increment measures, run via the Phase 4 playtest tooling; `verify_chain` still null-divergent on all generated runs.

- [ ] **Task 6.0 (Opus): author the Phase 6 plan.** Inputs: the 2026-07-30 spec §III (read *its* increment list in full — this charter deliberately does not restate it); NIGHTLOG's Phase 0 landing line; Phase 2's `events.gd`/`apply.gd`/`commands.gd`/`tables.gd` surfaces.
- [ ] **Task 6.1–6.n: execute.**

---

# Phase 7 — Juice (Sonnet fan-out, fully parallel)

**Charter.** The proposal's §V, kept: this is why we came. **One iron rule: juice reads, never writes.** Every item subscribes to `Chronicle` signals/state; none may touch sim state, consume sim rng counters, or gate a mechanic. Cosmetic randomness uses a *local* `RandomNumberGenerator` (allowed here, forbidden in sim). Each row is one independent Sonnet subagent task; all can run in parallel worktrees.

| Item | Sketch | Acceptance |
|---|---|---|
| Tweened movement | 0.1s slide + subtle hop per MOVE; never blocks input queue | 20-move burst stays in sync with state |
| Impact feedback | screen shake + hit-flash on STRIKE crits | shake amplitude capped; toggleable |
| Dynamic light | PointLight2D on torches/player; mining floors near-black | occlusion follows walls (LightOccluder2D from grid) |
| Particles | mining debris, scroll ember trails, crit sparks (GPUParticles2D) | pooled; zero allocs steady-state |
| Cosmetic coin scatter | GOLD_MOVED spawns RigidBody2D coins that bounce, then despawn into the HUD count | purse number always equals folded state |
| Trap shaders | gas = full-screen distortion + green tint; duration from the event, not a timer guess | shader off = identical play |
| Positional audio | AudioStreamPlayer2D per entity; Deep Echo's overhead cracking + muffled riser steps | mutes cleanly; no audio on headless |

Subagents on these rows should verify their work visually via `xo editor` screenshots against a running Xogot instance (or a windowed standard-Godot run) before hand-back.

**Exit gate:** 60fps on the 48×32 board with all items on; golden replay hash unchanged with juice enabled vs disabled.

- [ ] **Task 7.0 (Opus): author the Phase 7 plan** (thin — mostly this table expanded with node trees). Then dispatch all rows in parallel (superpowers:dispatching-parallel-agents, worktree isolation).

---

# Phase 8 — Cutover (Sonnet)

**Charter.** Godot becomes the game; TypeScript becomes the reference.

- README.md / MANUAL.md / WALKTHROUGH.md rewritten for the Godot build (install, play, test commands); AGENTS.md gains the sim/stage ground rules and the freeze policy; NIGHTLOG entry for the crossing.
- openwiki: update `openwiki/INSTRUCTIONS.md` source pointers so the scheduled workflow regenerates pages over `godot/` too (never hand-edit generated pages).
- Strike the "Artifact Publishing Target" backlog item (superseded — spec § Parked); park witness voice capture with its rationale.
- The web UI (`index.html`, `src/ui/`, vite) stays in-tree, labelled reference-only; `npm run dev` keeps working against the frozen engine.
- Final sweep: `./godot/test.sh` green, `npm run test` green, bidirectional golden, one full human-played floor, one `playtest` sweep — then the cutover commit.

- [ ] **Task 8.0: execute directly** (small enough to run without a sub-plan; superpowers:verification-before-completion before the final commit).

---

## Verification gate summary (the migration's spine)

| Gate | Proves | Phase |
|---|---|---|
| Fixture parity (rng/canonical/hash) | kernel bytes identical | 1 |
| Golden chain re-hash → `head` | envelopes + canonical + sha256 agree | 1 |
| Golden fold → `finalStateHash` | the reducer is a true twin | 2 |
| Full `verify_chain` null-divergence | counter accounting + schema versions | 2 |
| Scripted-session head equality (web vs Godot) | input→command wiring faithful | 3 |
| Bidirectional golden (Godot run verifies in TS) | no one-way drift | 4 |
| Juice on/off hash equality | presentation never decides | 7 |

## Self-review notes (writing-plans checklist, applied)

- **Spec coverage:** every section of the corrected migration spec maps to a phase (decision→0/1, sim/stage→1/2/3, parity ladder→gates, oracle→5, parked items→8, proposal §IV mining→6, §V juice→7, §VI pitfalls→Global Constraints + Phase 5).
- **Placeholders:** Phases 2–8 intentionally carry *charters + plan-authoring tasks* rather than step-level code — the detailed plans are Opus deliverables with inputs enumerated, which is the scope-check ("one plan per subsystem") applied deliberately; Phase 0–1, which no later plan can precede, are fully coded here with pinned ground truth.
- **Type consistency:** later phases consume exactly `SimRng.u32/float01/int_between`, `SimCanonical.encode`, `SimHash.hash_event`, `SimLog.append/chain(/fold/verify_chain in P2)`, `FixtureLoader.load_json/normalize`, `Chronicle.commit/state` — names match their defining tasks.
