extends GutTest
## Dispositions — the byte-twin of tests/core/dispositions.test.ts: guard and
## wanderer AI, plus the one piece of that story that actually lives in the
## REDUCER rather than the brain — a wanderer's `leg` advancing when a step
## lands on a waypoint (apply.gd's MOVE case, apply.ts:242-249).
##
## Only that one case ports today. The reference's other eleven drive
## `decide()` (src/core/ai.ts) or `createWorld()` (src/core/commands.ts), and
## neither has a GDScript body yet: `sim/ai.gd` is Task 2.E2, and
## `sim/commands/movement.gd` (createWorld's new home) is Task 2.E3a — both
## Wave E, both BLOCKED BY this task rather than the reverse. Porting their
## assertions now would mean hand-rolling the very functions those tasks
## exist to write, which is a redundant reducer wearing a test's clothes, not
## a test. The numeric tables they will need — GUARD_LEASH, ROUTE_STOPS — are
## already ported (tables.gd:250, 269); only the two decision functions
## themselves are missing.
##
## 12 = 1 ported + 11 deferred. Reference line numbers below are
## tests/core/dispositions.test.ts at ts-baseline.
##
## PORTED
##   :103 "the reducer advances the leg when a step lands on a waypoint — any
##        waypoint, forward only" — drives SimApply.apply directly against a
##        hand-built state and a hand-built MOVE event; no decide(), no
##        createWorld().
##
## DEFERRED to Task 2.E2 (sim/ai.gd, decide()) — describe('the guard') whole,
## and describe('the wanderer') other than the case ported above:
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
