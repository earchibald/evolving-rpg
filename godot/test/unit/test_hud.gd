extends GutTest
## Hud — what the run looks like from inside it.
##
## RECONCILIATION: 0 reference cases ported. The web UI's status column is
## rendered inline in `src/ui/debug.ts` with no suite of its own, so every case
## here is NON-REFERENCE, written against the Phase 3 plan's contract.
##
## These assert what the HUD BELIEVES — the `shown` dictionary — not what it
## draws. A label's text is a rendering of that belief and changes with the
## font; the belief is the thing that can be wrong in a way that matters.


func _tiles(n: int) -> Array:
	var out: Array = []
	for i in range(n):
		out.append(SimGrid.FLOOR)
	return out


func _world() -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 5, "height": 5, "tiles": _tiles(25), "seed": 7,
		"items": [], "opponents": [],
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 8, "might": 4, "wits": 3, "speed": 5}, "tags": [],
		},
		"playerGold": 6, "xp": 40, "level": 3, "depth": 4,
		"playerSatchel": {"kinds": ["vital draught", "ash ward"]},
		"playerScroll": {"kind": "unveiling"},
	})


func before_each() -> void:
	Chronicle.reset()


func after_all() -> void:
	Chronicle.reset()


func test_it_reads_every_number_out_of_the_fold() -> void:
	Chronicle.commit(_world())
	var hud := Hud.new()
	var shown: Dictionary = hud.read(Chronicle.state())

	assert_true(shown["alive"])
	assert_eq(shown["hp"], 8)
	assert_eq(shown["might"], 4)
	assert_eq(shown["wits"], 3)
	assert_eq(shown["speed"], 5)
	assert_eq(shown["depth"], 4)
	assert_eq(shown["turn"], 1)
	hud.free()


func test_the_derived_numbers_come_from_the_state_not_from_counting() -> void:
	## xp, level and gold are folded from history and never stored (covenant
	## M9). A HUD that kept a running total would drift the first time an event
	## arrived twice, out of order, or during a rewind — so it reads them, and
	## this is the test that says so.
	Chronicle.commit(_world())
	var hud := Hud.new()
	var shown: Dictionary = hud.read(Chronicle.state())
	assert_eq(shown["xp"], 40, "the ladder is read, not tallied")
	assert_eq(shown["level"], 3)
	assert_eq(shown["gold"], 6, "the purse is folded, not counted")
	hud.free()


func test_reading_the_same_state_twice_says_the_same_thing() -> void:
	## The property that makes it correct under a rewind for free: no counters
	## between calls, so the answer depends only on the argument.
	Chronicle.commit(_world())
	var hud := Hud.new()
	var first: Dictionary = hud.read(Chronicle.state()).duplicate(true)
	hud.read(Chronicle.state())
	hud.read(Chronicle.state())
	var last: Dictionary = hud.read(Chronicle.state())
	assert_eq(SimCanonical.encode(first), SimCanonical.encode(last),
		"the panel keeps no memory between readings")
	hud.free()


func test_the_gold_it_shows_follows_the_purse_the_chain_folded() -> void:
	Chronicle.commit(_world())
	var hud := Hud.new()
	assert_eq(hud.read(Chronicle.state())["gold"], 6)
	Chronicle.commit(SimEvents.draft("GOLD_MOVED", 0, 0, {"delta": 5, "reason": "loot"}))
	assert_eq(hud.read(Chronicle.state())["gold"], 11, "six and five, read off the fold")
	Chronicle.commit(SimEvents.draft("GOLD_MOVED", 0, 0, {"delta": -3, "reason": "spent"}))
	assert_eq(hud.read(Chronicle.state())["gold"], 8)
	hud.free()


func test_the_satchel_and_the_scroll_hand_are_read_by_absence_not_by_null() -> void:
	## `satchel` and `scroll` are ABSENT keys when unset, never null — the
	## absent-key law the whole migration is built on. A null check would read a
	## carried thing where there is none.
	Chronicle.commit(_world())
	var hud := Hud.new()
	var shown: Dictionary = hud.read(Chronicle.state())
	assert_eq(shown["satchel"], ["vital draught", "ash ward"])
	assert_eq(shown["scroll"], "unveiling")
	hud.free()


func test_an_empty_handed_player_shows_empty_hands_rather_than_crashing() -> void:
	var bare: Dictionary = _world()
	var payload: Dictionary = bare["payload"]
	payload.erase("playerSatchel")
	payload.erase("playerScroll")
	Chronicle.commit(bare)
	var hud := Hud.new()
	var shown: Dictionary = hud.read(Chronicle.state())
	assert_eq(shown["satchel"], [], "no satchel key means empty hands")
	assert_null(shown["scroll"], "and no scroll hand at all")
	hud.free()


func test_a_run_that_has_ended_still_has_something_to_say() -> void:
	## A dead or absent player is a real state, not an error. The panel has to
	## say something rather than crash on the frame the run ends.
	Chronicle.commit(_world())
	var hud := Hud.new()
	var shown: Dictionary = hud.read(Chronicle.state(), "nobody-by-that-name")
	assert_false(shown["alive"])
	assert_eq(shown["depth"], 4, "the floor is still a fact")
	hud.free()


# ── the chronicle's plain voice ───────────────────────────────────────────

func test_the_clock_and_the_footstep_are_not_news() -> void:
	## A message log that reports every step and every tick is a message log
	## nobody reads. Both return the empty string, which `note` drops.
	assert_eq(Hud.plain(SimEvents.draft("MOVE", 0, 0, {"entityId": "player", "to": {"x": 1, "y": 0}})), "")
	assert_eq(Hud.plain(SimEvents.draft("TURN_ADVANCED", 0, 0, {"turn": 2, "activeEntityId": "player"})), "")


func test_a_landed_blow_says_what_it_cost_and_a_missed_one_says_it_missed() -> void:
	var hit := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "brute", "hit": true, "damage": 3, "crit": false})
	var miss := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "brute", "hit": false, "damage": 0, "crit": false})
	assert_eq(Hud.plain(hit), "a blow lands for 3")
	assert_eq(Hud.plain(miss), "a blow misses")


func test_the_purse_line_shows_its_sign() -> void:
	assert_eq(Hud.plain(SimEvents.draft("GOLD_MOVED", 0, 0, {"delta": 5, "reason": "loot"})), "+5 gold")
	assert_eq(Hud.plain(SimEvents.draft("GOLD_MOVED", 0, 0, {"delta": -2, "reason": "spent"})), "-2 gold")


func test_the_log_is_bounded_so_a_long_run_is_not_a_leak() -> void:
	var hud := Hud.new()
	for i in range(40):
		hud.note(SimEvents.draft("BRACED", 0, 0, {"entityId": "player"}))
	assert_eq(hud.lines.size(), Hud.LOG_LINES, "eight lines, not forty")
	hud.free()


func test_a_new_world_wipes_the_log_because_it_is_a_different_floor() -> void:
	var hud := Hud.new()
	hud.note(SimEvents.draft("BRACED", 0, 0, {"entityId": "player"}))
	assert_eq(hud.lines.size(), 1)
	hud._on_world(SimState.empty())
	assert_eq(hud.lines.size(), 0, "what happened upstairs did not happen here")
	hud.free()


func test_every_event_type_the_engine_knows_has_a_line_or_a_deliberate_silence() -> void:
	## Without this, a twenty-sixth event type would simply never be spoken and
	## nothing would say so. `plain` returning "" is a CHOICE for MOVE,
	## TURN_ADVANCED and an unrevealed TRAP_SENSED; for anything else it is a
	## gap. SCHEMA_VERSIONS is the engine's own list of what exists.
	var silent := ["MOVE", "TURN_ADVANCED", "WORLD_BIBLE", "WORLD_BODIES",
		"WORLD_REMEMBERED", "TRAP_SENSED"]
	var unspoken: Array = []
	for type: String in SimEvents.SCHEMA_VERSIONS:
		if silent.has(type):
			continue
		var said := Hud.plain({"type": type, "payload": {}})
		if said == "":
			unspoken.append(type)
	assert_eq(unspoken, [], "these types have no line and no stated silence: %s" % [unspoken])
