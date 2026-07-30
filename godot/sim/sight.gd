class_name SimSight
## The honest line — covenant M7's geometry, the byte-twin of src/core/sight.ts
## (71 lines, both exports ported whole; no deferrals — see the file-header
## reconciliation below).
##
## In core because a shot is mechanics. The fog (a stage-side concern, not
## sim's) answers "what does the player see"; this answers "what can a stone
## cross", and the two are allowed to disagree at their edges: sight is
## presentation, the line is law. `within_reach` and `clear_shot` feed
## decide() (Wave E), whose choices become recorded events on the chain, so a
## line-of-sight rule that differs on a single boundary tile is not a
## cosmetic bug — it is a different game. Ported verbatim: the reference's
## own integer supercover, not AStarGrid2D or any other Godot line helper
## (spec §3 forbids AStarGrid2D in sim/ outright).
##
## ── Reconciliation ────────────────────────────────────────────────────────
## sight.ts:16  withinReach  -> within_reach   (below)
## sight.ts:35  clearShot    -> clear_shot     (below), plus two private
##              helpers lifted out of clearShot's own closures (GDScript
##              static methods cannot nest a named closure over `grid` and
##              `entities` as cleanly as a TS arrow function can, so `solid`
##              and `stands` become _solid/_stands taking those as
##              parameters instead — behaviourally identical, nothing lost).
## Both reference functions are PORTED. Nothing in this file is DEFERRED.


## The reach disc, exactly the circle the fog draws: dx²+dy² ≤ r²+r. One
## rounding rule for every circle in the game, so a ring the renderer shows is
## a ring the dice agree with. This is NOT a radius comparison — the "+ r"
## slack is deliberate in the reference — so it is ported as the inequality
## itself, not as anything that merely looks equivalent at small radii.
static func within_reach(from: Dictionary, to: Dictionary, radius: int) -> bool:
	var from_x: int = from["x"]
	var from_y: int = from["y"]
	var to_x: int = to["x"]
	var to_y: int = to["y"]
	var dx: int = to_x - from_x
	var dy: int = to_y - from_y
	return dx * dx + dy * dy <= radius * radius + radius


## Whether (x, y) is solid to a shot: a wall, or a secret door. An illusory
## wall is real enough to stop a stone in both directions, so geometry never
## leaks the secret to anyone reading clear_shot's answer. tile_at already
## reads out of bounds as WALL, so no bounds check is needed here.
static func _solid(grid: Dictionary, x: int, y: int) -> bool:
	var t: int = SimGrid.tile_at(grid, x, y)
	return t == SimGrid.WALL or t == SimGrid.SECRET


## Whether a living body occupies (x, y) — other than at the archer's or the
## mark's OWN tile, checked positionally (not by id) exactly as the reference
## does. The end tiles never block: the archer and the mark stand on them
## without stopping their own shot.
static func _stands(entities: Array, from: Dictionary, to: Dictionary, x: int, y: int) -> bool:
	var from_x: int = from["x"]
	var from_y: int = from["y"]
	var to_x: int = to["x"]
	var to_y: int = to["y"]
	for e: Dictionary in entities:
		if not SimEntity.is_alive(e):
			continue
		var pos: Dictionary = e["pos"]
		var ex: int = pos["x"]
		var ey: int = pos["y"]
		if ex == x and ey == y and not (x == from_x and y == from_y) and not (x == to_x and y == to_y):
			return true
	return false


## Whether a straight shot from `from` to `to` flies clear.
##
## An integer supercover walk, center to center, symmetric by construction
## (the walk from B to A visits the same cells). Walls and secrets stop it.
## Living bodies stop it where the line truly crosses their tile: no shooting
## through your enemies, theirs or ours, which is what makes a corridor
## single-file into cover. A corner crossed exactly blocks only when BOTH
## flanking cells are solid — two walls kissing stop the shot; a body never
## blocks at a corner it merely clips (the corner test below checks _solid
## only, never _stands, on purpose). The end tiles never block: the archer
## and the mark stand on them.
static func clear_shot(grid: Dictionary, entities: Array, from: Dictionary, to: Dictionary) -> bool:
	var from_x: int = from["x"]
	var from_y: int = from["y"]
	var to_x: int = to["x"]
	var to_y: int = to["y"]

	var dx: int = absi(to_x - from_x)
	var dy: int = absi(to_y - from_y)
	var sx: int = _step_sign(to_x - from_x)
	var sy: int = _step_sign(to_y - from_y)

	# Crossing times, scaled to integers: the k-th x-boundary is crossed at
	# (2k+1)*dy of 2*dx*dy, the j-th y-boundary at (2j+1)*dx. Comparing the
	# scaled pair walks the exact segment with no floats to round. INF below
	# is only a loop-local "no more boundaries of this kind" sentinel for the
	# axis already exhausted — the same INF-as-TS-Infinity trick SimInterpret
	# uses for its own distances, not part of any hashed state.
	var x: int = from_x
	var y: int = from_y
	var i: int = 0
	var j: int = 0
	while i < dx or j < dy:
		var t_x: float = INF
		if i < dx:
			t_x = float((2 * i + 1) * dy)
		var t_y: float = INF
		if j < dy:
			t_y = float((2 * j + 1) * dx)
		if t_x == t_y:
			if _solid(grid, x + sx, y) and _solid(grid, x, y + sy):
				return false
			x += sx
			y += sy
			i += 1
			j += 1
		elif t_x < t_y:
			x += sx
			i += 1
		else:
			y += sy
			j += 1
		if x == to_x and y == to_y:
			break
		if _solid(grid, x, y) or _stands(entities, from, to, x, y):
			return false
	return true


## Math.sign, spelled out: -1, 0 or 1. Written as its own helper rather than
## trusting GDScript's polymorphic built-in `sign()` to resolve to the
## int-returning overload — this project runs under two Godot minors
## (4.7.1 CLI and Xogot's embedded 4.6.2), and the step direction feeds
## integer tile arithmetic, so it must never come back a float.
static func _step_sign(n: int) -> int:
	if n > 0:
		return 1
	if n < 0:
		return -1
	return 0
