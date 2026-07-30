extends GutTest
## The purse — the byte-twin of tests/core/purse.test.ts. One test per TS
## `it(...)`, in the TS file's order, so the two suites can be diffed by eye.
##
## Every case here calls SimApply.apply and SimTables.value_of directly,
## never a command function: commands.ts has no producer of GOLD_MOVED at
## ts-baseline, and the reference file's own imports confirm it (apply from
## core/apply.js, valueOf from core/tables.js, COVENANT from
## assay/covenant.js — nothing from commands.js). See
## sim/commands/purse.gd's header for the fuller account of why that file
## has no functions to re-export.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 13 cases across four describe blocks.
## 13 = 11 PORTED (below) + 2 DEFERRED. Line numbers are
## tests/core/purse.test.ts at ts-baseline.
##
## describe('what a kind fetches') — 4
##   :46  prices every kind the dungeon can actually drop
##   :54  keeps the main dungeon nominal — pocket change, never a living
##   :63  pays less for a thing you were going to use up than for a thing you
##        were going to wear
##   :73  is worth nothing for a kind it does not know, rather than throwing
##
## describe('the purse is folded, never stored') — 4
##   :82  starts empty
##   :86  sums what exchange recorded
##   :98  sums honestly rather than clamping, so an unaffordable spend is a
##        visible bug
##   :106 spends no randomness — an exchange is arithmetic, not a roll
##
## describe('the purse crosses the stairs') — 3
##   :114 carries what the player had, like the satchel learned to at v9
##   :119 folds a floor that never said to an empty purse
##   :126 does not let a new floor forget money already earned mid-run
##
## ── Deferred — describe('the covenant states the purse (M9)') — 2 ─────────
## Both cases read `src/assay/covenant.ts`'s `COVENANT` array end to end
## (existence of the M9 entry, its register, its enforcedBy length, its
## statement text). Nothing under sim/ ports assay/ — Phase 2's charter is
## src/core/ and src/canon/rule.ts only. `assay/{covenant,register,
## ruleAssay}.ts` is explicit Phase 5 scope (master plan, Phase 5 charter
## line 781), sub-tasked as Task 5.1-5.n once Task 5.0 authors that phase's
## plan; no sharper task number exists yet because that plan has not been
## written. Owning task: Phase 5 (the assay/covenant.ts port).
##   :139 is stated as mechanical, with an enforcer
##   :146 says out loud that the purse is chain-derived
## M9 is not undocumented in the meantime — sim/tables.gd, sim/apply.gd and
## sim/state.gd each carry a prose comment at their M9-relevant line, and
## sim/commands/purse.gd's header states the invariant in full. What is
## missing is only the machine-checkable COVENANT record itself.
##
## ── The arithmetic, spelled out ───────────────────────────────────────────
## test_sums_what_exchange_recorded:                    0 +2 -> 2, +5 -> 7,
##                                                       -50 -> -43
## test_sums_honestly_rather_than_clamping...:           0 + (-1) = -1, unclamped
## test_carries_what_the_player_had...:                  playerGold 17 straight
##                                                       through, unmodified
## test_folds_a_floor_that_never_said...:                absent playerGold folds
##                                                       to 0
## test_does_not_let_a_new_floor_forget...:               0 + 9 (sale) = 9;
##                                                       carried into the next
##                                                       WORLD_INIT unchanged
##
## ── Why this suite is the only witness ────────────────────────────────────
## The golden run's single WORLD_INIT carries no `playerGold` key at all and
## the run contains zero GOLD_MOVED events (verified directly against
## godot/test/fixtures/golden-run.json: 1 WORLD_INIT, 0 GOLD_MOVED, out of
## 451 events). test_apply.gd's own four-law sweep exercises a WORLD_INIT
## with no `playerGold` in its payload either — it proves purity, shape, no
## fractional numbers and the absent-key law, never a specific gold value.
## So nothing before this file ever drove `state["gold"]` through a non-zero
## GOLD_MOVED fold or a non-empty stairs carry. This suite is what does, and
## scripts/mutate-sim.py's `Task 2.E3e` rows measure exactly that.
##
## No draw-arithmetic blind spot to inherit here (Wave D's warning to every
## 2.E3x task): test_spends_no_randomness... below is the whole of this
## family's draw story, and it is that GOLD_MOVED spends none.


## The reference's own `world()` helper (purse.test.ts:23-35), rebuilt with
## SimGrid's tile constants. `overrides` plays `...payload` — later keys win,
## matching the reference's object spread. Always called with an explicit
## Dictionary, exactly as the reference always calls `world({...})`.
func _world(overrides: Dictionary) -> Dictionary:
	var payload: Dictionary = {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"seed": 99,
		"items": [],
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [],
		},
		"opponents": [],
	}
	payload.merge(overrides, true)
	return SimEvents.draft("WORLD_INIT", 0, 8, payload)


## The reference's own `goldMoved()` helper (purse.test.ts:37-44). rngCounter
## is fixed at 8 there, not derived from any running total: every case below
## applies it straight after a `world({})`, whose own envelope always spends
## exactly 8 draws (rngDraws: 8, matching the reference literally), and
## GOLD_MOVED itself spends none — so 8 is where the counter actually sits
## every time this helper is used, including across the three chained calls
## in test_sums_what_exchange_recorded.
func _gold_moved(delta: int, reason: String) -> Dictionary:
	return SimEvents.draft("GOLD_MOVED", 8, 0, {"delta": delta, "reason": reason})


# ── describe('what a kind fetches') ───────────────────────────────────────

func test_prices_every_kind_the_dungeon_can_actually_drop() -> void:
	# A kind that generation can put on the floor must have a price, or the
	# first player to try selling it meets a silent zero.
	for relic: Dictionary in SimTables.ARMORY:
		assert_gt(SimTables.value_of(relic["kind"]), 0, relic["kind"])
	for provision: Dictionary in SimTables.PROVISIONS:
		assert_gt(SimTables.value_of(provision["kind"]), 0, provision["kind"])
	for scroll: Dictionary in SimTables.SCROLLS:
		assert_gt(SimTables.value_of(scroll["kind"]), 0, scroll["kind"])


func test_keeps_the_main_dungeon_nominal_pocket_change_never_a_living() -> void:
	# The whole point of the economy: the dungeon pays in XP and relics, the
	# mine pays in money. If floor loot could fund a pickaxe, the mine stops
	# being a decision. Kept as an inequality against the ceiling, exactly as
	# the reference states it — this test's job is the ceiling relationship,
	# not the exact band, which the next test pins on purpose.
	for relic: Dictionary in SimTables.ARMORY:
		assert_lte(SimTables.value_of(relic["kind"]), SimTables.LOOT_VALUE, relic["kind"])
	for provision: Dictionary in SimTables.PROVISIONS:
		assert_lte(SimTables.value_of(provision["kind"]), SimTables.LOOT_VALUE, provision["kind"])
	assert_lt(SimTables.PROVISION_VALUE, SimTables.LOOT_VALUE)


func test_pays_less_for_a_thing_you_were_going_to_use_up_than_for_a_thing_you_were_going_to_wear() -> void:
	# Found by mutation proof in the reference (repeated here — see
	# scripts/mutate-sim.py's purse-value-of-provisions-as-relics row):
	# pricing provisions at LOOT_VALUE passes
	# test_keeps_the_main_dungeon_nominal_pocket_change_never_a_living whole,
	# because every one of that test's assertions is an inequality against
	# the ceiling. The band's SHAPE is the design claim, so — per this task's
	# brief — it is spelled here as literal 2 / literal 1, never as
	# SimTables.LOOT_VALUE / SimTables.PROVISION_VALUE: a test that reads its
	# expectation from the very constant the function under test also reads
	# can confirm the two agree, but can never notice that constant's OWN
	# value drifting, only a category mistake relative to it.
	for relic: Dictionary in SimTables.ARMORY:
		assert_eq(SimTables.value_of(relic["kind"]), 2, relic["kind"])
	for scroll: Dictionary in SimTables.SCROLLS:
		assert_eq(SimTables.value_of(scroll["kind"]), 2, scroll["kind"])
	for provision: Dictionary in SimTables.PROVISIONS:
		assert_eq(SimTables.value_of(provision["kind"]), 1, provision["kind"])


func test_is_worth_nothing_for_a_kind_it_does_not_know_rather_than_throwing() -> void:
	# An old chain may carry a kind this engine renamed. A purse is not the
	# place to die, and a silent zero is honest: this engine cannot price it.
	assert_eq(SimTables.value_of("sputtering doohickey"), 0)
	assert_eq(SimTables.value_of(""), 0)


# ── describe('the purse is folded, never stored') ─────────────────────────

func test_starts_empty() -> void:
	assert_eq(SimState.empty()["gold"], 0)


func test_sums_what_exchange_recorded() -> void:
	var state: Dictionary = SimApply.apply(SimState.empty(), _world({}))
	assert_eq(state["gold"], 0)

	state = SimApply.apply(state, _gold_moved(2, "sale"))
	state = SimApply.apply(state, _gold_moved(5, "trove"))
	assert_eq(state["gold"], 7)

	state = SimApply.apply(state, _gold_moved(-50, "purchase"))
	assert_eq(state["gold"], -43)


func test_sums_honestly_rather_than_clamping_so_an_unaffordable_spend_is_a_visible_bug() -> void:
	# The spender gates affordability (Increment C, Phase 6). If apply
	# clamped at zero instead, a command that let you buy what you cannot
	# afford would fold to a plausible-looking purse and hide itself. No
	# clamp anywhere in sim/apply.gd's "GOLD_MOVED" arm is what this pins.
	var state: Dictionary = SimApply.apply(SimApply.apply(SimState.empty(), _world({})), _gold_moved(-1, "purchase"))
	assert_eq(state["gold"], -1)


func test_spends_no_randomness_an_exchange_is_arithmetic_not_a_roll() -> void:
	var before: Dictionary = SimApply.apply(SimState.empty(), _world({}))
	var after: Dictionary = SimApply.apply(before, _gold_moved(3, "sale"))
	assert_eq(after["rngCounter"], before["rngCounter"])


# ── describe('the purse crosses the stairs') ──────────────────────────────

func test_carries_what_the_player_had_like_the_satchel_learned_to_at_v9() -> void:
	var descended: Dictionary = SimApply.apply(SimState.empty(), _world({"depth": 2, "playerGold": 17}))
	assert_eq(descended["gold"], 17)


func test_folds_a_floor_that_never_said_to_an_empty_purse() -> void:
	# Every chain written before v15. Absence means nothing was carried,
	# which is simply true — inventing a balance would be fabricating
	# history.
	var legacy: Dictionary = SimApply.apply(SimState.empty(), _world({"depth": 2}))
	assert_eq(legacy["gold"], 0)


func test_does_not_let_a_new_floor_forget_money_already_earned_mid_run() -> void:
	# The bug this pins: descending resets the purse because WORLD_INIT
	# replaces state wholesale. The carry is what stops that.
	var state: Dictionary = SimApply.apply(SimState.empty(), _world({}))
	state = SimApply.apply(state, _gold_moved(9, "sale"))
	assert_eq(state["gold"], 9)

	var next: Dictionary = SimApply.apply(state, _world({"depth": 2, "playerGold": state["gold"]}))
	assert_eq(next["gold"], 9)
