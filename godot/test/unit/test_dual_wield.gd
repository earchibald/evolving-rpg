extends GutTest
## The item family's dual-wield suite — the byte-twin of
## tests/core/dual-wield.test.ts. One test per TS `it(...)`, in the TS
## file's order, so the two suites can be diffed by eye.
##
## Dual wield, proposal A — strong arms throw hard. The panel's verdict
## (three lenses, unanimous): ranged relics route to their own 'sling' slot
## by trait, grants stack into the one might stat, and the same ITEM_TAKEN
## v4 that learned satchel slots records the resolved gear slot and the shed
## relic — so replay never re-derives routing, and what you set down finally
## lands on the floor.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 8 cases across three describe blocks.
## 8 = 8 PORTED + 0 DEFERRED. Line numbers are tests/core/dual-wield.test.ts
## at ts-baseline.
##
## describe('the sling slot — routed by trait, not by stat') — 2
##   :47 exists, and slotFor sends ranged kinds there while grants still
##       route the rest
##   :54 walking takes the sling into its own slot beside a worn sword —
##       both stay, might stacks
##
## describe('what you set down lands on the floor — the vanish retired') — 3
##   :72 records the shed relic and mints it where the new one lay, grants
##       intact
##   :87 a bare-slot take sheds nothing and mints nothing
##   :94 an old chain's gear take (no gearSlot, no shed) folds the legacy way
##
## describe('the floors keep their promises') — 3
##   :109 depth 1 still guarantees the keen edge by name — order cannot
##        unseat it
##   :117 depth 2 owes a ranged relic — the slinger's debut floor arms the
##        answer
##   :125 the armory still holds exactly one ranged kind, so the guarantee is
##        the sling
##
## See test_satchel_two.gd's header for why `world()`/`commit()` here use
## fixed sentinel id/parent/seq rather than the reference's counter: apply()
## never reads those fields, and these two helpers call apply() directly.


func _world(gear: Variant = null, items: Array = []) -> Dictionary:
	var tiles: Array = []
	for i in range(8):
		tiles.append(SimGrid.FLOOR)
	var built_items: Array = []
	for i: Dictionary in items:
		built_items.append({"id": i["id"], "kind": i["kind"], "pos": {"x": i["x"], "y": i["y"]}, "grants": i["grants"]})
	var payload: Dictionary = {
		"width": 8, "height": 1, "tiles": tiles, "seed": 3,
		"items": built_items,
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0}, "stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
		"opponents": [],
	}
	if gear != null:
		payload["playerGear"] = gear
	var event: Dictionary = {
		"id": "w", "parent": null, "seq": 0,
		"type": "WORLD_INIT", "schemaVersion": SimEvents.SCHEMA_VERSIONS["WORLD_INIT"],
		"rngCounter": 0, "rngDraws": 0,
		"payload": payload,
	}
	return SimApply.apply(SimState.empty(), event)


func _commit(s: Dictionary, d: Variant) -> Dictionary:
	assert_not_null(d)
	var event: Dictionary = (d as Dictionary).duplicate(true)
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return SimApply.apply(s, event)


func _g(might: int = 0, hp: int = 0, speed: int = 0, wits: int = 0) -> Dictionary:
	return {"hp": hp, "might": might, "wits": wits, "speed": speed}


# ── describe('the sling slot — routed by trait, not by stat') ─────────────

func test_exists_and_slot_for_sends_ranged_kinds_there_while_grants_still_route_the_rest() -> void:
	assert_true(SimTables.SLOTS.has("sling"))
	assert_eq(SimTables.slot_for("leaden sling", _g(2)), "sling")
	assert_eq(SimTables.slot_for("keen edge", _g(2)), "weapon")
	assert_eq(SimTables.slot_for("keen edge", _g(2)), SimTables.slot_of(_g(2)))


func test_walking_takes_the_sling_into_its_own_slot_beside_a_worn_sword_both_stay_might_stacks() -> void:
	var armed: Dictionary = _world(
		{"weapon": {"kind": "keen edge", "grants": _g(2)}},
		[{"id": "relic-9", "kind": "leaden sling", "x": 0, "y": 0, "grants": _g(1)}])
	var took: Variant = SimCommands.take_underfoot(armed, "player")
	assert_not_null(took)
	assert_eq((took as Dictionary)["payload"]["gearSlot"], "sling")
	var after: Dictionary = _commit(armed, took)
	var you_entity: Dictionary = (after["entities"] as Array)[0]
	var gear: Dictionary = you_entity["gear"]
	assert_eq((gear["weapon"] as Dictionary)["kind"], "keen edge")
	assert_eq((gear["sling"] as Dictionary)["kind"], "leaden sling")
	assert_eq(int((you_entity["stats"] as Dictionary)["might"]), 3 + 1)
	assert_true(SimTables.wears_trait(gear, "ranged"))


# ── describe('what you set down lands on the floor — the vanish retired') ─

func test_records_the_shed_relic_and_mints_it_where_the_new_one_lay_grants_intact() -> void:
	var worn: Dictionary = _world(
		{"weapon": {"kind": "keen edge", "grants": _g(2)}},
		[{"id": "relic-9", "kind": "heavy edge", "x": 0, "y": 0, "grants": {"hp": 0, "might": 3, "wits": 0, "speed": -1}}])
	var took: Variant = SimCommands.take_underfoot(worn, "player", true)
	assert_not_null(took)
	assert_eq((took as Dictionary)["payload"]["shed"], {"kind": "keen edge", "grants": _g(2)})
	var after: Dictionary = _commit(worn, took)
	var dropped: Variant = null
	for i: Dictionary in (after["items"] as Array):
		if i["kind"] == "keen edge":
			dropped = i
	assert_not_null(dropped)
	assert_eq((dropped as Dictionary)["pos"], {"x": 0, "y": 0})
	assert_eq((dropped as Dictionary)["grants"], _g(2))


func test_a_bare_slot_take_sheds_nothing_and_mints_nothing() -> void:
	var bare: Dictionary = _world(null, [{"id": "relic-9", "kind": "keen edge", "x": 0, "y": 0, "grants": _g(2)}])
	var took: Variant = SimCommands.take_underfoot(bare, "player")
	assert_null((took as Dictionary)["payload"]["shed"])
	assert_eq((_commit(bare, took)["items"] as Array).size(), 0)


func test_an_old_chains_gear_take_no_gear_slot_no_shed_folds_the_legacy_way() -> void:
	var worn: Dictionary = _world({"weapon": {"kind": "keen edge", "grants": _g(2)}})
	var legacy: Dictionary = {
		"type": "ITEM_TAKEN", "schemaVersion": 3, "rngCounter": 0, "rngDraws": 0,
		"payload": {"entityId": "player", "itemId": "ghost", "grants": _g(3)},
	}
	var base: Dictionary = worn.duplicate()
	base["items"] = [{"id": "ghost", "kind": "edge of salt", "pos": {"x": 1, "y": 0}, "grants": _g(3)}]
	var after: Dictionary = _commit(base, legacy)
	var after_entities: Array = after["entities"]
	var gear: Dictionary = (after_entities[0] as Dictionary)["gear"]
	assert_eq((gear["weapon"] as Dictionary)["kind"], "edge of salt")
	var still_there := false
	for i: Dictionary in (after["items"] as Array):
		if i["kind"] == "keen edge":
			still_there = true
	assert_false(still_there)


# ── describe('the floors keep their promises') ────────────────────────────

func test_depth_1_still_guarantees_the_keen_edge_by_name_order_cannot_unseat_it() -> void:
	for seed in range(1, 9):
		var p: Dictionary = (SimCommands.create_world(seed, 48, 32) as Dictionary)["payload"]
		var has_keen := false
		var has_ranged := false
		for i: Dictionary in (p["items"] as Array):
			if i["kind"] == "keen edge":
				has_keen = true
			if SimTables.RELIC_TRAITS.get(i["kind"], "") == "ranged":
				has_ranged = true
		assert_true(has_keen, "seed %d lacks the keen edge" % seed)
		assert_false(has_ranged, "seed %d put a ranged relic on depth 1" % seed)


func test_depth_2_owes_a_ranged_relic_the_slingers_debut_floor_arms_the_answer() -> void:
	for seed in range(1, 13):
		var p: Dictionary = (SimCommands.create_world(seed, 48, 32, "player", 2) as Dictionary)["payload"]
		var ranged_count := 0
		for i: Dictionary in (p["items"] as Array):
			if SimTables.RELIC_TRAITS.get(i["kind"], "") == "ranged":
				ranged_count += 1
		assert_gte(ranged_count, 1, "seed %d owes depth 2 a ranged relic" % seed)


func test_the_armory_still_holds_exactly_one_ranged_kind_so_the_guarantee_is_the_sling() -> void:
	var ranged_count := 0
	for r: Dictionary in SimTables.ARMORY:
		if SimTables.RELIC_TRAITS.get(r["kind"], "") == "ranged":
			ranged_count += 1
	assert_eq(ranged_count, 1)
