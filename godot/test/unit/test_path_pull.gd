extends GutTest
## walk_path — the road, root-first. The byte-twin of tests/core/path-pull.test.ts
## (5 cases): 2 ported, 3 deferred.
##
## ── The reconciliation ──────────────────────────────────────────────────
## PORTED
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
## DEFERRED to Task 2.E3a (`commands/movement.gd`, which ships create_world)
## — each one's SUBJECT is
## createWorld's item placement, not walk_path. walk_path is the ruler they
## hold up to it, and there is nothing here to substitute:
##   "lays the keen edge on the path, eight steps of walking in, on every
##     seed" — needs createWorld and OPPONENT_MIN_DISTANCE.
##   "leaves the deep floors' detour economy alone" — needs createWorld at
##     depth 2 and its relic draw.
##   "keeps the provision off the path — the satchel still pays for scouting"
##     — needs createWorld's pantry.
##
## 2 ported + 3 deferred = 5.
##
## The teaching floor's rule those three guard (depth 1's one relic stands ON
## the walked path, eight steps in, so a human who simply walks the floor meets
## its guard early and its prize on the way) is untested anywhere in sim/ until
## Task 2.E3a lands them.


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
