extends GutTest
## The honest line — the byte-twin of tests/core/sight.test.ts. One test per
## TS `it(...)`, in the TS file's order, so the two suites can be diffed by
## eye. Both TS `describe` blocks are ported; nothing is deferred (see
## sight.gd's own header reconciliation).


## Rows of '#' (wall), '.' (floor), 's' (secret) — tests read like maps.
func _grid(rows: Array[String]) -> Dictionary:
	var tiles: Array = []
	for row: String in rows:
		for c: String in row:
			if c == "#":
				tiles.append(SimGrid.WALL)
			elif c == "s":
				tiles.append(SimGrid.SECRET)
			else:
				tiles.append(SimGrid.FLOOR)
	var width: int = (rows[0] as String).length()
	return SimGrid.make(width, rows.size(), tiles)


func _body(id: String, x: int, y: int, hp: int = 3) -> Dictionary:
	return {
		"id": id,
		"kind": "thing",
		"pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 2, "wits": 1, "speed": 2},
		"tags": [],
		"maxHp": 3,
	}


## The shared 7x5 open floor the TS file builds once at module scope.
## Rebuilt fresh per call rather than cached — see test_grid.gd's `_grid()`
## for why that is safe (immutable data, no GUT lifecycle dependency).
func _open() -> Dictionary:
	var rows: Array[String] = [
		".......",
		".......",
		".......",
		".......",
		".......",
	]
	return _grid(rows)


# ── the reach disc — the fog's own circle ───────────────────────────────────


func test_holds_the_straight_edge_and_refuses_past_it() -> void:
	assert_true(SimSight.within_reach({"x": 0, "y": 0}, {"x": 5, "y": 0}, 5))   # 25 <= 30
	assert_false(SimSight.within_reach({"x": 0, "y": 0}, {"x": 6, "y": 0}, 5))  # 36 > 30


func test_rounds_the_diagonal_the_way_sight_does() -> void:
	assert_true(SimSight.within_reach({"x": 0, "y": 0}, {"x": 5, "y": 2}, 5))   # 29 <= 30
	assert_false(SimSight.within_reach({"x": 0, "y": 0}, {"x": 4, "y": 4}, 5))  # 32 > 30


# ── the honest line — covenant M7 ───────────────────────────────────────────


func test_flies_clear_over_open_floor_and_the_same_both_ways() -> void:
	var open: Dictionary = _open()
	assert_true(SimSight.clear_shot(open, [], {"x": 0, "y": 0}, {"x": 6, "y": 2}))
	assert_true(SimSight.clear_shot(open, [], {"x": 6, "y": 2}, {"x": 0, "y": 0}))


func test_is_stopped_by_a_wall_square_the_line_crosses() -> void:
	var walled: Dictionary = _grid([
		".......",
		".......",
		"...#...",
		".......",
		".......",
	])
	assert_false(SimSight.clear_shot(walled, [], {"x": 0, "y": 2}, {"x": 6, "y": 2}))
	assert_false(SimSight.clear_shot(walled, [], {"x": 6, "y": 2}, {"x": 0, "y": 2}))


func test_is_stopped_by_a_secret_the_illusion_is_real_enough_to_stop_a_stone_both_ways() -> void:
	var secret: Dictionary = _grid([
		".......",
		".......",
		"...s...",
		".......",
		".......",
	])
	assert_false(SimSight.clear_shot(secret, [], {"x": 0, "y": 2}, {"x": 6, "y": 2}))
	assert_false(SimSight.clear_shot(secret, [], {"x": 6, "y": 2}, {"x": 0, "y": 2}))


func test_is_stopped_by_a_living_body_between_never_by_the_dead_never_by_the_ends() -> void:
	var open: Dictionary = _open()
	var between: Dictionary = _body("b", 3, 2)
	assert_false(SimSight.clear_shot(open, [between], {"x": 0, "y": 2}, {"x": 6, "y": 2}))
	assert_true(SimSight.clear_shot(open, [_body("b", 3, 2, 0)], {"x": 0, "y": 2}, {"x": 6, "y": 2}))
	# attacker and target stand on their own tiles without blocking the shot
	var ends: Array = [_body("a", 0, 2), _body("t", 6, 2)]
	assert_true(SimSight.clear_shot(open, ends, {"x": 0, "y": 2}, {"x": 6, "y": 2}))


func test_slips_a_single_corner_but_never_two_walls_kissing() -> void:
	# The diagonal from (0,2) to (2,0) crosses exactly two lattice corners:
	# first between cells (1,2) and (0,1), then between (2,1) and (1,0).
	var one_wall: Dictionary = _grid([
		"...",
		"#..",
		"...",
	])
	# (0,2) -> (2,0): corner at the lattice point between (0,1) and (1,2),
	# then between (1,0) and (2,1). Only (0,1) is wall — the shot slips by.
	assert_true(SimSight.clear_shot(one_wall, [], {"x": 0, "y": 2}, {"x": 2, "y": 0}))
	var kissing: Dictionary = _grid([
		"...",
		"#..",
		".#.",
	])
	# Now (0,1) and (1,2) both stand — two walls kissing stop the stone.
	assert_false(SimSight.clear_shot(kissing, [], {"x": 0, "y": 2}, {"x": 2, "y": 0}))
	assert_false(SimSight.clear_shot(kissing, [], {"x": 2, "y": 0}, {"x": 0, "y": 2}))


func test_never_lets_a_body_block_at_a_corner_it_merely_clips() -> void:
	# Same diagonal, a living body on (0,1): bodies block only where the line
	# truly crosses their tile, and a corner is not a crossing.
	var open3: Dictionary = _grid([
		"...",
		"...",
		"...",
	])
	assert_true(SimSight.clear_shot(open3, [_body("b", 0, 1)], {"x": 0, "y": 2}, {"x": 2, "y": 0}))
