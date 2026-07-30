extends GutTest
## Phase 2's second gate: the recorded chain audits clean end to end.
##
## verify_chain re-derives every hash and checks each event's recorded counter
## against the state it is about to be applied to — hash, then type, then
## schema version, then sequence, then rng counter, in that order, because the
## order decides which divergence gets reported first.
##
## ONE DEVIATION FROM THE PLAN'S OWN SNIPPET, deliberate. The plan writes
## `assert_eq(divergence, null, ...)`. That reads fine when the chain is sound
## — but on the run where it is NOT, GUT 9.7.1's comparator cannot diff a
## Dictionary against null and pushes "cannot set differences" instead of the
## divergence, which is precisely the moment you need the message. The Global
## Constraints' own rule (never compare against null through the comparator;
## use assert_null/assert_not_null) governs, so the gate is written that way and
## the reason is printed by hand.


func test_golden_chain_verifies_with_no_divergence() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var log := SimLog.new()
	var head: Variant = null
	for event: Dictionary in golden["events"]:
		head = (log.append(head, event) as Dictionary)["id"]
	var divergence: Variant = log.verify_chain(head)
	assert_null(divergence, "golden verifies clean; got %s" % [divergence])


func test_verify_still_catches_a_tampered_chain() -> void:
	## A gate that cannot fail proves nothing. Build a chain whose recorded id
	## does not match its content and confirm verify names it.
	var log := SimLog.new()
	var a: Dictionary = log.append(null, SimEvents.draft("WAIT", 0, 0, {"entityId": "p1"}))
	var forged: Dictionary = a.duplicate(true)
	forged["payload"] = {"entityId": "someone-else"}
	log.events[a["id"]] = forged        # same id, different content
	var d: Variant = log.verify_chain(a["id"])
	assert_not_null(d, "tampering is caught")
	assert_true(str((d as Dictionary)["reason"]).begins_with("hash mismatch"),
		"and named as a hash mismatch, the first check in the mandated order")
