extends GutTest
## fold and verify_chain — the byte-twin of src/log/chain.ts:106-204, which is
## the fold/verifyChain portion of tests/log/chain.test.ts's 21 cases.
##
## append and chain (11 of the 21) are Phase 1 work, ported in test_log.gd —
## this file is the other 10 (fold's F1-F4, verifyChain's V1-V6), plus what
## Task 2.C2's brief separately asks for: one hand-built broken chain per
## divergence reason (five, including sequence gap, which the reference never
## tests at all — see below), and fold's own cycle/missing-event guards.
##
## Full PORTED/DEFERRED reconciliation of the reference's 21 titles lives in
## the Task 2.C2 report, not here; in short:
##   - V1/F2/F3/F4 reuse a hand-drafted "honest" chain in place of the
##     reference's build() helper (createWorld/attemptMove/advanceTurn —
##     commands.gd does not exist yet, Wave E). Reducer-valid, unlike
##     test_log.gd's and test_refs.gd's own no-reducer stand-ins, because
##     these tests fold it.
##   - V3-V6 are ported as hand-built broken chains rather than build()-derived
##     ones, which folds them into Step 3's "one per divergence reason" set
##     rather than duplicating each as a second, separate test.
##   - C2-C4 (chain()'s own root-first/missing-event/cycle cases) were a
##     pre-existing Phase 1 gap in test_log.gd — closed here, opportunistically,
##     because fold()'s identical guards need the identical forged-log
##     fixtures anyway. A3/A5/A6's log-immutability clause/A7 remain
##     out of scope: append()'s own behaviour, untouched by this task, and
##     flagged separately rather than patched in passing.


## A short, real, single-floor chain: this suite's analogue of the
## reference's build() helper. commands.gd (createWorld/attemptMove/
## advanceTurn) does not exist yet (Wave E), so this hand-drafts the same
## SHAPE directly through SimEvents.draft() + SimLog.append() — the way
## test_log.gd and test_refs.gd's _build() already do. What differs from
## those two: this suite FOLDS the chain, so every payload must be
## reducer-valid (a real grid, a real player) and every declared rngCounter
## must honestly reflect the running counter at that point, or verify_chain
## would correctly flag a chain this comment calls honest.
##
## Nine events, matching the reference's build() count: 1 WORLD_INIT (which
## draws 9, so the "counter advanced, and stayed put after" both have
## something to show) + four (MOVE, TURN_ADVANCED) pairs, turn climbing 1..5.
func _honest_chain() -> Dictionary:
	var log := SimLog.new()
	var root: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 9, {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"seed": 2026, "opponents": [], "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
	}))
	var head: Variant = root["id"]
	var counter := 9
	var turn := 1
	for d: Array in [[1, 0], [0, 1], [1, 0], [0, 1]]:
		var moved: Dictionary = log.append(head, SimEvents.draft("MOVE", counter, 0,
			{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": d[0], "y": d[1]}}))
		head = moved["id"]
		turn += 1
		var turned: Dictionary = log.append(head, SimEvents.draft("TURN_ADVANCED", counter, 0,
			{"turn": turn, "activeEntityId": "player"}))
		head = turned["id"]
	return {"log": log, "head": head}


## Two floors, honestly recorded — the one shape none of the reference's own
## verifyChain tests exercise (its rng-counter case forges a MOVE, never a
## second WORLD_INIT; see the file header). Floor 1 draws 5 and never gives
## them back; floor 2 opens at a fresh 0 regardless, exactly "a fresh floor
## draws from a fresh seed addressed from zero" — sound only because of the
## WORLD_INIT exception. Returns the descent's own seq too, since the
## mutation proof needs to name precisely where a dropped exception starts
## disagreeing.
func _descent_chain() -> Dictionary:
	var log := SimLog.new()
	var small_world := {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"opponents": [], "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
	}

	var floor1_payload: Dictionary = small_world.duplicate(true)
	floor1_payload["seed"] = 100
	var floor1: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 5, floor1_payload))
	var head: Variant = floor1["id"]
	var moved1: Dictionary = log.append(head, SimEvents.draft("MOVE", 5, 0,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}}))
	head = moved1["id"]
	var turned1: Dictionary = log.append(head, SimEvents.draft("TURN_ADVANCED", 5, 0,
		{"turn": 2, "activeEntityId": "player"}))
	head = turned1["id"]

	# The descent: a fresh WORLD_INIT, addressed from zero, though the
	# running state's counter is 5. Sound only because of the exception.
	var floor2_payload: Dictionary = small_world.duplicate(true)
	floor2_payload["seed"] = 200
	var floor2: Dictionary = log.append(head, SimEvents.draft("WORLD_INIT", 0, 2, floor2_payload))
	var descent_seq: int = floor2["seq"]
	head = floor2["id"]

	var moved2: Dictionary = log.append(head, SimEvents.draft("MOVE", 2, 0,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}}))
	head = moved2["id"]
	var turned2: Dictionary = log.append(head, SimEvents.draft("TURN_ADVANCED", 2, 0,
		{"turn": 2, "activeEntityId": "player"}))
	head = turned2["id"]
	var moved3: Dictionary = log.append(head, SimEvents.draft("MOVE", 2, 0,
		{"entityId": "player", "from": {"x": 1, "y": 0}, "to": {"x": 2, "y": 0}}))
	head = moved3["id"]
	var turned3: Dictionary = log.append(head, SimEvents.draft("TURN_ADVANCED", 2, 0,
		{"turn": 3, "activeEntityId": "player"}))
	head = turned3["id"]

	return {"log": log, "head": head, "descent_seq": descent_seq}


# ── fold ─────────────────────────────────────────────────────────────────

func test_fold_of_a_null_head_is_the_empty_state() -> void:
	var log := SimLog.new()
	assert_eq(SimCanonical.encode(log.fold(null)), SimCanonical.encode(SimState.empty()))


func test_fold_is_deterministic_two_folds_of_one_chain_are_identical() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	assert_eq(SimCanonical.encode(log.fold(head)), SimCanonical.encode(log.fold(head)))


func test_fold_reaches_a_state_where_the_player_exists_and_turns_have_passed() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var state: Dictionary = log.fold(built["head"])
	var entities: Array = state["entities"]
	assert_gte(entities.size(), 1)
	assert_eq((entities[0] as Dictionary)["id"], "player")
	assert_gte(state["turn"], 2)
	assert_gt(state["rngCounter"], 0)


func test_folding_a_prefix_gives_the_state_as_it_was_then() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var third: Dictionary = log.chain(head)[2]
	assert_lte(log.fold(third["id"])["turn"], log.fold(head)["turn"])


func test_fold_raises_on_a_missing_event() -> void:
	## Step 1's own guard: fold() walks back through `events` independently of
	## chain(), so it needs — and gets — the identical missing-event check.
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var victim: Dictionary = log.chain(head)[4]
	log.events.erase(victim["id"])

	log.fold(head)
	assert_engine_error("missing event")


func test_fold_raises_on_a_cycle() -> void:
	## Step 1: "Cycles raise." Content addressing makes a real cycle
	## unreachable by appending, so this is a hand-forged log: two events
	## made to point at each other, mirroring the reference's own
	## `refuses a cycle` fixture technique (see test_chain_refuses_a_cycle
	## below, and its TS ancestor).
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var events: Array = log.chain(built["head"])
	var earlier: Dictionary = events[1]
	var later: Dictionary = events[2]
	var looped: Dictionary = earlier.duplicate()
	looped["parent"] = later["id"]
	log.events[earlier["id"]] = looped

	log.fold(later["id"])
	assert_engine_error("cycle")


# ── chain()'s own guards: a pre-existing Phase 1 gap in test_log.gd, ──────
# ── closed here because fold()'s guards above need the identical fixtures ─

func test_the_honest_fixtures_chain_is_root_first_with_contiguous_sequence_numbers() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var events: Array = log.chain(built["head"])
	assert_eq(events.size(), 9)
	assert_eq((events[0] as Dictionary)["type"], "WORLD_INIT")
	for i: int in events.size():
		assert_eq((events[i] as Dictionary)["seq"], i, "seq is position, at index %d" % i)


func test_chain_reports_a_missing_event_rather_than_returning_a_short_chain() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var victim: Dictionary = log.chain(head)[4]
	log.events.erase(victim["id"])

	log.chain(head)
	assert_engine_error("missing event")


func test_chain_refuses_a_cycle_rather_than_walking_forever() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var events: Array = log.chain(head)
	var earlier: Dictionary = events[1]
	var later: Dictionary = events[2]
	var looped: Dictionary = earlier.duplicate()
	looped["parent"] = later["id"]
	log.events[earlier["id"]] = looped

	log.chain(later["id"])
	assert_engine_error("cycle")


# ── verify_chain: sound chains ─────────────────────────────────────────────

func test_verify_chain_passes_a_chain_built_honestly() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	assert_null(log.verify_chain(built["head"]))


func test_verify_chain_passes_an_empty_chain() -> void:
	var log := SimLog.new()
	assert_null(log.verify_chain(null))


func test_verify_chain_passes_a_chain_that_legitimately_crosses_a_descent() -> void:
	## The WORLD_INIT exception's happy path. Nothing in the reference's own
	## suite exercises this — verifyChain's rng-counter case forges a MOVE,
	## never a second WORLD_INIT — so a verify_chain that wrongly demanded
	## continuity across the stairs would still pass every reference test
	## while failing every real saved game that had ever descended (see the
	## exception's own comment in log.gd). This is that missing case, and the
	## mutation proof's primary target.
	var built := _descent_chain()
	var log: SimLog = built["log"]
	assert_null(log.verify_chain(built["head"]))


func test_verify_chain_passes_the_recorded_golden_run() -> void:
	## 2.F2 makes this an exit gate in its own right; this is 2.C2's own sanity
	## check that verify_chain does not choke walking the real 451 events.
	## Worth recording precisely, because it bears on the mutation report: the
	## golden run's ONLY WORLD_INIT is its root (seq 0, rngCounter 0), so this
	## particular chain never descends and cannot exercise the exception's
	## happy path the way _descent_chain() above does.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var log := SimLog.new()
	var head: Variant = null
	for event: Dictionary in (golden["events"] as Array):
		head = (log.append(head, event) as Dictionary)["id"]
	assert_eq(head, golden["head"], "fixture problem: rebuilt head does not match recorded head")
	assert_null(log.verify_chain(head))


# ── verify_chain: the five divergence reasons (Step 3), each a hand-built ──
# ── broken chain, in the reason order log.gd's verify_chain checks them. ──
# ── V3-V6 below are the reference's own cases, ported this way rather than ─
# ── via build(); sequence gap has no reference test at all — it cannot ────
# ── arise through append(), which always assigns seq itself, so ───────────
# ── demonstrating it means forging an event straight into log.events the ──
# ── way the other four already do. ─────────────────────────────────────────

func test_verify_chain_catches_a_hash_mismatch_from_a_tampered_payload() -> void:
	var built := _honest_chain()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var victim: Dictionary = log.chain(head)[1]
	var forged: Dictionary = victim.duplicate(true)
	var forged_payload: Dictionary = (forged["payload"] as Dictionary).duplicate(true)
	forged_payload["to"] = {"x": 99, "y": 99}
	forged["payload"] = forged_payload
	log.events[victim["id"]] = forged

	var divergence: Variant = log.verify_chain(head)
	assert_not_null(divergence)
	assert_eq((divergence as Dictionary)["seq"], victim["seq"])
	assert_eq((divergence as Dictionary)["eventId"], victim["id"])
	assert_string_contains((divergence as Dictionary)["reason"], "hash mismatch, recomputed ")


func test_verify_chain_refuses_an_unknown_event_type() -> void:
	var log := SimLog.new()
	var alien: Dictionary = log.append(null,
		{"type": "SUMMONED_A_GOD", "schemaVersion": 1, "rngCounter": 0, "rngDraws": 0, "payload": {}})

	var divergence: Variant = log.verify_chain(alien["id"])
	assert_not_null(divergence)
	assert_eq((divergence as Dictionary)["seq"], 0)
	assert_string_contains((divergence as Dictionary)["reason"], "unknown event type SUMMONED_A_GOD")


func test_verify_chain_refuses_a_schema_version_this_engine_does_not_implement() -> void:
	var log := SimLog.new()
	var future: Dictionary = log.append(null, {
		"type": "MOVE", "schemaVersion": 99, "rngCounter": 0, "rngDraws": 0,
		"payload": {"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}},
	})

	var divergence: Variant = log.verify_chain(future["id"])
	assert_not_null(divergence)
	assert_string_contains((divergence as Dictionary)["reason"],
		"MOVE is schemaVersion 99, this engine implements %d" % SimEvents.SCHEMA_VERSIONS["MOVE"])


func test_verify_chain_catches_a_sequence_gap() -> void:
	var log := SimLog.new()
	var root: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"seed": 1, "opponents": [], "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 5, "might": 1, "wits": 1, "speed": 1}, "tags": []},
	}))
	# Self-consistent but wrong: the id is hashed straight from the SAME
	# (skipped) seq it is stored under, so the hash check — first in the
	# mandated order — has nothing to catch, and only the sequence check can
	# fire.
	var draft: Dictionary = SimEvents.draft("MOVE", 0, 0,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}})
	var skipped_seq := 5
	var id: String = SimHash.hash_event(draft, root["id"], skipped_seq)
	var forged: Dictionary = draft.duplicate(true)
	forged["id"] = id
	forged["parent"] = root["id"]
	forged["seq"] = skipped_seq
	log.events[id] = forged

	var divergence: Variant = log.verify_chain(id)
	assert_not_null(divergence)
	assert_eq((divergence as Dictionary)["seq"], skipped_seq)
	assert_eq((divergence as Dictionary)["eventId"], id)
	assert_string_contains((divergence as Dictionary)["reason"], "sequence gap: expected seq 1")


func test_verify_chain_catches_an_rng_counter_that_does_not_line_up_with_the_state() -> void:
	## Built honestly, so every hash is valid and the counter check is the
	## only thing that can fire. A MOVE, never a WORLD_INIT — the exception
	## above does not apply, and cannot be why this one is caught.
	var log := SimLog.new()
	var root: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 5, {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"seed": 555, "opponents": [], "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
	}))
	var state: Dictionary = log.fold(root["id"])
	var player: Dictionary = SimEntity.find(state["entities"], "player")
	var bad: Dictionary = log.append(root["id"], SimEvents.draft("MOVE", int(state["rngCounter"]) + 999, 0,
		{"entityId": "player", "from": (player["pos"] as Dictionary).duplicate(),
			"to": (player["pos"] as Dictionary).duplicate()}))

	var divergence: Variant = log.verify_chain(bad["id"])
	assert_not_null(divergence)
	assert_eq((divergence as Dictionary)["seq"], 1)
	assert_string_contains((divergence as Dictionary)["reason"], "rng counter recorded as 1004 but state is at 5")
