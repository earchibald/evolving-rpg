class_name SimEntity
## Anything that occupies a tile — the byte-twin of src/core/entity.ts.
##
## An entity is a plain Dictionary, key-for-key with the TS `Entity` interface.
## Six keys are always present: "id" (String), "kind" (String), "pos" (Pos),
## "stats" (Stats), "tags" (Array[String]), "maxHp" (int). A Pos is
## {"x": int, "y": int}; a Stats is {"hp": int, "might": int, "wits": int,
## "speed": int}.
##
## Nine more keys are `?`-marked in the reference, and therefore ABSENT —
## never present with value null — whenever unset: "post", "disposition",
## "route", "leg", "guise", "scroll", "pocket", "gear", "satchel". TS
## canonicalJson drops an `undefined` key outright; a GDScript null would
## instead encode as the literal `null` and fork every chain that folds an
## entity without one. See test_optional_fields_are_absent_not_null and
## test_state_shape.gd's entity tests for the law pinned two ways.


## The Dictionary with this id, or null when no entity carries it.
static func find(entities: Array, id: String) -> Variant:
	for e: Dictionary in entities:
		if e["id"] == id:
			return e
	return null


static func is_alive(entity: Dictionary) -> bool:
	var stats: Dictionary = entity["stats"]
	var hp: int = stats["hp"]
	return hp > 0
