extends GutTest
## The bottom floor answering back — SimMovement.stir_world, reached through
## SimCommands.stir_world.
##
## RECONCILIATION: 0 reference cases ported, 1 suite deferred. `stirWorld`'s
## only suite is tests/play/bottom.test.ts, which drives the SESSION layer
## (src/play/session.ts:138 is its only caller) and therefore belongs to
## PHASE 3, not to this phase. Deferred there by name.
##
## WHY THIS FILE EXISTS ANYWAY. Task 2.E3d found `stirWorld` unowned: the plan's
## 2.E3a–e table hands the WORLD_STIRRED producer to none of the five verb
## families, so `apply.gd` had a reducer arm for an event nothing in the
## migration could produce. Shipping the port with its only suite a phase away
## would leave it unwitnessed for as long as that takes, so these are the
## invariants that can be checked without the session: the draw protocol, the
## echo law, the distance floor, and the null.


func _tiles(w: int, h: int) -> Array:
	var out: Array = []
	for i in range(w * h):
		out.append(SimGrid.FLOOR)
	return out


## A wide floor so WAVE_DISTANCE has somewhere to be satisfied, a carrier in one
## corner, and two graves.
func _seized(bodies: Array = [], extra: Array = []) -> Dictionary:
	var state: Dictionary = SimState.empty()
	state["grid"] = SimGrid.make(20, 20, _tiles(20, 20))
	state["seed"] = 4242
	state["rngCounter"] = 100
	state["turn"] = 7
	var roster: Array = [{
		"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 4, "might": 3, "wits": 2, "speed": 3}, "tags": [], "maxHp": 11,
	}]
	roster.append_array(extra)
	state["entities"] = roster
	state["bodies"] = bodies
	return state


func test_the_graves_stand_up_wearing_the_carriers_strength_whole() -> void:
	## "your own past falls stand up where the bodies lie, wearing your current
	## strength whole" — hp is the carrier's CEILING (11), not its current 4.
	var stirred: Variant = SimCommands.stir_world(_seized([{"x": 3, "y": 3}, {"x": 4, "y": 3}]))
	assert_not_null(stirred)
	var risen: Array = ((stirred as Dictionary)["payload"] as Dictionary)["opponents"]
	var echoes: Array = []
	for r: Dictionary in risen:
		if r["kind"] == "echo":
			echoes.append(r)
	assert_eq(echoes.size(), 2, "one echo per grave")
	assert_eq((echoes[0] as Dictionary)["pos"], {"x": 3, "y": 3}, "risen where it fell")
	assert_eq((echoes[0] as Dictionary)["stats"],
		{"hp": 11, "might": 3, "wits": 2, "speed": 3},
		"the carrier's stats, healed to the carrier's ceiling")
	assert_eq((echoes[0] as Dictionary)["id"], "echo-1")
	assert_eq((echoes[1] as Dictionary)["id"], "echo-2")


func test_the_dead_rise_once_and_never_again() -> void:
	## "The echoes, once." A floor that already carries an echo raises no more,
	## however many graves are on it — otherwise every wave doubles the dead.
	var standing := [{
		"id": "echo-1", "kind": "echo", "pos": {"x": 9, "y": 9},
		"stats": {"hp": 11, "might": 3, "wits": 2, "speed": 3}, "tags": [], "maxHp": 11,
	}]
	var stirred: Variant = SimCommands.stir_world(_seized([{"x": 3, "y": 3}], standing))
	assert_not_null(stirred)
	for r: Dictionary in (((stirred as Dictionary)["payload"]) as Dictionary)["opponents"]:
		assert_ne(r["kind"], "echo", "no second crop of echoes")


func test_a_grave_under_a_living_body_raises_nothing() -> void:
	var standing := [{
		"id": "brute", "kind": "bruiser", "pos": {"x": 3, "y": 3},
		"stats": {"hp": 7, "might": 4, "wits": 1, "speed": 1}, "tags": [], "maxHp": 7,
	}]
	var stirred: Variant = SimCommands.stir_world(_seized([{"x": 3, "y": 3}], standing))
	assert_not_null(stirred)
	for r: Dictionary in (((stirred as Dictionary)["payload"]) as Dictionary)["opponents"]:
		assert_ne(r["kind"], "echo", "nothing rises under a body already standing there")


func test_the_riser_keeps_its_distance_so_its_arrival_is_a_chase() -> void:
	## WAVE_DISTANCE is 8 and the carrier is at (0,0), so every drawn tile must
	## be at least 8 straight steps away. Spelled as a literal on purpose: a
	## test that reads the bound off the constant it guards moves its own
	## goalposts, which this migration has already measured four times.
	var stirred: Variant = SimCommands.stir_world(_seized())
	assert_not_null(stirred)
	var risen: Array = (((stirred as Dictionary)["payload"]) as Dictionary)["opponents"]
	assert_eq(risen.size(), 1, "a graveless floor raises exactly the one drawn riser")
	var pos: Dictionary = (risen[0] as Dictionary)["pos"]
	assert_true(absi(int(pos["x"])) + absi(int(pos["y"])) >= 8,
		"the riser arrives at least 8 steps out, at %s" % [pos])
	assert_eq((risen[0] as Dictionary)["id"], "risen-7", "named for the turn it rose on")


func test_the_stir_spends_exactly_two_draws_and_says_where_they_started() -> void:
	## The draw protocol, pinned by OFFSET and not merely by count — the blind
	## spot Task 2.E3a measured, where a draw that MOVES is invisible to every
	## range assertion and to the golden run alike. One draw picks the
	## archetype, one picks the tile, and the envelope opens at the state's own
	## counter.
	var state: Dictionary = _seized()
	var stirred: Dictionary = SimCommands.stir_world(state)
	assert_eq(stirred["rngCounter"], 100, "the envelope opens where the state stood")
	assert_eq(stirred["rngDraws"], 2, "one for the archetype, one for the tile")

	# And the tile really is the one the SECOND draw names, not the first.
	var risen: Array = (stirred["payload"] as Dictionary)["opponents"]
	var pos: Dictionary = (risen[0] as Dictionary)["pos"]
	var candidates: Array = []
	for y in range(20):
		for x in range(20):
			if absi(x) + absi(y) >= 8:
				candidates.append({"x": x, "y": y})
	var index: int = SimRng.int_between(4242, 101, 0, candidates.size() - 1)
	assert_eq(pos, candidates[index],
		"the tile comes from counter 101, the draw after the archetype's")


func test_a_floor_with_nowhere_to_put_anything_records_nothing() -> void:
	## "a stir that raises nobody is not a fact worth recording" — null, not an
	## empty WORLD_STIRRED. A 3x3 board has no tile 8 steps from anywhere.
	var state: Dictionary = SimState.empty()
	state["grid"] = SimGrid.make(3, 3, _tiles(3, 3))
	state["seed"] = 4242
	state["entities"] = [{
		"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
		"stats": {"hp": 4, "might": 3, "wits": 2, "speed": 3}, "tags": [], "maxHp": 11,
	}]
	assert_null(SimCommands.stir_world(state), "nothing can rise, so nothing is recorded")


func test_no_carrier_no_stir() -> void:
	var state: Dictionary = _seized()
	state["entities"] = []
	assert_null(SimCommands.stir_world(state))


func test_what_it_produces_folds_through_the_reducer() -> void:
	## The whole point of finding this unowned: apply.gd has had a WORLD_STIRRED
	## arm since Wave C with nothing in the migration able to produce the event.
	## This is the first time the two meet.
	var state: Dictionary = _seized([{"x": 3, "y": 3}])
	var stirred: Dictionary = SimCommands.stir_world(state)
	var after: Dictionary = SimApply.apply(state, stirred)
	SimState.assert_shape(after)
	assert_eq((after["entities"] as Array).size(), 3, "the carrier plus an echo plus a riser")
	var echo: Variant = SimEntity.find(after["entities"], "echo-1")
	assert_not_null(echo)
	assert_eq((echo as Dictionary)["post"], {"x": 3, "y": 3}, "seated and posted where it rose")
	assert_eq((echo as Dictionary)["maxHp"], 11, "ceilinged at its birth hp")
