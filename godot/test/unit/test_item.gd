extends GutTest
## granted, at, and NOTHING — the byte-twin of item.ts's own exports.
##
## No TS test targets item.ts directly: tests/core/equipment.test.ts's six
## cases all drive src/core/commands.ts's takeUnderfoot (deciding whether a
## floor item is worth equipping) and src/core/apply.ts's ITEM_TAKEN reducer
## (the gear-slot stat/maxHp swap), calling granted/itemAt only as their own
## implementation detail. Those six stay behind for apply.gd (Wave C) and
## commands.gd's items/satchel/scrolls subtask (Wave E):
##   - "equips the first weapon whole"
##   - "replaces, never stacks: two swords are not twice as strong"
##   - "leaves a lesser item on the floor"
##   - "ignores an equal item too — a sidegrade is not worth the stoop"
##   - "swaps armor with its hit points, ceiling and all"
##   - "keeps different slots independent"
##
## The negative-grant case below is the one piece of item.ts's own behaviour
## specific enough to pin now: granted must not clamp at zero, or the heavy
## edge's speed cost (src/core/tables.ts's ARMORY; a concrete grant of
## `speed: -1` appears in tests/core/dual-wield.test.ts:75) silently vanishes
## into a buff. The rest of this file is new coverage with no TS counterpart
## — the same reason test_entity.gd and test_grid.gd each carry a few —
## since item.ts's exports otherwise have nothing to diff against.


func _item(id: String, x: int, y: int) -> Dictionary:
	return {"id": id, "kind": "test", "pos": {"x": x, "y": y}, "grants": SimItem.NOTHING}


func test_grants_ride_negative_because_the_heavy_edge_costs() -> void:
	var out := SimItem.granted({"hp": 4, "might": 2, "wits": 2, "speed": 3},
		{"hp": 0, "might": 3, "wits": 0, "speed": -1})
	assert_eq(out["might"], 5)
	assert_eq(out["speed"], 2, "a cost is subtracted, never clamped to zero")


func test_granted_builds_a_fresh_dictionary_rather_than_writing_through_stats() -> void:
	## Dictionaries are reference types in GDScript; a naive `stats["hp"] +=
	## grants["hp"]; return stats` would corrupt every other holder of that
	## same stats block (e.g. a baseline shared the way EMPTY_STATE is). The
	## reference builds a new object literal every call and writes through
	## neither argument — port that, not just the sums.
	var stats := {"hp": 4, "might": 2, "wits": 2, "speed": 3}
	var grants := {"hp": 1, "might": 0, "wits": 0, "speed": 0}
	SimItem.granted(stats, grants)
	assert_eq(stats["hp"], 4, "the stats argument is not written through")
	assert_eq(grants["hp"], 1, "the grants argument is not written through")


func test_at_finds_the_item_lying_on_that_tile() -> void:
	var items: Array = [_item("a", 1, 1), _item("b", 4, 0)]
	var found: Dictionary = SimItem.at(items, 4, 0)
	assert_eq(found["id"], "b")


func test_at_returns_null_when_nothing_lies_there() -> void:
	assert_null(SimItem.at([_item("a", 1, 1)], 9, 9))


func test_at_prefers_the_earliest_array_match_like_the_references_find() -> void:
	## Nothing stops two items sharing a tile; Array.prototype.find in the
	## reference returns the first hit, so replay must too.
	var items: Array = [_item("first", 2, 2), _item("second", 2, 2)]
	var found: Dictionary = SimItem.at(items, 2, 2)
	assert_eq(found["id"], "first")


func test_nothing_is_a_zeroed_stat_block() -> void:
	var keys: Array = SimItem.NOTHING.keys()
	keys.sort()
	assert_eq(keys, ["hp", "might", "speed", "wits"])
	for k in SimItem.NOTHING:
		assert_eq(SimItem.NOTHING[k], 0, "%s should be zero" % k)
