extends GutTest
## The item family's equip suite — the byte-twin of tests/core/equipment.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can
## be diffed by eye.
##
## Equipment, not accumulation. One slot, one item: a second sword replaces
## the first, a lesser sword stays on the floor, and armor that comes off
## takes its hit points with it.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 6 cases in one describe block.
## 6 = 6 PORTED + 0 DEFERRED. Line numbers are tests/core/equipment.test.ts
## at ts-baseline.
##
## describe('one slot, one item') — 6
##   :51 equips the first weapon whole
##   :58 replaces, never stacks: two swords are not twice as strong
##   :69 leaves a lesser item on the floor
##   :80 ignores an equal item too — a sidegrade is not worth the stoop
##   :88 swaps armor with its hit points, ceiling and all
##   :99 keeps different slots independent
##
## Unlike test_satchel_two.gd's and test_dual_wield.gd's `world()`/
## `commit()`, this suite's `play()` walks a REAL chain (append/fold), so
## `_world()` here returns the reference's own hand-stamped
## {id:'w',parent:null,seq:0} literal verbatim — `SimLog.append` overwrites
## those three fields with its own computed ones regardless of what a caller
## hands it (draft.duplicate(true) then id/parent/seq are reassigned), so
## the literal is inert, exactly as it is in the reference.


func _world(items: Array) -> Dictionary:
	var tiles: Array = []
	for i in range(10):
		tiles.append(SimGrid.FLOOR)
	var built_items: Array = []
	for i: Dictionary in items:
		var grants: Dictionary = {"hp": 0, "might": 0, "wits": 0, "speed": 0}
		for k: String in (i["grants"] as Dictionary):
			grants[k] = i["grants"][k]
		built_items.append({"id": i["id"], "kind": i["kind"], "pos": {"x": i["x"], "y": 0}, "grants": grants})
	return {
		"id": "w", "parent": null, "seq": 0,
		"type": "WORLD_INIT", "schemaVersion": SimEvents.SCHEMA_VERSIONS["WORLD_INIT"],
		"rngCounter": 0, "rngDraws": 0,
		"payload": {
			"width": 10, "height": 1, "tiles": tiles, "seed": 1, "depth": 1,
			"items": built_items,
			"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0}, "stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
			"opponents": [],
		},
	}


func _step_to(x: int) -> Dictionary:
	return {
		"type": "MOVE", "schemaVersion": 2, "rngCounter": 0, "rngDraws": 0,
		"payload": {"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": x, "y": 0}},
	}


## Returns {"log": SimLog, "head": String}, mirroring the reference's
## {log, head}. GDScript's SimLog is a stateful RefCounted rather than a
## value threaded through pure functions, so the single `log` created here
## is mutated in place by every append — see log.gd's own docstring on why
## an instance-scoped log is a strictly tighter representation of the same
## reference semantics.
func _play(w: Dictionary, moves: Array) -> Dictionary:
	var log := SimLog.new()
	var born: Dictionary = log.append(null, w)
	var head: String = born["id"]
	for x: int in moves:
		var moved: Dictionary = log.append(head, _step_to(x))
		head = moved["id"]
		var taken: Variant = SimCommands.take_underfoot(log.fold(head), "player")
		if taken != null:
			var got: Dictionary = log.append(head, taken as Dictionary)
			head = got["id"]
	return {"log": log, "head": head}


# ── describe('one slot, one item') ─────────────────────────────────────────

func test_equips_the_first_weapon_whole() -> void:
	var p: Dictionary = _play(_world([{"id": "a", "kind": "keen edge", "x": 2, "grants": {"might": 2}}]), [2])
	var log: SimLog = p["log"]
	var you_entity: Dictionary = (log.fold(p["head"])["entities"] as Array)[0]
	assert_eq(int((you_entity["stats"] as Dictionary)["might"]), 5)
	assert_eq(((you_entity["gear"] as Dictionary)["weapon"] as Dictionary)["kind"], "keen edge")


func test_replaces_never_stacks_two_swords_are_not_twice_as_strong() -> void:
	var p: Dictionary = _play(_world([
		{"id": "a", "kind": "keen edge", "x": 2, "grants": {"might": 2}},
		{"id": "b", "kind": "hewing axe", "x": 4, "grants": {"might": 3}},
	]), [2, 4])
	var log: SimLog = p["log"]
	var you_entity: Dictionary = (log.fold(p["head"])["entities"] as Array)[0]
	# 3 base − 2 off + 3 on, not 3 + 2 + 3.
	assert_eq(int((you_entity["stats"] as Dictionary)["might"]), 6)
	assert_eq(((you_entity["gear"] as Dictionary)["weapon"] as Dictionary)["kind"], "hewing axe")


func test_leaves_a_lesser_item_on_the_floor() -> void:
	var p: Dictionary = _play(_world([
		{"id": "a", "kind": "hewing axe", "x": 2, "grants": {"might": 3}},
		{"id": "b", "kind": "keen edge", "x": 4, "grants": {"might": 2}},
	]), [2, 4])
	var log: SimLog = p["log"]
	var state: Dictionary = log.fold(p["head"])
	assert_eq(int(((state["entities"] as Array)[0] as Dictionary)["stats"]["might"]), 6)
	# The lesser edge is still there, untaken.
	var found := false
	for i: Dictionary in (state["items"] as Array):
		if i["id"] == "b":
			found = true
	assert_true(found)


func test_ignores_an_equal_item_too_a_sidegrade_is_not_worth_the_stoop() -> void:
	var p: Dictionary = _play(_world([
		{"id": "a", "kind": "keen edge", "x": 2, "grants": {"might": 2}},
		{"id": "b", "kind": "other edge", "x": 4, "grants": {"might": 2}},
	]), [2, 4])
	var log: SimLog = p["log"]
	var state: Dictionary = log.fold(p["head"])
	var found := false
	for i: Dictionary in (state["items"] as Array):
		if i["id"] == "b":
			found = true
	assert_true(found)


func test_swaps_armor_with_its_hit_points_ceiling_and_all() -> void:
	var p: Dictionary = _play(_world([
		{"id": "a", "kind": "iron charm", "x": 2, "grants": {"hp": 3}},
		{"id": "b", "kind": "oak charm", "x": 4, "grants": {"hp": 5}},
	]), [2, 4])
	var log: SimLog = p["log"]
	var you_entity: Dictionary = (log.fold(p["head"])["entities"] as Array)[0]
	# 10 base + 5 from the better charm — the +3 came off with the old one.
	assert_eq(int(you_entity["maxHp"]), 15)
	assert_lte(int((you_entity["stats"] as Dictionary)["hp"]), int(you_entity["maxHp"]))


func test_keeps_different_slots_independent() -> void:
	var p: Dictionary = _play(_world([
		{"id": "a", "kind": "keen edge", "x": 2, "grants": {"might": 2}},
		{"id": "b", "kind": "fleet boots", "x": 4, "grants": {"speed": 1}},
		{"id": "c", "kind": "grey lens", "x": 6, "grants": {"wits": 1}},
	]), [2, 4, 6])
	var log: SimLog = p["log"]
	var you_entity: Dictionary = (log.fold(p["head"])["entities"] as Array)[0]
	var stats: Dictionary = you_entity["stats"]
	assert_eq(int(stats["might"]), 5)
	assert_eq(int(stats["speed"]), 5)
	assert_eq(int(stats["wits"]), 4)
	var gear_keys: Array = (you_entity["gear"] as Dictionary).keys()
	gear_keys.sort()
	assert_eq(gear_keys, ["boots", "trinket", "weapon"])
