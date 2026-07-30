class_name SimAi
## What a creature does on its turn — the byte-twin of src/core/ai.ts (271
## lines). The single most consequential pure function in the game: `decide`'s
## answer becomes a recorded event, so a tie broken the other way is not a
## tuning difference, it is a different chain.
##
## Deliberately DRAWLESS. Nothing here touches SimRng, and nothing here may
## ever start to: randomness in a decision would have to be threaded through
## the counter protocol for every creature on every turn, and replay would then
## hinge on the order creatures were asked in. Chance belongs in whether a blow
## lands, not in whether a creature decides to throw it. `test_ai.gd`'s
## fifty-fold repeat is the guard, and it checks the counter as well as the
## answer.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## ai.ts:14  AWARENESS   -> AWARENESS      (below)
## ai.ts:16  Action      -> a plain Dictionary tagged by "kind"; see below
## ai.ts:26  manhattan   -> _manhattan
## ai.ts:39  firstStep   -> _first_step
## ai.ts:95  canLunge    -> _can_lunge
## ai.ts:132 decide      -> decide
## Every function in the reference file is PORTED. Nothing is DEFERRED. One
## function is ported IN ADDITION — see the SimMapgen note below.
##
## ── The Action union, member for member ───────────────────────────────────
## TS discriminates on `kind`; a GDScript Dictionary carries exactly the same
## keys and nothing else, so a caller reads `action["kind"]` and then the one
## or two fields that kind carries:
##   {"kind": "call"}                        {"kind": "mend"}
##   {"kind": "strike", "targetId": String}  {"kind": "draw"}
##   {"kind": "step", "dx": int, "dy": int}  {"kind": "shoot", "targetId": …}
##   {"kind": "lunge",  "targetId": String}  {"kind": "wait"}
## An Action is never part of GameState and is never hashed — it is the
## argument a command turns into an event — so the absent-key law does not
## reach it. It is still written with no spare keys, because the caller
## switches on shape.
##
## ── `walk_distance` and the missing SimMapgen ─────────────────────────────
## The reference imports `walkDistance` from mapgen.ts (mapgen.ts:440), which
## in this port belongs to `SimMapgen` — Task 2.D1, NOT merged to main at this
## file's base (fbeb81f). This task's own "Blocked by" line omits 2.D1, which
## is a gap in the plan rather than a fact about the code: four of decide()'s
## branches (the vigil leash, the guard leash, the stalker's lurk, the
## caller's cry) cannot be written without it.
##
## So `_walk_distance` below is a faithful private port of mapgen.ts:440,
## eighteen lines, and this file therefore compiles whether 2.D1 lands before
## or after it. **When SimMapgen merges, `_walk_distance` should be deleted
## and its four call sites pointed at `SimMapgen.walk_distance`** — two ports
## of one reference function is one more than the migration wants, and a
## divergence between them would be invisible until a hunt disagreed. The
## Task 2.E2 report files this for the designer.
##
## ── Why `SimReach` is NOT what the hunt paths with ────────────────────────
## The task sketch says the hunt paths "through SimReach", and the plan lists
## SimReach among this file's consumers. Measured against the reference, it
## does not: ai.ts imports nothing from reachability.ts. `SimReach.
## reachable_from` answers "which tiles connect", with no distance and no
## first step, and `floor_count` is a census. The two questions decide()
## actually asks — "how far is that to walk" and "which way is the first step"
## — are `walkDistance` and this file's own `_first_step`. Named here because
## a later reader will otherwise look for a SimReach call that was never
## supposed to exist. AStarGrid2D is forbidden and is nowhere in this file.

## How far a creature notices you from: steps of *walking*, not line of
## flight. Eight steps down a corridor is eight steps; eight steps through a
## wall is no steps at all, because the path does not exist. This is what
## makes a closed door of wall a real refuge, and it is the same arithmetic a
## player can do by counting tiles.
const AWARENESS := 8

## The neighbour order, fixed: east, west, south, north. Written once and read
## by both searches, because the two must never drift apart — the whole claim
## that a replayed world hunts identically rests on this list's order.
const _NEIGHBOURS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]


static func _manhattan(a: Dictionary, b: Dictionary) -> int:
	var ap: Dictionary = a["pos"]
	var bp: Dictionary = b["pos"]
	return absi(int(ap["x"]) - int(bp["x"])) + absi(int(ap["y"]) - int(bp["y"]))


## How far the walk to a tile is, or INF if there is no walk at all.
##
## A private port of mapgen.ts:440 — see this file's header for why it is here
## and not called on SimMapgen. INF stands in for the reference's
## `Number.POSITIVE_INFINITY`, the same INF-as-TS-Infinity reading SimSight
## already uses; it is compared against a leash and never stored, so nothing
## fractional reaches SimCanonical.
##
## The reference dequeues with `Array.shift()`. A head index reproduces that
## FIFO order exactly at O(1) — the visit sequence is identical, not merely
## equivalent — which matters because BFS order is what makes the answer
## deterministic.
##
## Note the ordering, which is the OPPOSITE of _first_step's below and
## deliberately so: passability is tested BEFORE the neighbour is keyed, so an
## off-map coordinate never reaches the wrapping `y*width+x`.
static func _walk_distance(grid: Dictionary, from: Dictionary, to: Dictionary) -> float:
	var from_x: int = from["x"]
	var from_y: int = from["y"]
	var to_x: int = to["x"]
	var to_y: int = to["y"]

	var seen: Dictionary = {}
	seen[SimGrid.idx(grid, from_x, from_y)] = true
	var queue: Array = [[from_x, from_y, 0]]
	var head: int = 0

	while head < queue.size():
		var here: Array = queue[head]
		head += 1
		if here[0] == to_x and here[1] == to_y:
			return float(here[2])
		var neighbours: Array = [
			[here[0] + 1, here[1]], [here[0] - 1, here[1]],
			[here[0], here[1] + 1], [here[0], here[1] - 1],
		]
		for n: Array in neighbours:
			var nx: int = n[0]
			var ny: int = n[1]
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var key: int = SimGrid.idx(grid, nx, ny)
			if seen.has(key):
				continue
			seen[key] = true
			queue.append([nx, ny, int(here[2]) + 1])

	return INF


## First step of the hunt: a breadth-first search out to AWARENESS steps, over
## tiles the hunter could actually stand on — walls block it, and so do other
## living creatures, which is why a corridor fills single-file rather than
## clipping through itself. If the search reaches the goal, the first step of
## that shortest path comes back; if not — too far, or the way is blocked —
## null. Neighbour order is fixed (east, west, south, north), so the chosen
## path is deterministic and a replayed world hunts identically.
##
## `reach` is how far the search may walk. The hunt keeps AWARENESS; the
## guard's homeward walk and the wanderer's round pass the whole board,
## because a post or a waypoint is farther away than prey is allowed to be.
##
## ── Two orderings inside the loop, both load-bearing ──────────────────────
## BOUNDS come before the key. `SimGrid.idx` is plain `y*width+x`, so an
## off-map coordinate wraps onto a real tile — one column east of the map IS
## the next row's west door by arithmetic, and a hunt whose quarry stood at
## x=0 walked EAST off the world toward the collision. NIGHTLOG records this
## as a LATENT HUNT BUG that the reference found and fixed (the fog had learnt
## the same wrap lesson first, in fov.ts); walled borders had been hiding it,
## and borderless test grids exposed it. Ported with the fix, and with a
## regression test the reference itself never had —
## test_a_quarry_off_the_east_edge_is_never_smelled_through_the_wrap.
##
## PASSABILITY comes AFTER the key, and after the goal test. This looks like
## the very bug above and is not — it is what lets a creature path to its
## quarry at all, because the goal tile is a tile a living body is standing on
## and would fail the `occupied` test one line later. Marking an impassable
## neighbour `seen` before knowing it is impassable changes no answer either:
## the search never expands from such a tile, and its only other effect — the
## goal test — already ran on this visit. Analysed rather than assumed during
## Task 2.E2; moving `is_passable` above `seen` would not tidy this function,
## it would stop every hunt in the game.
static func _first_step(
	state: Dictionary,
	self_id: String,
	from: Dictionary,
	goal: Dictionary,
	reach: int = AWARENESS,
) -> Variant:
	var grid: Dictionary = state["grid"]
	var width: int = grid["width"]
	var height: int = grid["height"]
	var entities: Array = state["entities"]

	var occupied: Dictionary = {}
	for e: Dictionary in entities:
		if e["id"] != self_id and SimEntity.is_alive(e):
			var p: Dictionary = e["pos"]
			occupied[SimGrid.idx(grid, int(p["x"]), int(p["y"]))] = true
	var goal_key: int = SimGrid.idx(grid, int(goal["x"]), int(goal["y"]))

	var seen: Dictionary = {}
	seen[SimGrid.idx(grid, int(from["x"]), int(from["y"]))] = true
	# Each frontier entry is [x, y, first], where `first` is the {dx, dy} of
	# the opening step of the path that reached it — null at the start tile.
	var frontier: Array = [[int(from["x"]), int(from["y"]), null]]

	for depth in range(reach):
		var next: Array = []
		for at: Array in frontier:
			for d: Array in _NEIGHBOURS:
				var x: int = int(at[0]) + int(d[0])
				var y: int = int(at[1]) + int(d[1])
				if x < 0 or y < 0 or x >= width or y >= height:
					continue
				var k: int = SimGrid.idx(grid, x, y)
				if seen.has(k):
					continue
				seen[k] = true
				var first: Variant = at[2]
				if first == null:
					first = {"dx": int(d[0]), "dy": int(d[1])}
				if k == goal_key:
					return first
				if not SimGrid.is_passable(grid, x, y) or occupied.has(k):
					continue
				next.append([x, y, first])
		frontier = next

	return null


## Whether the skirmisher's lunge geometry holds: exactly two tiles of
## ground with a free tile on the way. The twin of the check inside
## `lungeStrike` (commands.ts), which is the one that decides for real —
## this only keeps the brain from wishing for the impossible.
static func _can_lunge(state: Dictionary, me: Dictionary, quarry: Dictionary) -> bool:
	if _manhattan(me, quarry) != 2:
		return false
	var grid: Dictionary = state["grid"]
	var entities: Array = state["entities"]
	var my_pos: Dictionary = me["pos"]
	var q_pos: Dictionary = quarry["pos"]

	for d: Array in _NEIGHBOURS:
		var mid_x: int = int(my_pos["x"]) + int(d[0])
		var mid_y: int = int(my_pos["y"]) + int(d[1])
		var closes: bool = absi(int(q_pos["x"]) - mid_x) + absi(int(q_pos["y"]) - mid_y) == 1
		if not closes:
			continue
		if not SimGrid.is_passable(grid, mid_x, mid_y):
			continue
		var taken: bool = false
		for e: Dictionary in entities:
			if SimEntity.is_alive(e) and e["id"] != me["id"]:
				var p: Dictionary = e["pos"]
				if int(p["x"]) == mid_x and int(p["y"]) == mid_y:
					taken = true
					break
		if taken:
			continue
		return true
	return false


## What a creature does on its turn.
##
## Deliberately **deterministic and drawless** — see this file's header for
## why that is a design decision rather than an omission.
##
## On top of the shared hunt, each archetype acts by its verb (tables.gd):
##
## - **ambush** (stalker): born coiled, it holds perfectly still until the
##   quarry comes within LURK_RANGE steps of walking — visible stillness is
##   the tell — then hunts; its first landed blow releases the spring.
## - **lunge** (skirmisher): two tiles and the blow in one motion, the only
##   actor that can — approach is what it punishes.
## - **vigil** (warden): leashed to its post; it pursues only quarry within
##   VIGIL_LEASH of the post, walks home when the leash empties, and knits
##   shut once it stands at its post unwatched.
## - **trample** (bruiser): decided nowhere here — the shove lives in the
##   blow itself (commands.gd), because it is part of hitting, not a choice.
##
## The reference names its subject `self`, which GDScript reserves; it is
## `me` throughout this file.
static func decide(state: Dictionary, entity_id: String) -> Dictionary:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	if found == null:
		return {"kind": "wait"}
	var me: Dictionary = found
	if not SimEntity.is_alive(me):
		return {"kind": "wait"}

	var grid: Dictionary = state["grid"]
	var my_pos: Dictionary = me["pos"]
	var tags: Array = me["tags"]

	# Reeling spends the action. The wait it decides is the event that clears
	# the tag — one stagger, one lost turn, no bookkeeping anywhere else.
	if tags.has("staggered"):
		return {"kind": "wait"}

	# The mimic's whole art is stillness: hidden, it does nothing at all —
	# no hunt, no drift, no tell — because an item that fidgets is no item.
	# The lie lives on the render side; this wait is just a thing that does
	# not move yet. Unmasked, it fights plain (its loaded spring is the
	# strike's business, not the mind's).
	if SimTables.verb_of(me["kind"]) == "feign" and tags.has("hidden"):
		return {"kind": "wait"}

	var quarry: Variant = null
	for e: Dictionary in entities:
		if e["kind"] == "you" and SimEntity.is_alive(e):
			quarry = e
			break
	if quarry == null:
		return {"kind": "wait"}
	var prey: Dictionary = quarry
	var prey_pos: Dictionary = prey["pos"]

	# Smoke in the air: a fooled hunter chases where you WERE when it rose.
	# Whoever had you in claws' reach then (recorded in the event) still has
	# you — and if you never moved, the stale trail still ends at your feet,
	# which is exactly what standing in your own smoke deserves.
	var smoke: Variant = state["smoke"]
	var fooled: bool = smoke != null \
		and int(state["turn"]) < int(smoke["until"]) \
		and not (smoke["unfooled"] as Array).has(entity_id)
	# The reference's second `state.smoke !== null` here is TypeScript
	# narrowing the type, not a second condition — `fooled` already implies
	# it — but it is kept literal rather than reasoned away.
	var scent: Dictionary = smoke["at"] if fooled and smoke != null else prey_pos

	var verb: Variant = SimTables.verb_of(me["kind"])

	# The vigil, before anything else: a warden's world is its post.
	if verb == "vigil":
		var post: Dictionary = me["post"] if me.get("post") != null else my_pos
		var intruder_near: bool = _walk_distance(grid, post, scent) <= SimTables.VIGIL_LEASH
		if not intruder_near:
			var home: bool = int(my_pos["x"]) == int(post["x"]) \
				and int(my_pos["y"]) == int(post["y"])
			if home:
				# Unwatched and wounded: the vigil knits the fight shut. Whole,
				# it simply stands — the stairs are what it is for.
				var stats: Dictionary = me["stats"]
				if int(stats["hp"]) < int(me["maxHp"]):
					return {"kind": "mend"}
				return {"kind": "wait"}
			# NOTE, and ported exactly as it stands: this call takes the
			# DEFAULT reach — AWARENESS, eight steps — while the guard's
			# identical homeward walk forty lines below passes width+height.
			# `_first_step`'s own docstring, added by the same commit that
			# added the guard (2c1f175, "guards and wanderers", WORLD_INIT
			# v10), says the reason applies to a POST as much as to a
			# waypoint: "a post or a waypoint is farther away than prey is
			# allowed to be". A warden shoved more than eight steps of
			# WALKING from its door therefore waits forever instead of
			# walking home. Suspected oversight in the reference, reported to
			# the designer by the Task 2.E2 report, and NOT fixed here: a bug
			# reproduced is a success, a bug fixed is a forked chain.
			var back: Variant = _first_step(state, entity_id, my_pos, post)
			if back == null:
				return {"kind": "wait"}
			return {"kind": "step", "dx": int(back["dx"]), "dy": int(back["dy"])}
		# Intruder inside the leash: an ordinary hunt from here down.

	# The alarm ringing: the floor knows where you are. Read here because it
	# answers two questions below — whether a posted guard leaves its post, and
	# how far the hunt may search.
	#
	# The designer's filing, 2026-07-29: "the alarm bell trap doesn't seem...to
	# attract monsters". Measured, they were right by arithmetic, and the clock
	# was not the reason: 83% of an expanse floor's bodies are POST-LEASHED
	# GUARDS, and the bell used to excuse every one of them. Per belled floor,
	# barely half a body took a single step — and ringing five times longer
	# moved exactly the same half. So the leash is what the bell cuts. A guard
	# whose whole floor is screaming does not keep standing by its shelf; the
	# warden's vigil does, because the warden is bound to the door BY ROLE and
	# the stairs being watched is load-bearing.
	var alarm: Variant = state["alarm"]
	var alarmed: bool = alarm != null and int(state["turn"]) < int(alarm["until"])

	# A posted guard is the vigil's homeward half without the mend (v10):
	# it hunts only what comes within GUARD_LEASH of its post — the leash
	# anchored to the POST, not to wherever the chase has dragged it — and
	# walks home when the leash empties. The keeper and every relic guard
	# hold their prizes now instead of freezing where a chase went cold.
	if me.get("disposition") == "guard" and verb != "vigil" and not alarmed:
		var post: Dictionary = me["post"] if me.get("post") != null else my_pos
		var intruder_near: bool = _walk_distance(grid, post, scent) <= SimTables.GUARD_LEASH
		if not intruder_near:
			var home: bool = int(my_pos["x"]) == int(post["x"]) \
				and int(my_pos["y"]) == int(post["y"])
			if home:
				return {"kind": "wait"}
			var back: Variant = _first_step(state, entity_id, my_pos, post,
				int(grid["width"]) + int(grid["height"]))
			if back == null:
				return {"kind": "wait"}
			return {"kind": "step", "dx": int(back["dx"]), "dy": int(back["dy"])}

	# Coiled: perfectly still until the quarry is close enough to commit to.
	# The stillness is in plain sight — that is the tell, and the dread.
	if verb == "ambush" and tags.has("ambush"):
		var near: bool = _walk_distance(grid, my_pos, scent) <= SimTables.LURK_RANGE
		if not near:
			return {"kind": "wait"}

	# The voice, before the teeth: a caller with its cry unspent cries out
	# the moment prey walks into range, and hunts like anything else after.
	# It cries at the scent — a smoked floor gets called down on where you
	# were, which is exactly what the smoke is for.
	if verb == "call" and tags.has("call") \
		and _walk_distance(grid, my_pos, scent) <= SimTables.CALL_RANGE:
		return {"kind": "call"}

	# A fooled hunter cannot strike or lunge at what it has lost — it walks
	# its stale trail. Only the unfooled fight as if they can see.
	if not fooled:
		if _manhattan(me, prey) == 1:
			return {"kind": "strike", "targetId": prey["id"]}

		# The skirmisher's tooth: close two tiles and strike in the same action.
		if verb == "lunge" and _can_lunge(state, me, prey):
			return {"kind": "lunge", "targetId": prey["id"]}

		# The volley: the fight starts before you arrive. Undrawn it draws —
		# the tell everyone sees, covenant M8 — and drawn it looses. No retreat
		# ever: the tradition regrets dancing AI, and the slinger's menace is
		# that it stands there. A broken line falls through to the hunt, whose
		# first step drops the stance — it re-draws when it re-acquires.
		if verb == "volley" \
			and SimSight.within_reach(my_pos, prey_pos, SimTables.SHOT_RANGE) \
			and SimSight.clear_shot(grid, entities, my_pos, prey_pos):
			if tags.has("drawn"):
				return {"kind": "shoot", "targetId": prey["id"]}
			return {"kind": "draw"}

	# The awareness cap — the wall of eight steps that makes a closed corridor
	# a refuge — is gone while the ringing lasts.
	var hunt_reach: int = int(grid["width"]) + int(grid["height"]) if alarmed else AWARENESS
	var step: Variant = _first_step(state, entity_id, my_pos, scent, hunt_reach)
	if step != null:
		return {"kind": "step", "dx": int(step["dx"]), "dy": int(step["dy"])}

	# Nothing in reach to hunt: the wanderer walks its round. The reducer
	# advances the leg as steps land on waypoints; here it is only read —
	# and a body already standing on its goal heads for the next stop, as
	# does one whose goal another body is parked on, so a round never
	# stalls on its own doorstep. Drawless like every decision here.
	if me.get("disposition") == "wander" and me.has("route") and (me["route"] as Array).size() > 0:
		var route: Array = me["route"]
		var leg_raw: Variant = me.get("leg")
		var leg: int = (int(leg_raw) if leg_raw != null else 0) % route.size()
		var goal: Dictionary = route[leg]
		if _waypoint_blocked(state, entity_id, my_pos, goal):
			goal = route[(leg + 1) % route.size()]
		var walk: Variant = _first_step(state, entity_id, my_pos, goal,
			int(grid["width"]) + int(grid["height"]))
		if walk != null:
			return {"kind": "step", "dx": int(walk["dx"]), "dy": int(walk["dy"])}

	return {"kind": "wait"}


## The reference's `blocked` closure, lifted out: a waypoint the walker is
## already standing on, or one another living body is parked on. Only the
## FIRST goal is tested against it — the reference never re-tests the stop it
## falls back to, so a round with both stops taken walks toward the taken one.
static func _waypoint_blocked(
	state: Dictionary, self_id: String, my_pos: Dictionary, w: Dictionary
) -> bool:
	if int(w["x"]) == int(my_pos["x"]) and int(w["y"]) == int(my_pos["y"]):
		return true
	var entities: Array = state["entities"]
	for e: Dictionary in entities:
		if e["id"] == self_id or not SimEntity.is_alive(e):
			continue
		var p: Dictionary = e["pos"]
		if int(p["x"]) == int(w["x"]) and int(p["y"]) == int(w["y"]):
			return true
	return false
