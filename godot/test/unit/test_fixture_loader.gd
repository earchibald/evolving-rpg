extends GutTest
## The loader is the one place a JSON-parser artifact gets corrected. Every
## number in this game's chains is an integer; if a float reaches SimCanonical
## it either renders wrong or refuses, and either way the chain forks. So the
## normalization is proven here, once, rather than trusted everywhere.


func test_normalizes_integral_floats_and_loads_golden() -> void:
	assert_eq(FixtureLoader.normalize(2.0), 2)
	assert_eq(typeof(FixtureLoader.normalize(2.0)), TYPE_INT)
	assert_eq(FixtureLoader.normalize([1.0, {"a": 3.0}]), [1, {"a": 3}])
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	assert_true((golden["events"] as Array).size() > 0, "golden events present")
	assert_eq(typeof(golden["seed"]), TYPE_INT)


func test_table_fixtures_keep_their_fractional_coefficients() -> void:
	## The game's balance coefficients really are fractional: VERB_THREAT prices
	## verbs at 1.1-1.3 and bountyStretch returns 1.5 and 2.5. Rounding them
	## would hide the integer-division bug class their rows exist to catch, so
	## the table loader keeps them while still folding integers to int.
	assert_eq(FixtureLoader.normalize(1.25, true), 1.25)
	assert_eq(typeof(FixtureLoader.normalize(1.25, true)), TYPE_FLOAT)
	assert_eq(FixtureLoader.normalize(3.0, true), 3, "an integer is still an integer")
	assert_eq(typeof(FixtureLoader.normalize(3.0, true)), TYPE_INT)
	var tables: Dictionary = FixtureLoader.load_table_json("res://test/fixtures/tables.json")
	assert_eq(tables["verbThreat"]["trample"], 1.1, "the trample multiplier survives loading")
	assert_eq(tables["verbThreat"]["call"], 1.3)
	# And the integers in the same file are still integers.
	assert_eq(typeof((tables["neededToHit"] as Array)[0]["value"]), TYPE_INT)


func test_the_strict_loader_still_refuses_a_fractional_number() -> void:
	## The exception is chosen at the call site, not granted globally. A chain or
	## state fixture carrying 1.25 is corruption, and must still crash.
	FixtureLoader.normalize(1.25)
	assert_engine_error("non-integral number in fixture")


func test_leaves_non_numbers_alone() -> void:
	assert_eq(FixtureLoader.normalize("two"), "two")
	assert_eq(FixtureLoader.normalize(null), null)
	assert_eq(FixtureLoader.normalize(true), true)
	# Nested structure is walked to the bottom, not just one level.
	assert_eq(
		FixtureLoader.normalize({"a": [{"b": [7.0]}]}),
		{"a": [{"b": [7]}]})
