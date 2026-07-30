extends GutTest
## The item family's two-slot satchel suite — the byte-twin of
## tests/core/satchel-two.test.ts. One test per TS `it(...)`, in the TS
## file's order, so the two suites can be diffed by eye.
##
## The satchel grows a second slot (the designer's ruling, voiced run
## 2026-07-28): two carried things, q spends the first, Q the second,
## duplicates welcome, full hands refuse the walk-over out loud, and the
## heart still seals everything it rides with.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 7 cases across four describe blocks.
## 7 = 7 PORTED + 0 DEFERRED. Line numbers are
## tests/core/satchel-two.test.ts at ts-baseline.
##
## describe('two slots, filled in order') — 3
##   :44 takes into the first empty slot, then the second, recording which
##   :57 welcomes duplicates — two flares are two flares
##   :64 refuses the walk-over on full hands, and swaps the first slot
##       deliberately
##
## describe('q spends the first thing, Q the second') — 2
##   :77 spends the named slot and compacts what remains
##   :89 refuses an empty slot quietly
##
## describe('the heart still seals everything') — 1
##   :97 rides a slot, seals both, and heartHeld sees it wherever it sits
##
## describe('the chain agrees') — 1
##   :109 take-take-use folds exact through a real chain
##
## ── A note on `id`/`seq`, dropped rather than ported ──────────────────────
## The reference's `world()`/`commit()` stamp each hand-built event with a
## monotonic `w${seq}`/`e${seq}` id via a module-level counter, purely for
## readability — `apply()` never reads an event's id/parent/seq (grep
## confirms no `event["id"]`/`event["seq"]` read anywhere in apply.gd; those
## fields exist for SimLog/SimHash, not the reducer), and these two helpers
## call `apply()` directly, bypassing SimLog entirely. So the counter is
## inert here and ported as fixed sentinel strings instead of a class-level
## `_seq` field, sidestepping any question of whether GUT recreates this
## script's instance between test methods.


func _world(satchel: Variant = null, items: Array = []) -> Dictionary:
	var tiles: Array = []
	for i in range(8):
		tiles.append(SimGrid.FLOOR)
	var built_items: Array = []
	for i: Dictionary in items:
		built_items.append({"id": i["id"], "kind": i["kind"], "pos": {"x": i["x"], "y": i["y"]}, "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}})
	var payload: Dictionary = {
		"width": 8, "height": 1, "tiles": tiles, "seed": 9,
		"items": built_items,
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0}, "stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
		"opponents": [],
	}
	if satchel != null:
		payload["playerSatchel"] = {"kinds": satchel}
	var event: Dictionary = {
		"id": "w", "parent": null, "seq": 0,
		"type": "WORLD_INIT", "schemaVersion": SimEvents.SCHEMA_VERSIONS["WORLD_INIT"],
		"rngCounter": 0, "rngDraws": 0,
		"payload": payload,
	}
	return SimApply.apply(SimState.empty(), event)


func _kinds(s: Dictionary) -> Array:
	var entities: Array = s["entities"]
	var player: Dictionary = entities[0]
	var out: Array = []
	if player.has("satchel"):
		for c: Dictionary in (player["satchel"] as Array):
			out.append(c["kind"])
	return out


func _commit(s: Dictionary, d: Variant) -> Dictionary:
	assert_not_null(d)
	var event: Dictionary = (d as Dictionary).duplicate(true)
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return SimApply.apply(s, event)


# ── describe('two slots, filled in order') ────────────────────────────────

func test_takes_into_the_first_empty_slot_then_the_second_recording_which() -> void:
	var bare: Dictionary = _world(null, [{"id": "p1", "kind": "still smoke", "x": 0, "y": 0}])
	var first: Variant = SimCommands.take_underfoot(bare, "player")
	assert_eq((first as Dictionary)["payload"]["satchel"], {"swappedOut": null, "slot": 0})
	var one: Dictionary = _commit(bare, first)
	assert_eq(_kinds(one), ["still smoke"])

	var one_item: Dictionary = _world(["still smoke"], [{"id": "p2", "kind": "tallow flare", "x": 0, "y": 0}])
	var second: Variant = SimCommands.take_underfoot(one_item, "player")
	assert_eq((second as Dictionary)["payload"]["satchel"], {"swappedOut": null, "slot": 1})
	assert_eq(_kinds(_commit(one_item, second)), ["still smoke", "tallow flare"])


func test_welcomes_duplicates_two_flares_are_two_flares() -> void:
	var s: Dictionary = _world(["tallow flare"], [{"id": "p1", "kind": "tallow flare", "x": 0, "y": 0}])
	var took: Variant = SimCommands.take_underfoot(s, "player")
	assert_not_null(took)
	assert_eq(_kinds(_commit(s, took)), ["tallow flare", "tallow flare"])


func test_refuses_the_walk_over_on_full_hands_and_swaps_the_first_slot_deliberately() -> void:
	var full: Dictionary = _world(["still smoke", "tallow flare"], [{"id": "p1", "kind": "vital draught", "x": 0, "y": 0}])
	assert_null(SimCommands.take_underfoot(full, "player"))
	var swapped: Variant = SimCommands.take_underfoot(full, "player", true)
	assert_eq((swapped as Dictionary)["payload"]["satchel"], {"swappedOut": "still smoke", "slot": 0})
	var after: Dictionary = _commit(full, swapped)
	assert_eq(_kinds(after), ["vital draught", "tallow flare"])
	var found := false
	for i: Dictionary in (after["items"] as Array):
		if i["kind"] == "still smoke" and int(i["pos"]["x"]) == 0:
			found = true
	assert_true(found)


# ── describe('q spends the first thing, Q the second') ───────────────────

func test_spends_the_named_slot_and_compacts_what_remains() -> void:
	var s: Dictionary = _world(["still smoke", "vital draught"])
	var second: Variant = SimCommands.use_carried(s, "player", 1)
	assert_eq(int((second as Dictionary)["payload"]["slot"]), 1)
	assert_eq((second as Dictionary)["payload"]["kind"], "vital draught")
	assert_eq(_kinds(_commit(s, second)), ["still smoke"])

	var first: Variant = SimCommands.use_carried(s, "player", 0)
	assert_eq((first as Dictionary)["payload"]["kind"], "still smoke")
	assert_eq(_kinds(_commit(s, first)), ["vital draught"])


func test_refuses_an_empty_slot_quietly() -> void:
	var s: Dictionary = _world(["still smoke"])
	assert_null(SimCommands.use_carried(s, "player", 1))
	assert_null(SimCommands.use_carried(_world(), "player", 0))


# ── describe('the heart still seals everything') ─────────────────────────

func test_rides_a_slot_seals_both_and_heart_held_sees_it_wherever_it_sits() -> void:
	var s: Dictionary = _world([SimTables.HEART_KIND, "tallow flare"])
	assert_true(SimCommands.heart_held(s))
	assert_null(SimCommands.use_carried(s, "player", 1))
	var with_item: Dictionary = _world([SimTables.HEART_KIND], [{"id": "p1", "kind": "still smoke", "x": 0, "y": 0}])
	assert_null(SimCommands.take_underfoot(with_item, "player"))
	assert_null(SimCommands.take_underfoot(with_item, "player", true))


# ── describe('the chain agrees') ───────────────────────────────────────────

func test_take_take_use_folds_exact_through_a_real_chain() -> void:
	var tiles: Array = []
	for i in range(8):
		tiles.append(SimGrid.FLOOR)
	var log := SimLog.new()
	var born: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 8, "height": 1, "tiles": tiles, "seed": 9,
		"items": [
			{"id": "p1", "kind": "still smoke", "pos": {"x": 0, "y": 0}, "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}},
			{"id": "p2", "kind": "vital draught", "pos": {"x": 0, "y": 0}, "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}},
		],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0}, "stats": {"hp": 4, "might": 3, "wits": 3, "speed": 4}, "tags": []},
		"opponents": [],
	}))
	var head: String = born["id"]
	for i in range(2):
		var took: Variant = SimCommands.take_underfoot(log.fold(head), "player")
		var done: Dictionary = log.append(head, took as Dictionary)
		head = done["id"]
	assert_eq(_kinds(log.fold(head)), ["still smoke", "vital draught"])

	var drink: Variant = SimCommands.use_carried(log.fold(head), "player", 1)
	var done2: Dictionary = log.append(head, drink as Dictionary)
	var after: Dictionary = log.fold(done2["id"])
	assert_eq(_kinds(after), ["still smoke"])
	var after_entities: Array = after["entities"]
	assert_gt(int((after_entities[0] as Dictionary)["stats"]["hp"]), 4)
