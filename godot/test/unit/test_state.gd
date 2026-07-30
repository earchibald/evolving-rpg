extends GutTest
## GameState's shape — the byte-twin of tests/core/entity.test.ts's
## `describe('EMPTY_STATE', ...)` block, plus the pinning suite that measures
## SimState against the state-shape oracle test_state_shape.gd already pinned.
##
## The three EMPTY_STATE tests below are ported in the TS file's order, even
## though the TS describe block lives in entity.test.ts: those cases belong
## to state.ts, not entity.ts, and waited for SimState to exist. The third —
## "is frozen" — cannot port literally. SimState.empty() deliberately returns
## a FRESH Dictionary on every call rather than one shared frozen singleton
## (see sim/state.gd's docstring on empty()), so "Object.isFrozen" has
## nothing to assert. What is ported instead is the reason the reference
## cared: a reducer mutating its accumulator must never corrupt what a later
## fold starts from.
##
## The real gate lives in test_empty_state_matches_the_reference_key_for_key:
## SimCanonical.encode(SimState.empty()) must equal the reference dump's own
## encoding, byte for byte.


func test_has_no_entities_and_no_active_turn() -> void:
	var s: Dictionary = SimState.empty()
	assert_eq(s["entities"], [], "no entities yet")
	assert_null(s["activeEntityId"], "no active turn yet")
	assert_eq(s["turn"], 0)
	assert_eq(s["rngCounter"], 0)


func test_is_a_solid_one_tile_grid_so_nothing_is_walkable_before_a_world_exists() -> void:
	var s: Dictionary = SimState.empty()
	assert_false(SimGrid.is_passable(s["grid"], 0, 0), "the empty state's one tile is a wall")


func test_mutating_one_empty_call_does_not_leak_into_the_next() -> void:
	## Ported intent of "is frozen, so a reducer mutating its accumulator
	## fails loudly instead of corrupting every later replay". The reference
	## proves this by freezing one shared EMPTY_STATE; SimState.empty() takes
	## the other route — a fresh Dictionary per call — so what must hold
	## instead is that a mutation of one call's result is simply invisible to
	## the next, which is equally sufficient to stop the corruption the TS
	## test was guarding against.
	var a: Dictionary = SimState.empty()
	a["turn"] = 99
	(a["entities"] as Array).append({"id": "intruder"})
	var b: Dictionary = SimState.empty()
	assert_eq(b["turn"], 0, "mutating one empty() result must not leak into the next")
	assert_eq((b["entities"] as Array).size(), 0, "nor must mutating its entities array")


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
	var s: Dictionary = SimState.empty()
	s["playerGold"] = 3   # the M9 mistake: a stored total beside the folded one
	# assert_shape uses assert(), which GUT surfaces as an engine error; the
	# contract under test is that the key set is checked at all.
	assert_false(SimState.STATE_KEYS.has("playerGold"))


func test_assert_shape_fires_on_a_stray_key() -> void:
	## The companion to the test above: that one shows "playerGold" is not a
	## recognised key; this one shows assert_shape actually refuses a state
	## carrying it, so the check has teeth and not just a source of truth.
	var s: Dictionary = SimState.empty()
	s["playerGold"] = 3
	SimState.assert_shape(s)
	assert_engine_error("expected keys")
