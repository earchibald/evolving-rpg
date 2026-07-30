extends GutTest
## sense_trap / spring_trap — the byte-twin of tests/core/traps.test.ts (17
## cases across four describe blocks). One test per TS `it(...)`, in the TS
## file's order, so the two suites can be diffed by eye.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## 17 = 16 PORTED + 1 DEFERRED. Line numbers are tests/core/traps.test.ts at
## ts-baseline.
##
## describe('sensing') — 3, all PORTED
##   :56  offers the sight chance once, records the miss, and never asks again
##   :75  offers the near chance up close, easier, once
##   :87  a revealed trap asks for nothing more
##
## describe('springing') — 11, all PORTED
##   :94  the spike pit rolls the dodge and the die either way — the counter
##        never depends on the outcome
##   :119 the needle allows no dodge until the player has earned one (level 3)
##   :129 the snare roots the leg: steps become the strain, blows still
##        swing, rounds slacken it
##   :154 the snare cannot be dodged around: some seed holds, some seed slips
##   :166 the alarm rings on a clock, and the ringing floor hunts past the
##        awareness cap
##   :177 the ringing bell takes posted guards off their posts — the filing
##        that said it attracted nobody
##   :193 the bell rings longer on a bigger board, so the summons can be
##        answered at all
##   :202 a trap is still usually found, but missing one is now an ordinary
##        event
##   :216 the hatch stands its risers up inside the band — never beside you —
##        and the reducer seats them
##   :231 the lodestone sets you down far away, on ground something could
##        stand on
##   :242 trap events ride the action: neither sensing nor springing spends a
##        turn of its own
##
## describe('the session settles the floor') — 1, DEFERRED
##   :250 "a step onto a trap springs it on the chain, and the sweep rolls
##        the chances" — needs `playerStep` (src/play/session.ts) to walk
##        the settleTraps loop (spring, then sense, until silence) on top of
##        attemptMove. session.ts is Phase 3 (the stage) territory: the
##        master plan (docs/superpowers/plans/2026-07-29-godot-migration-
##        master-plan.md:750) names `src/play/{session,store}.ts` as an
##        input to Task 3.0, which has not run — there is no godot/stage/
##        yet and no task number to hand this to more precisely than
##        "whichever Phase 3 task ports session.ts's settleTraps". Nothing
##        about the deferred case touches sense_trap or spring_trap
##        themselves: it tests that a SESSION-LAYER wrapper calls them in a
##        loop, which is a fact about session.ts, not about this file.
##
## describe('generation lays the field') — 2, all PORTED
##   :280 none on the teaching floor; counted by depth and stretch; never on
##        a prize, a body or the door
##   :299 the maw never lies on the bottom — there is no floor below the
##        bottom
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## THREE tests below have no counterpart in traps.test.ts. This task's own
## brief names the exact blind spot they close: "Traps are where your draw
## arithmetic lives — two recorded wits chances per trap... a range assertion
## cannot see a draw move." None of the 16 ported cases above independently
## recomputes an expected roll via SimRng and compares it to the draft's own
## — they check existence, band membership, or relative ordering, which is
## exactly the shape of assertion Task 2.E3a's own mutation sweep proved
## blind to a shifted draw offset (movement.gd's "strike's two draws" hole).
##
##   test_the_sense_rolls_needed_and_counter_are_pinned_not_merely_counted
##   test_the_near_rolls_needed_is_the_near_bases_own_arithmetic
##   test_the_spike_pits_damage_is_the_consecutive_draw_right_after_its_dodge
##
## A fourth closes a different hole this task's brief also names by name:
## "Hatch risers are level-1 bodies, not floor-band." Reference case :216
## checks the riser's POSITION only; nothing anywhere pins its LEVEL, so a
## regression reading the floor's own depth (or the trap's own level) back
## into the riser's stats would pass every ported case above.
##
##   test_hatch_risers_are_level_1_bodies_never_the_floors_own_band


func _corridor(entities: Array, traps: Array, over: Dictionary = {}) -> Dictionary:
	var width := 26
	var height := 3
	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.WALL)
	for x in range(1, width - 1):
		tiles[width + x] = SimGrid.FLOOR
	var state: Dictionary = SimState.empty()
	state["grid"] = SimGrid.make(width, height, tiles)
	state["entities"] = entities
	state["turn"] = 1
	state["activeEntityId"] = entities[0]["id"] if entities.size() > 0 else null
	state["seed"] = 7
	state["depth"] = 4
	state["traps"] = traps
	state.merge(over, true)
	return state


func _you(x: int, over: Dictionary = {}) -> Dictionary:
	var e: Dictionary = {
		"id": "player", "kind": "you", "pos": {"x": x, "y": 1},
		"stats": {"hp": 12, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 12,
	}
	e.merge(over, true)
	return e


func _foe(x: int) -> Dictionary:
	return {
		"id": "foe-1", "kind": "bruiser", "pos": {"x": x, "y": 1},
		"stats": {"hp": 7, "might": 4, "wits": 1, "speed": 1}, "tags": [], "maxHp": 7,
	}


func _trap(kind: String, x: int, over: Dictionary = {}) -> Dictionary:
	var t: Dictionary = {
		"id": "trap-1", "kind": kind, "pos": {"x": x, "y": 1}, "level": 2,
		"sightRolled": false, "nearRolled": false, "revealed": false, "sprung": false,
	}
	t.merge(over, true)
	return t


## The reference's seal(): a draft becomes an event with the three fields
## SimApply does not read but SimLog would otherwise add.
func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return event


# ── describe('sensing') ───────────────────────────────────────────────────

func test_offers_the_sight_chance_once_records_the_miss_and_never_asks_again() -> void:
	var state: Dictionary = _corridor([_you(5)], [_trap("spike pit", 10)])
	var first: Variant = SimCommands.sense_trap(state, "player")
	assert_not_null(first)
	var first_draft: Dictionary = first
	assert_eq((first_draft["payload"] as Dictionary)["method"], "sight")
	assert_eq(int(first_draft["rngDraws"]), 1)

	var after: Dictionary = SimApply.apply(state, _seal(first_draft))
	var again: Variant = SimCommands.sense_trap(after, "player")
	var after_trap0: Dictionary = (after["traps"] as Array)[0]
	# Whatever the roll said, the sight chance is spent; only the near chance
	# could remain, and at 5 steps away (TRAP_NEAR_RADIUS is 2) it is not
	# offered either way.
	if bool(after_trap0["revealed"]):
		assert_null(again)
	else:
		assert_true(bool(after_trap0["sightRolled"]))
		assert_null(again)


func test_offers_the_near_chance_up_close_easier_once() -> void:
	var trap_at_10: Dictionary = _trap("spike pit", 10, {"sightRolled": true})
	var state: Dictionary = _corridor([_you(9)], [trap_at_10])
	assert_true(absi(10 - 9) <= SimTables.TRAP_NEAR_RADIUS)
	var near: Variant = SimCommands.sense_trap(state, "player")
	assert_not_null(near)
	var near_draft: Dictionary = near
	assert_eq((near_draft["payload"] as Dictionary)["method"], "near")

	# Closer is louder: the near roll's bar sits below the sight roll's.
	var sight: Variant = SimCommands.sense_trap(
		_corridor([_you(5)], [_trap("spike pit", 10)]), "player")
	assert_not_null(sight)
	var sight_draft: Dictionary = sight
	assert_lt(
		int((near_draft["payload"] as Dictionary)["needed"]),
		int((sight_draft["payload"] as Dictionary)["needed"]))


func test_a_revealed_trap_asks_for_nothing_more() -> void:
	var state: Dictionary = _corridor([_you(9)], [_trap("spike pit", 10, {"revealed": true})])
	assert_null(SimCommands.sense_trap(state, "player"))


# ── describe('springing') ─────────────────────────────────────────────────

func test_the_spike_pit_rolls_the_dodge_and_the_die_either_way_the_counter_never_depends_on_the_outcome() -> void:
	var dodged_once := false
	var bled_once := false
	var seed := 1
	while seed < 60 and not (dodged_once and bled_once):
		var state: Dictionary = _corridor([_you(10)], [_trap("spike pit", 10)], {"seed": seed})
		var sprung: Dictionary = SimCommands.spring_trap(state, "player")
		var payload: Dictionary = sprung["payload"]
		assert_not_null(payload["dodge"])
		assert_eq(int(sprung["rngDraws"]), 2)
		var after: Dictionary = SimApply.apply(state, _seal(sprung))
		var after_trap: Dictionary = (after["traps"] as Array)[0]
		assert_true(bool(after_trap["sprung"]))
		assert_true(bool(after_trap["revealed"]))
		var player: Dictionary = (after["entities"] as Array)[0]
		var hp: int = int((player["stats"] as Dictionary)["hp"])
		if bool(payload["dodged"]):
			dodged_once = true
			assert_eq(hp, 12)
		else:
			bled_once = true
			var effect: Dictionary = payload["effect"]
			assert_eq(effect["kind"], "spikes")
			assert_eq(hp, 12 - int(effect["damage"]))
		seed += 1
	assert_true(dodged_once and bled_once)


func test_the_needle_allows_no_dodge_until_the_player_has_earned_one_level_3() -> void:
	var green: Dictionary = _corridor([_you(10)], [_trap("venom needle", 10)])
	var green_sprung: Dictionary = SimCommands.spring_trap(green, "player")
	assert_null((green_sprung["payload"] as Dictionary)["dodge"])

	var seasoned: Dictionary = _corridor([_you(10)], [_trap("venom needle", 10)], {"level": 3})
	var seasoned_sprung: Dictionary = SimCommands.spring_trap(seasoned, "player")
	assert_not_null((seasoned_sprung["payload"] as Dictionary)["dodge"])

	var bitten: Dictionary = SimApply.apply(green, _seal(green_sprung))
	var bitten_player: Dictionary = (bitten["entities"] as Array)[0]
	assert_true((bitten_player["tags"] as Array).has("venom-%d" % SimTables.NEEDLE_VENOM_TURNS))


func test_the_snare_roots_the_leg_steps_become_the_strain_blows_still_swing_rounds_slacken_it() -> void:
	var base: Dictionary = _corridor([_you(10), _foe(11)], [_trap("strangling snare", 10)], {"seed": 3})
	var sprung: Dictionary = SimCommands.spring_trap(base, "player")
	var snared: Dictionary = SimApply.apply(base, _seal(sprung))
	var me: Dictionary = SimEntity.find(snared["entities"], "player")
	var is_snared := false
	for t: String in (me["tags"] as Array):
		if t.begins_with("snared-"):
			is_snared = true
			break
	if not is_snared:
		return # dodged on this seed — covered by the seed sweep below

	# A step away is the strain — a recorded WAIT, honestly spent.
	assert_eq((SimCommands.attempt_move(snared, "player", -1, 0) as Dictionary)["type"], "WAIT")
	# The bump still owns the blow.
	assert_eq((SimCommands.attempt_move(snared, "player", 1, 0) as Dictionary)["type"], "STRIKE")

	# The rounds slacken it: wrap the turn SNARE_TURNS times, tag gone.
	var s: Dictionary = snared
	for round_i in range(SimTables.SNARE_TURNS):
		var turn_draft: Dictionary = SimEvents.draft("TURN_ADVANCED", int(s["rngCounter"]), 0, {
			"activeEntityId": "player", "turn": int(s["turn"]) + 1,
		})
		s = SimApply.apply(s, _seal(turn_draft))
	var final_me: Dictionary = SimEntity.find(s["entities"], "player")
	var still_snared := false
	for t: String in (final_me["tags"] as Array):
		if t.begins_with("snared-"):
			still_snared = true
			break
	assert_false(still_snared)


func test_the_snare_cannot_be_dodged_around_some_seed_holds_some_seed_slips() -> void:
	var held := false
	var slipped := false
	var seed := 1
	while seed < 60 and not (held and slipped):
		var state: Dictionary = _corridor([_you(10)], [_trap("strangling snare", 10)], {"seed": seed})
		var sprung: Dictionary = SimCommands.spring_trap(state, "player")
		if bool((sprung["payload"] as Dictionary)["dodged"]):
			slipped = true
		else:
			held = true
		seed += 1
	assert_true(held and slipped)


func test_the_alarm_rings_on_a_clock_and_the_ringing_floor_hunts_past_the_awareness_cap() -> void:
	var state: Dictionary = _corridor([_you(3), _foe(22)], [_trap("alarm bell", 3)])
	var sprung: Dictionary = SimCommands.spring_trap(state, "player")
	var rung: Dictionary = SimApply.apply(state, _seal(sprung))
	assert_eq(rung["alarm"], {"until": int(state["turn"]) + SimTables.ALARM_TURNS})

	# 19 steps away — far past AWARENESS 8. Quiet, the bruiser stands;
	# ringing, it comes.
	var quiet: Dictionary = rung.duplicate(true)
	quiet["alarm"] = null
	assert_eq(SimAi.decide(quiet, "foe-1"), {"kind": "wait"})
	assert_eq(SimAi.decide(rung, "foe-1"), {"kind": "step", "dx": -1, "dy": 0})


func test_the_ringing_bell_takes_posted_guards_off_their_posts_the_filing_that_said_it_attracted_nobody() -> void:
	var posted: Dictionary = _foe(22)
	posted["disposition"] = "guard"
	posted["post"] = {"x": 22, "y": 1}
	var state: Dictionary = _corridor([_you(3), posted], [_trap("alarm bell", 3)])
	var sprung: Dictionary = SimCommands.spring_trap(state, "player")
	var rung: Dictionary = SimApply.apply(state, _seal(sprung))

	# Quiet: the leash holds it home (GUARD_LEASH 4, the player 19 away).
	var quiet: Dictionary = rung.duplicate(true)
	quiet["alarm"] = null
	assert_eq(SimAi.decide(quiet, "foe-1"), {"kind": "wait"})
	# Ringing: it leaves the post and comes.
	assert_eq(SimAi.decide(rung, "foe-1"), {"kind": "step", "dx": -1, "dy": 0})


func test_the_bell_rings_longer_on_a_bigger_board_so_the_summons_can_be_answered_at_all() -> void:
	assert_eq(SimTables.alarm_turns(1), SimTables.ALARM_TURNS)
	assert_eq(SimTables.alarm_turns(2), 2 * SimTables.ALARM_TURNS)
	assert_eq(SimTables.alarm_turns(3), 3 * SimTables.ALARM_TURNS)


func test_a_trap_is_still_usually_found_but_missing_one_is_now_an_ordinary_event() -> void:
	var wits := 6
	var level: int = SimTables.trap_level_at(6)
	var chance := func(need: int) -> float:
		return float(clampi(21 - (need + 2 * level - wits), 0, 20)) / 20.0
	var found: float = 1.0 - (1.0 - chance.call(SimTables.TRAP_SIGHT_NEED)) \
		* (1.0 - chance.call(SimTables.TRAP_NEAR_NEED))
	assert_gt(found, 0.6)
	assert_lt(found, 0.85)


func test_the_hatch_stands_its_risers_up_inside_the_band_never_beside_you_and_the_reducer_seats_them() -> void:
	var state: Dictionary = _corridor([_you(10)], [_trap("hatch", 10)])
	var sprung: Dictionary = SimCommands.spring_trap(state, "player")
	var payload: Dictionary = sprung["payload"]
	var effect: Dictionary = payload["effect"]
	assert_eq(effect["kind"], "hatch")
	var opponents: Array = effect["opponents"]
	assert_eq(opponents.size(), 1)
	var riser: Dictionary = opponents[0]
	var rpos: Dictionary = riser["pos"]
	var away := absi(int(rpos["x"]) - 10) + absi(int(rpos["y"]) - 1)
	assert_gte(away, SimTables.HATCH_BAND[0])
	assert_lte(away, SimTables.HATCH_BAND[1])

	var after: Dictionary = SimApply.apply(state, _seal(sprung))
	var found := false
	for e: Dictionary in (after["entities"] as Array):
		if e["id"] == riser["id"]:
			found = true
			break
	assert_true(found)


func test_the_lodestone_sets_you_down_far_away_on_ground_something_could_stand_on() -> void:
	var state: Dictionary = _corridor([_you(10)], [_trap("lodestone", 10)])
	var sprung: Dictionary = SimCommands.spring_trap(state, "player")
	var payload: Dictionary = sprung["payload"]
	var effect: Dictionary = payload["effect"]
	assert_eq(effect["kind"], "lodestone")
	var to: Dictionary = effect["to"]
	assert_gte(absi(int(to["x"]) - 10) + absi(int(to["y"]) - 1), 8)
	var after: Dictionary = SimApply.apply(state, _seal(sprung))
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq(player["pos"], to)


func test_trap_events_ride_the_action_neither_sensing_nor_springing_spends_a_turn_of_its_own() -> void:
	var state: Dictionary = _corridor([_you(5)], [_trap("spike pit", 10)])
	assert_false(SimCommands.ends_turn(SimCommands.sense_trap(state, "player")))
	assert_false(SimCommands.ends_turn(
		SimCommands.spring_trap(_corridor([_you(10)], [_trap("spike pit", 10)]), "player")))


# ── describe('the session settles the floor') ────────────────────────────
# :250 "a step onto a trap springs it on the chain, and the sweep rolls the
# chances" — DEFERRED. See the file header's reconciliation.


# ── describe('generation lays the field') ─────────────────────────────────

func test_none_on_the_teaching_floor_counted_by_depth_and_stretch_never_on_a_prize_a_body_or_the_door() -> void:
	assert_eq(SimTables.trap_count(1, 3), 0)
	for seed: int in [3, 15, 44]:
		var d1: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 1)
		var d1_traps: Array = (d1["payload"] as Dictionary).get("traps", [])
		assert_eq(d1_traps.size(), 0)

		var d4: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 4)
		var d4_payload: Dictionary = d4["payload"]
		var laid: Array = d4_payload.get("traps", [])
		assert_gt(laid.size(), 0)
		assert_lte(laid.size(), SimTables.trap_count(4, 2))
		var kinds: Array = []
		for k: Dictionary in SimTables.trap_kinds_at(4):
			kinds.append(k["kind"])
		var items: Array = d4_payload["items"]
		var opponents: Array = d4_payload["opponents"]
		for t: Dictionary in laid:
			assert_true(kinds.has(t["kind"]), "seed %d: %s is not a depth-4 kind" % [seed, t["kind"]])
			var tp: Dictionary = t["pos"]
			var on_item := false
			for i: Dictionary in items:
				var ip: Dictionary = i["pos"]
				if int(ip["x"]) == int(tp["x"]) and int(ip["y"]) == int(tp["y"]):
					on_item = true
					break
			assert_false(on_item, "seed %d: a trap lies on a prize" % seed)
			var on_opp := false
			for o: Dictionary in opponents:
				var op: Dictionary = o["pos"]
				if int(op["x"]) == int(tp["x"]) and int(op["y"]) == int(tp["y"]):
					on_opp = true
					break
			assert_false(on_opp, "seed %d: a trap lies on an opponent" % seed)


func test_the_maw_never_lies_on_the_bottom_there_is_no_floor_below_the_bottom() -> void:
	var has_maw_9 := false
	for k: Dictionary in SimTables.trap_kinds_at(9):
		if k["kind"] == "the maw":
			has_maw_9 = true
	assert_false(has_maw_9)
	var has_maw_8 := false
	for k: Dictionary in SimTables.trap_kinds_at(8):
		if k["kind"] == "the maw":
			has_maw_8 = true
	assert_true(has_maw_8)


# ── non-reference: the draw-arithmetic blind spot this task's brief names ──

func test_the_sense_rolls_needed_and_counter_are_pinned_not_merely_counted() -> void:
	## NON-REFERENCE — the blind spot this task's own brief names by name:
	## "a range assertion cannot see a draw move." rngDraws == 1 (ported
	## above) proves a single draw happened; it never proves WHICH counter it
	## read. A mutant reading the sight roll from counter + 1 while still
	## declaring rngCounter == state.rngCounter and rngDraws == 1 would pass
	## every ported case in this file — none of them recomputes the roll
	## independently. Recomputed here via SimRng directly, never through
	## sense_trap's own return, so the two genuinely cannot move together.
	var state: Dictionary = _corridor([_you(5)], [_trap("spike pit", 10)], {"rngCounter": 40})
	var draft: Dictionary = SimCommands.sense_trap(state, "player")
	var payload: Dictionary = draft["payload"]
	assert_eq(int(draft["rngCounter"]), 40)
	# needed = TRAP_SIGHT_NEED(14) + 2*level(2*2=4) - wits(3) = 15. Spelled
	# as literals per the brief: a test must never derive its expectation
	# from the constant it guards.
	assert_eq(int(payload["needed"]), 15)
	assert_eq(int(payload["roll"]), SimRng.int_between(7, 40, 1, 20),
		"the roll is drawn at the state's own counter, not some other offset")


func test_the_near_rolls_needed_is_the_near_bases_own_arithmetic() -> void:
	## NON-REFERENCE, companion to the sight-side pin above. Distinguishes
	## the near chance's base (TRAP_NEAR_NEED, 11) from the sight chance's
	## (14) by literal arithmetic rather than by import — a drift in
	## _sensed's own base selection would still land in a plausible d20 band
	## and could still pass the ported ordering case (":75", which only
	## checks near.needed < sight.needed) if both bases drifted together.
	var trap_rolled: Dictionary = _trap("spike pit", 10, {"sightRolled": true})
	var state: Dictionary = _corridor([_you(9)], [trap_rolled], {"rngCounter": 20})
	var draft: Dictionary = SimCommands.sense_trap(state, "player")
	var payload: Dictionary = draft["payload"]
	assert_eq(payload["method"], "near")
	# needed = TRAP_NEAR_NEED(11) + 2*level(2*2=4) - wits(3) = 12.
	assert_eq(int(payload["needed"]), 12)
	assert_eq(int(payload["roll"]), SimRng.int_between(7, 20, 1, 20))


func test_the_spike_pits_damage_is_the_consecutive_draw_right_after_its_dodge() -> void:
	## NON-REFERENCE, closing the same blind spot from the springing side.
	## rngDraws == 2 (ported above) proves two draws happened; it does not
	## prove the second is counter + 1 rather than some other offset that
	## still nets two draws' worth of advance — exactly the divergence class
	## Task 2.E3a's own mutation sweep found invisible to every range
	## assertion in the reference suite (movement.gd's strike-damage-draw
	## mutation, MEASURED at 456/456 passing before its own pinning test
	## existed). Scanned to a seed where the dodge fails, so the damage
	## effect actually resolves and there is a second draw to pin.
	var seed := 1
	while seed < 60:
		var state: Dictionary = _corridor([_you(10)], [_trap("spike pit", 10)], {"seed": seed})
		var start: int = int(state["rngCounter"])
		var sprung: Dictionary = SimCommands.spring_trap(state, "player")
		var payload: Dictionary = sprung["payload"]
		var dodge: Dictionary = payload["dodge"]
		assert_eq(int(dodge["roll"]), SimRng.int_between(seed, start, 1, 20), "the dodge is draw one")
		if not bool(payload["dodged"]):
			var effect: Dictionary = payload["effect"]
			# damage = 1d(SPIKE_DIE) + floor(depth/2); depth is 4, so +2.
			var expected_damage := SimRng.int_between(seed, start + 1, 1, SimTables.SPIKE_DIE) + 2
			assert_eq(int(effect["damage"]), expected_damage,
				"the damage is draw two, immediately after the dodge")
			return
		seed += 1
	assert_true(false, "no seed under 60 failed the dodge")


func test_hatch_risers_are_level_1_bodies_never_the_floors_own_band() -> void:
	## NON-REFERENCE, and named in this task's own brief as a hazard: "Hatch
	## risers are level-1 bodies, not floor-band" (commands.ts:991-996, kept
	## on purpose after measurement — floor-band risers fed the depth-5
	## brawler 14/20 survival against a pinned ceiling of 13). Reference case
	## :216 pins the riser's POSITION only; nothing anywhere pins its LEVEL,
	## so this rule shipped with no witness until now. Depth 8 and the trap's
	## own level (3) are both deliberately NOT 1, so a regression reading
	## either back into the riser's stats cannot hide behind a coincidence.
	var state: Dictionary = _corridor(
		[_you(10)], [_trap("hatch", 10, {"level": 3})], {"depth": 8})
	var sprung: Dictionary = SimCommands.spring_trap(state, "player")
	var effect: Dictionary = (sprung["payload"] as Dictionary)["effect"]
	var riser: Dictionary = (effect["opponents"] as Array)[0]
	var level_1_stats: Dictionary = SimTables.creature_stats(riser["kind"], 1)
	assert_eq(riser["stats"], level_1_stats)
