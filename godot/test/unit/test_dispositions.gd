extends GutTest
## Dispositions — the byte-twin of tests/core/dispositions.test.ts: guard and
## wanderer AI, plus the one piece of that story that actually lives in the
## REDUCER rather than the brain — a wanderer's `leg` advancing when a step
## lands on a waypoint (apply.gd's MOVE case, apply.ts:242-249).
##
## When Task 2.C1 ported this file only that one reducer case could land: the
## other eleven drive `decide()` (src/core/ai.ts) or `createWorld()`
## (src/core/commands.ts), and neither had a GDScript body yet. **Task 2.E2
## has since shipped `sim/ai.gd`, and ADOPTS the six `decide()` cases that
## were deferred to it** — describe('the guard') whole, and
## describe('the wanderer') other than the reducer case. They live here
## rather than in test_ai.gd because they are this reference file's cases and
## reuse its corridor; test_ai.gd's own header names them as adopted so the
## two ledgers agree. **Task 2.E3a has since shipped `sim/commands/movement.gd`
## and DISCHARGES the last five** — describe('generation deals the tempers')
## whole, which needed `createWorld()` and nothing else.
##
## 12 = 12 ported + 0 deferred. Reference line numbers below are
## tests/core/dispositions.test.ts at ts-baseline.
##
## PORTED by Task 2.C1
##   :103 "the reducer advances the leg when a step lands on a waypoint — any
##        waypoint, forward only" — drives SimApply.apply directly against a
##        hand-built state and a hand-built MOVE event; no decide(), no
##        createWorld().
##
## PORTED by Task 2.E2 (adopted with sim/ai.gd's decide())
##   :52  "ignores prey beyond the leash of its post — even prey at arm's
##        reach — and walks home"
##   :64  "hunts what comes inside the leash, and rests at its post when the
##        floor is quiet"
##   :85  "walks its round when nothing is in reach to hunt"
##   :94  "the hunt interrupts the round"
##   :114 "standing on its own goal, it heads for the next stop rather than
##        stalling"
##   :122 "a goal another body is parked on yields to the next stop"
##
## PORTED by Task 2.E3a (adopted with sim/commands/movement.gd's create_world())
## — describe('generation deals the tempers') whole:
##   :137 "the teaching floor stays still: no routes at depth 1, on any board"
##   :144 "guards by role are drawless: the keeper and every relic guard own
##        their posts"
##   :154 "past the teaching floor some of the floor walks rounds, recorded
##        whole and bounded"
##   :169 "the temper crosses the fold: disposition, route and leg 0 stand in
##        state" — reads create_world()'s output back through apply(), but
##        the world being folded has to come FROM create_world() first, so
##        the blocker here is generation, not the fold.
##   :181 "routes replay identically: same seed, same rounds"


## The reference's corridor(): one walkable row, 26 tiles wide, so a step's
## direction is legible and unambiguous. A raw state literal, not a folded
## WORLD_INIT — the TS fixture never goes through apply() to build its world
## either, and the one case ported here does not need it to. Kept as a
## reusable helper (with _being/_you/_move_to below) so Task 2.E2/2.E3a can
## extend this file's harness rather than starting one from nothing.
const _CORRIDOR_WIDTH := 26
const _CORRIDOR_HEIGHT := 3


func _corridor(entities: Array) -> Dictionary:
	var tiles: Array = []
	for i in range(_CORRIDOR_WIDTH * _CORRIDOR_HEIGHT):
		tiles.append(SimGrid.WALL)
	for x in range(1, _CORRIDOR_WIDTH - 1):
		tiles[_CORRIDOR_WIDTH + x] = SimGrid.FLOOR
	return {
		"grid": SimGrid.make(_CORRIDOR_WIDTH, _CORRIDOR_HEIGHT, tiles),
		"entities": entities,
		"items": [],
		"turn": 1,
		"activeEntityId": entities[0]["id"] if entities.size() > 0 else null,
		"seed": 7,
		"rngCounter": 0,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 3,
		"gold": 0,
		"story": "",
		"motif": null,
		"bodies": [],
		"bible": null,
		"smoke": null,
		"traps": [],
		"alarm": null,
		"unveiled": [],
	}


## The reference's being(id, x, extra).
func _being(id: String, x: int, extra: Dictionary = {}) -> Dictionary:
	var e: Dictionary = {
		"id": id, "kind": "thing", "pos": {"x": x, "y": 1},
		"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 3}, "tags": [], "maxHp": 5,
	}
	for k: String in extra:
		e[k] = extra[k]
	return e


## The reference's you(x).
func _you(x: int) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": 1},
		"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 10,
	}


## The reference's moveTo(state, id, to). `from` rides along in the payload
## for shape fidelity; apply.gd's MOVE case never reads it.
func _move_to(state: Dictionary, id: String, to: Dictionary) -> Dictionary:
	return SimEvents.draft("MOVE", state["rngCounter"], 0,
		{"entityId": id, "from": {"x": 0, "y": 0}, "to": to})


## The reference's `round`, a two-stop patrol declared once at describe scope.
## Rebuilt fresh per call rather than held in a `const`, which Godot 4 makes
## read-only — the same reasoning test_sight.gd's `_open()` records.
func _round() -> Array:
	return [{"x": 4, "y": 1}, {"x": 20, "y": 1}]


# ── the guard ───────────────────────────────────────────────────────────────


func test_ignores_prey_beyond_the_leash_of_its_post_even_prey_at_arms_reach_and_walks_home() -> void:
	# Displaced to x=13 with its post at x=8; the player stands ADJACENT at
	# x=14, but the post reads the leash and the player is 6 from it. The
	# old stillness would have struck; the guard turns for home instead.
	var state: Dictionary = _corridor([
		_being("g", 13, {"disposition": "guard", "post": {"x": 8, "y": 1}}),
		_you(14),
	])
	assert_gt(14 - 8, SimTables.GUARD_LEASH)
	assert_eq(SimAi.decide(state, "g"), {"kind": "step", "dx": -1, "dy": 0})


func test_hunts_what_comes_inside_the_leash_and_rests_at_its_post_when_the_floor_is_quiet() -> void:
	# The player 3 from the post: inside the leash, ordinary hunt.
	var hunting: Dictionary = _corridor([
		_being("g", 8, {"disposition": "guard", "post": {"x": 8, "y": 1}}),
		_you(11),
	])
	assert_eq(SimAi.decide(hunting, "g"), {"kind": "step", "dx": 1, "dy": 0})

	# Home, leash empty: it stands. (The old behavior also stood here —
	# what changed is only ever the walk back.)
	var quiet: Dictionary = _corridor([
		_being("g", 8, {"disposition": "guard", "post": {"x": 8, "y": 1}}),
		_you(24),
	])
	assert_eq(SimAi.decide(quiet, "g"), {"kind": "wait"})


# ── the wanderer ────────────────────────────────────────────────────────────


func test_walks_its_round_when_nothing_is_in_reach_to_hunt() -> void:
	var state: Dictionary = _corridor([
		_being("w", 12, {"disposition": "wander", "route": _round(), "leg": 0}),
		_you(24),
	])
	# Leg 0 points at x=4, west.
	assert_eq(SimAi.decide(state, "w"), {"kind": "step", "dx": -1, "dy": 0})


func test_the_hunt_interrupts_the_round() -> void:
	var state: Dictionary = _corridor([
		_being("w", 12, {"disposition": "wander", "route": _round(), "leg": 0}),
		_you(17),
	])
	# The round says west; the prey at 5 steps says east. Teeth win.
	assert_eq(SimAi.decide(state, "w"), {"kind": "step", "dx": 1, "dy": 0})


func test_the_reducer_advances_the_leg_when_a_step_lands_on_a_waypoint_any_waypoint_forward_only() -> void:
	var three_stop: Dictionary = _corridor([
		_being("w", 7, {
			"disposition": "wander",
			"route": [{"x": 4, "y": 1}, {"x": 8, "y": 1}, {"x": 20, "y": 1}],
			"leg": 0,
		}),
		_you(24),
	])
	var landed: Dictionary = SimApply.apply(three_stop, _move_to(three_stop, "w", {"x": 8, "y": 1}))
	# Struck the SECOND stop while heading for the first: the round turns to
	# the third, never back to the one behind.
	var walker: Dictionary = SimEntity.find(landed["entities"], "w")
	assert_eq(walker["leg"], 2)


func test_standing_on_its_own_goal_it_heads_for_the_next_stop_rather_than_stalling() -> void:
	var state: Dictionary = _corridor([
		_being("w", 4, {"disposition": "wander", "route": _round(), "leg": 0}),
		_you(24),
	])
	assert_eq(SimAi.decide(state, "w"), {"kind": "step", "dx": 1, "dy": 0})


func test_a_goal_another_body_is_parked_on_yields_to_the_next_stop() -> void:
	var state: Dictionary = _corridor([
		_being("w", 12, {"disposition": "wander", "route": _round(), "leg": 0}),
		_being("parked", 4),
		_you(24),
	])
	# x=4 is taken; the round turns east for x=20 instead of jamming.
	assert_eq(SimAi.decide(state, "w"), {"kind": "step", "dx": 1, "dy": 0})


# ── describe('generation deals the tempers') ────────────────────────────────
# The five cases Task 2.C1 deferred to Task 2.E3a, DISCHARGED. Every one drives
# create_world and reads the temper back off the WORLD_INIT payload, so the
# corridor above is not used here — generation needs a real board.
# Reference lines are tests/core/dispositions.test.ts:137, :144, :154, :169
# and :181 at ts-baseline.


## The reference's fold(): a draft becomes the state a run would start from.
func _fold(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "w"
	event["parent"] = null
	event["seq"] = 0
	return SimApply.apply(SimState.empty(), event)


func test_the_teaching_floor_stays_still_no_routes_at_depth_1_on_any_board() -> void:
	for seed: int in [3, 15, 44]:
		var born: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 1)
		for o: Dictionary in ((born["payload"] as Dictionary)["opponents"] as Array):
			# THE ABSENT-KEY LAW: an untempered creature carries no `route` key
			# at all, which is what the reference's `route === undefined` means.
			assert_false(o.has("route"),
				"seed %d: %s walks a round on the teaching floor" % [seed, o["id"]])


func test_guards_by_role_are_drawless_the_keeper_and_every_relic_guard_own_their_posts() -> void:
	var born: Dictionary = SimCommands.create_world(21, 96, 64, "player", 3)
	var warden: Variant = null
	for o: Dictionary in ((born["payload"] as Dictionary)["opponents"] as Array):
		if (o["kind"] as String).begins_with("warden"):
			warden = o
			break
	assert_not_null(warden, "depth 3 owes a warden")
	assert_eq((warden as Dictionary).get("disposition"), "guard")
	# Depth 1's one relic guard, same law, vale board — the pre-v10 world's
	# only disposition change.
	var vale: Dictionary = SimCommands.create_world(15, 48, 32, "player", 1)
	var first: Dictionary = ((vale["payload"] as Dictionary)["opponents"] as Array)[0]
	assert_eq(first.get("disposition"), "guard")


func test_past_the_teaching_floor_some_of_the_floor_walks_rounds_recorded_whole_and_bounded() -> void:
	# ROUTE_STOPS is [2, 4]; a recorded round holds two, three or four stops.
	# Spelled as literals rather than read off the constant — the reference
	# reads the constant, and a test whose bounds move with the thing they
	# bound cannot fail (Task 2.E2 measured exactly that shape in ai.test.ts).
	var wanderers := 0
	for seed: int in [3, 7, 11, 21, 33, 44]:
		var born: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 3)
		for o: Dictionary in ((born["payload"] as Dictionary)["opponents"] as Array):
			if o.get("disposition") != "wander":
				continue
			wanderers += 1
			assert_true(o.has("route"), "seed %d: a wanderer with no round" % seed)
			var route: Array = o["route"]
			assert_gte(route.size(), 2, "seed %d: %s walks a round of one" % [seed, o["id"]])
			assert_lte(route.size(), 4, "seed %d: %s walks an unbounded round" % [seed, o["id"]])
	assert_gt(wanderers, 0, "no seed produced a wanderer at all")


func test_the_temper_crosses_the_fold_disposition_route_and_leg_0_stand_in_state() -> void:
	for seed: int in [3, 7, 11, 21, 33, 44]:
		var state: Dictionary = _fold(SimCommands.create_world(seed, 96, 64, "player", 3))
		var walker: Variant = null
		for e: Dictionary in (state["entities"] as Array):
			if e.get("disposition") == "wander":
				walker = e
				break
		if walker == null:
			continue
		assert_true((walker as Dictionary).has("route"))
		assert_eq(int((walker as Dictionary)["leg"]), 0, "a fresh round starts on its first leg")
		return
	assert_true(false, "no seed produced a wanderer to fold")


func test_routes_replay_identically_same_seed_same_rounds() -> void:
	var a: Dictionary = SimCommands.create_world(33, 96, 64, "player", 4)
	var b: Dictionary = SimCommands.create_world(33, 96, 64, "player", 4)
	var a_routes: Array = []
	for o: Dictionary in ((a["payload"] as Dictionary)["opponents"] as Array):
		a_routes.append(o.get("route"))
	var b_routes: Array = []
	for o: Dictionary in ((b["payload"] as Dictionary)["opponents"] as Array):
		b_routes.append(o.get("route"))
	assert_eq(a_routes, b_routes)
	assert_eq(int(a["rngDraws"]), int(b["rngDraws"]))
