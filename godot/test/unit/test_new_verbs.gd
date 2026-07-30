extends GutTest
## The fifth and sixth verbs — the byte-twin of tests/core/new-verbs.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye. Venom is the bite that keeps costing; the call is the fight
## becoming the room, and the clock.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 11 cases across three describe blocks.
## 11 = 11 PORTED + 0 DEFERRED. Line numbers are tests/core/new-verbs.test.ts
## at ts-baseline.
##
## describe('venom') — 5
##   :74  takes hold on a landed bite, whole and counted
##   :79  burns once per round until it spends itself
##   :94  re-opens rather than stacks on a second bite
##   :104 does not haunt the dead
##   :114 is priced into the threat it spends and the XP it pays
##
## describe('the call') — 4
##   :124 is the decision when prey is near and the voice unspent
##   :130 wakes the floor at a chase's distance, with every draw counted
##   :146 spends the voice and raises exactly what was recorded
##   :162 replays exactly — same world, same cry, same answers
##
## describe('the teaching floor stays teachable') — 2
##   :169 never seats a stinger or a caller on depth 1
##   :179 lets them in once the lesson is over
##
## Venom's five and the teaching floor's two reach this file rather than
## test_commands.gd or test_apply.gd because the reference SUITE is this task's
## by the plan's table; their subjects are `attempt_move` (2.E3a's),
## `create_world` (2.E3a's) and the reducer's TURN_ADVANCED tick (2.C1's), all
## of which already exist. Nothing is stubbed and nothing is deferred.
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## ONE test at the bottom of this file has no counterpart in the reference:
##   test_the_calls_four_draws_come_from_four_CONSECUTIVE_counter_offsets
## The reference's :130 checks the COUNT of draws and the DISTANCE of the
## risers — both of which survive a draw moving to a different counter offset,
## because every legal offset still produces a legal tile at a legal distance.
## Task 2.E3a MEASURED that exact blindness on the strike's damage draw: moving
## it off `counter + 1` failed NOTHING across 456 tests. The call spends four
## draws, more than any other verb in this family, so the offsets are pinned
## here by re-deriving each one from SimRng on the test's side of the fence.


const _SEED := 5


## The reference's room(): an open 24x16 floor at depth 4 (the call's own
## floor — a caller is barred until depth 3).
func _room(entities: Array, walls: Array = [], counter: int = 0, depth: int = 4) -> Dictionary:
	var width := 24
	var height := 16
	var tiles: Array = []
	for i in range(width * height):
		tiles.append(SimGrid.FLOOR)
	for w: Array in walls:
		tiles[int(w[1]) * width + int(w[0])] = SimGrid.WALL
	var first: String = (entities[0] as Dictionary)["id"] if not entities.is_empty() else ""
	return {
		"grid": SimGrid.make(width, height, tiles),
		"entities": entities,
		"items": [],
		"turn": 1,
		"activeEntityId": first if first != "" else null,
		"seed": _SEED,
		"rngCounter": counter,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": depth,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


## The reference's being(id, kind, x, y, { hp = 5, tags }).
func _being(id: String, kind: String, x: int, y: int, o: Dictionary = {}) -> Dictionary:
	var hp: int = int(o["hp"]) if o.has("hp") else 5
	return {
		"id": id, "kind": kind, "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 4, "wits": 1, "speed": 3},
		"tags": o["tags"] if o.has("tags") else [],
		"maxHp": hp,
	}


## The reference's you(x, y, hp = 12).
func _you(x: int, y: int, hp: int = 12) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 3, "wits": 3, "speed": 4},
		"tags": [], "maxHp": hp,
	}


func _counter_rolling(predicate: Callable) -> int:
	for c in range(5000):
		if predicate.call(SimRng.int_between(_SEED, c, 1, 20)):
			return c
	assert_true(false, "no counter found")
	return -1


func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "x"
	event["parent"] = null
	event["seq"] = 0
	return event


## The reference's wrap(): a bare turn passing, so the round's tick can run.
func _wrap(state: Dictionary) -> Dictionary:
	return _seal(SimEvents.draft("TURN_ADVANCED", int(state["rngCounter"]), 0,
		{"activeEntityId": null, "turn": int(state["turn"]) + 1}))


func _at(state: Dictionary, id: String) -> Dictionary:
	return SimEntity.find(state["entities"], id)


func _hp(state: Dictionary, id: String) -> int:
	return int((_at(state, id)["stats"] as Dictionary)["hp"])


# ── describe('venom') ─────────────────────────────────────────────────────

## The reference's bitten(): a stinger's landed bite, folded.
func _bitten() -> Dictionary:
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 12 and r < 20)
	var state: Dictionary = _room([_being("foe-1", "stinger", 5, 5), _you(6, 5)], [], counter)
	return SimApply.apply(state, _seal(SimCommands.attempt_move(state, "foe-1", 1, 0)))


func test_takes_hold_on_a_landed_bite_whole_and_counted() -> void:
	assert_has(_at(_bitten(), "player")["tags"], "venom-%d" % SimTables.VENOM_TURNS)


func test_burns_once_per_round_until_it_spends_itself() -> void:
	var state: Dictionary = _bitten()
	var start := _hp(state, "player")
	for round_n in range(1, SimTables.VENOM_TURNS + 1):
		state = SimApply.apply(state, _wrap(state))
		assert_eq(_hp(state, "player"), start - SimTables.VENOM_HARM * round_n,
			"round %d of the burn" % round_n)
	var still_burning := false
	for t: String in (_at(state, "player")["tags"] as Array):
		if t.begins_with("venom-"):
			still_burning = true
	assert_false(still_burning, "the wound spends itself")
	# Spent: further rounds cost nothing.
	var later: Dictionary = SimApply.apply(state, _wrap(state))
	assert_eq(_hp(later, "player"), _hp(state, "player"))


func test_re_opens_rather_than_stacks_on_a_second_bite() -> void:
	var state: Dictionary = _bitten()
	state = SimApply.apply(state, _wrap(state))
	# Bite again: fresh venom replaces the half-spent wound.
	var again: Dictionary = state.duplicate()
	again["rngCounter"] = _counter_rolling(func(r: int) -> bool: return r >= 12 and r < 20)
	var after: Dictionary = SimApply.apply(
		again, _seal(SimCommands.attempt_move(again, "foe-1", 1, 0)))
	var burning: Array = []
	for t: String in (_at(after, "player")["tags"] as Array):
		if t.begins_with("venom-"):
			burning.append(t)
	assert_eq(burning, ["venom-%d" % SimTables.VENOM_TURNS], "re-opened, never stacked")


func test_does_not_haunt_the_dead() -> void:
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 12 and r < 20)
	var state: Dictionary = _room([_being("foe-1", "stinger", 5, 5), _you(6, 5, 1)], [], counter)
	var dead: Dictionary = SimApply.apply(
		state, _seal(SimCommands.attempt_move(state, "foe-1", 1, 0)))
	assert_eq(_hp(dead, "player"), 0)
	# A killing bite leaves no venom on a corpse, and rounds cost it nothing.
	var haunted := false
	for t: String in (_at(dead, "player")["tags"] as Array):
		if t.begins_with("venom-"):
			haunted = true
	assert_false(haunted)
	assert_eq(_hp(SimApply.apply(dead, _wrap(dead)), "player"), 0)


func test_is_priced_into_the_threat_it_spends_and_the_xp_it_pays() -> void:
	var stats: Variant = SimTables.creature_stats("stinger", 2)
	assert_not_null(stats, "the stinger is in the bestiary")
	assert_gt(SimTables.threat_of(stats, "stinger"), SimTables.threat_of(stats),
		"a verb that keeps costing costs more to kill")


# ── describe('the call') ──────────────────────────────────────────────────

## The reference's meeting(): a caller three tiles from the player, on a floor
## deep enough to have callers on it at all.
func _meeting(tags: Array = ["call"]) -> Dictionary:
	return _room([_being("caller-1", "caller", 5, 5, {"tags": tags}), _you(8, 5)])


func test_is_the_decision_when_prey_is_near_and_the_voice_unspent() -> void:
	assert_eq(SimAi.decide(_meeting(), "caller-1"), {"kind": "call"})
	# Spent voice: it hunts like anything else.
	assert_ne(SimAi.decide(_meeting([]), "caller-1")["kind"], "call")


func test_wakes_the_floor_at_a_chases_distance_with_every_draw_counted() -> void:
	var state: Dictionary = _meeting()
	var called: Variant = SimCommands.call_out(state, "caller-1")
	assert_not_null(called, "an open floor can always answer")
	var d: Dictionary = called
	var opponents: Array = (d["payload"] as Dictionary)["opponents"]
	assert_eq(opponents.size(), SimTables.CALL_RISERS)
	assert_eq(int(d["rngDraws"]), SimTables.CALL_RISERS * 2, "an archetype and a tile each")
	for o: Dictionary in opponents:
		var p: Dictionary = o["pos"]
		var away: int = absi(int(p["x"]) - 8) + absi(int(p["y"]) - 5)
		assert_gte(away, SimTables.CALL_DISTANCE, "risers arrive as a chase")
		# A caller never calls callers — one voice is a clock, a chain is a
		# fork bomb.
		assert_false(str(o["kind"]).begins_with("caller"))


func test_spends_the_voice_and_raises_exactly_what_was_recorded() -> void:
	var state: Dictionary = _meeting()
	var called: Dictionary = SimCommands.call_out(state, "caller-1")
	var after: Dictionary = SimApply.apply(state, _seal(called))

	assert_does_not_have(_at(after, "caller-1")["tags"], "call")
	for o: Dictionary in ((called["payload"] as Dictionary)["opponents"] as Array):
		var raised: Dictionary = _at(after, o["id"])
		assert_eq(raised["pos"], o["pos"])
		assert_eq(int(raised["maxHp"]), int((o["stats"] as Dictionary)["hp"]))
		assert_eq(raised["post"], o["pos"])
	# Called once: the decision never comes back.
	assert_ne(SimAi.decide(after, "caller-1")["kind"], "call")


func test_replays_exactly_same_world_same_cry_same_answers() -> void:
	var state: Dictionary = _meeting()
	assert_eq(
		SimCanonical.encode(SimCommands.call_out(state, "caller-1")),
		SimCanonical.encode(SimCommands.call_out(state, "caller-1")))


# ── describe('the teaching floor stays teachable') ────────────────────────

func test_never_seats_a_stinger_or_a_caller_on_depth_1() -> void:
	for seed in range(1, 13):
		var world: Dictionary = SimCommands.create_world(seed, 48, 32)
		for e: Dictionary in ((world["payload"] as Dictionary)["opponents"] as Array):
			assert_false(str(e["kind"]).begins_with("stinger"), "seed %d" % seed)
			assert_false(str(e["kind"]).begins_with("caller"), "seed %d" % seed)


func test_lets_them_in_once_the_lesson_is_over() -> void:
	# Somewhere in twenty deep floors the new kinds appear at all — the depth
	# gate is a gate, not a wall.
	var seen := false
	for seed in range(1, 21):
		if seen:
			break
		var world: Dictionary = SimCommands.create_world(seed, 48, 32, "player", 4)
		for e: Dictionary in ((world["payload"] as Dictionary)["opponents"] as Array):
			if str(e["kind"]).begins_with("stinger") or str(e["kind"]).begins_with("caller"):
				seen = true
				break
	assert_true(seen)


# ── non-reference ─────────────────────────────────────────────────────────

func test_the_calls_four_draws_come_from_four_CONSECUTIVE_counter_offsets() -> void:
	## NON-REFERENCE, and the answer to the blind spot Task 2.E3a MEASURED:
	## moving the strike's damage draw off `counter + 1` failed NOTHING across
	## 456 tests, because every damage assertion in the reference is a RANGE and
	## the golden run re-hashes rather than re-derives.
	##
	## The call has the same shape of hole and four times the exposure. :130
	## above asserts the COUNT (4) and the DISTANCE (>= CALL_DISTANCE), and both
	## survive any offset move: shift the tile draw by one and every riser still
	## lands on legal ground at a legal distance, on a chain that still
	## verifies. So the PROTOCOL is pinned instead — which offset each of the
	## four draws comes from, re-derived from SimRng here rather than read back
	## out of the command, so the two cannot move together.
	##
	## Every number below is a LITERAL, never read from the constant it guards:
	## the answering pool at depth 4 is skirmisher 3, bruiser 2, stalker 2,
	## stinger 2, slinger 2 — the caller barred BY VERB, the warden and the
	## mimic by weight 0 — for a total weight of 11; and CALL_DISTANCE is spelled
	## 6. Deriving the expectation from BESTIARY or CALL_DISTANCE would move the
	## goalposts with the constant, which is exactly how the reference's own
	## AWARENESS cases came to catch nothing.
	const POOL: Array = [["skirmisher", 3], ["bruiser", 2], ["stalker", 2],
		["stinger", 2], ["slinger", 2]]
	const TOTAL := 11
	const DISTANCE := 6

	var state: Dictionary = _meeting()
	var called: Dictionary = SimCommands.call_out(state, "caller-1")
	var opponents: Array = (called["payload"] as Dictionary)["opponents"]
	assert_eq(opponents.size(), 2, "two risers, four draws")
	assert_eq(int(called["rngCounter"]), 0, "the cry declares the counter it started from")
	assert_eq(int(called["rngDraws"]), 4)

	# The pool the test believes in is the pool the tables hold. Asserted, not
	# assumed — if the bestiary gains a spawnable archetype this test must fail
	# loudly rather than pin the wrong arithmetic.
	var live: Array = []
	var live_total := 0
	for a: Dictionary in SimTables.BESTIARY:
		var from_depth: int = int(a["fromDepth"]) if a.has("fromDepth") else 1
		if int(a["weight"]) > 0 and 4 >= from_depth and SimTables.verb_of(a["kind"]) != "call":
			live.append([a["kind"], int(a["weight"])])
			live_total += int(a["weight"])
	assert_eq(live, POOL, "the answering pool at depth 4")
	assert_eq(live_total, TOTAL)

	# ── draws 0 and 2: the archetypes ────────────────────────────────────
	assert_eq(opponents[0]["kind"], _walk_pool(POOL, SimRng.int_between(_SEED, 0, 1, TOTAL)),
		"riser 0's kind is drawn at counter + 0")
	assert_eq(opponents[1]["kind"], _walk_pool(POOL, SimRng.int_between(_SEED, 2, 1, TOTAL)),
		"riser 1's kind is drawn at counter + 2")

	# ── draws 1 and 3: the tiles ─────────────────────────────────────────
	# Rebuilt independently, in the grid's own y-then-x order, with riser 0's
	# tile occupied for riser 1's scan — which is why the second draw's RANGE
	# depends on the first draw's answer and the offsets cannot be shuffled.
	var taken: Array = [{"x": 5, "y": 5}, {"x": 8, "y": 5}]
	var first_field: Array = _tiles_at_least(state["grid"], taken, DISTANCE)
	var first_at: int = SimRng.int_between(_SEED, 1, 0, first_field.size() - 1)
	assert_eq(opponents[0]["pos"], first_field[first_at],
		"riser 0's tile is drawn at counter + 1")

	taken.append(opponents[0]["pos"])
	var second_field: Array = _tiles_at_least(state["grid"], taken, DISTANCE)
	var second_at: int = SimRng.int_between(_SEED, 3, 0, second_field.size() - 1)
	assert_eq(opponents[1]["pos"], second_field[second_at],
		"riser 1's tile is drawn at counter + 3")

	# The two indices differ, so a swapped pair of offsets could not pass by
	# coincidence — the guard against a pin that is accidentally vacuous.
	assert_ne(first_at, second_at, "the two tile draws are genuinely different numbers")


## One weighted walk over a literal pool, the reference's own loop. Kept here
## rather than reaching into SimStances so the expectation is independent of
## the code it checks.
func _walk_pool(pool: Array, pick: int) -> String:
	var n := pick
	for row: Array in pool:
		n -= int(row[1])
		if n <= 0:
			return row[0]
	return pool[0][0]


## Every passable, non-exit, unoccupied tile at least `distance` of straight
## ground from the PLAYER at (8, 5) — scanned y-then-x, the order the command
## builds its candidate list in. Written out longhand on purpose: a helper that
## called into SimStances would move with the code it is meant to pin.
func _tiles_at_least(grid: Dictionary, taken: Array, distance: int) -> Array:
	var out: Array = []
	for y in range(int(grid["height"])):
		for x in range(int(grid["width"])):
			if not SimGrid.is_passable(grid, x, y):
				continue
			if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
				continue
			if absi(x - 8) + absi(y - 5) < distance:
				continue
			var stood := false
			for t: Dictionary in taken:
				if int(t["x"]) == x and int(t["y"]) == y:
					stood = true
					break
			if stood:
				continue
			out.append({"x": x, "y": y})
	return out
