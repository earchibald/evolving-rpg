class_name SimMapgen
## Where a floor comes from — the byte-twin of src/core/mapgen.ts (632 lines).
##
## Rogue's rooms-and-passages, sized against Brogue's conventions, joined by a
## spanning tree and then looped on purpose. Every design note the reference
## carries about WHY the shape is this shape lives there; what is written here
## is what a port has to get right.
##
## ── The draw stream is the whole file ───────────────────────────────────
## Generation is a sequence of COUNTED draws against (seed, counter), and the
## counter is the contract: `counterAfter` is the number the caller threads
## into the next generator, so a port that spends one draw too few builds a
## different world from the same seed and every downstream decision — spawns,
## loot, the exit — diverges silently from there on.
##
## **A REJECTED draw still advances the counter.** An overlapping rectangle is
## thrown away and its four draws are spent anyway; a loop whose two endpoints
## come up equal is skipped and its two draws are spent anyway; a floor with no
## candidate in any exit band spends its second draw on nothing before falling
## back to the far anchor. The counter's job is to replay the sequence of
## DECISIONS, including the ones that came to nothing, so every `c += 1` below
## sits exactly where the reference puts it and nowhere else.
##
## The counts, stated so a divergence has something to be checked against:
##   generate_map, roomy   4 per placement attempt (kept or rejected)
##                       + 1 per room after the first (the spanning join)
##                       + 2 per wanted loop, +1 more when its ends differ
##                       + 1 for the start room
##   generate_map, chamber 2 (the start x, then the start y) — no room loop
##   choose_exit           EXACTLY 2, on every floor and every path out
##   seal_secret_room      0 when there are fewer than 3 rooms; else 1 for the
##                         odds roll, then 1 per attempt (up to 4)
##   pick_spawn_points     1 per point actually placed
##   walk_distances / farthest_from / walk_path / walk_distance / with_exit /
##   repair_with_secret    drawless — derived, never rolled
##
## Verified against godot/test/fixtures/mapgen.json: six recorded boards, tile
## for tile AND on counterAfter. See test_mapgen.gd's board sweep.
##
## ── Reference cases, reconciled ─────────────────────────────────────────
## tests/core/mapgen.test.ts (11): 11 ported, 0 deferred.
## tests/core/path-pull.test.ts (5): 5 ported, 0 deferred. Two landed with
##   this file (one with its world substituted, disclosed there); the other
##   three waited on Task 2.E3a's create_world — each of those three is ABOUT
##   where createWorld puts the relic and the provision; walk_path is the
##   ruler they hold up to it, not their subject. 2.E3a shipped, and all
##   three are DISCHARGED in test_path_pull.gd (:140+), whose own header now
##   reads 5 = 5 ported + 0 deferred.
## Adopted from Task 2.B3's deferral list (godot/test/unit/test_tables.gd
##   names mapgen.gd as their owner): 2 from tests/core/motifs.test.ts and 1
##   from tests/core/size.test.ts. All 3 ported here.
## Not this task's: tests/core/secrets.test.ts exercises seal_secret_room and
##   repair_with_secret, but the plan assigns that file to Task 2.E3c
##   (commands/hazards.gd), so the functions land here and their suite lands
##   there.
##
## ── One place this file departs from the interface sketch ───────────────
## `walk_distance` returns **float**, not int. The reference returns
## `Number.POSITIVE_INFINITY` for "no walk exists", commands.ts:619 branches on
## `Number.isFinite(walk)` to print "?" instead of a number, and no int
## sentinel can carry that distinction without inventing a magic value the
## reference never had. Every FINITE answer is an integral float, so the `<=`
## comparisons in ai.ts port unchanged and nothing fractional can reach
## SimCanonical (the result is rendered into a story string, never stored).
##
## ── Whose flood is whose ────────────────────────────────────────────────
## The three `SimReach.reachable_from` calls below are the reference's own
## `reachableFrom` imports from ./reachability.js — generate_map's connectivity
## self-check, pick_spawn_points' candidate set, and repair_with_secret's truth
## flood. That is Task 2.D2's file and it walks a SECRET like the floor it
## really is, which is what makes the third one work: a deliberately sealed
## room is already connected, so repair never punches it a redundant second
## door. `_flood_honest` further down is the deliberate opposite — the
## player's-eye view, where a secret is the wall it pretends to be — and the
## two must not be confused for one another.

## Boards too small to hold two separated rooms become one open chamber, so
## trial worlds and tiny test boards flow through the same generator as the
## real game rather than through a fossil kept alive for them. Judged against
## the smallest motif's rooms, motif-independent — a tiny board is a chamber
## whatever the depth.
const MIN_ROOMY_WIDTH := 3 * 2 + 5
const MIN_ROOMY_HEIGHT := 3 * 2 + 5

## Where the way out lies, in fractions of the floor's OWN longest walk — so
## the vale and the waste both get a long way and a close one in their own
## terms. Two counted draws buy the band and then the tile inside it, and the
## tile comes from ALL of the band's candidates, which is what breaks the
## corner habit: corners are where the longest walks end, not the middling
## ones.
##
## `maxSteps` is a ceiling in STEPS, not fractions, and is ABSENT on the two
## bands that do not want one — the reference reads it as `band.maxSteps ??
## reach`, so absent and "no ceiling" are the same statement. Read it with
## `.get("maxSteps", reach)`, never as a key that must exist.
const EXIT_BANDS: Array = [
	{"name": "the long way", "from": 0.8, "to": 1.0, "weight": 6},
	{"name": "the middle", "from": 0.45, "to": 0.8, "weight": 3},
	{"name": "close by", "from": 0.0, "to": 0.45, "weight": 1, "maxSteps": 25},
]

## No exit nearer than this many steps of walking. The stairs may be one room
## apart; they are never underfoot, and the teaching floor's baseline walk (the
## relic and its guard, eight steps in) needs a road to stand on.
const MIN_EXIT_WALK := 8

## The four neighbours, in the hunt's order — east, west, south, north. Fixed
## and shared by every walk in this file, because a BFS that visited them in a
## different order would still find shortest paths and would still tie-break
## differently, and the road a floor is judged by has to be the same road every
## replay judges.
const _STEPS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]


## Chooses where a world's inhabitants stand.
##
## Candidates are the tiles genuinely reachable from the start and at least
## `min_distance` away, so nothing is already breathing on you when the world
## opens and nothing is sealed somewhere you can never reach. Picking by index
## out of a SHRINKING list guarantees distinct tiles in exactly one draw each,
## rather than rejection-sampling an unbounded number of times.
##
## Returns fewer points than asked for rather than looping forever if the
## reachable area is too small — a cramped map is a reason to have fewer
## creatures in it, not a reason to hang.
##
## Returns {"points": Array of {"x","y"}, "counterAfter": int}.
static func pick_spawn_points(
	seed: int,
	counter: int,
	grid: Dictionary,
	start: Dictionary,
	count: int,
	min_distance: int,
) -> Dictionary:
	var width: int = grid["width"]
	var sx: int = start["x"]
	var sy: int = start["y"]
	var reachable: Dictionary = SimReach.reachable_from(grid, sx, sy)
	var candidates: Array = []

	for index: int in reachable:
		var x: int = index % width
		var y: int = floori(float(index) / float(width))
		if absi(x - sx) + absi(y - sy) >= min_distance:
			candidates.append({"x": x, "y": y})
	# The reference sorts even though its Set's iteration order is already
	# deterministic, so the choice never depends on an implementation detail of
	# reachableFrom. Here that matters more, not less: Dictionary key order is
	# insertion order in GDScript too, but nothing in the language promises it.
	# Every (x, y) is distinct, so this comparator is a strict total order and
	# the sort's stability cannot come into it.
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if int(a["y"]) != int(b["y"]):
			return int(a["y"]) < int(b["y"])
		return int(a["x"]) < int(b["x"]))

	var points: Array = []
	var c := counter

	var i := 0
	while i < count and not candidates.is_empty():
		var pick := SimRng.int_between(seed, c, 0, candidates.size() - 1)
		c += 1
		var chosen: Dictionary = candidates[pick]
		points.append(chosen)
		candidates.remove_at(pick)
		i += 1

	return {"points": points, "counterAfter": c}


## A room's centre. Integer division both ways, matching the reference's
## Math.floor on a non-negative quotient.
static func _center(r: Dictionary) -> Dictionary:
	return {
		"x": int(r["x"]) + floori(float(r["w"]) / 2.0),
		"y": int(r["y"]) + floori(float(r["h"]) / 2.0),
	}


## One tile of wall kept between rooms, so two rooms never merge by touching
## and every join is a corridor something chose to carve.
static func _overlaps_with_margin(a: Dictionary, b: Dictionary) -> bool:
	var ax: int = a["x"]
	var ay: int = a["y"]
	var aw: int = a["w"]
	var ah: int = a["h"]
	var bx: int = b["x"]
	var by: int = b["y"]
	var bw: int = b["w"]
	var bh: int = b["h"]
	return ax - 1 < bx + bw and ax + aw + 1 > bx \
		and ay - 1 < by + bh and ay + ah + 1 > by


static func _carve_room(tiles: Array, width: int, room: Dictionary) -> void:
	var rx: int = room["x"]
	var ry: int = room["y"]
	for y in range(ry, ry + int(room["h"])):
		for x in range(rx, rx + int(room["w"])):
			tiles[y * width + x] = SimGrid.FLOOR


## An L-shaped corridor between two interior points, one tile wide: the whole
## horizontal leg, then the whole vertical leg, or the other way round. Both
## ends are room centres, so the path never touches the border.
static func _carve_l(
	tiles: Array,
	width: int,
	from: Dictionary,
	to: Dictionary,
	horizontal_first: bool,
) -> void:
	var bend: Dictionary = {"x": int(to["x"]), "y": int(from["y"])} if horizontal_first \
		else {"x": int(from["x"]), "y": int(to["y"])}
	for leg: Array in [[from, bend], [bend, to]]:
		var a: Dictionary = leg[0]
		var b: Dictionary = leg[1]
		var x0: int = mini(int(a["x"]), int(b["x"]))
		var x1: int = maxi(int(a["x"]), int(b["x"]))
		var y0: int = mini(int(a["y"]), int(b["y"]))
		var y1: int = maxi(int(a["y"]), int(b["y"]))
		for y in range(y0, y1 + 1):
			for x in range(x0, x1 + 1):
				tiles[y * width + x] = SimGrid.FLOOR


## Rooms joined by corridors, with loops.
##
## Placement is rejection sampling: draw a rectangle, keep it if it fits with a
## one-tile margin, until the target count is met or the attempts run out.
## Every room then joins the NEAREST already-connected room — a spanning tree,
## so the whole map is connected by construction — and a few extra corridors go
## on top, because a tree makes every wrong turn a dead end you must walk back
## out of, and loops are what turn a chase into a choice.
##
## Boards below the rooms-and-corridors minimum become one open chamber, so
## every consumer — the real game, the assay's trial worlds, a 12x8 test board
## — flows through this one generator.
##
## Returns {"grid", "start", "rooms", "counterAfter", "story"} (MapGenResult,
## mapgen.ts:70). `motif` defaults to the door — the shape the game launched
## with — so every existing caller and test means exactly what it meant.
static func generate_map(
	seed: int,
	counter: int,
	width: int,
	height: int,
	motif: Dictionary = SimTables.MOTIFS["door"],
) -> Dictionary:
	var c := counter

	# The open-chamber degenerate: all interior floor inside a solid border.
	if width < MIN_ROOMY_WIDTH or height < MIN_ROOMY_HEIGHT:
		if width < 3 or height < 3:
			# The reference THROWS. GDScript's assert() unwinds exactly one
			# frame and hands the caller this function's default `{}`, and the
			# explicit return produces the SAME `{}` in a release build where
			# the assert does not exist — so debug and release refuse alike.
			# push_error rides alongside for exactly that reason: it survives
			# the strip, and an exported build that quietly handed back a
			# 2x2 "world" would be the loudest bug reported from the quietest
			# place. Same belt-and-braces as SimApply's unknown-event guard.
			push_error("generate_map: %dx%d cannot hold an interior" % [width, height])
			assert(false, "generate_map: %dx%d cannot hold an interior" % [width, height])
			return {}
		var chamber_tiles: Array = []
		chamber_tiles.resize(width * height)
		chamber_tiles.fill(SimGrid.WALL)
		var chamber: Dictionary = {"x": 1, "y": 1, "w": width - 2, "h": height - 2}
		_carve_room(chamber_tiles, width, chamber)
		var sx := SimRng.int_between(seed, c, 1, width - 2)
		c += 1
		var sy := SimRng.int_between(seed, c, 1, height - 2)
		c += 1
		return {
			"grid": SimGrid.make(width, height, chamber_tiles),
			"start": {"x": sx, "y": sy},
			"rooms": [chamber],
			"counterAfter": c,
			"story": "one open chamber",
		}

	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.WALL)

	# Rogue put ~9 rooms on 80x24 (one per ~210 tiles); Brogue runs denser. The
	# divisor is the motif's: the warren crowds, the halls breathe. The cap
	# scales with area (16 was tuned on 48x32; a fixed cap on a 4x board would
	# starve the motif and hand back a prairie with sixteen sheds) — floored at
	# 16 so every board the game launched with means what it meant, ceilinged
	# at 64 as the runaway guard.
	#
	# roundi is JS Math.round for every input this can see: the two disagree
	# only on negative halves, and both quotients here are of positive areas.
	var cap: int = mini(64, maxi(16, roundi(float(16 * width * height) / 1536.0)))
	var target: int = maxi(3, mini(cap,
		roundi(float(width * height) / float(motif["tilesPerRoom"]))))
	var rooms: Array = []

	var room_w: Array = motif["roomW"]
	var room_h: Array = motif["roomH"]
	var attempt := 0
	while attempt < target * 10 and rooms.size() < target:
		# Four draws, spent whether or not the rectangle survives the next
		# line. This is the rejected-draw rule in its purest form and the
		# single easiest place in the port to lose a draw.
		var w := SimRng.int_between(seed, c, int(room_w[0]), int(room_w[1]))
		c += 1
		var h := SimRng.int_between(seed, c, int(room_h[0]), int(room_h[1]))
		c += 1
		var x := SimRng.int_between(seed, c, 1, width - 1 - w)
		c += 1
		var y := SimRng.int_between(seed, c, 1, height - 1 - h)
		c += 1
		attempt += 1
		var candidate: Dictionary = {"x": x, "y": y, "w": w, "h": h}
		var clashes := false
		for r: Dictionary in rooms:
			if _overlaps_with_margin(candidate, r):
				clashes = true
				break
		if clashes:
			continue
		rooms.append(candidate)
		_carve_room(tiles, width, candidate)

	# A board that fits no second room is still a world: fall back to a chamber
	# rather than hand back an all-wall grid.
	if rooms.is_empty():
		var chamber: Dictionary = {"x": 1, "y": 1, "w": width - 2, "h": height - 2}
		_carve_room(tiles, width, chamber)
		rooms.append(chamber)

	# Spanning connection: each room joins the nearest room already connected.
	# Connectivity of the whole map follows by induction, not by luck.
	for i in range(1, rooms.size()):
		var here: Dictionary = _center(rooms[i])
		var nearest := 0
		var best := 0x7FFFFFFFFFFFFFFF
		for j in range(i):
			var there: Dictionary = _center(rooms[j])
			var d: int = absi(int(here["x"]) - int(there["x"])) \
				+ absi(int(here["y"]) - int(there["y"]))
			if d < best:
				best = d
				nearest = j
		var horizontal_first := SimRng.int_between(seed, c, 0, 1) == 0
		c += 1
		_carve_l(tiles, width, here, _center(rooms[nearest]), horizontal_first)

	# Loops. A pure tree means every wrong turn is walked twice; a cycle means a
	# route AROUND — flight has somewhere to go and a chase has two mouths. The
	# rate is the motif's: the warren loops hard, the halls barely.
	var loops := 0
	if rooms.size() >= 3:
		var wanted: int = maxi(1, floori(float(rooms.size()) / float(motif["loopPer"])))
		for i in range(wanted):
			var a := SimRng.int_between(seed, c, 0, rooms.size() - 1)
			c += 1
			var b := SimRng.int_between(seed, c, 0, rooms.size() - 1)
			c += 1
			# A loop from a room to itself is no loop. Its two draws are spent
			# regardless; only the THIRD draw — the bend — is skipped, so the
			# stream reads 2 here and 3 everywhere else.
			if a == b:
				continue
			var horizontal_first := SimRng.int_between(seed, c, 0, 1) == 0
			c += 1
			_carve_l(tiles, width, _center(rooms[a]), _center(rooms[b]), horizontal_first)
			loops += 1

	var start_room := SimRng.int_between(seed, c, 0, rooms.size() - 1)
	c += 1
	var start: Dictionary = _center(rooms[start_room])

	var grid: Dictionary = SimGrid.make(width, height, tiles)

	# By construction every carved tile is connected; this is the loud check
	# that the construction holds. A generator that could hand back a sealed
	# room would break covenant M5 silently, and silence is the failure mode.
	var reachable: Dictionary = SimReach.reachable_from(grid, int(start["x"]), int(start["y"]))
	for i in range(tiles.size()):
		if int(tiles[i]) == SimGrid.FLOOR and not reachable.has(i):
			var msg := "generate_map: sealed floor at %d,%d (seed %d)" % [
				i % width, floori(float(i) / float(width)), seed,
			]
			push_error(msg)
			assert(false, msg)
			return {}

	return {
		"grid": grid,
		"start": start,
		"rooms": rooms,
		"counterAfter": c,
		"story": "%d rooms, %d loop%s" % [rooms.size(), loops, "" if loops == 1 else "s"],
	}


## Every walkable tile's distance from the start, in steps of walking rather
## than straight-line — so "far" means far to walk, not far to look at. Keyed
## by tile index; the one flood fill every "how far is that" question here
## shares, so they cannot disagree about the shape of the floor.
##
## The start is seeded UNCONDITIONALLY, exactly as the reference does — a start
## standing in a wall still reads 0 from itself and still spreads to whatever
## passable tiles touch it. Ported as-is; the callers never do that.
static func walk_distances(grid: Dictionary, start: Dictionary) -> Dictionary:
	var width: int = grid["width"]
	var seen: Dictionary = {}
	# A read head instead of shift(): identical FIFO order, without the O(n)
	# re-shuffle Array.pop_front() pays on a 6144-tile board.
	var queue: Array = [{"x": int(start["x"]), "y": int(start["y"]), "d": 0}]
	var head := 0
	seen[int(start["y"]) * width + int(start["x"])] = 0

	while head < queue.size():
		var here: Dictionary = queue[head]
		head += 1
		var hx: int = here["x"]
		var hy: int = here["y"]
		var hd: int = here["d"]
		for step: Array in _STEPS:
			var nx: int = hx + int(step[0])
			var ny: int = hy + int(step[1])
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var key := ny * width + nx
			if seen.has(key):
				continue
			seen[key] = hd + 1
			queue.append({"x": nx, "y": ny, "d": hd + 1})

	return seen


## The tile indices of a walk, ascending. The reference spreads its Map into an
## array and sorts on the index, so both readers of that array — farthest_from
## and choose_exit — see the same fixed order whatever order the fill wrote it
## in. It is load-bearing for BOTH: the far anchor ties on lowest index, and
## the exit's candidate list is indexed by a counted draw.
static func _sorted_indices(distances: Dictionary) -> Array:
	var indices: Array = distances.keys()
	indices.sort()
	return indices


## The farthest walkable tile from the start. Ties break on tile index, which is
## deterministic and independent of traversal order.
##
## Draws nothing. This is the FAR ANCHOR — the bottom's heart lies here, and the
## exit's bands are measured against it — not, since the designer's ruling, the
## way out on an ordinary floor.
static func farthest_from(grid: Dictionary, start: Dictionary) -> Dictionary:
	var width: int = grid["width"]
	var distances: Dictionary = walk_distances(grid, start)
	var best: Dictionary = {"x": int(start["x"]), "y": int(start["y"])}
	var best_distance := -1
	for index: int in _sorted_indices(distances):
		var d: int = distances[index]
		if d <= best_distance:
			continue
		best = {"x": index % width, "y": floori(float(index) / float(width))}
		best_distance = d
	return best


## Where the way out lies — a band drawn from the floor's own reach, then a
## tile drawn from ALL of that band's candidates.
##
## EXACTLY TWO counted draws on every path through this function, including the
## one that finds no band at all: the fallback spends its second draw on
## nothing so the stream reads the same either way. Returns
## {"exit": {"x","y"}, "band": String, "counterAfter": int}.
static func choose_exit(
	seed: int,
	counter: int,
	grid: Dictionary,
	start: Dictionary,
) -> Dictionary:
	var c := counter
	var width: int = grid["width"]
	var distances: Dictionary = walk_distances(grid, start)
	var indices: Array = _sorted_indices(distances)
	var reach := 0
	for index: int in indices:
		reach = maxi(reach, int(distances[index]))

	var total := 0
	for band: Dictionary in EXIT_BANDS:
		total += int(band["weight"])
	var roll := SimRng.int_between(seed, c, 1, total)
	c += 1
	var chosen := 0
	for i in range(EXIT_BANDS.size()):
		roll -= int((EXIT_BANDS[i] as Dictionary)["weight"])
		if roll <= 0:
			chosen = i
			break

	# The chosen band first, then the others in declared order — longest way
	# out is the last resort, which is where a floor too small to hold a band
	# honestly ends up. Drawless: the fallback order is fixed.
	var order: Array = [chosen]
	for i in range(EXIT_BANDS.size()):
		if i != chosen:
			order.append(i)

	for i: int in order:
		var band: Dictionary = EXIT_BANDS[i]
		var lo: int = maxi(MIN_EXIT_WALK, ceili(float(band["from"]) * float(reach)))
		# Band 0's ceiling is the reach itself, not floor(1.0 * reach) — the
		# reference special-cases it, and on a floor whose reach is 0 the two
		# would agree anyway, so the case is kept for exactness rather than
		# because it is known to bite.
		var band_hi: int = reach if i == 0 else floori(float(band["to"]) * float(reach))
		var hi: int = mini(band_hi, int(band.get("maxSteps", reach)))
		var candidates: Array = []
		for index: int in indices:
			var d: int = distances[index]
			if d >= lo and d <= hi:
				candidates.append(index)
		if candidates.is_empty():
			continue
		var pick: int = candidates[SimRng.int_between(seed, c, 0, candidates.size() - 1)]
		c += 1
		return {
			"exit": {"x": pick % width, "y": floori(float(pick) / float(width))},
			"band": band["name"],
			"counterAfter": c,
		}

	# A floor with nothing eight steps away at all: the far anchor, and the
	# draw spent so the stream reads the same either way.
	c += 1
	return {"exit": farthest_from(grid, start), "band": "the long way", "counterAfter": c}


## A shortest walk between two tiles, root-first and inclusive of both ends, or
## [] when no walk exists. Fixed neighbour order (_STEPS), so the road a floor
## is judged by is the same road every replay judges. Drawless: a path is
## derived, never rolled.
static func walk_path(grid: Dictionary, from: Dictionary, to: Dictionary) -> Array:
	var width: int = grid["width"]
	var fx: int = from["x"]
	var fy: int = from["y"]
	var tx: int = to["x"]
	var ty: int = to["y"]
	var parent: Dictionary = {}
	var seen: Dictionary = {SimGrid.idx(grid, fx, fy): true}
	var queue: Array = [{"x": fx, "y": fy}]
	var head := 0
	var found := false
	while head < queue.size() and not found:
		var here: Dictionary = queue[head]
		head += 1
		var hx: int = here["x"]
		var hy: int = here["y"]
		for step: Array in _STEPS:
			var nx: int = hx + int(step[0])
			var ny: int = hy + int(step[1])
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var key := SimGrid.idx(grid, nx, ny)
			if seen.has(key):
				continue
			seen[key] = true
			parent[key] = SimGrid.idx(grid, hx, hy)
			if nx == tx and ny == ty:
				found = true
				break
			queue.append({"x": nx, "y": ny})
	# from == to is not "found", but it is a walk — the one-tile one.
	if not found and not (fx == tx and fy == ty):
		return []
	var path: Array = []
	var at := SimGrid.idx(grid, tx, ty)
	var home := SimGrid.idx(grid, fx, fy)
	while at != home:
		path.append({"x": at % width, "y": floori(float(at) / float(width))})
		if not parent.has(at):
			return []
		at = parent[at]
	path.append({"x": fx, "y": fy})
	path.reverse()
	return path


## How far the walk to a tile is, or INF if there is no walk at all.
##
## Float, not int, and deliberately: the reference answers
## Number.POSITIVE_INFINITY for the unreachable and its callers branch on
## isFinite. Every finite answer is integral, so `<=` against a leash reads the
## same as it does in TypeScript.
static func walk_distance(grid: Dictionary, from: Dictionary, to: Dictionary) -> float:
	var fx: int = from["x"]
	var fy: int = from["y"]
	var tx: int = to["x"]
	var ty: int = to["y"]
	var seen: Dictionary = {SimGrid.idx(grid, fx, fy): true}
	var queue: Array = [{"x": fx, "y": fy, "d": 0}]
	var head := 0
	while head < queue.size():
		var here: Dictionary = queue[head]
		head += 1
		var hx: int = here["x"]
		var hy: int = here["y"]
		var hd: int = here["d"]
		# Tested on DEQUEUE, not on enqueue — which is why walking from a tile
		# to itself is 0 even when that tile is a wall.
		if hx == tx and hy == ty:
			return float(hd)
		for step: Array in _STEPS:
			var nx: int = hx + int(step[0])
			var ny: int = hy + int(step[1])
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var key := SimGrid.idx(grid, nx, ny)
			if seen.has(key):
				continue
			seen[key] = true
			queue.append({"x": nx, "y": ny, "d": hd + 1})
	return INF


## Carves the way out into the tiles. The exit is a place, so it lives in the
## map. SimGrid.make hands back a FROZEN tiles array, so the copy is not
## defensive style — it is the only way to write one.
static func with_exit(grid: Dictionary, exit: Dictionary) -> Dictionary:
	var width: int = grid["width"]
	var tiles: Array = (grid["tiles"] as Array).duplicate()
	tiles[int(exit["y"]) * width + int(exit["x"])] = SimGrid.EXIT
	return SimGrid.make(width, int(grid["height"]), tiles)


## Flood fill that treats undiscovered secrets as the walls they pretend to be
## — the player's-eye reachability, as opposed to SimReach.reachable_from's truth.
static func _flood_honest(grid: Dictionary, start: Dictionary) -> Dictionary:
	var seen: Dictionary = {}
	var sx: int = start["x"]
	var sy: int = start["y"]
	if not _honest_passable(grid, sx, sy):
		return seen
	var stack: Array = [[sx, sy]]
	seen[SimGrid.idx(grid, sx, sy)] = true
	while not stack.is_empty():
		var current: Array = stack.pop_back()
		var cx: int = current[0]
		var cy: int = current[1]
		for step: Array in _STEPS:
			var nx: int = cx + int(step[0])
			var ny: int = cy + int(step[1])
			if not _honest_passable(grid, nx, ny):
				continue
			var i := SimGrid.idx(grid, nx, ny)
			if seen.has(i):
				continue
			seen[i] = true
			stack.push_back([nx, ny])
	return seen


static func _honest_passable(grid: Dictionary, x: int, y: int) -> bool:
	var t := SimGrid.tile_at(grid, x, y)
	return t != SimGrid.WALL and t != SimGrid.SECRET


## The walkable tiles in the one-tile band around a room, told apart: a `door`
## is a narrow gap — floor with wall on both shoulders, the shape a doorway
## actually has — while `open` counts band floor that is simply more room, the
## shared edge of rooms the generator let run together. Only doors can be
## sealed; painting SECRET across an open edge turns the neighbour's own floor
## into fake wall (found on floor 7 of the first voiced run, where two entire
## "walls" of a room were secrets). Corners sit diagonal — no 4-way step enters
## through one — so they are neither.
##
## Returns {"doors": Array of tile index, "open": int}.
static func _boundary_of(grid: Dictionary, room: Dictionary) -> Dictionary:
	var doors: Array = []
	var open := 0
	var rx: int = room["x"]
	var ry: int = room["y"]
	var rw: int = room["w"]
	var rh: int = room["h"]

	for x in range(rx, rx + rw):
		for y: int in [ry - 1, ry + rh]:
			if SimGrid.tile_at(grid, x, y) != SimGrid.FLOOR:
				continue
			if SimGrid.tile_at(grid, x - 1, y) != SimGrid.FLOOR \
				and SimGrid.tile_at(grid, x + 1, y) != SimGrid.FLOOR:
				doors.append(SimGrid.idx(grid, x, y))
			else:
				open += 1
	for y in range(ry, ry + rh):
		for x: int in [rx - 1, rx + rw]:
			if SimGrid.tile_at(grid, x, y) != SimGrid.FLOOR:
				continue
			if SimGrid.tile_at(grid, x, y - 1) != SimGrid.FLOOR \
				and SimGrid.tile_at(grid, x, y + 1) != SimGrid.FLOOR:
				doors.append(SimGrid.idx(grid, x, y))
			else:
				open += 1

	return {"doors": doors, "open": open}


static func _in_room(room: Dictionary, x: int, y: int) -> bool:
	var rx: int = room["x"]
	var ry: int = room["y"]
	return x >= rx and x < rx + int(room["w"]) and y >= ry and y < ry + int(room["h"])


## Sometimes, a room keeps itself secret.
##
## Roughly one floor in `secret_in`, one room's every doorway becomes an
## illusory wall: it looks like wall and blocks the fog until walked through,
## but was always walkable. The start and exit rooms are never sealed, and the
## seal is committed only if everything OUTSIDE the room stays reachable
## without crossing a secret — a corridor that merely passes through the room
## may be load-bearing, and sealing a thoroughfare would hide half the floor
## rather than one room.
##
## Draws: none at all below three rooms; otherwise one for the odds, then one
## per attempt (at most four), spent whether the attempt commits or is skipped.
## Returns {"grid", "counterAfter", "sealed"}.
static func seal_secret_room(
	seed: int,
	counter: int,
	grid: Dictionary,
	rooms: Array,
	start: Dictionary,
	exit: Dictionary,
	secret_in: int = 3,
) -> Dictionary:
	var c := counter
	if rooms.size() < 3:
		return {"grid": grid, "counterAfter": c, "sealed": false}

	var roll := SimRng.int_between(seed, c, 1, secret_in)
	c += 1
	if roll != 1:
		return {"grid": grid, "counterAfter": c, "sealed": false}

	var eligible: Array = []
	for r: Dictionary in rooms:
		if not _in_room(r, int(start["x"]), int(start["y"])) \
			and not _in_room(r, int(exit["x"]), int(exit["y"])):
			eligible.append(r)
	if eligible.is_empty():
		return {"grid": grid, "counterAfter": c, "sealed": false}

	var width: int = grid["width"]
	var height: int = grid["height"]

	# A few tries: a drawn room whose sealing would strand the floor is
	# skipped, not forced. The same room may come up twice — the reference does
	# not remove a rejected pick, and removing it would change the stream.
	for attempt in range(mini(4, eligible.size())):
		var pick := SimRng.int_between(seed, c, 0, eligible.size() - 1)
		c += 1
		var room: Dictionary = eligible[pick]
		var boundary: Dictionary = _boundary_of(grid, room)
		var doors: Array = boundary["doors"]
		# No doors is nothing to seal; open boundary is a room merged into its
		# neighbour — it has no wall to hide behind, and sealing it would eat
		# the neighbour's floor.
		if doors.is_empty() or int(boundary["open"]) > 0:
			continue

		var tiles: Array = (grid["tiles"] as Array).duplicate()
		for d: int in doors:
			tiles[d] = SimGrid.SECRET
		var sealed_grid: Dictionary = SimGrid.make(width, height, tiles)

		# The player's-eye check: everything outside the room must still be
		# walkable without knowing any secret.
		var honest: Dictionary = _flood_honest(sealed_grid, start)
		var stranded := false
		for i in range(tiles.size()):
			if stranded:
				break
			var t: int = tiles[i]
			if t != SimGrid.FLOOR and t != SimGrid.EXIT:
				continue
			var x: int = i % width
			var y: int = floori(float(i) / float(width))
			if _in_room(room, x, y):
				continue
			if not honest.has(i):
				stranded = true
		if stranded:
			continue

		return {"grid": sealed_grid, "counterAfter": c, "sealed": true}

	return {"grid": grid, "counterAfter": c, "sealed": false}


## The repair rule, stated by the designer: if a map arrives with rooms the
## player cannot reach, we do not throw it away — we cut a hidden way in. Any
## walkable region the honest flood cannot reach gets one wall on its boundary
## turned into a secret passage, until nothing is stranded.
##
## By construction the generator never produces such a map, so this is defence
## in depth — but a sabotaged build once leaked exactly that into a live
## session, and the rule is better than the throw. Drawless and deterministic:
## the punched wall is the lowest-index candidate.
##
## Returns {"grid", "punched"}.
static func repair_with_secret(grid: Dictionary, start: Dictionary) -> Dictionary:
	var width: int = grid["width"]
	var height: int = grid["height"]
	var tiles: Array = (grid["tiles"] as Array).duplicate()
	var punched := 0

	for guard in range(8):
		var current: Dictionary = SimGrid.make(width, height, tiles)
		# TRUE disconnection only: SimReach.reachable_from walks secrets like the floor
		# they are, so a deliberately sealed room is already connected and
		# never "repaired" with a redundant second door. Stranded means no path
		# exists at all — the sabotage case.
		var truth: Dictionary = SimReach.reachable_from(current, int(start["x"]), int(start["y"]))

		var hole := -1
		for i in range(tiles.size()):
			if int(tiles[i]) != SimGrid.WALL:
				continue
			var x: int = i % width
			var y: int = floori(float(i) / float(width))
			var touches_reached := false
			var touches_stranded := false
			for step: Array in _STEPS:
				var nx: int = x + int(step[0])
				var ny: int = y + int(step[1])
				if not SimGrid.is_passable(current, nx, ny):
					continue
				if truth.has(SimGrid.idx(grid, nx, ny)):
					touches_reached = true
				else:
					touches_stranded = true
			if touches_reached and touches_stranded:
				hole = i
				break

		if hole == -1:
			return {"grid": current, "punched": punched}
		tiles[hole] = SimGrid.SECRET
		punched += 1

	return {"grid": SimGrid.make(width, height, tiles), "punched": punched}
