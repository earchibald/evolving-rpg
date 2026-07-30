extends GutTest
## sim/mapgen.gd — the byte-twin of tests/core/mapgen.test.ts (11 cases), all
## 11 ported, in the TS file's order so the two suites diff by eye.
##
## Three further cases are ADOPTED here from Task 2.B3's deferral list —
## godot/test/unit/test_tables.gd's header names mapgen.gd as their owner
## because each one calls generateMap, which did not exist when tables landed:
##   tests/core/motifs.test.ts  "cuts the halls broad and the warren tight"
##   tests/core/motifs.test.ts  "keeps the warren inside its caps"
##   tests/core/size.test.ts    "the room cap scales with area, so the motif
##                               keeps its density"
##
## ── The board sweep is the point of this file ───────────────────────────
## test_generates_the_reference_boards_tile_for_tile replays all six recorded
## boards from godot/test/fixtures/mapgen.json and compares them tile for tile
## AND on counterAfter. Of the two, **counterAfter is the stronger assertion.**
## Two generators can coincidentally agree on a board while spending different
## randomness, and then diverge on the very next draw — somewhere far away and
## much later, in spawns or loot or the exit, with nothing to point back here.
## A matching draw count cannot be faked that way. A board that matches while
## counterAfter does not is a WRONG port that looks right; it is a hard
## failure, never a rounding question.
##
## All of mapgen.json is integers, so it uses the strict FixtureLoader.load_json
## — a fractional number in a board would be corruption, not data.

const FIXTURE := "res://test/fixtures/mapgen.json"

## The three boards the door offers, by the names tests/core/size.test.ts uses
## for them (they are test-local constants there too, not exports).
const VALE := {"width": 48, "height": 32}
const EXPANSE := {"width": 96, "height": 64}


func _fixture() -> Dictionary:
	return FixtureLoader.load_json(FIXTURE)


## The first index at which two tile arrays disagree, or -1. Compared before
## the canonical encoding below purely so a failure names a tile instead of
## dumping two six-thousand-element strings as its first word.
func _first_tile_difference(got: Array, want: Array) -> int:
	if got.size() != want.size():
		return 0
	for i in range(got.size()):
		if got[i] != want[i]:
			return i
	return -1


# ── the board-identity sweep ─────────────────────────────────────────────

func test_generates_the_reference_boards_tile_for_tile() -> void:
	var fx: Dictionary = _fixture()

	# The recorded tiles mean nothing unless our constants name the same
	# things, and the recorded draws mean nothing unless generate_map's own
	# default motif is the motif the exporter passed it (MOTIFS.door). Both
	# are cheap and both can fail.
	var constants: Dictionary = fx["tileConstants"]
	assert_eq(int(constants["FLOOR"]), SimGrid.FLOOR, "FLOOR")
	assert_eq(int(constants["WALL"]), SimGrid.WALL, "WALL")
	assert_eq(int(constants["EXIT"]), SimGrid.EXIT, "EXIT")
	assert_eq(int(constants["SECRET"]), SimGrid.SECRET, "SECRET")
	assert_eq(fx["defaultMotif"], SimTables.MOTIFS["door"],
		"the fixture was recorded with generate_map's own default motif")

	var cases: Array = fx["cases"]
	assert_eq(cases.size(), 6, "all six recorded boards")
	for c: Dictionary in cases:
		var want: Dictionary = c["result"]
		var got: Dictionary = SimMapgen.generate_map(
			int(c["seed"]), int(c["counterIn"]), int(c["width"]), int(c["height"]))
		var where := "seed %d at %dx%d" % [int(c["seed"]), int(c["width"]), int(c["height"])]

		assert_eq(_first_tile_difference(
			(got["grid"] as Dictionary)["tiles"], (want["grid"] as Dictionary)["tiles"]),
			-1, "%s: first differing tile index" % where)
		assert_eq(SimCanonical.encode(got["grid"]), SimCanonical.encode(want["grid"]), where)

		# The stronger half. A board that matches while this does not means the
		# port spent different randomness to arrive at the same picture, and
		# every later draw on this seed is off by the difference.
		assert_eq(int(got["counterAfter"]), int(want["counterAfter"]),
			"%s: the draw stream spent the same randomness" % where)
		# drawsConsumed was recorded independently of counterAfter by the
		# exporter, so this is a second witness rather than a restatement.
		assert_eq(int(got["counterAfter"]) - int(c["counterIn"]), int(c["drawsConsumed"]),
			"%s: draws consumed" % where)


func test_generates_the_reference_boards_start_rooms_and_story() -> void:
	## Everything else MapGenResult carries. The start is drawn (the last draw
	## of the roomy path), the rooms are the rejection sampler's whole record,
	## and the story counts both — so a port that placed the right tiles from
	## the wrong rooms is caught here rather than downstream.
	for c: Dictionary in (_fixture()["cases"] as Array):
		var want: Dictionary = c["result"]
		var got: Dictionary = SimMapgen.generate_map(
			int(c["seed"]), int(c["counterIn"]), int(c["width"]), int(c["height"]))
		var where := "seed %d at %dx%d" % [int(c["seed"]), int(c["width"]), int(c["height"])]
		assert_eq(got["start"], want["start"], "%s: start" % where)
		assert_eq(got["rooms"], want["rooms"], "%s: rooms" % where)
		assert_eq(got["story"], want["story"], "%s: story" % where)


# ── ported from tests/core/mapgen.test.ts (11 cases, all portable) ────────
#
# 11 = 11 ported + 0 deferred. Every case in that file drives generateMap or
# walkDistance directly; none of them needs createWorld or the reducer.

func test_is_deterministic_for_the_same_seed_and_counter() -> void:
	var a: Dictionary = SimMapgen.generate_map(1234, 0, 48, 32)
	var b: Dictionary = SimMapgen.generate_map(1234, 0, 48, 32)
	assert_eq((a["grid"] as Dictionary)["tiles"], (b["grid"] as Dictionary)["tiles"])
	assert_eq(a["start"], b["start"])
	assert_eq(a["rooms"], b["rooms"])
	assert_eq(int(a["counterAfter"]), int(b["counterAfter"]))


func test_produces_different_maps_for_different_seeds() -> void:
	var a: Dictionary = SimMapgen.generate_map(1, 0, 48, 32)
	var b: Dictionary = SimMapgen.generate_map(2, 0, 48, 32)
	assert_ne((a["grid"] as Dictionary)["tiles"], (b["grid"] as Dictionary)["tiles"])


func test_respects_a_non_zero_starting_counter() -> void:
	var a: Dictionary = SimMapgen.generate_map(7, 0, 48, 32)
	var b: Dictionary = SimMapgen.generate_map(7, 500, 48, 32)
	assert_gt(int(b["counterAfter"]), 500)
	assert_ne((a["grid"] as Dictionary)["tiles"], (b["grid"] as Dictionary)["tiles"])


func test_connects_every_floor_tile_to_the_start() -> void:
	## Covenant M5's teeth. The old scatter generator promised 60% reachable;
	## rooms and corridors promise there is no sealed room at all, because a
	## relic behind a wall with no way in is a lie the map tells.
	##
	## The TS case reaches for reachableFrom. Here the check runs through
	## walk_distances instead — a genuinely SEPARATE breadth-first walk from
	## the depth-first flood generate_map already ran on itself before
	## returning. Asserting with the same flood the generator just used would
	## only prove the flood agrees with itself.
	for seed in range(50):
		var built: Dictionary = SimMapgen.generate_map(seed, 0, 48, 32)
		var grid: Dictionary = built["grid"]
		var walked: Dictionary = SimMapgen.walk_distances(grid, built["start"])
		var tiles: Array = grid["tiles"]
		for i in range(tiles.size()):
			if int(tiles[i]) == SimGrid.FLOOR:
				assert_true(walked.has(i), "seed %d: sealed floor at tile %d" % [seed, i])


func test_starts_you_standing_inside_a_room_not_inside_a_wall() -> void:
	for seed in range(50):
		var built: Dictionary = SimMapgen.generate_map(seed, 0, 48, 32)
		var start: Dictionary = built["start"]
		assert_true(SimGrid.is_passable(built["grid"], int(start["x"]), int(start["y"])),
			"seed %d: start is not passable" % seed)
		var inside := false
		for r: Dictionary in (built["rooms"] as Array):
			if int(start["x"]) >= int(r["x"]) and int(start["x"]) < int(r["x"]) + int(r["w"]) \
				and int(start["y"]) >= int(r["y"]) and int(start["y"]) < int(r["y"]) + int(r["h"]):
				inside = true
				break
		assert_true(inside, "seed %d: start is in no room" % seed)


func test_keeps_the_border_solid_so_the_world_has_an_inside() -> void:
	for seed in range(20):
		var grid: Dictionary = (SimMapgen.generate_map(seed, 0, 48, 32) as Dictionary)["grid"]
		var w: int = grid["width"]
		var h: int = grid["height"]
		for x in range(w):
			assert_eq(SimGrid.tile_at(grid, x, 0), SimGrid.WALL, "seed %d top %d" % [seed, x])
			assert_eq(SimGrid.tile_at(grid, x, h - 1), SimGrid.WALL,
				"seed %d bottom %d" % [seed, x])
		for y in range(h):
			assert_eq(SimGrid.tile_at(grid, 0, y), SimGrid.WALL, "seed %d left %d" % [seed, y])
			assert_eq(SimGrid.tile_at(grid, w - 1, y), SimGrid.WALL,
				"seed %d right %d" % [seed, y])


func test_carves_several_genuine_rooms_on_a_full_size_board() -> void:
	for seed in range(20):
		var built: Dictionary = SimMapgen.generate_map(seed, 0, 48, 32)
		var rooms: Array = built["rooms"]
		assert_between(rooms.size(), 3, 16, "seed %d: room count" % seed)
		for r: Dictionary in rooms:
			for y in range(int(r["y"]), int(r["y"]) + int(r["h"])):
				for x in range(int(r["x"]), int(r["x"]) + int(r["w"])):
					assert_eq(SimGrid.tile_at(built["grid"], x, y), SimGrid.FLOOR,
						"seed %d: room tile %d,%d" % [seed, x, y])


func test_tells_its_story_with_the_real_numbers_in_it() -> void:
	var built: Dictionary = SimMapgen.generate_map(11, 0, 48, 32)
	var story: String = built["story"]
	assert_string_contains(story, "%d rooms" % (built["rooms"] as Array).size())
	assert_true(story.contains("loop"), "the story names its loops: %s" % story)


func test_degrades_a_tiny_board_to_one_open_chamber() -> void:
	## Trial worlds and 12x8 test boards flow through this generator too — one
	## model for every consumer, no fossil generator kept alive for tests.
	var built: Dictionary = SimMapgen.generate_map(5, 0, 12, 8)
	assert_eq(built["rooms"], [{"x": 1, "y": 1, "w": 10, "h": 6}])
	assert_eq(built["story"], "one open chamber")
	var start: Dictionary = built["start"]
	assert_true(SimGrid.is_passable(built["grid"], int(start["x"]), int(start["y"])))
	for y in range(1, 7):
		for x in range(1, 11):
			assert_eq(SimGrid.tile_at(built["grid"], x, y), SimGrid.FLOOR, "%d,%d" % [x, y])


func test_refuses_a_board_too_small_to_hold_an_interior() -> void:
	## The reference THROWS. GDScript's assert() unwinds exactly one frame and
	## hands the caller the return type's default, so what is asserted is that
	## the refusal is LOUD and that nothing plausible comes back. BOTH channels
	## are checked on purpose: assert() is compiled OUT of a release build and
	## push_error is not, so checking only the assert would let an exported
	## build hand back a 2x2 "world" with this test still green.
	var built: Dictionary = SimMapgen.generate_map(3, 0, 2, 2)
	assert_true(built.is_empty(), "a refused board returns nothing to build on")
	assert_engine_error("cannot hold an interior")
	assert_push_error("cannot hold an interior")


func test_measures_steps_of_walking_and_calls_the_unreachable_unreachable() -> void:
	## 3x3 with a wall bar down the middle: around is the only way, and there
	## is none — the far column must read as unreachable, not as "3 away".
	var grid: Dictionary = SimGrid.make(3, 3, [
		SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR,
	])
	assert_eq(SimMapgen.walk_distance(grid, {"x": 0, "y": 0}, {"x": 0, "y": 2}), 2.0)
	var blocked := SimMapgen.walk_distance(grid, {"x": 0, "y": 0}, {"x": 2, "y": 0})
	assert_true(is_inf(blocked) and blocked > 0.0,
		"no walk exists, so the answer is +INF, not a number: %s" % blocked)
	assert_eq(SimMapgen.walk_distance(grid, {"x": 0, "y": 0}, {"x": 0, "y": 0}), 0.0)


# ── adopted from Task 2.B3's deferral list ───────────────────────────────
#
# Each of these was ported-but-parked in test_tables.gd because it calls
# generateMap. They are motif and size cases; their subject is what the
# generator does with a motif's numbers, which is this file's business.

func _mean_room_area(motif_key: String) -> float:
	var area := 0
	var count := 0
	for seed in range(1, 13):
		var rooms: Array = (SimMapgen.generate_map(
			seed, 0, 48, 32, SimTables.MOTIFS[motif_key]) as Dictionary)["rooms"]
		for r: Dictionary in rooms:
			area += int(r["w"]) * int(r["h"])
			count += 1
	return float(area) / float(count)


func test_cuts_the_halls_broad_and_the_warren_tight() -> void:
	## motifs.test.ts. The bands have to differ STRUCTURALLY, not just by name:
	## roomW/roomH are the only thing separating them, so a port that read the
	## wrong motif's caps — or read roomW where the reference reads roomH —
	## collapses these three orderings.
	var door := _mean_room_area("door")
	var warren := _mean_room_area("warren")
	var halls := _mean_room_area("halls")
	assert_lt(warren, door, "the warren crowds")
	assert_gt(halls, door, "the halls breathe")
	assert_gt(halls, warren * 1.8, "and they are not merely a little broader")


func test_keeps_the_warren_inside_its_caps() -> void:
	## motifs.test.ts. Two ceilings, and they are not the same number — 6 wide
	## by 4 tall — which is what makes this able to fail: swapping roomW for
	## roomH keeps every width under 6 and pushes heights to 6.
	for seed in range(1, 9):
		var rooms: Array = (SimMapgen.generate_map(
			seed, 0, 48, 32, SimTables.MOTIFS["warren"]) as Dictionary)["rooms"]
		for r: Dictionary in rooms:
			assert_lte(int(r["w"]), 6, "seed %d: warren room width" % seed)
			assert_lte(int(r["h"]), 4, "seed %d: warren room height" % seed)


func test_the_room_cap_scales_with_area_so_the_motif_keeps_its_density() -> void:
	## size.test.ts. On the vale the cap (16) binds before the door motif's
	## divisor does (1536/110 is about 14 — close); on the expanse a fixed 16
	## would hand back a prairie with sixteen sheds. The generator self-checks
	## connectivity, so a green run here is also a reachability proof at every
	## size.
	var big: Array = (SimMapgen.generate_map(
		5, 0, int(EXPANSE["width"]), int(EXPANSE["height"])) as Dictionary)["rooms"]
	assert_gt(big.size(), 16, "the expanse earns more than the vale's cap")
	var vale: Array = (SimMapgen.generate_map(
		5, 0, int(VALE["width"]), int(VALE["height"])) as Dictionary)["rooms"]
	assert_lte(vale.size(), 16, "the vale stays under it")


# ── no TS counterpart ────────────────────────────────────────────────────

func test_choose_exit_spends_exactly_two_draws_on_every_path_out() -> void:
	## The reference states the two-draw rule in prose and no TS case pins it.
	## It is worth a test of its own because the fallback path — a floor with
	## no candidate in any band — reaches its `c += 1` by a completely
	## different route from the ordinary one, and a port that dropped that line
	## would still pass the six-board sweep (those boards all find a band) and
	## would shift every later draw on any cramped floor.
	var roomy: Dictionary = SimMapgen.generate_map(17, 0, 48, 32)
	var ordinary: Dictionary = SimMapgen.choose_exit(
		17, int(roomy["counterAfter"]), roomy["grid"], roomy["start"])
	assert_eq(int(ordinary["counterAfter"]) - int(roomy["counterAfter"]), 2,
		"an ordinary floor: the band, then the tile")

	# A 3x1 corridor: reach is 2, so no band can offer a tile eight steps out
	# and every one of them is skipped drawlessly before the fallback.
	var cramped: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR])
	var fallen: Dictionary = SimMapgen.choose_exit(17, 900, cramped, {"x": 0, "y": 0})
	assert_eq(int(fallen["counterAfter"]) - 900, 2,
		"the fallback spends its second draw on nothing so the stream reads alike")
	assert_eq(fallen["band"], "the long way", "and calls itself the long way")
	assert_eq(fallen["exit"], SimMapgen.farthest_from(cramped, {"x": 0, "y": 0}),
		"landing on the far anchor")


func test_the_exit_bands_are_the_three_the_designer_ruled() -> void:
	## Not a static-fact test in disguise: MIN_EXIT_WALK and the bands are read
	## by choose_exit through arithmetic that would silently accept a wrong
	## weight, so the weights are asserted where the ROLL can see them — a roll
	## of 1..6 must land in the long way, 7..9 in the middle, 10 in close by.
	assert_eq(SimMapgen.EXIT_BANDS.size(), 3)
	assert_eq(SimMapgen.MIN_EXIT_WALK, 8)
	var total := 0
	for band: Dictionary in SimMapgen.EXIT_BANDS:
		total += int(band["weight"])
	assert_eq(total, 10, "six the long way, three the middle, one close by")
	# close by is the only band with a step ceiling, and it is ABSENT on the
	# other two rather than null — choose_exit reads it as `?? reach`.
	assert_false((SimMapgen.EXIT_BANDS[0] as Dictionary).has("maxSteps"))
	assert_false((SimMapgen.EXIT_BANDS[1] as Dictionary).has("maxSteps"))
	assert_eq(int((SimMapgen.EXIT_BANDS[2] as Dictionary)["maxSteps"]), 25)


func test_pick_spawn_points_keeps_its_distance_and_never_repeats() -> void:
	## pickSpawnPoints has no TS suite of its own — it is exercised only
	## through createWorld, which is Wave E. Its three promises are testable
	## now: minimum distance, distinct tiles, and one draw per point placed.
	var built: Dictionary = SimMapgen.generate_map(99, 0, 48, 32)
	var spawned: Dictionary = SimMapgen.pick_spawn_points(
		99, int(built["counterAfter"]), built["grid"], built["start"], 6, 8)
	var points: Array = spawned["points"]
	assert_eq(points.size(), 6, "a 48x32 board has room for six")
	assert_eq(int(spawned["counterAfter"]) - int(built["counterAfter"]), points.size(),
		"exactly one draw per point placed")
	var seen: Dictionary = {}
	for p: Dictionary in points:
		var key := "%d,%d" % [int(p["x"]), int(p["y"])]
		assert_false(seen.has(key), "no tile is chosen twice: %s" % key)
		seen[key] = true
		assert_gte(
			absi(int(p["x"]) - int((built["start"] as Dictionary)["x"]))
			+ absi(int(p["y"]) - int((built["start"] as Dictionary)["y"])),
			8, "nothing is already breathing on you at %s" % key)
		assert_true(SimGrid.is_passable(built["grid"], int(p["x"]), int(p["y"])),
			"and nothing stands in a wall at %s" % key)


func test_with_exit_writes_the_way_out_without_touching_what_it_was_handed() -> void:
	## SimGrid.make hands back a FROZEN tiles array. A port that wrote through
	## the original instead of a copy would either crash here or — worse, in a
	## release build where the read-only flag is still enforced but the assert
	## is not — mutate a grid something else already folded.
	var grid: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR])
	var opened: Dictionary = SimMapgen.with_exit(grid, {"x": 2, "y": 0})
	assert_eq(SimGrid.tile_at(opened, 2, 0), SimGrid.EXIT)
	assert_eq(SimGrid.tile_at(grid, 2, 0), SimGrid.FLOOR, "the original is untouched")
	assert_true((opened["tiles"] as Array).is_read_only(), "and the new one is frozen too")


func test_seal_secret_room_spends_nothing_below_three_rooms() -> void:
	## The zero-draw early return. Every other exit from seal_secret_room has
	## spent at least the odds roll, so a port that hoisted that roll above the
	## room-count guard would look correct and would shift the stream on every
	## chamber floor.
	var grid: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR])
	var rooms: Array = [{"x": 0, "y": 0, "w": 1, "h": 1}, {"x": 2, "y": 0, "w": 1, "h": 1}]
	var out: Dictionary = SimMapgen.seal_secret_room(
		1, 400, grid, rooms, {"x": 0, "y": 0}, {"x": 2, "y": 0})
	assert_eq(int(out["counterAfter"]), 400, "two rooms cannot hide a third")
	assert_false(bool(out["sealed"]))
	assert_true(is_same(out["grid"], grid), "and the grid comes back as the same object")


func test_repair_with_secret_cuts_a_way_into_a_stranded_room_and_leaves_a_whole_map_alone() -> void:
	## The designer's repair rule. By construction the generator never produces
	## a stranded room, so this is defence in depth — and drawless, which is
	## why it can be checked on a hand-built board.
	##
	## 5x3, a sealed one-tile cell at the right: floor . wall . floor, with the
	## whole thing walled around.
	var W := SimGrid.WALL
	var F := SimGrid.FLOOR
	var broken: Dictionary = SimGrid.make(5, 3, [
		W, W, W, W, W,
		F, F, W, F, W,
		W, W, W, W, W,
	])
	var fixed: Dictionary = SimMapgen.repair_with_secret(broken, {"x": 0, "y": 1})
	assert_eq(int(fixed["punched"]), 1, "one wall becomes a hidden way in")
	assert_eq(SimGrid.tile_at(fixed["grid"], 2, 1), SimGrid.SECRET,
		"the lowest-index wall touching both sides")

	var whole: Dictionary = SimGrid.make(5, 3, [
		W, W, W, W, W,
		F, F, F, F, W,
		W, W, W, W, W,
	])
	var untouched: Dictionary = SimMapgen.repair_with_secret(whole, {"x": 0, "y": 1})
	assert_eq(int(untouched["punched"]), 0, "a whole map is not improved")
	assert_eq((untouched["grid"] as Dictionary)["tiles"], (whole as Dictionary)["tiles"])
