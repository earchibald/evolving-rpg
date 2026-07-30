extends GutTest
## upcast_event and upcast_chain — the byte-twin of tests/log/upcast.test.ts.
##
## The v1 fixture (golden-run-v1.json) is the only log in existence written
## before the draw protocol. It is kept precisely so the v1→v2 migration
## (rngDraws derived from payload.counterAfter) has something real to
## migrate, rather than a fixture shaped to make the test pass.
##
## Four of the reference's upcastChain cases needed fold() to inspect folded
## state (turn progress, EMPTY_STATE equality) or verify_chain() to confirm
## soundness, and were deferred here rather than faked, until Task 2.C2
## brought both to SimLog:
##   - 'produces a chain the current engine verifies'         (verify_chain)
##   - 'preserves meaning: every field v1 had folds to...'    (fold)
##   - 'folds to a state that still hashes stably...'         (fold)
##   - 'does not retroactively change what an old log meant'  (fold)
## All four are ported below now, alongside the other two upcastChain cases
## (chain length, and that ids change) which needed neither and were already
## ported. Six of six.


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


# ── the four deferred upcastChain cases (Task 2.C2 discharges them) ───────

func test_upcast_chain_produces_a_chain_the_current_engine_verifies() -> void:
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	var log: SimLog = migrated["log"]
	assert_null(log.verify_chain(migrated["head"]))


func test_upcast_chain_preserves_meaning_every_field_v1_had_folds_to_the_value_v1_folded_to() -> void:
	## Compared field by field rather than by digest, and the reason is worth
	## keeping. This test began, in the reference, as a hash comparison
	## against v1's own recorded finalStateHash, and that held only as long as
	## GameState's SHAPE did. The moment state gained an `items` field, an old
	## log's fold necessarily hashed differently while meaning precisely the
	## same thing. So the honest invariant is "identical meaning in every
	## field that existed at the time, and empty in the ones that did not" —
	## never "identical bytes". A migration cannot promise that a container it
	## never saw stays the same size.
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	var log: SimLog = migrated["log"]
	var state: Dictionary = log.fold(migrated["head"])

	assert_eq(state["turn"], 101)
	assert_eq(state["seed"], 12345)
	assert_eq(state["rngCounter"], 122)
	var grid: Dictionary = state["grid"]
	assert_eq(grid["width"], 24)
	assert_eq(grid["height"], 16)
	var entities: Array = state["entities"]
	assert_eq(entities.size(), 1)
	assert_eq((entities[0] as Dictionary)["id"], "player")
	# Fields that did not exist when the log was written are empty, not
	# invented.
	assert_eq(state["items"], [])


func test_upcast_chain_folds_to_a_state_that_still_hashes_stably_just_not_to_v1_digest() -> void:
	## Determinism is unaffected by the shape change: two folds of the
	## migrated chain agree with each other, which is the property replay
	## needs — but neither agrees with v1's own digest, computed over a
	## GameState shape this engine no longer has.
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	var log: SimLog = migrated["log"]
	var a: Dictionary = log.fold(migrated["head"])
	var b: Dictionary = log.fold(migrated["head"])
	assert_eq(SimCanonical.encode(a), SimCanonical.encode(b))

	# The same recipe test_state_shape.gd pins: sha256 over the canonical
	# bytes of the whole state.
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(SimCanonical.encode(a).to_utf8_buffer())
	assert_ne(ctx.finish().hex_encode(), v1["finalStateHash"])


func test_upcast_chain_does_not_retroactively_change_what_an_old_log_meant() -> void:
	## Blocked moves no longer cost a turn, but a v1 log recorded the turn
	## advances IT made under the old rule, and still contains them.
	## Migrating replays history as it was lived, not as the current rules
	## would have produced it.
	var v1 := _v1()
	var migrated: Dictionary = SimUpcast.upcast_chain(v1["events"])
	var log: SimLog = migrated["log"]
	assert_eq((log.fold(migrated["head"]) as Dictionary)["turn"], 101)
