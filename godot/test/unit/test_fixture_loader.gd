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


func test_leaves_non_numbers_alone() -> void:
	assert_eq(FixtureLoader.normalize("two"), "two")
	assert_eq(FixtureLoader.normalize(null), null)
	assert_eq(FixtureLoader.normalize(true), true)
	# Nested structure is walked to the bottom, not just one level.
	assert_eq(
		FixtureLoader.normalize({"a": [{"b": [7.0]}]}),
		{"a": [{"b": [7]}]})
