class_name SimPurse
## The economy verbs — the byte-twin of src/core/commands.ts's `GOLD_MOVED`
## producers. Reached through `SimCommands`, never directly, like every other
## family under sim/commands/.
##
## ── THIS FILE HAS NO FUNCTIONS, AND THAT IS NOT AN OVERSIGHT ──────────────
## `git grep -n "GOLD_MOVED" ts-baseline -- src/` finds it in exactly five
## places: assay/covenant.ts (M9's own record), core/apply.ts (the fold),
## core/events.ts (the schema entry), core/state.ts (a doc comment) — and
## nowhere in commands.ts. No function anywhere in the reference constructs a
## GOLD_MOVED draft. tests/core/purse.test.ts confirms it from the other
## side: its imports pull `apply` from core/apply.js, `valueOf` from
## core/tables.js, and `COVENANT` from assay/covenant.js — nothing at all
## from commands.js. Every one of its 13 cases calls the reducer or the table
## directly, by hand-building the event, because there is no command to call.
##
## The design spec is explicit about why: Increment A ("the purse",
## docs/superpowers/specs/2026-07-30-economy-mining-and-sprites.md §III) is
## "the economy's spine, with nothing to spend it on. Deliberately small so
## the invariant is settled before anything leans on it." It ships the fold,
## the price table, and the stairs-carry — and stops. Increments B-D (the
## mine, the shop, mining traps — the actual sellers and spenders that would
## call GOLD_MOVED) are Phase 6 of the Godot migration, explicitly out of
## scope here (master plan, Phase 6 charter: "minus whatever Phase 0 recorded
## as already landed in TS — those arrived via the Phase 2 port").
##
## So this task's whole Increment-A surface was already ported by earlier
## Phase 2 tasks, before Wave E existed to claim it:
##   * `SimTables.value_of`, `LOOT_VALUE`, `PROVISION_VALUE` — sim/tables.gd,
##     fixture-swept against godot/test/fixtures/tables.json's "valueOf" rows.
##   * `SimState.empty()["gold"] == 0` — sim/state.gd.
##   * `GOLD_MOVED`'s fold (a sum, no clamp) — sim/apply.gd's "GOLD_MOVED" arm.
##   * `WORLD_INIT`'s `playerGold` carry, absence folding to 0 — sim/apply.gd's
##     "WORLD_INIT" arm, `"gold": _or(p.get("playerGold"), 0)`.
##   * `GOLD_MOVED` schemaVersion 1, `WORLD_INIT` schemaVersion 15 — sim/events.gd.
## None of that infrastructure had a purse-shaped witness before this task:
## the golden run carries a single depth-1 WORLD_INIT with no `playerGold`
## key and zero GOLD_MOVED events (measured directly against
## godot/test/fixtures/golden-run.json), so it exercises none of the above.
## godot/test/unit/test_purse.gd is what closes that gap, and is the entire
## witness for it. See that file's header for the full 13-case reconciliation
## and scripts/mutate-sim.py's `Task 2.E3e` rows for the mutation proof.
##
## The `reason` field's closed union (`'sale' | 'purchase' | 'trove'` in
## GoldMovedPayload, core/events.ts:382) is a TypeScript compile-time fact
## with no GDScript runtime counterpart, the same as every other payload
## shape in events.ts — see events.gd's own header on why those types don't
## reappear here.
##
## When Phase 6 adds the mine and the shop, THEIR commands are what belongs
## in this file: a sale, a purchase, a trove. Nothing here should invent that
## surface ahead of the design that owns it.
