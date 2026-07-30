extends GutTest
## The command layer's movement family — the byte-twin of
## tests/core/commands.test.ts. One test per TS `it(...)`, in the TS file's
## order, so the two suites can be diffed by eye.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 32 cases across six describe blocks.
## 32 = 32 PORTED + 0 DEFERRED. Line numbers are tests/core/commands.test.ts
## at ts-baseline.
##
## describe('createWorld') — 7
##   :20  is deterministic for a seed
##   :25  records every draw generation made, the map and its inhabitants alike
##   :38  places its inhabitants reachable, apart, and clear of you
##   :57  posts a keeper beside the way out, and nothing free-roaming
##        out-threatens it
##   :81  sends the warden to the stairs on its floors
##   :93  gives the player the four stats
##   :98  folds into a state whose player stands on the recorded start
##
## describe('attemptMove') — 11
##   :130 produces a MOVE into open floor
##   :136 blocks on a wall and says so
##   :142 blocks at the edge of the grid
##   :148 strikes a hostile occupant instead of moving into it
##   :163 is merely blocked by something of its own kind
##   :174 walks through the dead
##   :181 carries the current rng counter without advancing it
##   :185 rejects anything but a single orthogonal step
##   :191 rejects a fractional half-step that happens to sum to one
##   :198 carries the counter unchanged on every branch, not just the
##        successful one
##   :212 rejects an unknown entity
##
## describe('advanceTurn') — 2
##   :218 keeps the turn number when the round has not wrapped
##   :226 increments the turn when the order wraps
##
## describe('endsTurn') — 2
##   :233 charges a turn for an action that happened
##   :239 charges nothing for a refused one
##
## describe('striking') — 6
##   :281 records a miss as a miss, and still spends both draws
##   :291 records the roll and the number it needed, not just the verdict
##   :298 deals inside the might band's dice, doubled on a crit
##   :306 takes hit points away on a hit
##   :314 takes no hit points on a miss, but still spends the draws
##   :327 clamps at zero rather than letting a corpse get deader
##
## describe('the numbers a player decides on') — 4
##   :348 states what you need to roll, from both sides
##   :353 turns that into odds out of twenty
##   :357 makes the keen edge worth taking, measurably
##   :375 cannot promise a certainty or an impossibility
##
## ── Deferrals ADOPTED by this task ────────────────────────────────────────
## Task 2.D1 parked three cases of tests/core/path-pull.test.ts here because
## their subject is create_world's item placement. All three are DISCHARGED,
## and they live in test_path_pull.gd beside the two that file already had —
## that is the reference file's own home, and its header now reads 5 = 5
## ported + 0 deferred.
##
## Task 2.C1 parked five cases of tests/core/dispositions.test.ts here for the
## same reason. All five are DISCHARGED and live in test_dispositions.gd; its
## header now reads 12 = 12 ported + 0 deferred.
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## Four tests at the bottom of this file have no counterpart in
## commands.test.ts. Each is marked where it stands.
##
## test_the_golden_world_is_rebuilt_byte_for_byte is the important one. The
## committed golden run's first event IS `createWorld(17, 48, 32)` as the
## TypeScript engine recorded it, schemaVersion and rngDraws and story
## included. Rebuilding it here compares the WHOLE payload against frozen
## reference bytes, which is the only thing that can catch the chain-forking
## hazard Wave D handed this task by name: `SimMapgen.walk_distance` returns a
## FLOAT, and `str(12.0)` renders "12.0" in Godot where TypeScript writes
## "12". The recorded story says "63 steps of walking". A `%s` where a `%d`
## belongs would print "63.0 steps of walking" and every test that does not
## compare the story byte for byte would still pass.
##
## The reference's own :20 ("is deterministic for a seed") cannot catch it —
## it compares create_world against itself, so both sides move together. That
## is the same shape of hole Task 2.E2 measured in ai.test.ts's AWARENESS
## cases, and the same remedy: pin the number as a literal from outside.


const _GOLDEN := "res://test/fixtures/golden-run.json"


# ── the reference's fixture(): a hand-built 3x2 world, floor everywhere
# except (2,0). Extra entities are passed in rather than pushed afterwards,
# exactly as the TS fixture does.
func _fixture(extra: Array = []) -> Dictionary:
	var entities: Array = [{
		"id": "player", "kind": "you", "pos": {"x": 1, "y": 0},
		"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4},
		"tags": [], "maxHp": 10,
	}]
	entities.append_array(extra)
	return {
		"grid": SimGrid.make(3, 2, [
			SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL,
			SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
		]),
		"entities": entities,
		"items": [],
		"turn": 1,
		"activeEntityId": "player",
		"seed": 5,
		"rngCounter": 40,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 1,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


## The reference's seal(): a draft becomes an event with the three fields
## SimApply does not read but SimLog would otherwise add.
func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "x"
	event["parent"] = null
	event["seq"] = 0
	return event


# ── describe('createWorld') ───────────────────────────────────────────────

func test_is_deterministic_for_a_seed() -> void:
	assert_eq(
		SimCanonical.encode(SimCommands.create_world(4242, 24, 16)),
		SimCanonical.encode(SimCommands.create_world(4242, 24, 16)),
		"the same seed builds the same world")


func test_records_every_draw_generation_made_the_map_and_its_inhabitants_alike() -> void:
	# The exact count belongs to generation internals; what matters is that the
	# envelope owns every draw. Same seed, same world, same declared draws —
	# and strictly more than the bare map needed, because choosing and placing
	# a population costs draws too.
	var draft: Dictionary = SimCommands.create_world(4242, 24, 16)
	var again: Dictionary = SimCommands.create_world(4242, 24, 16)
	var map: Dictionary = SimMapgen.generate_map(4242, 0, 24, 16)

	assert_eq(int(again["rngDraws"]), int(draft["rngDraws"]))
	assert_gt(int(draft["rngDraws"]), int(map["counterAfter"]))


func test_places_its_inhabitants_reachable_apart_and_clear_of_you() -> void:
	# The head-count belongs to the budget tables and the balance suite; what
	# this test owns is placement. Population must exist, stand on distinct
	# tiles, and give the player room to breathe.
	#
	# The distance floor is spelled as the LITERAL 8, not as
	# SimCommands.OPPONENT_MIN_DISTANCE the way the reference writes it. A test
	# that reads its expectation out of the constant it guards moves both sides
	# together and can never fail — measured in this migration, in ai.test.ts's
	# AWARENESS cases (Task 2.E2). Eight is what pick_spawn_points is asked for
	# and what create_world's own doc calls "far enough that nothing is already
	# on top of you when the world opens"; if the constant changes, this line is
	# supposed to be edited by hand.
	var draft: Dictionary = SimCommands.create_world(4242, 24, 16)
	var payload: Dictionary = draft["payload"]
	var player: Dictionary = payload["player"]
	var opponents: Array = payload["opponents"]
	assert_gte(opponents.size(), 2)

	var seen: Dictionary = {}
	for o: Dictionary in opponents:
		var pos: Dictionary = o["pos"]
		var distance: int = absi(int(pos["x"]) - int(player["pos"]["x"])) \
			+ absi(int(pos["y"]) - int(player["pos"]["y"]))
		assert_gte(distance, 8, "%s stands %d away, under the eight-step floor" % [o["id"], distance])
		seen["%d,%d" % [int(pos["x"]), int(pos["y"])]] = true
	# Distinct tiles: picking from a shrinking list is what guarantees this,
	# and two creatures on one square would be a state nothing else expects.
	assert_eq(seen.size(), opponents.size())


func test_posts_a_keeper_beside_the_way_out_and_nothing_free_roaming_out_threatens_it() -> void:
	# Rooms and corridors made every fight avoidable, and the measurement was
	# the exact domination the Covenant forbids: the runner out-survived the
	# fighter 11 to 9 at depth 3. The stairs cost something now. Relic guards
	# are exempt from selection — a guard's post is its prize.
	for seed: int in [1, 7, 25, 4242]:
		var payload: Dictionary = (SimCommands.create_world(seed, 48, 32) as Dictionary)["payload"]
		var tiles: Array = payload["tiles"]
		var exit_at: int = tiles.find(SimGrid.EXIT)
		var width: int = payload["width"]
		var exit: Dictionary = {"x": exit_at % width, "y": floori(float(exit_at) / float(width))}

		var beside: Array = []
		for o: Dictionary in (payload["opponents"] as Array):
			var pos: Dictionary = o["pos"]
			if absi(int(pos["x"]) - int(exit["x"])) + absi(int(pos["y"]) - int(exit["y"])) == 1:
				beside.append(o)
		assert_gte(beside.size(), 1, "seed %d leaves the stairs unwatched" % seed)

		var roaming: Array = []
		for o: Dictionary in (payload["opponents"] as Array):
			var pos: Dictionary = o["pos"]
			var on_relic := false
			for i: Dictionary in (payload["items"] as Array):
				if int((i["pos"] as Dictionary)["x"]) == int(pos["x"]) \
					and int((i["pos"] as Dictionary)["y"]) == int(pos["y"]):
					on_relic = true
					break
			if not on_relic and not beside.has(o):
				roaming.append(o)

		var keeper_threat := -1
		for o: Dictionary in beside:
			keeper_threat = maxi(keeper_threat, SimTables.threat_of(o["stats"]))
		for o: Dictionary in roaming:
			assert_lte(SimTables.threat_of(o["stats"]), keeper_threat,
				"seed %d: %s out-threatens the keeper" % [seed, o["id"]])


func test_sends_the_warden_to_the_stairs_on_its_floors() -> void:
	# A boss is the strongest thing on its floor by construction, so the keeper
	# selection finds it with no special case — but the sentence a player learns
	# is this one, so it is pinned in these words.
	var payload: Dictionary = (SimCommands.create_world(9, 48, 32, "player", 3) as Dictionary)["payload"]
	var tiles: Array = payload["tiles"]
	var width: int = payload["width"]
	var exit_at: int = tiles.find(SimGrid.EXIT)
	var exit: Dictionary = {"x": exit_at % width, "y": floori(float(exit_at) / float(width))}
	var warden: Variant = null
	for o: Dictionary in (payload["opponents"] as Array):
		if (o["kind"] as String).begins_with("warden"):
			warden = o
			break
	assert_not_null(warden, "depth 3 owes a warden")
	var pos: Dictionary = (warden as Dictionary)["pos"]
	assert_eq(absi(int(pos["x"]) - int(exit["x"])) + absi(int(pos["y"]) - int(exit["y"])), 1)


func test_gives_the_player_the_four_stats() -> void:
	var payload: Dictionary = (SimCommands.create_world(1, 12, 8) as Dictionary)["payload"]
	assert_eq((payload["player"] as Dictionary)["stats"],
		{"hp": 10, "might": 3, "wits": 3, "speed": 4})


func test_folds_into_a_state_whose_player_stands_on_the_recorded_start() -> void:
	var draft: Dictionary = SimCommands.create_world(77, 24, 16)
	var state: Dictionary = SimApply.apply(SimState.empty(), _seal(draft))
	var entities: Array = state["entities"]
	assert_eq((entities[0] as Dictionary)["pos"],
		((draft["payload"] as Dictionary)["player"] as Dictionary)["pos"])


# ── describe('attemptMove') ───────────────────────────────────────────────

func test_produces_a_move_into_open_floor() -> void:
	var draft: Dictionary = SimCommands.attempt_move(_fixture(), "player", -1, 0)
	assert_eq(draft["type"], "MOVE")
	assert_eq(draft["payload"],
		{"entityId": "player", "from": {"x": 1, "y": 0}, "to": {"x": 0, "y": 0}})


func test_blocks_on_a_wall_and_says_so() -> void:
	var draft: Dictionary = SimCommands.attempt_move(_fixture(), "player", 1, 0)
	assert_eq(draft["type"], "MOVE_BLOCKED")
	var p: Dictionary = draft["payload"]
	assert_eq(p["attempted"], {"x": 2, "y": 0})
	assert_eq(p["reason"], "wall")


func test_blocks_at_the_edge_of_the_grid() -> void:
	var draft: Dictionary = SimCommands.attempt_move(_fixture(), "player", 0, -1)
	assert_eq(draft["type"], "MOVE_BLOCKED")
	assert_eq((draft["payload"] as Dictionary)["reason"], "out-of-bounds")


func test_strikes_a_hostile_occupant_instead_of_moving_into_it() -> void:
	# Bump to attack: walking into something hostile is the attack, which keeps
	# the entire game on four inputs.
	var state: Dictionary = _fixture([{
		"id": "other", "kind": "thing", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 4, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": 4,
	}])
	var draft: Dictionary = SimCommands.attempt_move(state, "player", -1, 0)
	assert_eq(draft["type"], "STRIKE")
	var p: Dictionary = draft["payload"]
	assert_eq(p["attackerId"], "player")
	assert_eq(p["targetId"], "other")
	# The literal 2, deliberately, not STRIKE_DRAWS: asserting a constant
	# against itself moves both sides together and can never fail. The
	# reference says so in these words, and the reason is the same one that
	# put a literal 8 in the placement test above.
	assert_eq(int(draft["rngDraws"]), 2)


func test_is_merely_blocked_by_something_of_its_own_kind() -> void:
	# Alike kinds do not fight. Without this, a crowd of creatures would brawl
	# with each other on the way to you instead of arriving.
	var state: Dictionary = _fixture([{
		"id": "twin", "kind": "you", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 4, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": 4,
	}])
	var draft: Dictionary = SimCommands.attempt_move(state, "player", -1, 0)
	assert_eq(draft["type"], "MOVE_BLOCKED")
	assert_eq((draft["payload"] as Dictionary)["reason"], "occupied")


func test_walks_through_the_dead() -> void:
	var state: Dictionary = _fixture([{
		"id": "corpse", "kind": "thing", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 0, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": 0,
	}])
	assert_eq((SimCommands.attempt_move(state, "player", -1, 0) as Dictionary)["type"], "MOVE")


func test_carries_the_current_rng_counter_without_advancing_it() -> void:
	assert_eq(int((SimCommands.attempt_move(_fixture(), "player", -1, 0) as Dictionary)["rngCounter"]), 40)


func test_rejects_anything_but_a_single_orthogonal_step() -> void:
	# The reference THROWS. GDScript's assert() unwinds exactly one frame and
	# hands the caller the return type's default, so what is asserted is that
	# the refusal is LOUD and that nothing plausible comes back. BOTH channels
	# are checked: assert() is compiled OUT of a release build and push_error
	# is not, so checking only the assert would let an exported build walk the
	# player diagonally with this test still green.
	for step: Array in [[1, 1], [2, 0], [0, 0]]:
		var draft: Dictionary = SimCommands.attempt_move(
			_fixture(), "player", int(step[0]), int(step[1]))
		assert_true(draft.is_empty(),
			"(%d, %d) is not a single orthogonal step" % [int(step[0]), int(step[1])])
		assert_engine_error("single orthogonal step")
		assert_push_error("single orthogonal step")


func test_rejects_a_fractional_half_step_that_happens_to_sum_to_one() -> void:
	# Both of these pass a magnitude-only check: 0.5 + 0.5 and 0.25 + 0.75 are
	# each exactly 1. Without an integer guard the player ends up between tiles.
	#
	# `dx`/`dy` are Variant on attempt_move ON PURPOSE — the reference takes
	# `number`, and typed `int` parameters would truncate 0.5 to 0 at the call
	# boundary and port this guard into nothing. See movement.gd's own note.
	for step: Array in [[0.5, 0.5], [0.25, -0.75]]:
		var draft: Dictionary = SimCommands.attempt_move(_fixture(), "player", step[0], step[1])
		assert_true(draft.is_empty(),
			"(%s, %s) is not a single orthogonal step" % [step[0], step[1]])
		assert_engine_error("single orthogonal step")
		assert_push_error("single orthogonal step")


func test_carries_the_counter_unchanged_on_every_branch_not_just_the_successful_one() -> void:
	# The fixture sits at counter 40. A hardcoded 0 in any one blocked branch
	# would otherwise pass unnoticed, and replay verification would then fail
	# far from the cause.
	var occupied: Dictionary = _fixture([{
		"id": "other", "kind": "thing", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 4, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": 4,
	}])
	assert_eq(int((SimCommands.attempt_move(_fixture(), "player", -1, 0) as Dictionary)["rngCounter"]), 40)
	assert_eq(int((SimCommands.attempt_move(_fixture(), "player", 1, 0) as Dictionary)["rngCounter"]), 40)
	assert_eq(int((SimCommands.attempt_move(_fixture(), "player", 0, -1) as Dictionary)["rngCounter"]), 40)
	assert_eq(int((SimCommands.attempt_move(occupied, "player", -1, 0) as Dictionary)["rngCounter"]), 40)
	assert_eq(int((SimCommands.advance_turn(_fixture()) as Dictionary)["rngCounter"]), 40)


func test_rejects_an_unknown_entity() -> void:
	assert_true(SimCommands.attempt_move(_fixture(), "nobody", 1, 0).is_empty())
	assert_engine_error("no entity nobody")
	assert_push_error("no entity nobody")


# ── describe('advanceTurn') ───────────────────────────────────────────────

func test_keeps_the_turn_number_when_the_round_has_not_wrapped() -> void:
	var state: Dictionary = _fixture([{
		"id": "zzz", "kind": "thing", "pos": {"x": 2, "y": 1},
		"stats": {"hp": 4, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": 4,
	}])
	var draft: Dictionary = SimCommands.advance_turn(state)
	assert_eq(draft["payload"], {"activeEntityId": "zzz", "turn": 1})


func test_increments_the_turn_when_the_order_wraps() -> void:
	var draft: Dictionary = SimCommands.advance_turn(_fixture())
	assert_eq(draft["payload"], {"activeEntityId": "player", "turn": 2})


# ── describe('endsTurn') ──────────────────────────────────────────────────

func test_charges_a_turn_for_an_action_that_happened() -> void:
	var state: Dictionary = _fixture()
	assert_true(SimCommands.ends_turn(SimCommands.attempt_move(state, "player", -1, 0)))
	assert_true(SimCommands.ends_turn(SimCommands.advance_turn(state)))


func test_charges_nothing_for_a_refused_one() -> void:
	# Walking into a wall is a mispress, not a decision. Charging a turn for it
	# hands a free hit to whatever is standing next to you — which is why this
	# is a rule of the game and not a detail of the view. Found by playing, not
	# by testing.
	var state: Dictionary = _fixture()
	assert_false(SimCommands.ends_turn(SimCommands.attempt_move(state, "player", 1, 0)))
	assert_false(SimCommands.ends_turn(SimCommands.attempt_move(state, "player", 0, -1)))


# ── describe('striking') ──────────────────────────────────────────────────

## Two creatures a step apart, so a bump is an attack.
func _brawl(counter: int) -> Dictionary:
	return {
		"grid": SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR]),
		"entities": [
			{
				"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
				"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4},
				"tags": [], "maxHp": 10,
			},
			{
				"id": "thing-1", "kind": "thing", "pos": {"x": 1, "y": 0},
				"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 3},
				"tags": [], "maxHp": 5,
			},
		],
		"items": [],
		"turn": 1,
		"activeEntityId": "player",
		"seed": 5,
		"rngCounter": counter,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 1,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


## Searches for a counter that rolls under the target, rather than hardcoding
## one — a hardcoded counter would silently stop testing a miss the moment the
## RNG or the to-hit maths changed.
func _counter_rolling(predicate: Callable) -> int:
	for c in range(5000):
		if predicate.call(SimRng.int_between(5, c, 1, 20)):
			return c
	assert_true(false, "no counter found — the generator or the range changed")
	return -1


func test_records_a_miss_as_a_miss_and_still_spends_both_draws() -> void:
	# needed = 10 + their speed (3) - your might (3) = 10.
	var needed := 10 + 3 - 3
	var counter := _counter_rolling(func(r: int) -> bool: return r < needed)
	var draft: Dictionary = SimCommands.attempt_move(_brawl(counter), "player", 1, 0)
	assert_eq(draft["type"], "STRIKE")
	var p: Dictionary = draft["payload"]
	assert_false(bool(p["hit"]))
	assert_eq(int(p["damage"]), 0)
	# Spending the same count either way is what keeps the counter's progress
	# independent of the outcome. Literal, not the constant — see above.
	assert_eq(int(draft["rngDraws"]), 2)


func test_records_the_roll_and_the_number_it_needed_not_just_the_verdict() -> void:
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 10)
	var p: Dictionary = (SimCommands.attempt_move(_brawl(counter), "player", 1, 0) as Dictionary)["payload"]
	assert_eq(int(p["needed"]), 10)
	assert_true(bool(p["hit"]))
	assert_gte(int(p["roll"]), 1)
	assert_lte(int(p["roll"]), 20)


func test_deals_inside_the_might_bands_dice_doubled_on_a_crit() -> void:
	# might 3 -> 1d3+1: 2..4 on an ordinary hit, 4..8 on a natural 20.
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 10)
	var p: Dictionary = (SimCommands.attempt_move(_brawl(counter), "player", 1, 0) as Dictionary)["payload"]
	var damage: int = p["damage"]
	var crit: bool = p["crit"]
	assert_gte(damage, 4 if crit else 2)
	assert_lte(damage, 8 if crit else 4)


func test_takes_hit_points_away_on_a_hit() -> void:
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 10)
	var state: Dictionary = _brawl(counter)
	var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
	var after: Dictionary = SimApply.apply(state, _seal(draft))
	var damage: int = (draft["payload"] as Dictionary)["damage"]
	var them: Dictionary = (after["entities"] as Array)[1]
	assert_eq(int((them["stats"] as Dictionary)["hp"]), 5 - damage)


func test_takes_no_hit_points_on_a_miss_but_still_spends_the_draws() -> void:
	# Not object identity: a miss changes nobody, yet the counter still moves by
	# two, so the state genuinely differs. Distinguishing "no damage" from "no
	# draws" is the whole point — conflating them would hide a counter that
	# failed to advance, and that surfaces later as a replay divergence.
	#
	# `is_same` rather than `==`: the reference asserts OBJECT IDENTITY here
	# (`toBe`), and the reducer's "an event that changed nothing returns the
	# very same state" is exactly the property being pinned. A `==` would pass
	# on a fresh copy with equal contents and prove nothing.
	var counter := _counter_rolling(func(r: int) -> bool: return r < 10)
	var state: Dictionary = _brawl(counter)
	var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
	var after: Dictionary = SimApply.apply(state, _seal(draft))

	assert_true(is_same(after["entities"], state["entities"]),
		"a whiff into open air allocates nothing")
	assert_eq(int(after["rngCounter"]), int(state["rngCounter"]) + 2)


func test_clamps_at_zero_rather_than_letting_a_corpse_get_deader() -> void:
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 10)
	var state: Dictionary = _brawl(counter)
	var dying: Dictionary = state.duplicate()
	var entities: Array = state["entities"]
	var frail: Dictionary = (entities[1] as Dictionary).duplicate()
	frail["stats"] = {"hp": 1, "might": 4, "wits": 1, "speed": 3}
	dying["entities"] = [entities[0], frail]

	var draft: Dictionary = SimCommands.attempt_move(dying, "player", 1, 0)
	var after: Dictionary = SimApply.apply(dying, _seal(draft))
	var them: Dictionary = (after["entities"] as Array)[1]
	assert_eq(int((them["stats"] as Dictionary)["hp"]), 0)


# ── describe('the numbers a player decides on') ───────────────────────────

func _you(might: int) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 10, "might": might, "wits": 3, "speed": 4},
		"tags": [], "maxHp": 10,
	}


func _thing() -> Dictionary:
	return {
		"id": "thing-1", "kind": "thing", "pos": {"x": 1, "y": 0},
		"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 3},
		"tags": [], "maxHp": 5,
	}


func test_states_what_you_need_to_roll_from_both_sides() -> void:
	assert_eq(SimCommands.to_hit(_you(3), _thing()), 10)
	assert_eq(SimCommands.to_hit(_thing(), _you(3)), 10)


func test_turns_that_into_odds_out_of_twenty() -> void:
	assert_eq(SimCommands.hit_chance(_you(3), _thing()), 11)


func test_makes_the_keen_edge_worth_taking_measurably() -> void:
	# The item read as doing nothing when played, which was a legibility failure
	# rather than a balance one — so the effect is pinned here in the terms a
	# player would notice, not as a stat delta.
	var before: Dictionary = _you(3)
	var after: Dictionary = _you(5)

	assert_eq(SimCommands.to_hit(before, _thing()), 10)
	assert_eq(SimCommands.to_hit(after, _thing()), 8)
	assert_eq(SimCommands.hit_chance(before, _thing()), 11)
	assert_eq(SimCommands.hit_chance(after, _thing()), 13)

	# Damage per turn: odds times average damage. Roughly three quarters more.
	var per_turn := func(e: Dictionary) -> float:
		var might: int = (e["stats"] as Dictionary)["might"]
		return (float(SimCommands.hit_chance(e, _thing())) / 20.0) * ((1.0 + float(might)) / 2.0)
	assert_gt(per_turn.call(after) / per_turn.call(before), 1.7)


func test_cannot_promise_a_certainty_or_an_impossibility() -> void:
	# NOT a vacuous inequality, and the arithmetic is why. chance_in_20 is
	# 21 - needed, CLAMPED to 0..20; the clamp is the whole subject.
	#   might 20:  needed = 10 + 3 - 20 = -7  ->  21 - (-7) = 28, clamped to 20
	#   might -20: needed = 10 + 3 + 20 =  33  ->  21 -  33  = -12, clamped to 0
	# Remove either clamp and this test fails with 28 and -12. Spelled out
	# because "assert x <= 20" reads like a ceiling nothing could violate, and
	# here it is a ceiling something violates by eight.
	var mighty: Dictionary = _you(20)
	var feeble: Dictionary = _you(-20)
	assert_lte(SimCommands.hit_chance(mighty, _thing()), 20)
	assert_gte(SimCommands.hit_chance(feeble, _thing()), 0)


# ── NON-REFERENCE ─────────────────────────────────────────────────────────
# Four tests with no counterpart in commands.test.ts. See the file header.

func test_the_golden_world_is_rebuilt_byte_for_byte() -> void:
	## NON-REFERENCE. The committed golden run's first event is
	## `createWorld(17, 48, 32)` as the TypeScript engine recorded it. Rebuilt
	## here and compared WHOLE — envelope and payload — against frozen bytes
	## the reference wrote, which is the only witness in this migration that
	## can catch a story rendered "63.0 steps" instead of "63 steps".
	##
	## It also pins the absent-key law across the whole generated payload:
	## the recorded event carries exactly twelve payload keys, with no `traps`,
	## no `playerMaxHp` and no `disposition` on the one free-roaming spawn.
	var golden: Dictionary = FixtureLoader.load_json(_GOLDEN)
	var recorded: Dictionary = (golden["events"] as Array)[0]
	assert_eq(recorded["type"], "WORLD_INIT", "the golden run opens on the world")

	var built: Dictionary = SimCommands.create_world(
		int(golden["seed"]), int(golden["width"]), int(golden["height"]))

	assert_eq(int(built["schemaVersion"]), int(recorded["schemaVersion"]))
	assert_eq(int(built["rngCounter"]), int(recorded["rngCounter"]))
	assert_eq(int(built["rngDraws"]), int(recorded["rngDraws"]), "every draw generation made")

	var built_payload: Dictionary = built["payload"]
	var recorded_payload: Dictionary = recorded["payload"]

	# The story first and by itself, so a divergence names itself rather than
	# hiding inside a 1536-tile Dictionary diff.
	assert_eq(built_payload["story"], recorded_payload["story"], "the story, byte for byte")

	var built_keys: Array = built_payload.keys()
	built_keys.sort()
	var recorded_keys: Array = recorded_payload.keys()
	recorded_keys.sort()
	assert_eq(built_keys, recorded_keys, "exactly the payload keys the reference wrote")

	assert_eq(SimCanonical.encode(built_payload), SimCanonical.encode(recorded_payload),
		"the whole world, canonical bytes")


func test_the_walking_distance_in_the_story_is_never_rendered_as_a_float() -> void:
	## NON-REFERENCE, and the narrowest possible guard on the hazard Wave D
	## named. `SimMapgen.walk_distance` returns a FLOAT on purpose (INF means
	## "no walk exists"), so `str(walk)` and `"%s" % walk` both render "63.0"
	## where TypeScript's template literal writes "63". Every finite answer is
	## an integral float, so the rendered story must never contain ".0".
	##
	## Broader than the golden test above by design: that one pins ONE board,
	## and the two story branches (the bottom's heart, and every other floor's
	## way out) print the distance from different sentences.
	for depth: int in [1, 3, 9]:
		var payload: Dictionary = (SimCommands.create_world(11, 48, 32, "player", depth) as Dictionary)["payload"]
		var story: String = payload["story"]
		assert_false(story.contains(".0"),
			"depth %d rendered a float into the story: %s" % [depth, story])
		assert_true(story.contains("steps of walking"),
			"depth %d lost the walking distance entirely" % depth)


func test_the_keeper_never_stands_in_what_paints_as_wall() -> void:
	## NON-REFERENCE, and the seed is not arbitrary. A keeper standing on an
	## illusory wall gives the secret away and reads as a haunting, so
	## create_world skips SECRET tiles when it posts one — but that skip is
	## only ever CONSULTED on a floor that sealed, and only ever DECIDES
	## anything when a sealed doorway happens to abut the way out.
	##
	## MEASURED across depths 1-9 x seeds 1-60 on the vale board: 172 of 540
	## worlds seal, and exactly TWO put a SECRET beside their exit — depth 7
	## and depth 8, both at seed 32. Neither was reachable from any other seed
	## this suite drives, so without this test the skip shipped executed-never
	## -witnessed. (Task 2.D1 disclosed seal_secret_room's committing path as
	## UNREACHED by anything in the migration; create_world reaches it, and
	## this is the one line of create_world that reads what it wrote.)
	for depth: int in [7, 8]:
		var payload: Dictionary = (SimCommands.create_world(
			32, 48, 32, "player", depth) as Dictionary)["payload"]
		var grid: Dictionary = SimGrid.make(
			int(payload["width"]), int(payload["height"]), payload["tiles"])
		var exit_at: int = (payload["tiles"] as Array).find(SimGrid.EXIT)
		var width: int = payload["width"]
		var exit := {"x": exit_at % width, "y": floori(float(exit_at) / float(width))}

		# The precondition, asserted rather than assumed: this floor really
		# does hide a doorway next to its stairs. If generation ever stops
		# doing so on this seed, this test must be re-seeded rather than
		# quietly becoming vacuous.
		var secret_beside := false
		for step: Array in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
			if SimGrid.tile_at(grid, int(exit["x"]) + int(step[0]),
				int(exit["y"]) + int(step[1])) == SimGrid.SECRET:
				secret_beside = true
		assert_true(secret_beside,
			"depth %d seed 32 no longer hides a doorway beside its stairs" % depth)

		var keeper: Variant = null
		for o: Dictionary in (payload["opponents"] as Array):
			var pos: Dictionary = o["pos"]
			if absi(int(pos["x"]) - int(exit["x"])) + absi(int(pos["y"]) - int(exit["y"])) == 1:
				keeper = o
				break
		assert_not_null(keeper, "depth %d: the stairs stand unwatched" % depth)
		var at: Dictionary = (keeper as Dictionary)["pos"]
		assert_ne(SimGrid.tile_at(grid, int(at["x"]), int(at["y"])), SimGrid.SECRET,
			"depth %d: the keeper haunts an illusory wall" % depth)


func test_a_strikes_two_draws_are_the_two_CONSECUTIVE_draws_it_declares() -> void:
	## NON-REFERENCE, and added because a mutation MEASURED the hole. Moving
	## the damage draw from `counter + 1` to `counter + 2` — so a strike's two
	## draws stop being consecutive while `rngDraws` still says 2 — failed
	## NOTHING in the other 455 tests. Every damage assertion in the reference
	## suite is a RANGE (2..4 on a hit, 4..8 on a crit, <= 4 uncoiled), and
	## `takes hit points away on a hit` compares the reducer against the
	## draft's own damage, so both sides move together.
	##
	## That is exactly the divergence class replay verification finds far from
	## its cause: the counter advances correctly, the numbers are all in band,
	## and the chain forks anyway. So the draw PROTOCOL is pinned here rather
	## than the damage: the roll is the counter's own draw and the damage is
	## the very next one, recomputed from SimRng on the test's side of the
	## fence so the two cannot move together.
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 10 and r < 20)
	var state: Dictionary = _brawl(counter)
	var p: Dictionary = (SimCommands.attempt_move(state, "player", 1, 0) as Dictionary)["payload"]

	# The roll is drawn at the counter the event declares.
	assert_eq(int(p["roll"]), SimRng.int_between(5, counter, 1, 20), "the roll is draw one")
	# might 3 is the 1d3+1 band; the counter is chosen to land a non-crit hit,
	# so the damage is the undoubled next draw. Both numbers are literals: the
	# band is spelled out rather than read back through damage_dice().
	assert_false(bool(p["crit"]), "the chosen counter rolls under the crit floor")
	assert_eq(int(p["damage"]), SimRng.int_between(5, counter + 1, 1, 3) + 1,
		"the damage is draw two, immediately after the roll")


func test_a_board_over_the_cap_is_refused_rather_than_allocated() -> void:
	## NON-REFERENCE. The reference THROWS above MAX_BOARD_DIM (commands.ts:224
	## — "above the cap a mistyped dimension allocates a country"). No
	## reference case exercises the throw, and it is the one guard standing
	## between a typo and a 65536-tile allocation, so it gets a witness here.
	## 257 is MAX_BOARD_DIM (256) plus one, spelled as a literal.
	assert_true(SimCommands.create_world(1, 257, 32).is_empty(), "257 wide is refused")
	assert_engine_error("exceeds the 256 board cap")
	assert_push_error("exceeds the 256 board cap")
	assert_true(SimCommands.create_world(1, 48, 257).is_empty(), "257 tall is refused")
	assert_engine_error("exceeds the 256 board cap")
	assert_push_error("exceeds the 256 board cap")
	# And the cap itself is not over the cap — the boundary belongs to the
	# board, not to the refusal.
	assert_false(SimCommands.create_world(1, 256, 32).is_empty(), "256 wide is allowed")


func test_the_descent_ceremony_drafts_are_drawless_and_carry_their_facts() -> void:
	## NON-REFERENCE. `outcome` is named in this task's brief as an interface
	## 2.E3b-e consume, and `record_bodies` / `found_world` / `ratify_rule` are
	## the descent ceremony's three writers ("identity, then the dead, then
	## law" — commands.ts:1868). Their reference suites are tests/play/*.ts and
	## tests/canon/bible.test.ts, owned by later tasks, so without this they
	## would ship with no witness at all.
	var state: Dictionary = _fixture()

	# outcome: standing off the exit is playing.
	assert_eq(SimCommands.outcome(state), "playing")

	# Dead is dead, wherever it is standing.
	var fallen: Dictionary = state.duplicate()
	var corpse: Dictionary = ((state["entities"] as Array)[0] as Dictionary).duplicate()
	corpse["stats"] = {"hp": 0, "might": 3, "wits": 3, "speed": 4}
	fallen["entities"] = [corpse]
	assert_eq(SimCommands.outcome(fallen), "dead")

	# On the exit, above the bottom, is escaping.
	var out: Dictionary = state.duplicate()
	out["grid"] = SimGrid.make(3, 2, [
		SimGrid.FLOOR, SimGrid.EXIT, SimGrid.WALL,
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
	])
	assert_eq(SimCommands.outcome(out), "escaped")

	# The bottom turns it around: the same tile means nothing without the heart,
	# and everything with it. Depth 9 is BOTTOM_DEPTH, spelled as a literal.
	var bottom: Dictionary = out.duplicate()
	bottom["depth"] = 9
	assert_eq(SimCommands.outcome(bottom), "playing", "the bottom's stair is not an escape")
	var carrying: Dictionary = ((state["entities"] as Array)[0] as Dictionary).duplicate()
	carrying["satchel"] = [{"kind": SimTables.HEART_KIND}]
	var won: Dictionary = bottom.duplicate()
	won["entities"] = [carrying]
	assert_true(SimCommands.heart_held(won), "the heart rides in the satchel")
	assert_eq(SimCommands.outcome(won), "won")

	# The ceremony's three writers: drawless, and each carrying its own fact.
	var bodies: Dictionary = SimCommands.record_bodies(state, [{"x": 2, "y": 1}])
	assert_eq(bodies["type"], "WORLD_BODIES")
	assert_eq(int(bodies["rngDraws"]), 0)
	assert_eq((bodies["payload"] as Dictionary)["bodies"], [{"x": 2, "y": 1}])

	var bible: Dictionary = {"title": "a place", "kinds": {}}
	var founded: Dictionary = SimCommands.found_world(state, bible)
	assert_eq(founded["type"], "WORLD_BIBLE")
	assert_eq(int(founded["rngDraws"]), 0)
	assert_eq((founded["payload"] as Dictionary)["bible"], bible)

	var rule: Dictionary = {"id": "r1", "when": "blowLanded", "require": [], "then": []}
	var ratified: Dictionary = SimCommands.ratify_rule(state, rule)
	assert_eq(ratified["type"], "RULE_RATIFIED")
	# Rules never consume randomness. See the interpreter for why that is a
	# load-bearing guarantee rather than an accident.
	assert_eq(int(ratified["rngDraws"]), 0)

	# A world already holding MAX_RULES refuses — the cap is a property of a
	# WORLD, not of a rule. 16 is MAX_RULES, spelled as a literal.
	var full: Dictionary = state.duplicate()
	var many: Array = []
	for i in range(16):
		many.append(rule)
	full["rules"] = many
	assert_true(SimCommands.ratify_rule(full, rule).is_empty(), "the seventeenth rule is refused")
	assert_engine_error("already holds the limit")
	assert_push_error("already holds the limit")
