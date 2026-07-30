extends GutTest
## walk_path — the road, root-first. The byte-twin of tests/core/path-pull.test.ts
## (5 cases): 5 ported, 0 deferred.
##
## ── The reconciliation ──────────────────────────────────────────────────
## PORTED by Task 2.D1
##   "returns nothing when there is no walk at all" — verbatim.
##   "walks a shortest path whose length is the walk distance" — ported with
##     its WORLD SUBSTITUTED, and that substitution is the disclosure: the TS
##     case builds its board with createWorld (src/core/commands.ts, Wave E's
##     Task 2.E3a) and then asserts three properties of walkPath — root-first,
##     length equal to walk_distance, every step orthogonal and adjacent.
##     Those properties are walkPath's; createWorld is the scaffolding that
##     produces a board with an exit on it. Here the same board comes from
##     generate_map + choose_exit + with_exit, which is exactly what
##     createWorld does to build it (commands.ts:236-255), so the assertions
##     port unchanged and only their scaffolding differs.
##
## PORTED by Task 2.E3a — DISCHARGING the three cases Task 2.D1 deferred to
## it, now that `sim/commands/movement.gd` ships create_world. Each one's
## SUBJECT is createWorld's item placement, not walk_path; walk_path is only
## the ruler they hold up to it, which is why there was nothing to substitute
## and they had to wait. They live at the bottom of this file, under their own
## describe heading, because this is their reference file:
##   "lays the keen edge on the path, eight steps of walking in, on every
##     seed" — needed createWorld and OPPONENT_MIN_DISTANCE.
##   "leaves the deep floors' detour economy alone" — needed createWorld at
##     depth 2 and its relic draw.
##   "keeps the provision off the path — the satchel still pays for scouting"
##     — needed createWorld's pantry.
##
## 2 + 3 = 5 ported, 0 deferred.
##
## The teaching floor's rule those three guard — depth 1's one relic stands ON
## the walked path, eight steps in, so a human who simply walks the floor meets
## its guard early and its prize on the way — now has its witness in sim/.


## The board createWorld builds, minus everything createWorld does that is not
## about the shape of the floor: cut the map, draw the exit, carve it in.
func _floor(seed: int) -> Dictionary:
	var built: Dictionary = SimMapgen.generate_map(seed, 0, 48, 32)
	var chosen: Dictionary = SimMapgen.choose_exit(
		seed, int(built["counterAfter"]), built["grid"], built["start"])
	return {
		"grid": SimMapgen.with_exit(built["grid"], chosen["exit"]),
		"start": built["start"],
		"exit": chosen["exit"],
	}


func test_walks_a_shortest_path_whose_length_is_the_walk_distance() -> void:
	var floor_3: Dictionary = _floor(3)
	var grid: Dictionary = floor_3["grid"]
	var start: Dictionary = floor_3["start"]
	var exit: Dictionary = floor_3["exit"]
	var path: Array = SimMapgen.walk_path(grid, start, exit)

	assert_gt(path.size(), 1, "the way out is not underfoot")
	assert_eq(path[0], {"x": int(start["x"]), "y": int(start["y"])}, "root-first")
	assert_eq(float(path.size() - 1), SimMapgen.walk_distance(grid, start, exit),
		"a shortest path is exactly the walk distance long")
	assert_eq(path[path.size() - 1], {"x": int(exit["x"]), "y": int(exit["y"])},
		"and inclusive of the far end")
	# Every step is a step: orthogonal, adjacent.
	for i in range(1, path.size()):
		var here: Dictionary = path[i]
		var back: Dictionary = path[i - 1]
		var dx: int = absi(int(here["x"]) - int(back["x"]))
		var dy: int = absi(int(here["y"]) - int(back["y"]))
		assert_eq(dx + dy, 1, "step %d is not a step" % i)


func test_returns_nothing_when_there_is_no_walk_at_all() -> void:
	var walled: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR])
	assert_eq(SimMapgen.walk_path(walled, {"x": 0, "y": 0}, {"x": 2, "y": 0}), [])


# ── no TS counterpart ────────────────────────────────────────────────────

func test_a_walk_to_where_you_already_stand_is_the_tile_you_stand_on() -> void:
	## The reference reaches its "found" flag only by STEPPING onto the
	## target, so from == to never sets it — and the guard that lets that case
	## through anyway (`!found && !(from.x === to.x && from.y === to.y)`) is a
	## branch no TS case exercises. Drop half of it and this returns [] where
	## the reference returns a one-tile road, which would read downstream as
	## "there is no way from here to here".
	var grid: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR])
	assert_eq(SimMapgen.walk_path(grid, {"x": 1, "y": 0}, {"x": 1, "y": 0}),
		[{"x": 1, "y": 0}])


func test_the_road_bends_east_before_it_bends_south() -> void:
	## The neighbour order is east, west, south, north — the hunt's order — and
	## the reference is explicit that it is load-bearing: "the road a floor is
	## judged by is the same road every replay judges." Wave E's createWorld
	## lays the teaching floor's relic ON that road at a fixed number of steps,
	## so a DIFFERENT shortest path is a different relic tile and a different
	## game from the same seed.
	##
	## Nothing else in this file can see that: every other assertion here is
	## about the road's LENGTH, and all four orders give shortest paths. So the
	## tie-break gets pinned where it can be worked out by hand — an open 3x3,
	## corner to corner, where east-first walks the top edge and south-first
	## would walk the left one.
	var open_board: Dictionary = SimGrid.make(3, 3, [
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
	])
	assert_eq(SimMapgen.walk_path(open_board, {"x": 0, "y": 0}, {"x": 2, "y": 2}), [
		{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 2, "y": 0},
		{"x": 2, "y": 1}, {"x": 2, "y": 2},
	])


func test_the_road_is_the_same_road_on_every_seed_it_is_asked_for() -> void:
	## The three deferred cases all sweep seeds; this keeps a sweep in the file
	## so a walk_path that worked on one hand-picked board and not on real ones
	## is caught before Task 2.E3 arrives to notice.
	for seed in range(1, 21):
		var floor_n: Dictionary = _floor(seed)
		var grid: Dictionary = floor_n["grid"]
		var path: Array = SimMapgen.walk_path(grid, floor_n["start"], floor_n["exit"])
		assert_gt(path.size(), 1, "seed %d: no road to the way out" % seed)
		assert_eq(float(path.size() - 1),
			SimMapgen.walk_distance(grid, floor_n["start"], floor_n["exit"]),
			"seed %d: the road is not the shortest one" % seed)
		for i in range(1, path.size()):
			var here: Dictionary = path[i]
			var back: Dictionary = path[i - 1]
			assert_eq(
				absi(int(here["x"]) - int(back["x"])) + absi(int(here["y"]) - int(back["y"])),
				1, "seed %d: step %d is not a step" % [seed, i])
			assert_true(SimGrid.is_passable(grid, int(here["x"]), int(here["y"])),
				"seed %d: step %d walks through a wall" % [seed, i])


# ── describe('the teaching floor reaches the player') ─────────────────────
# The three cases Task 2.D1 deferred to Task 2.E3a, DISCHARGED. Reference
# lines are tests/core/path-pull.test.ts:50, :66 and :81 at ts-baseline.

const _WIDTH := 48
const _HEIGHT := 32


## The world as create_world builds it, read back as a grid the way the TS
## helper's worldGrid() does.
func _world(seed: int, depth: int = 1) -> Dictionary:
	var payload: Dictionary = (SimCommands.create_world(
		seed, _WIDTH, _HEIGHT, "player", depth) as Dictionary)["payload"]
	var grid: Dictionary = SimGrid.make(
		int(payload["width"]), int(payload["height"]), payload["tiles"])
	var exit: Variant = null
	for y in range(int(grid["height"])):
		for x in range(int(grid["width"])):
			if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
				exit = {"x": x, "y": y}
				break
		if exit != null:
			break
	assert_not_null(exit, "seed %d depth %d has no exit" % [seed, depth])
	return {"payload": payload, "grid": grid, "exit": exit}


func _on_path(path: Array, at: Dictionary) -> bool:
	for t: Dictionary in path:
		if int(t["x"]) == int(at["x"]) and int(t["y"]) == int(at["y"]):
			return true
	return false


func test_lays_the_keen_edge_on_the_path_eight_steps_of_walking_in_on_every_seed() -> void:
	# The teaching floor reaches the player (the baseline-balance ruling):
	# depth 1's one relic — the fighter's whole early curve — stands ON the
	# walked path, eight steps in.
	#
	# The eight is spelled as the LITERAL 8, where the reference writes
	# OPPONENT_MIN_DISTANCE. A test that reads its expectation out of the
	# constant it guards moves both sides together and can never fail; this
	# migration has already measured that mistake once (Task 2.E2, AWARENESS).
	for seed in range(1, 21):
		var world: Dictionary = _world(seed)
		var payload: Dictionary = world["payload"]
		var player_pos: Dictionary = (payload["player"] as Dictionary)["pos"]
		var path: Array = SimMapgen.walk_path(world["grid"], player_pos, world["exit"])

		var edge: Variant = null
		for i: Dictionary in (payload["items"] as Array):
			if i["kind"] == "keen edge":
				edge = i
				break
		assert_not_null(edge, "seed %d: the teaching floor owes a keen edge" % seed)
		var edge_pos: Dictionary = (edge as Dictionary)["pos"]

		var at: int = mini(8, path.size() - 2)
		assert_eq(edge_pos,
			{"x": int((path[at] as Dictionary)["x"]), "y": int((path[at] as Dictionary)["y"])},
			"seed %d: the edge is not %d steps along the road" % [seed, at])
		# Its guard stands on it — the fight is on the road too.
		var guarded := false
		for o: Dictionary in (payload["opponents"] as Array):
			var pos: Dictionary = o["pos"]
			if int(pos["x"]) == int(edge_pos["x"]) and int(pos["y"]) == int(edge_pos["y"]):
				guarded = true
				break
		assert_true(guarded, "seed %d: the edge lies unguarded" % seed)


func test_leaves_the_deep_floors_detour_economy_alone() -> void:
	# Depth 2+ relics stay where the draws put them: across seeds, at least one
	# first relic lies OFF the path — the pull is the teaching floor's rule,
	# not the game's.
	var off_path := 0
	for seed in range(1, 11):
		var world: Dictionary = _world(seed, 2)
		var payload: Dictionary = world["payload"]
		var player_pos: Dictionary = (payload["player"] as Dictionary)["pos"]
		var path: Array = SimMapgen.walk_path(world["grid"], player_pos, world["exit"])
		var first: Dictionary = (payload["items"] as Array)[0]
		if not _on_path(path, first["pos"]):
			off_path += 1
	assert_gt(off_path, 0, "every depth-2 first relic landed on the road")


func test_keeps_the_provision_off_the_path() -> void:
	# The satchel still pays for scouting: a guarded consumable would just be
	# another relic, and an on-path one is not a detour, it is a toll both
	# already collected.
	var off := 0
	for seed in range(1, 11):
		var world: Dictionary = _world(seed)
		var payload: Dictionary = world["payload"]
		var player_pos: Dictionary = (payload["player"] as Dictionary)["pos"]
		var path: Array = SimMapgen.walk_path(world["grid"], player_pos, world["exit"])
		var provision: Variant = null
		for i: Dictionary in (payload["items"] as Array):
			if i["kind"] != "keen edge":
				provision = i
				break
		assert_not_null(provision, "seed %d: the floor owes a provision" % seed)
		if not _on_path(path, (provision as Dictionary)["pos"]):
			off += 1
	# More than five of ten, the reference's own threshold — a provision that
	# happens to fall on the road now and then is fine; one that always does
	# would mean the pantry had been pulled onto the path too.
	assert_gt(off, 5, "the pantry has been pulled onto the road")
