extends GutTest
## findEntity and isAlive — the byte-twin of tests/core/entity.test.ts's
## findEntity/isAlive suites, one test per TS `it(...)` in the TS file's
## order. That file's other three tests (EMPTY_STATE) belong to state.ts, not
## entity.ts, and wait for that port: SimState does not exist yet.
##
## The final test has no TS counterpart: it is the absent-key law made
## executable at the entity level. See test_state_shape.gd for the same law
## pinned against the golden fixture's own entities.

func _entity(id: String, hp: int) -> Dictionary:
	return {"id": id, "kind": "test", "pos": {"x": 0, "y": 0},
		"stats": {"hp": hp, "might": 1, "wits": 1, "speed": 1}, "tags": [], "maxHp": hp}


func test_finds_by_id() -> void:
	var list: Array = [_entity("a", 5), _entity("b", 5)]
	var found: Dictionary = SimEntity.find(list, "b")
	assert_eq(found["id"], "b")


func test_returns_null_for_an_unknown_id() -> void:
	assert_null(SimEntity.find([_entity("a", 5)], "zz"))


func test_is_alive_is_true_above_zero_hp_and_false_at_or_below() -> void:
	assert_true(SimEntity.is_alive(_entity("a", 1)))
	assert_false(SimEntity.is_alive(_entity("a", 0)))
	assert_false(SimEntity.is_alive(_entity("a", -3)))


func test_optional_fields_are_absent_not_null() -> void:
	## TS canonicalJson DROPS undefined keys. A GDScript null would encode as
	## `null` and fork every chain that folds an entity without a satchel.
	var plain := {"id": "p1", "kind": "player", "pos": {"x": 1, "y": 1},
		"stats": {"hp": 3, "might": 1, "wits": 1, "speed": 1}}
	assert_false(plain.has("route"), "route is absent, never null")
	assert_false(plain.has("scroll"), "scroll is absent, never null")
	assert_false(plain.has("pocket"), "pocket is absent, never null")
	assert_false(plain.has("satchel"), "satchel is absent, never null")
	assert_false(SimCanonical.encode(plain).contains("null"),
		"a plain entity encodes with no nulls at all")
