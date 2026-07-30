extends GutTest
## splitmix32, checked against the reference engine rather than against anyone's
## reading of the JavaScript. The pinned values below were computed from the
## live TS engine at tag ts-baseline; the fixture rows were exported from it.


func test_pinned_reference_values() -> void:
	assert_eq(SimRng.u32(17, 0), 1341360728)
	assert_eq(SimRng.u32(17, 1), 355572909)
	assert_eq(SimRng.u32(17, 2), 877023582)
	assert_eq(SimRng.u32(123456789, 41), 570345708)
	assert_eq(SimRng.u32(-5, 7), 3645567351)   # negative seed wraps like (x | 0)
	assert_eq(SimRng.int_between(17, 5, 1, 6), 5)


func test_matches_reference_fixtures() -> void:
	var fx: Dictionary = FixtureLoader.load_json("res://test/fixtures/rng.json")
	var u32_rows: Array = fx["u32"]
	assert_eq(u32_rows.size(), 63, "the exported u32 grid")
	for row: Dictionary in u32_rows:
		assert_eq(SimRng.u32(row["seed"], row["counter"]), row["u32"],
			"u32(%d, %d)" % [row["seed"], row["counter"]])
	var int_rows: Array = fx["intBetween"]
	assert_eq(int_rows.size(), 12, "the exported intBetween grid")
	for row: Dictionary in int_rows:
		assert_eq(
			SimRng.int_between(row["seed"], row["counter"], row["min"], row["max"]),
			row["value"],
			"int_between(%d, %d, %d, %d)" % [row["seed"], row["counter"], row["min"], row["max"]])


func test_every_draw_stays_inside_32_bits() -> void:
	## A 64-bit language that forgets to mask produces a plausible-looking number
	## that is simply too big. Cheap to check, and it localises the failure.
	for counter: int in range(0, 200):
		var v := SimRng.u32(17, counter)
		assert_between(v, 0, 4294967295, "u32(17, %d) in range" % counter)


func test_float01_is_the_draw_over_two_to_the_32() -> void:
	assert_almost_eq(SimRng.float01(17, 0), 1341360728 / 4294967296.0, 1e-15)
	for counter: int in range(0, 50):
		var f := SimRng.float01(17, counter)
		assert_true(f >= 0.0 and f < 1.0, "float01(17, %d) in [0,1)" % counter)


func test_int_between_is_inclusive_on_both_ends() -> void:
	## A single-value span must be the value, never a modulo-by-one accident.
	for counter: int in range(0, 20):
		assert_eq(SimRng.int_between(17, counter, 4, 4), 4)
	var seen := {}
	for counter: int in range(0, 400):
		seen[SimRng.int_between(17, counter, 1, 6)] = true
	for face: int in range(1, 7):
		assert_true(seen.has(face), "face %d appears across 400 draws" % face)
