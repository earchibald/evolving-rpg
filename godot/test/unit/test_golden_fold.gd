extends GutTest
## Phase 2's headline gate: replaying the golden chain through the ported
## reducer reproduces the exact state the TypeScript engine signed.
##
## The recipe is sha256(canonicalJson(state)) — the WHOLE state object, so this
## passes only if every key, every absent optional, and every integer in the
## folded state matches the reference. It is the strictest assertion in the
## migration, and the reason the absent-key law exists.
##
## READ THIS BEFORE QUOTING A GREEN RUN OF IT. The golden run's 451 events
## exercise five of the twenty-five event types — WORLD_INIT v15, MOVE v2,
## STRIKE v5, TURN_ADVANCED v2, ITEM_TAKEN v5. Passing here proves five of
## apply.gd's twenty-five cases and says nothing about the other twenty; for
## those, the ported unit suites ARE the verification, not a supplement to it.
## The same hole covers `route`, `scroll`, `pocket` and `satchel`, which never
## appear in this run's entities at all — exactly the fields most likely to get
## the absent-key law wrong.

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
	## When the gate above fails, this is the test that tells you which key to
	## look at: a null where the reference has an absent key, an extra key, a
	## float where the reference has an int, or a derived value (xp/gold/level)
	## computed differently.
	var built := _rebuild()
	var mine: Dictionary = (built[0] as SimLog).fold(built[1])
	var shape: Dictionary = FixtureLoader.load_json("res://test/fixtures/state-shape.json")
	var theirs: Dictionary = shape["goldenFinal"]
	var my_keys: Array = mine.keys()
	my_keys.sort()
	var their_keys: Array = theirs.keys()
	their_keys.sort()
	assert_eq(my_keys, their_keys, "the state's key set")
	for key: String in their_keys:
		assert_eq(SimCanonical.encode(mine[key]), SimCanonical.encode(theirs[key]),
			"state key '%s'" % key)
