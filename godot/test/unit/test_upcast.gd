extends GutTest
## upcast_event and upcast_chain — the byte-twin of tests/log/upcast.test.ts.
##
## The v1 fixture (golden-run-v1.json) is the only log in existence written
## before the draw protocol. It is kept precisely so the v1→v2 migration
## (rngDraws derived from payload.counterAfter) has something real to
## migrate, rather than a fixture shaped to make the test pass.
##
## Four of the reference's upcastChain cases need fold() to inspect folded
## state (turn progress, EMPTY_STATE equality) or verify_chain() to confirm
## soundness — neither exists on SimLog yet; its own docstring says both
## "need the reducer and join in Phase 2". Deferred here, not faked, until
## apply.gd/commands.gd land and fold()/verify_chain() arrive alongside them:
##   - 'produces a chain the current engine verifies'         (verify_chain)
##   - 'preserves meaning: every field v1 had folds to...'    (fold)
##   - 'folds to a state that still hashes stably...'         (fold)
##   - 'does not retroactively change what an old log meant'  (fold)
## The other two upcastChain cases — chain length, and that ids change — need
## neither, and are ported below.


func _v1() -> Dictionary:
	return FixtureLoader.load_json("res://test/fixtures/golden-run-v1.json")


func test_derives_draws_from_where_v1_buried_them_and_drops_the_payload_field() -> void:
	var v1 := _v1()
	var root: Dictionary = v1["events"][0]
	assert_eq(root["schemaVersion"], 1)
	assert_eq((root["payload"] as Dictionary)["counterAfter"], 122)

	var up: Dictionary = SimUpcast.upcast_event(root)
	assert_eq(up["schemaVersion"], SimEvents.SCHEMA_VERSIONS["WORLD_INIT"])
	assert_eq(up["rngDraws"], 122)
	assert_false((up["payload"] as Dictionary).has("counterAfter"))


func test_declares_zero_draws_for_the_v1_events_that_consumed_none() -> void:
	var v1 := _v1()
	var move: Variant = null
	for e: Dictionary in v1["events"]:
		if e["type"] == "MOVE":
			move = e
			break
	assert_not_null(move, "fixture problem: no MOVE")
	assert_eq(SimUpcast.upcast_event(move)["rngDraws"], 0)


func test_walks_a_v6_world_init_to_v7_without_inventing_a_cut() -> void:
	## v7 added payload.motif. Floors recorded before motifs existed never
	## said their cut, and stay unsaid — absence folds to null and `motifIs`
	## reads it as false, rather than a migration guessing "door".
	var v6 := {
		"type": "WORLD_INIT", "schemaVersion": 6, "rngCounter": 0, "rngDraws": 3,
		"payload": {
			"width": 2, "height": 1, "tiles": [0, 0], "seed": 9, "story": "two tiles", "depth": 1,
			"items": [], "opponents": [],
			"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
				"stats": {"hp": 5, "might": 1, "wits": 1, "speed": 1}, "tags": []},
		},
	}
	var up: Dictionary = SimUpcast.upcast_event(v6)
	assert_eq(up["schemaVersion"], SimEvents.SCHEMA_VERSIONS["WORLD_INIT"])
	assert_false((up["payload"] as Dictionary).has("motif"))


func test_passes_a_current_version_event_through_untouched() -> void:
	var already := {
		"type": "MOVE", "schemaVersion": SimEvents.SCHEMA_VERSIONS["MOVE"], "rngCounter": 5, "rngDraws": 2,
		"payload": {"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}},
	}
	assert_true(is_same(SimUpcast.upcast_event(already), already), "same object, not a copy")


func test_refuses_a_log_from_the_future_rather_than_guessing() -> void:
	var future := {
		"type": "MOVE", "schemaVersion": 99, "rngCounter": 0, "rngDraws": 0,
		"payload": {"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}},
	}
	SimUpcast.upcast_event(future)
	assert_engine_error("cannot be downcast")


func test_refuses_an_event_type_it_has_no_upcaster_for() -> void:
	SimUpcast.upcast_event({"type": "__NEVER_AN_EVENT__", "schemaVersion": 1, "rngCounter": 0, "payload": {}})
	assert_engine_error("unknown event type __NEVER_AN_EVENT__")


func test_upcast_chain_keeps_every_event() -> void:
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	var log: SimLog = migrated["log"]
	assert_eq(log.chain(migrated["head"]).size(), (v1["events"] as Array).size())


func test_upcast_chain_does_not_preserve_ids_because_identity_is_content_plus_position() -> void:
	## Upcasting changes content, so the hashes must change. A migration that
	## kept its ids would mean the new content was never hashed — which would
	## be the real bug. Asserting the change makes that explicit rather than
	## leaving it as a surprise later.
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	assert_ne(migrated["head"], v1["head"])


func test_upcasting_the_golden_chain_changes_nothing() -> void:
	## Golden is already at current versions, so upcast must be the identity.
	## If it is not, an upcaster is firing when it should not.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	for event: Dictionary in golden["events"]:
		var up: Dictionary = SimUpcast.upcast_event(event)
		assert_eq(up["schemaVersion"], event["schemaVersion"], "%s untouched" % event["type"])
		assert_eq(SimCanonical.encode(up["payload"]), SimCanonical.encode(event["payload"]),
			"%s payload untouched" % event["type"])
