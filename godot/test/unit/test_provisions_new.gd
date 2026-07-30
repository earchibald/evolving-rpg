extends GutTest
## The item family's widened-pantry suite — the byte-twin of
## tests/core/provisions-new.test.ts. One test per TS `it(...)`, in the TS
## file's order, so the two suites can be diffed by eye.
##
## The pantry widened (designer's word, the 929-second run): three new
## provisions beside the teaching trio. The ward drinks exactly one blow;
## the burr staggers exactly who stood beside you; the bell is knowledge,
## never power. Depth gates keep floor one to the original three.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 11 cases across four describe blocks.
## 11 = 10 PORTED + 1 DEFERRED. Line numbers are
## tests/core/provisions-new.test.ts at ts-baseline.
##
## describe('the pantry gate') — 3
##   :58 keeps floor one to the teaching trio
##   :62 opens by depth: ward and bell at two, the burr at three
##   :70 gives every kind a positive weight
##
## describe('the ward') — 4
##   :76  is worn when drunk: the tag arrives, the hand empties
##   :85  refuses a second warding while the first holds
##   :90  drinks exactly one landing blow — no wound, no venom, the draw
##        unbroken
##   :106 zeroes the recorded damage at command time and says so on the
##        payload
##
## describe('the burr') — 2
##   :132 staggers exactly who stood beside you
##   :144 casts honestly at empty air — recorded, nobody reels
##
## describe('the bell') — 2
##   :152 records where the way out stands and where the prizes lie
##
## ── Deferrals ──────────────────────────────────────────────────────────
## :162 "is knowledge the fog reads off the chain: the exit joins SEEN"
##      — DEFERRED to Phase 3 (`stage/`, the task that ports src/ui/fov.ts's
##      `fogAt`), same reasoning as test_loot.gd's deferral. The ITEM_USED
##      command side this test also exercises (`useCarried` producing the
##      bell's effect) IS ported and covered above, by "records where the
##      way out stands and where the prizes lie".
##
## See test_satchel_two.gd's header for why `world()`/`commit()` here use
## fixed sentinel id/parent/seq rather than the reference's counter: apply()
## never reads those fields, and these two helpers call apply() directly.


func _world(satchel: Variant = null, tags: Array = [], foes: Array = [], items: Array = [], exit_at: int = -1, seed: int = 9) -> Dictionary:
	var tiles: Array = []
	for i in range(8):
		tiles.append(SimGrid.EXIT if i == exit_at else SimGrid.FLOOR)
	var built_items: Array = []
	for i: Dictionary in items:
		built_items.append({"id": i["id"], "kind": i["kind"], "pos": {"x": i["x"], "y": i["y"]}, "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}})
	var opponents: Array = []
	for f: Dictionary in foes:
		opponents.append({
			"id": f["id"], "kind": f.get("kind", "bruiser-1"), "pos": {"x": f["x"], "y": f["y"]},
			"stats": {"hp": 6, "might": 2, "wits": 1, "speed": 2}, "tags": [],
		})
	var payload: Dictionary = {
		"width": 8, "height": 1, "tiles": tiles, "seed": seed,
		"items": built_items,
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0}, "stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": tags},
		"opponents": opponents,
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


func _commit(s: Dictionary, d: Variant) -> Dictionary:
	assert_not_null(d)
	var event: Dictionary = (d as Dictionary).duplicate(true)
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return SimApply.apply(s, event)


func _you(s: Dictionary) -> Dictionary:
	return SimEntity.find(s["entities"], "player")


# ── describe('the pantry gate') ────────────────────────────────────────────

func test_keeps_floor_one_to_the_teaching_trio() -> void:
	var kinds_at_1: Array = []
	for p: Dictionary in SimTables.provisions_at(1):
		kinds_at_1.append(p["kind"])
	assert_eq(kinds_at_1, ["vital draught", "still smoke", "tallow flare"])


func test_opens_by_depth_ward_and_bell_at_two_the_burr_at_three() -> void:
	var at_two: Array = []
	for p: Dictionary in SimTables.provisions_at(2):
		at_two.append(p["kind"])
	assert_true(at_two.has("ash ward"))
	assert_true(at_two.has("hollow bell"))
	assert_false(at_two.has("iron burr"))
	assert_eq(SimTables.provisions_at(3).size(), SimTables.PROVISIONS.size())


func test_gives_every_kind_a_positive_weight() -> void:
	for p: Dictionary in SimTables.PROVISIONS:
		assert_gt(int(p["weight"]), 0)


# ── describe('the ward') ────────────────────────────────────────────────

func test_is_worn_when_drunk_the_tag_arrives_the_hand_empties() -> void:
	var s: Dictionary = _world(["ash ward"])
	var drunk: Variant = SimCommands.use_carried(s, "player")
	assert_eq((drunk as Dictionary)["payload"]["effect"], {"kind": "ward"})
	var after: Dictionary = _commit(s, drunk)
	var player: Dictionary = _you(after)
	assert_true((player["tags"] as Array).has("warded"))
	var satchel: Array = player["satchel"] if player.has("satchel") else []
	assert_eq(satchel.size(), 0)


func test_refuses_a_second_warding_while_the_first_holds() -> void:
	var s: Dictionary = _world(["ash ward"], ["warded"])
	assert_null(SimCommands.use_carried(s, "player"))


func test_drinks_exactly_one_landing_blow_no_wound_no_venom_the_draw_unbroken() -> void:
	var s: Dictionary = _world(null, ["warded", "drawn"], [{"id": "foe-1", "x": 1, "y": 0, "kind": "stinger-2"}])
	var event: Dictionary = {
		"id": "blow", "parent": null, "seq": 90,
		"type": "STRIKE", "schemaVersion": SimEvents.SCHEMA_VERSIONS["STRIKE"], "rngCounter": 0, "rngDraws": 2,
		"payload": {"attackerId": "foe-1", "targetId": "player", "mode": "melee", "roll": 18, "needed": 10, "hit": true, "crit": false, "damage": 0, "warded": true},
	}
	var struck: Dictionary = SimApply.apply(s, event)
	var player: Dictionary = _you(struck)
	assert_eq(int((player["stats"] as Dictionary)["hp"]), 10)
	var tags: Array = player["tags"]
	assert_false(tags.has("warded"))
	assert_true(tags.has("drawn"))
	var has_venom := false
	for t: String in tags:
		if t.begins_with("venom-"):
			has_venom = true
	assert_false(has_venom)


func test_zeroes_the_recorded_damage_at_command_time_and_says_so_on_the_payload() -> void:
	for seed in range(1, 61):
		var bare: Dictionary = _world(null, [], [{"id": "foe-1", "x": 1, "y": 0}], [], -1, seed)
		var plain: Dictionary = SimCommands.attempt_move(bare, "player", 1, 0)
		var plain_p: Dictionary = plain["payload"]
		if plain["type"] != "STRIKE" or not bool(plain_p["hit"]):
			continue
		assert_gt(int(plain_p["damage"]), 0)

		var warded: Dictionary = _world(null, [], [{"id": "foe-1", "x": 1, "y": 0}], [], -1, seed)
		var shielded: Dictionary = warded.duplicate()
		var new_entities: Array = []
		for e: Dictionary in (warded["entities"] as Array):
			if e["id"] == "foe-1":
				var tagged: Dictionary = e.duplicate()
				tagged["tags"] = ["warded"]
				new_entities.append(tagged)
			else:
				new_entities.append(e)
		shielded["entities"] = new_entities

		var drunk: Dictionary = SimCommands.attempt_move(shielded, "player", 1, 0)
		assert_eq(drunk["type"], "STRIKE", "the warded twin must still be a blow")
		var drunk_p: Dictionary = drunk["payload"]
		assert_eq(int(drunk_p["roll"]), int(plain_p["roll"]))
		assert_eq(int(drunk_p["damage"]), 0)
		assert_true(bool(drunk_p["warded"]))
		return
	assert_true(false, "no seed in 60 landed a blow — the fixture is wrong")


# ── describe('the burr') ────────────────────────────────────────────────

func test_staggers_exactly_who_stood_beside_you() -> void:
	var s: Dictionary = _world(["iron burr"], [], [{"id": "near-1", "x": 1, "y": 0}, {"id": "far-1", "x": 5, "y": 0}])
	var cast: Variant = SimCommands.use_carried(s, "player")
	assert_eq((cast as Dictionary)["payload"]["effect"], {"kind": "burr", "staggered": ["near-1"]})
	var after: Dictionary = _commit(s, cast)
	var near: Dictionary = SimEntity.find(after["entities"], "near-1")
	var far: Dictionary = SimEntity.find(after["entities"], "far-1")
	assert_true((near["tags"] as Array).has("staggered"))
	assert_false((far["tags"] as Array).has("staggered"))


func test_casts_honestly_at_empty_air_recorded_nobody_reels() -> void:
	var s: Dictionary = _world(["iron burr"], [], [{"id": "far-1", "x": 6, "y": 0}])
	var cast: Variant = SimCommands.use_carried(s, "player")
	assert_eq((cast as Dictionary)["payload"]["effect"], {"kind": "burr", "staggered": []})


# ── describe('the bell') ───────────────────────────────────────────────

func test_records_where_the_way_out_stands_and_where_the_prizes_lie() -> void:
	var s: Dictionary = _world(["hollow bell"], [], [], [{"id": "i1", "kind": "keen edge", "x": 4, "y": 0}], 7)
	var rung: Variant = SimCommands.use_carried(s, "player")
	assert_eq((rung as Dictionary)["payload"]["effect"], {"kind": "bell", "exit": {"x": 7, "y": 0}, "prizes": [{"x": 4, "y": 0}]})


# :162 "is knowledge the fog reads off the chain: the exit joins SEEN" is
# DEFERRED — see the file header's Deferrals section. fogAt has no port
# anywhere in godot/sim/ yet; it belongs to Phase 3 (stage/).
