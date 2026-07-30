# Godot Phase 3 — The Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a human can play a full floor in Godot with the keyboard, placeholder art, and the same verbs as the web debug UI.

**The one architectural rule, from which everything else follows:** **authority stays in `sim/`.** The stage calls a command function, appends the returned draft through `Chronicle`, and repaints from the fold. It never computes an outcome, never mutates state, never decides anything a chain would need to agree with later. A stage that decides is a second source of truth, and the whole migration exists to have exactly one.

**Parent plan:** `docs/superpowers/plans/2026-07-29-godot-migration-master-plan.md` (Phase 3 charter).
**Predecessor:** Phase 2 is complete — 18 sim modules, 52 test scripts, 654 tests, three exit gates green.

---

## What Phase 2 hands you, exactly as named

```gdscript
# The chain
SimLog.new(); log.append(head, draft) -> Dictionary   # the SEALED event
log.chain(head) -> Array                              # root-first
log.fold(head) -> Dictionary                          # the state, memoised
log.verify_chain(head) -> Variant                     # null when sound

# The verbs — ALL return DRAFTS, never state
SimCommands.create_world(seed, w, h, player_id, depth) -> Dictionary
SimCommands.attempt_move(state, entity_id, dx, dy) -> Dictionary
SimCommands.advance_turn(state) -> Dictionary
SimCommands.wait(state, entity_id) -> Dictionary
SimCommands.take_underfoot(state, entity_id, deliberate := false) -> Variant
SimCommands.take_or_refuse(...) / use_carried(state, id, slot) -> Variant
SimCommands.read_scroll(...) / shove_at(state, id, dx, dy) -> Variant
SimCommands.brace_self(...) / draw_stance(...) / loose_shot(...) / shot_target(...)
SimCommands.call_out(...) / sense_trap(...) / spring_trap(...)
SimCommands.stir_world(state, player_id) -> Variant
SimCommands.outcome(state) -> String
SimCommands.ratify_rule(state, rule) -> Dictionary

# The mind, the board, the eye
SimAi.decide(state, entity_id) -> Dictionary          # an Action, tagged by kind
SimTurns.initiative_order(entities) -> Array
SimTurns.next_active(entities, active_id) -> Dictionary
SimGrid.FLOOR / WALL / EXIT / SECRET, tile_at, is_passable
SimSight.<fov>                                        # read sight.gd for the surface
SimTables.sight_at(depth) -> int
SimEntity.find(entities, id) -> Variant
SimState.STATE_KEYS                                   # the 20 keys
```

A command returning **`null`** means *the world said no* — not an error. Nothing is
appended and nothing changes. That is a routine outcome and the stage must render
it as a refusal, never as a crash.

---

## Global Constraints

- **Engine:** Godot 4.7.1 standard CLI is the backbone. `project.godot` `config/features` stays pinned to `"4.6"` (see NIGHTLOG — bumping it is a designer decision with every gate re-run behind it). GDScript only, typed everywhere.
- **`godot/sim/` stays pure and stays untouched.** Phase 3 adds `autoload/` and `stage/`; it does not edit `sim/`. If the stage needs something `sim/` does not expose, that is a finding to report, not a reason to reach in.
- **The stage may not import `Node` into `sim/`, and `sim/` may not learn about the stage.** The dependency arrow points one way, forever.
- **`Chronicle` is the ONLY writer.** Nothing else calls `log.append`. One writer is what makes "the stage is a projection" checkable rather than aspirational.
- **Test runner:** `./godot/test.sh` only, and its script-count guard is never worked around. A parse error is a silently skipped script and GUT exits 0 on those.
- **GUT idiom:** never `assert_ne(x, null)` — the comparator pushes an engine error that counts as a failure. Use `assert_null` / `assert_not_null`.
- **A test must never derive its expectation from the constant it guards.** This migration measured NINE tests that could never have failed, two of them inherited from the reference's own suite. Spell numbers as literals and show the arithmetic.
- **Every test file states its reconciliation.** Ported, or deferred with the owning task named.
- **The balance suite costs ~9 minutes.** Use `-gselect=<file>.gd` while iterating; one full run before you report.
- Commit messages: one evocative line in the repo's voice plus the `Co-Authored-By:` trailer.

---

## The palette, from `src/ui/debug.css` — the stage should look like the game

```
ground  #14161a   raised  #191c21   ink    #e8e9ec   soft  #99a1b0
faint   #5b6472   rule    #2a2f38   wall   #2c3038   floor #1b1e24
player  #f0ad3c   foe     #b5483c   exit   #2f8f74   peril #d08770
item    #a78bfa   scroll  #d9c8a0   sling  #64a9e8   worn  #8ea4c8
tool    #e08fd4   heart   #efe6d8
```

## The keys, from `MANUAL.md` §2 and `src/ui/debug.ts`'s handler

| Key | Verb | Command |
|---|---|---|
| arrows / wasd | walk (into a creature is an attack, into a wall costs nothing) | `attempt_move` |
| `.` / space | stand still | `wait` |
| `x` then a direction | shove | `shove_at` |
| `z` | brace | `brace_self` |
| `f` | draw the sling; again to loose | `draw_stance` / `loose_shot` |
| `q` / `Q` | use satchel slot 0 / slot 1 | `use_carried` |
| `,` | take underfoot, deliberately | `take_or_refuse` |
| `r` | read the carried scroll | `read_scroll` |

`x` is **modal**: it arms, then the next direction key spends it. The web UI sets
`shoveArmed = true`, says "shove — which way?", and every other key clears it.
Port that exactly — an armed shove that survives an unrelated keypress is a
different game.

Phase 3 does **not** bind `c`/`t`/`g`/`m`/`n`/`p` (witness, gamemaster, forge,
screen, worlds, palette). Those are Phase 5 and later; leave them unbound rather
than stubbed, so a key that does nothing is visibly not yet a key.

---

# Task 3.1: `autoload/Chronicle.gd` — the seam

**THIS FILE IS OPUS-REVIEWED.** It is the only writer and the seam the whole
stage hangs on; everything else in Phase 3 is a projection of what it holds.

**Files:** create `godot/autoload/Chronicle.gd`, `godot/test/unit/test_chronicle.gd`. Register the autoload in `project.godot`.

**Produces:**
```gdscript
extends Node
signal event_appended(event: Dictionary, state: Dictionary)
signal world_replaced(state: Dictionary)          # WORLD_INIT: repaint everything
var log: SimLog
var head: Variant                                  # String, or null before the first event
func reset() -> void                               # a fresh log and a null head
func commit(draft: Variant) -> Variant             # null draft -> null, nothing appended
func state() -> Dictionary                         # fold(head); EMPTY_STATE when head is null
```

- [ ] **Step 1: `commit` takes a `Variant`, not a `Dictionary`.** Half the command
  surface returns `null` for "the world said no". `commit(null)` must return
  `null`, append nothing, and emit nothing. Making callers null-check before
  every commit is how one of them eventually forgets.
- [ ] **Step 2: emit AFTER the append, with the folded state.** Listeners repaint
  from what they are handed, never by re-folding themselves — one fold per
  event, and every listener sees the same state.
- [ ] **Step 3: `world_replaced` is separate from `event_appended`** because
  WORLD_INIT replaces state wholesale and the board's incremental repaint cannot
  express that. Emit both, `world_replaced` first.
- [ ] **Step 4: tests.** A committed draft lands in the log and moves the head; a
  null draft does neither; `state()` before anything equals `SimState.empty()`;
  the signals carry the state the listener would have folded; two commits chain
  (the second's parent is the first's id). **Prove the null path by mutation** —
  make `commit` append a null and confirm a named test fails.
- [ ] **Step 5: commit.**

# Task 3.2: `stage/board/` — the floor

**Files:** create `godot/stage/board/Board.gd` + `Board.tscn`, `godot/test/unit/test_board.gd`.

- [ ] **Step 1:** a `TileMapLayer` with a flat-colour `TileSet` — one tile per
  `SimGrid` constant, in the palette above (`floor`, `wall`, `exit`; `SECRET`
  paints as **wall** — the lie is render-side, exactly as in the web UI).
- [ ] **Step 2:** `paint(state)` repaints wholesale on `world_replaced`.
  `touch(event, state)` repaints only what an event can change — `SCROLL_READ`'s
  stone song turns wall to floor, and nothing else in the game moves a tile.
- [ ] **Step 3:** tests that assert the painted cell for each tile kind, and that
  a stone-song event changes exactly the enumerated cells and no others.
- [ ] **Step 4: commit.**

# Task 3.3: `stage/entities/` — the bodies

**Files:** create `godot/stage/entities/Entities.gd`, `Body.tscn`, `godot/test/unit/test_entities.gd`.

- [ ] **Step 1:** one `Node2D` per entity, **keyed by id**, position = grid cell ×
  tile size. Add on appear, free on disappear, move on `pos` change. Never
  rebuild the whole set on every event — a rebuild loses any animation state and
  makes 60fps on a 48×32 board a coin toss.
- [ ] **Step 2: the mimic's lie stays render-side.** An entity with `guise` and
  the `hidden` tag draws as the ITEM its guise names, in the item colour. The
  state already knows the truth; the player does not. Read `test_mimics.gd` for
  what the sim guarantees here.
- [ ] **Step 3:** tests — a body appears, moves, and is freed; a hidden mimic
  draws as its guise and an unmasked one draws as itself.
- [ ] **Step 4: commit.**

# Task 3.4: `stage/input/` — the hands

**Files:** create `godot/stage/input/Keymap.gd`, `godot/test/unit/test_keymap.gd`.

- [ ] **Step 1:** a pure, testable mapping — **not** an `_input` handler that
  calls commands directly. `Keymap.resolve(key: String, armed: bool) -> Dictionary`
  returns `{"verb": String, "dx": int, "dy": int, "arms": bool, "clears": bool}`.
  Keeping it pure is what lets the exit gate replay a keystroke list headlessly
  with no window at all.
- [ ] **Step 2:** the shove's modal arm, per the table above. Every non-direction
  key clears it.
- [ ] **Step 3:** tests for every row of the keymap table, plus: an armed shove
  spent by a direction, an armed shove cleared by an unrelated key, and an
  unbound key resolving to nothing rather than to a wrong verb.
- [ ] **Step 4: commit.**

# Task 3.5: `stage/turn_manager.gd` — the shell

**Files:** create `godot/stage/TurnManager.gd`, `godot/test/unit/test_turn_manager.gd`.

- [ ] **Step 1:** it **sequences**, it never resolves. `PLAYER_TURN → ENEMY_TURN →
  PLAYER_TURN`. On an enemy turn it asks `SimAi.decide`, translates the returned
  Action into the matching command call, and commits the draft. It computes no
  outcome of its own, ever.
- [ ] **Step 2:** `await` only for input and animation pacing — never inside the
  commit path. A turn's events must all land in the same frame's chain, or a
  save taken mid-animation records half a turn.
- [ ] **Step 3:** tests that drive a whole round headlessly and assert the chain
  the round produced, not the pixels.
- [ ] **Step 4: commit.**

# Task 3.6: `stage/hud/` — the readout

**Files:** create `godot/stage/hud/Hud.gd` + `Hud.tscn`, `godot/test/unit/test_hud.gd`.

- [ ] **Step 1:** hp/might/wits/speed, xp and level (the ladder readout), depth,
  gold, the satchel's two slots, the scroll belt slot, and a message log.
- [ ] **Step 2: every one of those is DERIVED from the fold.** `xp`, `level` and
  `gold` especially — covenant M9: they are folded from history, never stored,
  and the HUD must read them from the state rather than keeping a running total.
  A HUD that counts is a second source of truth.
- [ ] **Step 3:** Oracle-authored text has no port yet (Phase 5). Leave plain-text
  fallbacks, not stubs that look like they work.
- [ ] **Step 4: commit.**

# Task 3.7: fog, camera, minimap

**Files:** `godot/stage/board/Fog.gd`, `godot/stage/Camera.gd`, `godot/stage/hud/Minimap.gd`.

- [ ] **Step 1:** fog from `SimSight` at `SimTables.sight_at(depth)`. Remembered
  tiles stay dim; unseen stay black.
- [ ] **Step 2:** `Camera2D` follows the player.
- [ ] **Step 3:** minimap as a `TextureRect` painted per tile, replacing the web
  UI's 2px canvas.
- [ ] **Step 4: commit.**

# Task 3.8: persistence

**Files:** `godot/autoload/Store.gd`, `godot/test/unit/test_store.gd`.

- [ ] **Step 1:** save and load `{events, head}` JSON to `user://runs/`, **porting
  the shape `src/play/store.ts` uses**, so web-era runs remain loadable. Read it
  at `ts-baseline`; do not invent a shape.
- [ ] **Step 2:** a loaded run must `verify_chain` clean before it is played. A
  save that does not verify is a corrupted save and the player is told so.
- [ ] **Step 3:** tests — round-trip a run, and refuse a tampered one.
- [ ] **Step 4: commit.**

# Task 3.9: THE EXIT GATE — the scripted session

**Files:** `godot/test/unit/test_scripted_session.gd`, `docs/phase-3-session.md`.

This is the gate the whole phase is measured by, and it is the only one that can
tell "it looks right" from "it is right".

- [ ] **Step 1: write down a 20-keystroke session** — an explicit, documented list
  of keys, from a fixed seed and a fixed board.
- [ ] **Step 2: play it headlessly** through `Keymap.resolve` → `SimCommands` →
  `Chronicle`, with no window and no rendering.
- [ ] **Step 3: assert the resulting CHAIN HEAD.** Not the pixels, not the HUD —
  the head. Two engines that agree on the head agree on everything the chain
  records.
- [ ] **Step 4: prove the gate can fail** — change one keystroke and confirm the
  head changes. A gate that cannot fail proves nothing, and this migration has
  already measured nine tests that could not.
- [ ] **Step 5:** window resize sanity and 60fps on the 48×32 board, checked by
  hand and recorded — these two are not headless-checkable and should not pretend
  to be.
- [ ] **Step 6: commit.**

---

## Exit gates (all must hold)

| Gate | Assertion | Task |
|---|---|---|
| **Session parity** | the documented 20-keystroke session produces a recorded chain head | 3.9 |
| **Suite parity** | `./godot/test.sh` exit 0, script-count guard satisfied, no existing test weakened | all |
| **One writer** | `git grep -n "\.append(" godot/stage godot/autoload` returns only `Chronicle.gd` | 3.1 |
| **Purity** | `godot/sim/` unchanged by this phase: `git diff <phase-2-tip> HEAD -- godot/sim/` is empty | all |

## Self-review notes

- **The charter's exit gate says "plays identically to the same session on the web
  UI at `ts-baseline`, verified by comparing resulting chain heads."** Task 3.9 as
  written asserts the head against a **recorded** value rather than against a
  live web run. That is the honest form: driving the web UI headlessly is a
  browser-automation problem, not a migration problem, and a recorded head that
  was **generated from the TypeScript engine** carries the same proof with none
  of the apparatus. Whoever runs 3.9 must generate that head from `ts-baseline`
  and say so in the commit — a head recorded from the Godot side would be a test
  agreeing with itself.
- **`decide()` has eight branches the golden run never exercises**; Phase 2 named
  them. The turn manager (3.5) is the first thing that will drive them in
  anger. Expect to find something there, and report it rather than patching
  `sim/`.
