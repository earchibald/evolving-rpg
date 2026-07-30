extends GutTest
## Append and chain. Written in Phase 1, when fold() and verify_chain() did not
## exist yet; Task 2.C2 shipped both, and their tests live in test_chain.gd —
## including chain()'s own root-first / missing-event / cycle cases, which were
## a gap here and were closed there because fold()'s identical guards needed the
## identical forged-log fixtures anyway.
##
## What remains provable HERE is append()'s own contract: position-sealing,
## convergent-history idempotence, root-first ordering and the deep freeze.
##
## STILL UNCOVERED, and named so it stops being invisible: two cases from the
## reference's append() suite (the log-immutability clause of A5, and A7) have
## no test in this repo. Found during Task 2.C2's reconciliation, and out of
## that task's file authorization to fix — recorded here rather than patched in
## passing, which is why this docstring says it instead of the report only.

const DRAFT_A := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 0, "payload": {"n": 1}}
const DRAFT_B := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 1, "payload": {"n": 2}}


func test_append_seals_position_and_chains_root_first() -> void:
	var log := SimLog.new()
	var a: Dictionary = log.append(null, DRAFT_A)
	var b: Dictionary = log.append(a["id"], DRAFT_B)
	assert_eq(a["seq"], 0)
	assert_eq(b["seq"], 1)
	assert_eq(b["parent"], a["id"])
	assert_eq(a["parent"], null, "the root has no parent")
	var events: Array = log.chain(b["id"])
	assert_eq(events.size(), 2)
	assert_eq(events[0]["id"], a["id"], "chain is root-first")
	assert_eq(events[1]["id"], b["id"])


func test_convergent_history_is_idempotent() -> void:
	## Two holders appending the same content at the same position have written
	## the same event, not two events. This is what content addressing buys.
	var log := SimLog.new()
	var a1: Dictionary = log.append(null, DRAFT_A)
	var a2: Dictionary = log.append(null, DRAFT_A)
	assert_eq(a1["id"], a2["id"])
	assert_eq(log.events.size(), 1)


func test_the_same_draft_at_a_different_position_is_a_different_event() -> void:
	var log := SimLog.new()
	var a: Dictionary = log.append(null, DRAFT_A)
	var again: Dictionary = log.append(a["id"], DRAFT_A)
	assert_ne(a["id"], again["id"])
	assert_eq(log.events.size(), 2)


func test_sealed_events_are_read_only() -> void:
	var log := SimLog.new()
	var a: Dictionary = log.append(null, DRAFT_A)
	assert_true(a.is_read_only(), "the event itself is frozen")
	assert_true((a["payload"] as Dictionary).is_read_only(), "and so is its payload")


func test_the_draft_is_copied_not_captured() -> void:
	## A caller who keeps mutating their draft must not be able to reach into
	## sealed history. The reference engine's hardest lesson, kept.
	var draft := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 0, "payload": {"n": 1}}
	var log := SimLog.new()
	var a: Dictionary = log.append(null, draft)
	draft["payload"]["n"] = 999
	assert_eq((a["payload"] as Dictionary)["n"], 1, "sealed history is unmoved")


func test_chain_forks_share_their_root() -> void:
	var log := SimLog.new()
	var root: Dictionary = log.append(null, DRAFT_A)
	var left: Dictionary = log.append(root["id"], DRAFT_B)
	var right: Dictionary = log.append(root["id"], {"type": "WAIT", "schemaVersion": 1, "rngCounter": 2, "payload": {"n": 3}})
	assert_ne(left["id"], right["id"])
	assert_eq((log.chain(left["id"]) as Array).size(), 2)
	assert_eq((log.chain(right["id"]) as Array).size(), 2)
	assert_eq((log.chain(left["id"]) as Array)[0]["id"], root["id"], "both forks keep the root")
	assert_eq((log.chain(right["id"]) as Array)[0]["id"], root["id"])


func test_chain_of_nothing_is_empty() -> void:
	var log := SimLog.new()
	assert_eq((log.chain(null) as Array).size(), 0)
