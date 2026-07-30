extends GutTest
## The player's verbs — the byte-twin of tests/core/player-verbs.test.ts. One
## test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye.
##
## The monsters got verbs and the player had none; these are the answer, and
## like the bestiary's they are tested against the real command layer and the
## real reducer.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 14 cases across three describe blocks.
## 14 = 13 PORTED + 1 DEFERRED. Line numbers are
## tests/core/player-verbs.test.ts at ts-baseline.
##
## describe('the shove') — 6, all PORTED
##   :68  drives an adjacent hostile one pace, spends no dice, hurts nobody
##   :85  slams a body into a wall: a point of harm and a reel, no ground gained
##   :99  treats the way out as a door frame, not a door
##   :104 tangles two bodies: both reel, nobody moves
##   :119 refuses thin air without spending the turn
##   :124 pays for a slam kill like any other kill
##
## describe('the stagger') — 2, one PORTED and one DEFERRED
##   :133 spends the creature's next action, as a recorded wait      PORTED
##   :146 stays silence for an ordinary creature wait                DEFERRED
##
## describe('the brace') — 6, all PORTED
##   :165 raises the bar by 2 + wits/2, and the recorded event says so
##   :180 staggers whatever misses the set guard
##   :188 holds the ground against a trample
##   :198 breaks the coiled spring: the bonus is absorbed, the coil still spends
##   :218 is set by its event and drops the moment its holder acts
##   :227 drops when the holder strikes out of it
##
## ── The one DEFERRAL, and who owns it ─────────────────────────────────────
## :146 "stays silence for an ordinary creature wait" asserts
## `draftFor(state, 'foe-1', { kind: 'wait' })` is NULL — that an UNstaggered
## creature's wait never becomes an event. `draftFor` is
## src/play/session.ts:156, not commands.ts, and nothing in `sim/` has ported
## it: the wait gate is the session's, and the session is **Phase 3's** (the
## master plan's "Task 3.0 — author the Phase 3 plan" is what schedules it;
## src/play/session.ts has no Phase 2 task at all).
##
## `SimStances.wait` drafts what it is asked for, unconditionally, exactly as
## the reference's `wait` does — so there is no gate in this layer for the case
## to be asserted against. What this file CAN hold, and does, is the
## discriminator the absent gate reads: :133 below drives the staggered half
## end to end, so when Phase 3 ports `draftFor` the only thing left to witness
## is the negative branch.
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## ONE test at the bottom of this file has no counterpart in the reference, so
## the file holds 14 cases for 13 ported + 1 of its own:
##   test_a_hidden_mimic_is_furniture_to_every_tool_of_this_family
## The reference tests the mimic's stillness only through the BUMP
## (tests/core/mimics.test.ts, Task 2.E3c's). Nothing anywhere exercises
## `shove_at`'s hidden refusal, `_shot_eligible`'s hidden refusal, or
## `decide()`'s feign branch — and all three are the same rule wearing three
## coats, so one test witnesses them together. Without it, a tool of THIS
## family would be the mimic detector the lie exists to prevent.


const _SEED := 5


## The reference's room(): an open 20x12 floor at depth 3. Walls, an exit and a
## starting counter are added per test where they matter.
func _room(entities: Array, walls: Array = [], exit_at: Variant = null, counter: int = 0) -> Dictionary:
	var width := 20
	var height := 12
	var tiles: Array = []
	for i in range(width * height):
		tiles.append(SimGrid.FLOOR)
	for w: Array in walls:
		tiles[int(w[1]) * width + int(w[0])] = SimGrid.WALL
	if exit_at != null:
		var e: Array = exit_at
		tiles[int(e[1]) * width + int(e[0])] = SimGrid.EXIT
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
		"depth": 3,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


## The reference's being(id, kind, x, y, { hp = 5, might = 4, speed = 3, tags }).
func _being(id: String, kind: String, x: int, y: int, o: Dictionary = {}) -> Dictionary:
	var hp: int = int(o["hp"]) if o.has("hp") else 5
	return {
		"id": id, "kind": kind, "pos": {"x": x, "y": y},
		"stats": {
			"hp": hp,
			"might": int(o["might"]) if o.has("might") else 4,
			"wits": 1,
			"speed": int(o["speed"]) if o.has("speed") else 3,
		},
		"tags": o["tags"] if o.has("tags") else [],
		"maxHp": int(o["maxHp"]) if o.has("maxHp") else hp,
	}


## The reference's you(x, y, hp = 10, tags = []).
func _you(x: int, y: int, hp: int = 10, tags: Array = []) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 3, "wits": 3, "speed": 4},
		"tags": tags, "maxHp": hp,
	}


## The reference's counterRolling(): the first counter whose d20 satisfies the
## predicate. A test that needs a particular ROLL asks for it rather than
## hunting a seed, which is what keeps these cases readable.
func _counter_rolling(predicate: Callable) -> int:
	for c in range(5000):
		if predicate.call(SimRng.int_between(_SEED, c, 1, 20)):
			return c
	assert_true(false, "no counter found — the generator or the range changed")
	return -1


## The reference's asEvent(): a draft becomes an event with the three fields
## SimApply does not read but SimLog would otherwise add.
func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "x"
	event["parent"] = null
	event["seq"] = 0
	return event


func _at(state: Dictionary, id: String) -> Dictionary:
	return SimEntity.find(state["entities"], id)


# ── describe('the shove') ─────────────────────────────────────────────────

func test_drives_an_adjacent_hostile_one_pace_spends_no_dice_hurts_nobody() -> void:
	var state: Dictionary = _room([_you(6, 5), _being("foe-1", "bruiser", 7, 5)])
	var draft: Variant = SimCommands.shove_at(state, "player", 1, 0)
	assert_not_null(draft, "an adjacent hostile is shovable")
	var d: Dictionary = draft
	# ZERO DRAWS, spelled as a literal: a tool you position with cannot gamble.
	assert_eq(int(d["rngDraws"]), 0, "the shove spends no dice")
	var p: Dictionary = d["payload"]
	assert_eq(p["to"], {"x": 8, "y": 5})
	assert_false(bool(p["slammed"]))
	assert_null(p["struckId"])

	var after: Dictionary = SimApply.apply(state, _seal(d))
	var foe: Dictionary = _at(after, "foe-1")
	assert_eq(foe["pos"], {"x": 8, "y": 5})
	assert_eq(int((foe["stats"] as Dictionary)["hp"]), 5, "open ground costs nothing")
	assert_does_not_have(foe["tags"], "staggered")


func test_slams_a_body_into_a_wall_a_point_of_harm_and_a_reel_no_ground_gained() -> void:
	var state: Dictionary = _room([_you(6, 5), _being("foe-1", "bruiser", 7, 5)], [[8, 5]])
	var d: Dictionary = SimCommands.shove_at(state, "player", 1, 0)
	var p: Dictionary = d["payload"]
	assert_true(bool(p["slammed"]))
	assert_null(p["to"])

	var after: Dictionary = SimApply.apply(state, _seal(d))
	var foe: Dictionary = _at(after, "foe-1")
	assert_eq(foe["pos"], {"x": 7, "y": 5}, "no ground gained")
	# 5 hp less the one point a wall costs. Both numbers literal.
	assert_eq(int((foe["stats"] as Dictionary)["hp"]), 4, "the wall is the argument")
	assert_has(foe["tags"], "staggered")


func test_treats_the_way_out_as_a_door_frame_not_a_door() -> void:
	var state: Dictionary = _room([_you(6, 5), _being("foe-1", "bruiser", 7, 5)], [], [8, 5])
	var d: Dictionary = SimCommands.shove_at(state, "player", 1, 0)
	assert_true(bool((d["payload"] as Dictionary)["slammed"]),
		"the stairs stop a body the way a wall does")


func test_tangles_two_bodies_both_reel_nobody_moves() -> void:
	var state: Dictionary = _room([
		_you(6, 5),
		_being("foe-1", "bruiser", 7, 5),
		_being("foe-2", "skirmisher", 8, 5),
	])
	var d: Dictionary = SimCommands.shove_at(state, "player", 1, 0)
	var p: Dictionary = d["payload"]
	assert_eq(p["struckId"], "foe-2")
	assert_null(p["to"])
	assert_false(bool(p["slammed"]), "a body is not a wall — no slam damage")

	var after: Dictionary = SimApply.apply(state, _seal(d))
	assert_has(_at(after, "foe-1")["tags"], "staggered")
	assert_has(_at(after, "foe-2")["tags"], "staggered")
	assert_eq(_at(after, "foe-1")["pos"], {"x": 7, "y": 5})
	assert_eq(_at(after, "foe-2")["pos"], {"x": 8, "y": 5})


func test_refuses_thin_air_without_spending_the_turn() -> void:
	var state: Dictionary = _room([_you(6, 5), _being("foe-1", "bruiser", 9, 9)])
	assert_null(SimCommands.shove_at(state, "player", 1, 0), "a mispress, not a turn")


func test_pays_for_a_slam_kill_like_any_other_kill() -> void:
	var state: Dictionary = _room(
		[_you(6, 5), _being("foe-1", "bruiser", 7, 5, {"hp": 1})], [[8, 5]])
	var after: Dictionary = SimApply.apply(
		state, _seal(SimCommands.shove_at(state, "player", 1, 0)))
	assert_eq(int((_at(after, "foe-1")["stats"] as Dictionary)["hp"]), 0)
	assert_eq(int(after["xp"]),
		SimTables.threat_of({"hp": 1, "might": 4, "wits": 1, "speed": 3}, "bruiser"),
		"a kill is a kill however it was dealt")


# ── describe('the stagger') ───────────────────────────────────────────────

func test_spends_the_creatures_next_action_as_a_recorded_wait() -> void:
	## The reference reaches the draft through `draftFor` (session.ts:156),
	## which is Phase 3's and not ported. What that function does for a
	## STAGGERED body is call `wait(state, entityId)` — so this drives the same
	## three facts it does: the mind decides to wait, the wait is a recorded
	## WAIT rather than silence, and applying it is what clears the reel.
	var state: Dictionary = _room(
		[_you(6, 5), _being("foe-1", "bruiser", 8, 5, {"tags": ["staggered"]})])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "wait"})
	# The gate draftFor reads, asserted where the ported layer can see it.
	assert_has(_at(state, "foe-1")["tags"], "staggered")

	var draft: Dictionary = SimCommands.wait(state, "foe-1")
	assert_eq(draft["type"], "WAIT")
	assert_eq(int(draft["rngDraws"]), 0, "reeling costs a turn, never a draw")

	var after: Dictionary = SimApply.apply(state, _seal(draft))
	assert_does_not_have(_at(after, "foe-1")["tags"], "staggered")
	# Recovered: the next decision hunts again.
	assert_ne(SimAi.decide(after, "foe-1")["kind"], "wait")


# :146 'stays silence for an ordinary creature wait' — DEFERRED to Phase 3's
# session port. See this file's header for the whole reason.


# ── describe('the brace') ─────────────────────────────────────────────────

## The bar a foe faces against the UNBRACED player, read off a real draft
## rather than recomputed — the reference's baseNeeded().
func _base_needed() -> int:
	var probe: Dictionary = _room([_being("foe-1", "bruiser", 5, 5), _you(6, 5)])
	var draft: Dictionary = SimCommands.attempt_move(probe, "foe-1", 1, 0)
	return int((draft["payload"] as Dictionary)["needed"])


func test_raises_the_bar_by_2_plus_wits_over_2_and_the_recorded_event_says_so() -> void:
	var needed := _base_needed()
	var wall := SimTables.brace_wall(3)
	# A roll that lands on the open player but breaks on the set guard.
	var counter := _counter_rolling(
		func(r: int) -> bool: return r >= needed and r < needed + wall and r < 20)

	var open: Dictionary = _room([_being("foe-1", "bruiser", 5, 5), _you(6, 5)], [], null, counter)
	var open_blow: Dictionary = (SimCommands.attempt_move(open, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_true(bool(open_blow["hit"]), "the same roll lands on bare skin")

	var set_up: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5, 10, ["braced"])], [], null, counter)
	var set_blow: Dictionary = (SimCommands.attempt_move(set_up, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_eq(int(set_blow["needed"]), needed + wall, "the event says the bar it faced")
	assert_false(bool(set_blow["hit"]))


func test_staggers_whatever_misses_the_set_guard() -> void:
	var needed := _base_needed()
	var wall := SimTables.brace_wall(3)
	var counter := _counter_rolling(
		func(r: int) -> bool: return r >= needed and r < needed + wall and r < 20)
	var state: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5, 10, ["braced"])], [], null, counter)
	var after: Dictionary = SimApply.apply(
		state, _seal(SimCommands.attempt_move(state, "foe-1", 1, 0)))
	assert_has(_at(after, "foe-1")["tags"], "staggered", "overcommitment reels")


func test_holds_the_ground_against_a_trample() -> void:
	var needed := _base_needed()
	var wall := SimTables.brace_wall(3)
	# A blow that lands even against the guard — and still cannot shove.
	var counter := _counter_rolling(func(r: int) -> bool: return r >= needed + wall and r < 20)
	var state: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5, 10, ["braced"])], [], null, counter)
	var blow: Dictionary = (SimCommands.attempt_move(state, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_true(bool(blow["hit"]))
	# ABSENT, not null: the trample's field is written only when it happened.
	assert_false(blow.has("targetTo"), "the set guard is not driven back")


func test_breaks_the_coiled_spring_the_bonus_is_absorbed_the_coil_still_spends() -> void:
	var needed := _base_needed()
	var counter := _counter_rolling(
		func(r: int) -> bool: return r >= needed + SimTables.brace_wall(3) and r < 20)
	var might := 4

	var sprung: Dictionary = _room([
		_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"], "might": might}),
		_you(6, 5, 20),
	], [], null, counter)
	var set_up: Dictionary = _room([
		_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"], "might": might}),
		_you(6, 5, 20, ["braced"]),
	], [], null, counter)

	var open_blow: Dictionary = (SimCommands.attempt_move(sprung, "foe-1", 1, 0) as Dictionary)["payload"]
	var set_blow: Dictionary = (SimCommands.attempt_move(set_up, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_true(bool(open_blow["hit"]))
	assert_true(bool(set_blow["hit"]))
	# Same dice, one band apart: the guard ate exactly the spring's bonus.
	assert_lt(int(set_blow["damage"]), int(open_blow["damage"]))
	# The coil is spent either way — no second spring against bare skin.
	assert_eq(set_blow["ambush"], true)
	var after: Dictionary = SimApply.apply(
		set_up, _seal(SimCommands.attempt_move(set_up, "foe-1", 1, 0)))
	assert_does_not_have(_at(after, "foe-1")["tags"], "ambush")


func test_is_set_by_its_event_and_drops_the_moment_its_holder_acts() -> void:
	var state: Dictionary = _room([_you(6, 5), _being("foe-1", "bruiser", 9, 9)])
	var brace: Dictionary = SimCommands.brace_self(state, "player")
	assert_eq(int(brace["rngDraws"]), 0, "the brace spends no dice")
	var braced: Dictionary = SimApply.apply(state, _seal(brace))
	assert_has(_at(braced, "player")["tags"], "braced")

	var moved: Dictionary = SimApply.apply(
		braced, _seal(SimCommands.attempt_move(braced, "player", 0, 1)))
	assert_does_not_have(_at(moved, "player")["tags"], "braced")


func test_drops_when_the_holder_strikes_out_of_it() -> void:
	var state: Dictionary = _room(
		[_you(6, 5, 10, ["braced"]), _being("foe-1", "bruiser", 7, 5)])
	var after: Dictionary = SimApply.apply(
		state, _seal(SimCommands.attempt_move(state, "player", 1, 0)))
	assert_does_not_have(_at(after, "player")["tags"], "braced")


# ── non-reference ─────────────────────────────────────────────────────────

func test_a_hidden_mimic_is_furniture_to_every_tool_of_this_family() -> void:
	## NON-REFERENCE. The mimic's lie is tested through the BUMP in
	## tests/core/mimics.test.ts (Task 2.E3c's file). Nothing in the reference
	## points a STANCE verb at a hidden mimic, so three guards ship unwitnessed:
	## `shove_at`'s hidden refusal (commands.ts:1110), `_shot_eligible`'s
	## (commands.ts:1165), and `decide()`'s feign branch (ai.ts, ai.gd:230).
	## All three say the same thing — an item that can be shoved, shot or seen
	## fidgeting is no item — so one test holds them together. Any of the three
	## alone would turn a key of THIS family into the mimic detector the lie
	## exists to prevent.
	var state: Dictionary = _room([
		_you(6, 5),
		# Adjacent, so the shove has real geometry to refuse on.
		_being("foe-1", "mimic", 7, 5, {"tags": ["hidden"]}),
		# Three tiles SOUTH — off the first mimic's line, so nothing but the
		# `hidden` tag can be what refuses it: inside SHOT_RANGE (5), past the
		# bump's tile, and with clear ground the whole way.
		_being("foe-2", "mimic", 6, 8, {"tags": ["hidden"]}),
	])
	assert_null(SimCommands.shove_at(state, "player", 1, 0), "you cannot shove furniture")
	assert_null(SimCommands.shot_target(state, "player"), "the mark never volunteers a mimic")

	# And the lie holds from the inside: a hidden mimic does not move at all.
	assert_eq(SimAi.decide(state, "foe-2"), {"kind": "wait"}, "an item that fidgets is no item")

	# The precondition, so this cannot go quietly vacuous: unmask the far one
	# and the very same tools find it.
	var seen: Array = []
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != "foe-2":
			seen.append(e)
			continue
		var plain: Dictionary = e.duplicate()
		plain["tags"] = []
		seen.append(plain)
	var open_state: Dictionary = state.duplicate()
	open_state["entities"] = seen
	assert_eq((SimCommands.shot_target(open_state, "player") as Dictionary)["id"], "foe-2",
		"unmasked, it is a mark like any other")
	assert_ne(SimAi.decide(open_state, "foe-2")["kind"], "wait", "unmasked, it fights plain")
