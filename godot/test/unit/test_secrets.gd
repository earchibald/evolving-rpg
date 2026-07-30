extends GutTest
## Secret passages: illusory walls — the byte-twin of tests/core/secrets.test.ts
## (10 cases across six describe blocks). This is the first reference-suite
## witness `SimMapgen.seal_secret_room` and `repair_with_secret` (mapgen.gd,
## Task 2.D1) have had anywhere in sim/: they landed in Wave D without it,
## because the plan assigned secrets.test.ts to this task. Task 2.E3a has
## since shown create_world genuinely drives seal_secret_room's committing
## path (105 of 360 swept worlds, test_commands.gd), so the code is
## exercised — but until this file, its BEHAVIOUR was pinned only by the
## six-board fixture sweep's byte-for-byte hash, which proves a floor didn't
## change, never that any one of these properties holds.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## 10 = 7 PORTED + 3 DEFERRED. Line numbers are tests/core/secrets.test.ts at
## ts-baseline.
##
## describe('the tile itself') — 1, PORTED
##   :24  is passable — an illusory wall was always walkable
##
## describe('what the fog believes') — 3, all DEFERRED
##   :34  "occludes like wall until trodden"
##   :42  "never occludes again once trodden"
##   :49  "reveals through play: walk into the wall that is not one, and the
##        far side opens"
##   All three call `visibleFrom` (and the third also `playerStep`), both
##   from src/ui/fov.ts — a module its OWN docstring calls "Deliberately in
##   ui/, not core/" (fov.ts:16-21: "Sight is presentation... nothing here
##   touches an event or a draw"). This is not this task's judgment call:
##   sight.gd's own header (Task 2.D3, already reviewed and merged) draws the
##   identical line for a different function — "The fog (a stage-side
##   concern, not sim's) answers 'what does the player see'; this answers
##   'what can a stone cross'". fov.ts and src/play/session.ts (playerStep)
##   are both named as inputs to Task 3.0 in the master plan
##   (docs/superpowers/plans/2026-07-29-godot-migration-master-plan.md:750);
##   Phase 3 (the stage) owns them, and no godot/stage/ exists yet to hold
##   them. Nothing about the three deferred cases is a property of
##   seal_secret_room or repair_with_secret — they are properties of the fog,
##   which is presentation by the reference's own design.
##
## describe('what creatures believe') — 1, PORTED
##   :76  nothing — they path straight through a secret door
##
## describe('sealed rooms, generated') — 1, PORTED
##   :114 seals some floors, not most; never strands the way out; truth
##        stays whole
##
## describe('what may keep itself secret') — 2, both PORTED
##   :163 refuses a room merged into its neighbor — there is no wall to hide
##        behind
##   :173 seals a walled room at its narrow door, and nowhere else
##
## describe('the repair rule') — 2, both PORTED
##   :187 cuts a hidden way into a truly stranded chamber
##   :205 touches nothing on a whole floor
##
## 1 + 1 + 1 + 2 + 2 = 7 ported. 3 deferred. 7 + 3 = 10.
##
## What this file now PROVES about the two Wave D functions: seal_secret_room
## refuses a merged room with no wall to hide behind (:163), seals a genuinely
## walled room at exactly its one door and nowhere else (:173), never strands
## the way out or any walkable tile across 40 generated seeds while sealing
## roughly one floor in three (:114); repair_with_secret cuts exactly one
## passage into a hand-built stranded chamber and reconnects it completely
## (:187), and touches nothing at all on a floor that was never broken (:205).
## Those five properties were previously witnessed only by six committed
## fixture hashes matching byte for byte — which proves a floor is the SAME
## floor it always was, never that any of these five rules is the one holding
## it together.


# ── describe('the tile itself') ───────────────────────────────────────────

func test_is_passable_an_illusory_wall_was_always_walkable() -> void:
	var g: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.SECRET, SimGrid.FLOOR])
	assert_true(SimGrid.is_passable(g, 1, 0))


# ── describe('what the fog believes') ─────────────────────────────────────
# :34, :42, :49 — DEFERRED. See the file header's reconciliation.


# ── describe('what creatures believe') ────────────────────────────────────

func test_nothing_they_path_straight_through_a_secret_door() -> void:
	# A wall bars the row except one SECRET tile; the quarry stands beyond.
	# The creature must set off toward the door it was never fooled by.
	var width := 12
	var height := 3
	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.FLOOR)
	for y in range(height):
		tiles[y * width + 6] = SimGrid.WALL
	tiles[1 * width + 6] = SimGrid.SECRET
	var beast: Dictionary = {
		"id": "thing-1", "kind": "thing", "pos": {"x": 4, "y": 1},
		"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 3}, "tags": [], "maxHp": 5,
	}
	var you: Dictionary = {
		"id": "player", "kind": "you", "pos": {"x": 8, "y": 1},
		"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 10,
	}
	var state: Dictionary = SimState.empty()
	state["grid"] = SimGrid.make(width, height, tiles)
	state["entities"] = [beast, you]
	state["turn"] = 1
	state["activeEntityId"] = "thing-1"
	state["seed"] = 7
	state["depth"] = 1
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 1, "dy": 0})


# ── describe('sealed rooms, generated') ───────────────────────────────────

## The honest flood: what a player who knows no secrets can walk to. A
## SECRET tile is WALL to this walk on purpose — this is the reference's own
## test-local floodHonest, not any function in sim/, because "what an honest
## player can reach" is a property nothing in production needs to compute.
func _flood_honest(grid: Dictionary, sx: int, sy: int) -> Dictionary:
	var seen: Dictionary = {SimGrid.idx(grid, sx, sy): true}
	var stack: Array = [[sx, sy]]
	while not stack.is_empty():
		var cur: Array = stack.pop_back()
		var cx: int = cur[0]
		var cy: int = cur[1]
		for step: Array in [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]:
			var nx: int = step[0]
			var ny: int = step[1]
			var t: int = SimGrid.tile_at(grid, nx, ny)
			if t == SimGrid.WALL or t == SimGrid.SECRET:
				continue
			var i := SimGrid.idx(grid, nx, ny)
			if seen.has(i):
				continue
			seen[i] = true
			stack.append([nx, ny])
	return seen


func test_seals_some_floors_not_most_never_strands_the_way_out_truth_stays_whole() -> void:
	var sealed_count := 0
	for seed in range(1, 41):
		var draft: Dictionary = SimCommands.create_world(seed, 48, 32)
		var payload: Dictionary = draft["payload"]
		var tiles: Array = payload["tiles"]
		var grid: Dictionary = SimGrid.make(int(payload["width"]), int(payload["height"]), tiles)
		var start: Dictionary = (payload["player"] as Dictionary)["pos"]
		var exit_at: int = tiles.find(SimGrid.EXIT)
		var has_secrets: bool = tiles.has(SimGrid.SECRET)
		var story: String = str(payload.get("story", ""))
		if story.contains("keeps itself secret"):
			sealed_count += 1
			assert_true(has_secrets, "seed %d: sealed but no SECRET tile on the floor" % seed)

		# Whether sealed or not: the exit is reachable by someone who knows
		# no secrets, and every walkable tile is reachable by the truth.
		var honest: Dictionary = _flood_honest(grid, int(start["x"]), int(start["y"]))
		assert_true(honest.has(exit_at), "seed %d: the way out is stranded from the honest flood" % seed)
		var truth: Dictionary = SimReach.reachable_from(grid, int(start["x"]), int(start["y"]))
		for i in range(tiles.size()):
			if int(tiles[i]) != SimGrid.WALL:
				assert_true(truth.has(i), "seed %d: tile %d unreachable by the truth" % [seed, i])
	# Roughly one floor in three — the draw is 1-in-3 and some picks abort.
	assert_gte(sealed_count, 4)
	assert_lte(sealed_count, 20)


# ── describe('what may keep itself secret') ───────────────────────────────
# One floor, three rooms: A and B share an open edge (the generator lets
# rooms run together) and C stands apart behind a wall with one door.
#   y1  #........#...##
#   y3  #............##   <- the lone gap at (9,3) is C's door
# The 929-second run found floor 7 sealing a merged room: the whole shared
# edge became illusory wall, two "walls" of the neighbor were secrets.
const _ROWS: Array[String] = [
	"###############",
	"#........#...##",
	"#........#...##",
	"#............##",
	"#........#...##",
	"#........#...##",
	"###############",
]
const _ROOM_A := {"x": 1, "y": 1, "w": 4, "h": 5}
const _ROOM_B := {"x": 5, "y": 1, "w": 4, "h": 5}
const _ROOM_C := {"x": 10, "y": 1, "w": 3, "h": 5}
const _ROOMS_WIDTH := 15


func _rows_tiles() -> Array:
	var out: Array = []
	for row: String in _ROWS:
		for i in range(row.length()):
			out.append(SimGrid.WALL if row[i] == "#" else SimGrid.FLOOR)
	return out


func test_refuses_a_room_merged_into_its_neighbor_there_is_no_wall_to_hide_behind() -> void:
	var grid: Dictionary = SimGrid.make(_ROOMS_WIDTH, 7, _rows_tiles())
	# Start in C, exit in B: only A is eligible, and A's right edge is open
	# floor shared with B. Sealing it would turn B's own column into fake wall.
	var result: Dictionary = SimMapgen.seal_secret_room(
		7, 0, grid, [_ROOM_A, _ROOM_B, _ROOM_C], {"x": 11, "y": 2}, {"x": 7, "y": 4}, 1)
	assert_false(bool(result["sealed"]))
	assert_eq((result["grid"] as Dictionary)["tiles"], grid["tiles"])


func test_seals_a_walled_room_at_its_narrow_door_and_nowhere_else() -> void:
	var grid: Dictionary = SimGrid.make(_ROOMS_WIDTH, 7, _rows_tiles())
	# Start and exit in the merged blob: only C is eligible, and C is
	# honest — walls all around, one gap. That gap and only that gap
	# becomes secret.
	var result: Dictionary = SimMapgen.seal_secret_room(
		7, 0, grid, [_ROOM_A, _ROOM_B, _ROOM_C], {"x": 2, "y": 2}, {"x": 7, "y": 4}, 1)
	assert_true(bool(result["sealed"]))
	var after: Dictionary = result["grid"]
	assert_eq(SimGrid.tile_at(after, 9, 3), SimGrid.SECRET)
	var before_tiles: Array = grid["tiles"]
	var after_tiles: Array = after["tiles"]
	var changed: Array = []
	for i in range(after_tiles.size()):
		if int(after_tiles[i]) != int(before_tiles[i]):
			changed.append(int(after_tiles[i]))
	assert_eq(changed, [SimGrid.SECRET])


# ── describe('the repair rule') ───────────────────────────────────────────

func test_cuts_a_hidden_way_into_a_truly_stranded_chamber() -> void:
	# Two chambers, a solid bar between: the designer's case, hand-built.
	var width := 7
	var tiles: Array = [
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
		SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR,
	]
	var broken: Dictionary = SimGrid.make(width, 3, tiles)
	var result: Dictionary = SimMapgen.repair_with_secret(broken, {"x": 0, "y": 0})
	assert_eq(int(result["punched"]), 1)
	var grid: Dictionary = result["grid"]
	var truth: Dictionary = SimReach.reachable_from(grid, 0, 0)
	var grid_tiles: Array = grid["tiles"]
	for i in range(grid_tiles.size()):
		if int(grid_tiles[i]) != SimGrid.WALL:
			assert_true(truth.has(i), "tile %d unreachable after the repair" % i)
	var secret_count := 0
	for t: int in grid_tiles:
		if t == SimGrid.SECRET:
			secret_count += 1
	assert_eq(secret_count, 1)


func test_touches_nothing_on_a_whole_floor() -> void:
	var fine: Dictionary = SimGrid.make(3, 1, [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR])
	var result: Dictionary = SimMapgen.repair_with_secret(fine, {"x": 0, "y": 0})
	assert_eq(int(result["punched"]), 0)
	assert_eq((result["grid"] as Dictionary)["tiles"], fine["tiles"])
