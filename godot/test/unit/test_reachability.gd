extends GutTest
## Flood fill over passable tiles — the byte-twin of
## tests/core/reachability.test.ts. One test per TS `it(...)`, in the TS
## file's order, so the two suites can be diffed by eye: 5 of 5 ported (4
## under the reference's `describe('reachableFrom')`, 1 under
## `describe('floorCount')`).
##
## Three tests beyond the ported five, none with a TS counterpart:
##
## - test_reaches_every_floor_tile_by_index_not_just_the_right_count is Task
##   2.D2's Step 2 "total-connectivity mutation proof": the pattern every
##   actual consumer of reachableFrom in the reference leans on. Neither of
##   src/core/mapgen.ts's connectivity guards trusts the Set's size — both
##   walk every tile and check `.has(i)` — and so do
##   tests/core/{mapgen,secrets}.test.ts and tests/play/session.test.ts. A
##   mutation that reaches the right COUNT of tiles by the wrong PATH would
##   slip past a size-only check; this closes that gap directly on
##   reachable_from itself, since mapgen.gd (the actual consumer) is Task
##   2.D1, out of this file's scope.
## - test_a_neighbour_off_the_grid_edge_is_never_marked_reachable pins the
##   brief's Step 1 concern: NIGHTLOG records a LATENT HUNT BUG in ai.ts's
##   firstStep (a different function, Wave E, not this file) where an
##   out-of-bounds neighbour was keyed by idx BEFORE its passability was
##   checked, so a quarry at the map's edge read as reachable one tile past
##   it. reachable_from's own ordering (is_passable, then idx) is what
##   prevents the same bug here; this is the regression that proves it.
## - test_floor_count_does_not_count_exit_or_secret_tiles: the reference's
##   ported case only ever mixes FLOOR and WALL. A plausible `!= WALL`
##   rewrite of `== FLOOR` would still pass that case and fail only here,
##   now that the grid has four tile kinds instead of two.

const F := SimGrid.FLOOR
const W := SimGrid.WALL


## -- reachableFrom (tests/core/reachability.test.ts:4-34) --

func test_finds_the_whole_open_grid() -> void:
	var grid := SimGrid.make(3, 3, [
		F, F, F,
		F, F, F,
		F, F, F,
	])
	assert_eq(SimReach.reachable_from(grid, 1, 1).size(), 9)


func test_does_not_cross_a_full_wall_so_a_sealed_room_stays_sealed() -> void:
	# column x=1 is solid, splitting the grid in two
	var grid := SimGrid.make(3, 3, [
		F, W, F,
		F, W, F,
		F, W, F,
	])
	assert_eq(SimReach.reachable_from(grid, 0, 0).size(), 3)
	assert_eq(SimReach.reachable_from(grid, 2, 0).size(), 3)


func test_does_not_move_diagonally() -> void:
	# (0,0) and (1,1) touch only at a corner
	var grid := SimGrid.make(2, 2, [
		F, W,
		W, F,
	])
	assert_eq(SimReach.reachable_from(grid, 0, 0).size(), 1)


func test_returns_nothing_when_the_start_is_not_standable() -> void:
	var grid := SimGrid.make(2, 1, [W, F])
	assert_eq(SimReach.reachable_from(grid, 0, 0).size(), 0)


## -- floorCount (tests/core/reachability.test.ts:36-40) --

func test_counts_only_floor_tiles() -> void:
	var grid := SimGrid.make(2, 2, [F, W, F, F])
	assert_eq(SimReach.floor_count(grid), 3)


## -- beyond the ported suite --

func test_reaches_every_floor_tile_by_index_not_just_the_right_count() -> void:
	# Started at an INTERIOR tile (1,1), not a corner: with floor in all
	# four directions from the start, every one of the four is load-bearing
	# for full coverage. A corner start would let a dropped direction hide —
	# starting at (0,0) in a grid whose rows only go DOWN from there, "north"
	# is never needed regardless of whether it is implemented at all.
	var tiles := [
		F, F, F, F,
		F, F, F, F,
		F, F, F, F,
	]
	var grid := SimGrid.make(4, 3, tiles)
	var reachable := SimReach.reachable_from(grid, 1, 1)
	assert_eq(reachable.size(), tiles.size())
	for i in range(tiles.size()):
		assert_true(reachable.has(i), "tile %d must be reachable" % i)


func test_a_neighbour_off_the_grid_edge_is_never_marked_reachable() -> void:
	# A lone floor tile surrounded on all four sides by the grid's own edge
	# is the sharpest possible grid to catch this on: every neighbour is out
	# of bounds, so a single wrongly-keyed one inflates the result.
	var grid := SimGrid.make(1, 1, [F])
	var reachable := SimReach.reachable_from(grid, 0, 0)
	assert_eq(reachable.size(), 1, "only the start tile is on the grid at all")
	assert_true(reachable.has(0))


func test_floor_count_does_not_count_exit_or_secret_tiles() -> void:
	var grid := SimGrid.make(2, 2, [F, SimGrid.EXIT, SimGrid.SECRET, F])
	assert_eq(SimReach.floor_count(grid), 2)
