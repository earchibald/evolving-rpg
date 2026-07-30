extends GutTest
## Event identity is a hash of these exact bytes, so any drift here forks every
## chain ever written. The fixture pairs come from the reference encoder.


func test_pinned_encoding() -> void:
	assert_eq(
		SimCanonical.encode({"b": [1, "two", null], "a": {"z": true, "m": 2}}),
		'{"a":{"m":2,"z":true},"b":[1,"two",null]}')
	assert_eq(SimCanonical.encode(2.0), "2")   # parser artifact folds to int form


func test_matches_reference_fixtures() -> void:
	var cases: Array = FixtureLoader.load_json("res://test/fixtures/canonical.json")
	assert_eq(cases.size(), 15, "the exported canonical cases")
	for c: Dictionary in cases:
		assert_eq(SimCanonical.encode(c["input"]), c["expected"],
			"encode(%s)" % JSON.stringify(c["input"]))


func test_keys_sort_by_code_point_not_alphabetically() -> void:
	## The discriminating case: "Z" is 90 and "a" is 97, so a case-insensitive
	## sort would put "a" first and disagree with JS's Array.prototype.sort.
	assert_eq(SimCanonical.encode({"a": 1, "Z": 2}), '{"Z":2,"a":1}')
	assert_eq(SimCanonical.encode({"b": 1, "A": 2, "a": 3}), '{"A":2,"a":3,"b":1}')


func test_no_whitespace_anywhere() -> void:
	var out := SimCanonical.encode({"a": [1, 2, {"b": 3}], "c": "d"})
	assert_false(out.contains(" "), "encoded bytes carry no spaces: %s" % out)
	assert_false(out.contains("\n"), "encoded bytes carry no newlines")


func test_empty_containers_and_nulls() -> void:
	assert_eq(SimCanonical.encode({}), "{}")
	assert_eq(SimCanonical.encode([]), "[]")
	assert_eq(SimCanonical.encode(null), "null")
	assert_eq(SimCanonical.encode({"keep": 1, "drop": null}), '{"drop":null,"keep":1}')
