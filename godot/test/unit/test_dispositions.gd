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
## two ledgers agree. Five remain deferred, all to Task 2.E3a: `createWorld()`
## still has no GDScript body (`sim/commands/movement.gd`).
##
## 12 = 7 ported + 5 deferred. Reference line numbers below are
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
## DEFERRED to Task 2.E3a (sim/commands/movement.gd, create_world()) —
## describe('generation deals the tempers') whole:
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
