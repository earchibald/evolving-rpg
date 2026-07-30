class_name SimReach
## Flood fill over passable tiles — the byte-twin of src/core/reachability.ts
## (34 lines, two exports). Reconciliation: 2 reference exports in, 2 ported
## out, 0 deferred — reachable_from (ts lines 5-28) and floor_count (ts lines
## 30-34).
##
## `reachable_from` returns a GDScript Dictionary standing in for the TS
## Set<number>: idx -> true, membership only — the "(a set)" in this task's
## interface sketch. Per the brief's own instruction, iteration order was
## checked against every consumer of the reference's Set before leaning on
## that being safe:
##   - src/core/mapgen.ts has three call sites. Two (generateMap's
##     connectivity guard, repairWithSecret's stranded-room check) read only
##     `.has(i)`. The third, pickSpawnPoints, DOES iterate the set — but its
##     own comment explains why that is still order-independent: "Set
##     iteration order is insertion order, which depends on the flood fill's
##     traversal — deterministic, but sort anyway so the choice never depends
##     on an implementation detail of reachableFrom." It sorts candidates by
##     (y, x) immediately after collecting them.
##   - tests/core/{secrets,mapgen}.test.ts and tests/play/session.test.ts all
##     read only `.has(i)` or `.size`.
## So iteration order never reaches a decision anywhere in the reference.
## This port still reproduces the reference's exact DFS mechanics — explicit
## stack, LIFO pop, neighbours generated east/west/south/north before each
## push — rather than resting on that finding, because a GDScript
## Dictionary's insertion-order iteration is observed behaviour here, not a
## documented contract the way JS Set's is, and a future consumer that
## iterates without sorting (unlike pickSpawnPoints) would silently inherit
## whatever order this function happens to produce.
##
## Neighbours are bounds-checked — via is_passable, which routes through
## tile_at's in_bounds check — BEFORE being keyed by idx (y*width+x), never
## the other way around. Not a hypothetical: NIGHTLOG records a LATENT HUNT
## BUG in ai.ts's firstStep (a different function; ai.gd is Wave E, not this
## file) that keyed an out-of-bounds neighbour before checking bounds, so a
## quarry standing at x=0 read as reachable one tile east of the map's edge.
## reachableFrom's own git history (one commit, ca66663, never touched since)
## shows it never carried that bug — is_passable is checked first from its
## very first line — but the ordering below is exactly what keeps it that
## way, so it stays explicit rather than surviving as an accident of the
## port. See test_a_neighbour_off_the_grid_edge_is_never_marked_reachable.
##
## One line of the reference is not reproduced on purpose: TS's
## `const current = stack.pop(); if (current === undefined) break;` guards a
## type (`Array.pop()` returns `T | undefined`), not a reachable branch — the
## enclosing `while (stack.length > 0)` already makes that pop always
## defined. GDScript's `pop_back()` has no such type to appease, so the
## no-op check is dropped rather than ported as dead code.


## Flood fill over passable tiles, 4-directional. Returns tile indices as an
## idx -> true Dictionary (the Set<number> stand-in).
static func reachable_from(grid: Dictionary, x: int, y: int) -> Dictionary:
	var seen: Dictionary = {}
	if not SimGrid.is_passable(grid, x, y):
		return seen

	var stack: Array = [[x, y]]
	seen[SimGrid.idx(grid, x, y)] = true

	while stack.size() > 0:
		var current: Array = stack.pop_back()
		var cx: int = current[0]
		var cy: int = current[1]
		var neighbours: Array = [
			[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
		]
		for n: Array in neighbours:
			var nx: int = n[0]
			var ny: int = n[1]
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var i := SimGrid.idx(grid, nx, ny)
			if seen.has(i):
				continue
			seen[i] = true
			stack.push_back([nx, ny])

	return seen


## Tiles that are exactly FLOOR — not EXIT, not SECRET, both walkable too.
static func floor_count(grid: Dictionary) -> int:
	var n := 0
	var tiles: Array = grid["tiles"]
	for t: int in tiles:
		if t == SimGrid.FLOOR:
			n += 1
	return n
