class_name SimGrid
## The playfield's fixed geometry: a flat, row-major tile array — the
## byte-twin of src/core/grid.ts.
##
## A grid is exactly the Dictionary {"width", "height", "tiles"} and nothing
## else, because GameState.grid is part of what gets hashed: an extra key
## here is bytes the reference never signed, and forks every chain that folds
## it (see test_grid_is_the_three_hashed_keys_and_nothing_else).

const FLOOR := 0
const WALL := 1
## The way out. Walkable like floor — it is a place, not an object, which is
## why it lives in the tiles rather than in a list of things.
const EXIT := 2
## An illusory wall: LOOKS like wall and blocks sight until the player has
## trodden it, but was always walkable — walking into it is how it is found.
## Mechanically floor, visually wall, and only the PLAY view is ever fooled:
## creatures and bots path by passability, so everything that lives here
## knows every secret door by construction.
const SECRET := 3


## Frozen as well as copied. EMPTY_STATE.grid is the one grid every fold in
## the process shares as its baseline, and Dictionary/Array mutability alone
## stops nothing at runtime — make_read_only() is what actually holds it.
static func make(width: int, height: int, tiles: Array) -> Dictionary:
	assert(width > 0 and height > 0, "make: bad size %dx%d" % [width, height])
	assert(tiles.size() == width * height,
		"make: expected %d tiles, got %d" % [width * height, tiles.size()])
	var frozen_tiles: Array = tiles.duplicate(true)
	frozen_tiles.make_read_only()
	var grid: Dictionary = {"width": width, "height": height, "tiles": frozen_tiles}
	grid.make_read_only()
	return grid


static func idx(grid: Dictionary, x: int, y: int) -> int:
	var width: int = grid["width"]
	return y * width + x


static func in_bounds(grid: Dictionary, x: int, y: int) -> bool:
	var width: int = grid["width"]
	var height: int = grid["height"]
	return x >= 0 and y >= 0 and x < width and y < height


## Outside the grid reads as solid, so callers never need a bounds check first.
static func tile_at(grid: Dictionary, x: int, y: int) -> int:
	if not in_bounds(grid, x, y):
		return WALL
	var tiles: Array = grid["tiles"]
	var i := idx(grid, x, y)
	# grid.tiles[idx] ?? WALL in the reference: a defence against a tiles
	# array shorter than width*height, which make() itself never produces but
	# a hand-built or JSON-sourced Dictionary could.
	if i < 0 or i >= tiles.size():
		return WALL
	var tile: int = tiles[i]
	return tile


## Anything that is not wall. Stated as a negative on purpose: every tile kind
## added from here — exit, and whatever comes after — is walkable unless it
## says otherwise, so a new kind cannot become accidentally impassable by
## nobody remembering to add it to a list.
static func is_passable(grid: Dictionary, x: int, y: int) -> bool:
	return tile_at(grid, x, y) != WALL
