extends GutTest
## SCHEMA_VERSIONS and draft() — the byte-twin of src/core/events.ts's own
## exports. events.ts is mostly TS payload TYPES with no GDScript runtime
## counterpart (payloads are plain Dictionaries; shaping them is the
## reducer's business, not this file's) — what has runtime behaviour to pin
## is the version table and the draft envelope builder.
##
## The golden run is the strong witness here: it is a recorded chain whose
## every event carries its own type and schemaVersion, so checking the table
## against it proves the table matches reality rather than a reading of the
## reference. It only exercises 5 of the 25 types (WORLD_INIT, MOVE, STRIKE,
## TURN_ADVANCED, ITEM_TAKEN) — the other 20 have no independent witness
## here and rest on the hand-transcription from ts-baseline.


func test_the_schema_table_covers_every_type_the_golden_run_uses() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	for event: Dictionary in golden["events"]:
		var t: String = event["type"]
		assert_true(SimEvents.SCHEMA_VERSIONS.has(t), "schema table knows %s" % t)
		assert_eq(SimEvents.SCHEMA_VERSIONS[t], event["schemaVersion"],
			"%s version agrees with the recorded chain" % t)


func test_a_draft_carries_exactly_the_five_hashed_and_recorded_keys() -> void:
	var d := SimEvents.draft("WAIT", 3, 0, {"entityId": "p1"})
	var keys: Array = d.keys()
	keys.sort()
	assert_eq(keys, ["payload", "rngCounter", "rngDraws", "schemaVersion", "type"])
	assert_eq(d["schemaVersion"], 1, "the version comes from the table, not the caller")
