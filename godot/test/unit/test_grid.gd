extends GutTest
## The playfield's fixed geometry — the byte-twin of tests/core/grid.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye. The final test has no TS counterpart: it pins the exact key
## set of the Dictionary shape, because GameState.grid is hashed and an extra
## key here would fork the chain without any TS test ever noticing.

const TILES := [
	SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL,
	SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR,
]


## The shared 3x2 fixture the TS file builds once at module scope. Rebuilt
## fresh per test rather than cached on the instance: the grid is immutable
## data, so recomputing it is behaviourally identical and does not depend on
## GUT's script-instantiation lifecycle.
func _grid() -> Dictionary:
	return SimGrid.make(3, 2, TILES)


func test_rejects_a_tile_count_that_does_not_match_the_dimensions() -> void:
	SimGrid.make(3, 2, [SimGrid.FLOOR])
	assert_engine_error("expected 6 tiles")


func test_rejects_non_positive_dimensions() -> void:
	SimGrid.make(0, 4, [])
	assert_engine_error("bad size")


func test_copies_the_tiles_so_later_mutation_of_the_input_cannot_leak_in() -> void:
	var input: Array = [SimGrid.FLOOR, SimGrid.FLOOR]
	var g: Dictionary = SimGrid.make(2, 1, input)
	input[0] = SimGrid.WALL
	assert_eq(SimGrid.tile_at(g, 0, 0), SimGrid.FLOOR)


func test_freezes_what_it_returns_so_a_shared_grid_cannot_be_written_through() -> void:
	## readonly typing stops nothing at runtime; a cast or JSON-sourced data
	## writes straight through it. EMPTY_STATE.grid is shared by every fold.
	var g: Dictionary = SimGrid.make(2, 1, [SimGrid.FLOOR, SimGrid.FLOOR])
	assert_true(g.is_read_only(), "the grid itself is frozen")
	assert_true((g["tiles"] as Array).is_read_only(), "and so are its tiles")


func test_idx_maps_coordinates_row_major() -> void:
	var grid := _grid()
	assert_eq(SimGrid.idx(grid, 0, 0), 0)
	assert_eq(SimGrid.idx(grid, 2, 0), 2)
	assert_eq(SimGrid.idx(grid, 0, 1), 3)
	assert_eq(SimGrid.idx(grid, 2, 1), 5)


func test_in_bounds_accepts_inside_and_rejects_outside() -> void:
	var grid := _grid()
	assert_true(SimGrid.in_bounds(grid, 0, 0))
	assert_true(SimGrid.in_bounds(grid, 2, 1))
	assert_false(SimGrid.in_bounds(grid, -1, 0))
	assert_false(SimGrid.in_bounds(grid, 3, 0))
	assert_false(SimGrid.in_bounds(grid, 0, 2))


func test_tile_at_reads_the_stored_tile() -> void:
	var grid := _grid()
	assert_eq(SimGrid.tile_at(grid, 1, 0), SimGrid.FLOOR)
	assert_eq(SimGrid.tile_at(grid, 2, 0), SimGrid.WALL)


func test_tile_at_treats_everything_outside_the_grid_as_solid() -> void:
	var grid := _grid()
	assert_eq(SimGrid.tile_at(grid, -1, 0), SimGrid.WALL)
	assert_eq(SimGrid.tile_at(grid, 99, 99), SimGrid.WALL)


func test_is_passable_is_true_only_for_floor_inside_the_grid() -> void:
	var grid := _grid()
	assert_true(SimGrid.is_passable(grid, 0, 0))
	assert_false(SimGrid.is_passable(grid, 1, 1))
	assert_false(SimGrid.is_passable(grid, -1, -1))


func test_grid_is_the_three_hashed_keys_and_nothing_else() -> void:
	var g := SimGrid.make(2, 1, [SimGrid.FLOOR, SimGrid.WALL])
	var keys: Array = g.keys()
	keys.sort()
	assert_eq(keys, ["height", "tiles", "width"], "GameState.grid is hashed; extra keys fork the chain")
