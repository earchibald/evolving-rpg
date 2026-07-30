extends GutTest
## Append and chain. Written in Phase 1, when fold() and verify_chain() did not
## exist yet; Task 2.C2 shipped both, and their tests live in test_chain.gd —
## including chain()'s own root-first / missing-event / cycle cases, which were
## a gap here and were closed there because fold()'s identical guards needed the
## identical forged-log fixtures anyway.
##
## What remains provable HERE is append()'s own contract: position-sealing,
## convergent-history idempotence, the refusal of an unknown head, root-first
## ordering and the deep freeze.
##
## A5 (an unknown head is refused) and A7 (a head that reset can redo its move)
## were 2.C2's reconciliation's two real gaps — recorded in this docstring
## rather than patched in passing, because they sat outside that task's file
## authorization. Both are ported now, at the bottom of this file.
##
## What stays unported is A3 and the log-immutability clause of A6, and neither
## is a gap. Both assert that the reference's EventLog is PERSISTENT: append
## hands back a NEW log, and a repeat append hands back the identical one. This
## port's SimLog is a mutable instance appending into its own `events`, so
## there is no second log for either claim to be about. The claim underneath
## them — that a repeat append writes nothing — is what
## test_convergent_history_is_idempotent checks in their place.

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


func test_append_rejects_a_head_it_has_never_seen() -> void:
	## A5. An unknown parent is a chain that never existed, and sealing an
	## event onto one would open the very hole chain() and fold() spend a guard
	## each refusing to walk. Cheaper to refuse it at the only door events come
	## in by.
	var log := SimLog.new()
	log.append("nope-not-a-real-hash", DRAFT_A)
	assert_engine_error("unknown head")
	assert_eq(log.events.size(), 0, "and nothing was written")


func test_a_world_can_redo_a_move_it_reset_away() -> void:
	## A7. Reset walks a head backwards; the next press of the same key then
	## reproduces an id the log already holds. In the reference that THREW, and
	## the debug view has no try/catch, so the key silently stopped working —
	## the regression that shipped, and the reason append() returns the sealed
	## event instead of refusing a repeat.
	##
	## Distinct from test_convergent_history_is_idempotent above, which is two
	## holders converging at the root. This is one holder rewinding past its
	## own move and making it again, which is the shape a reset actually has.
	## Nothing here folds, so the payloads are the file's usual stand-ins.
	var log := SimLog.new()
	var root: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 9, {"seed": 20260724}))
	var step := SimEvents.draft("MOVE", 9, 0,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}})

	var moved: Dictionary = log.append(root["id"], step)
	# The reset: head goes back to the world init, and the same move is made
	# from there a second time.
	var redone: Dictionary = log.append(root["id"], step)

	assert_eq(redone["id"], moved["id"], "the redone move IS the move, not a second one")
	assert_eq(log.events.size(), 2, "and the log did not grow to hold a twin")
