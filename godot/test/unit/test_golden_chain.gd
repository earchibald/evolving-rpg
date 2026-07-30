extends GutTest
## The migration's first hard gate.
##
## Every recorded event of the committed golden run re-hashes, in GDScript, to
## the identical chain — closing on the same head the TypeScript engine signed.
## No reducer is involved yet: this proves that rng-counter envelopes, canonical
## bytes and SHA-256 all agree across the two languages. If this passes, the two
## engines mean the same thing by "history".
##
## The run is 125 brawler actions that produced 451 events on a 48x32 vale.


func test_golden_chain_rehashes_to_recorded_head() -> void:
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var events: Array = golden["events"]
	var parent: Variant = null
	var seq := 0
	for event: Dictionary in events:
		parent = SimHash.hash_event(event, parent, seq)
		seq += 1
	assert_eq(seq, events.size())
	assert_eq(parent, golden["head"], "golden chain head")


func test_every_recorded_id_is_reproduced_in_place() -> void:
	## The head agreeing is the headline, but it is one comparison. This asserts
	## all 451 ids independently, so a first-divergence is named rather than
	## having to be bisected by hand.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var events: Array = golden["events"]
	var parent: Variant = null
	var diverged := -1
	for i: int in events.size():
		var event: Dictionary = events[i]
		var id: String = SimHash.hash_event(event, parent, i)
		if id != event["id"] and diverged == -1:
			diverged = i
			assert_eq(id, event["id"],
				"first divergence at seq %d, a %s" % [i, event["type"]])
		assert_eq(event["seq"], i, "recorded seq %d is its position" % i)
		assert_eq(event["parent"], parent, "recorded parent at seq %d" % i)
		parent = id
	assert_eq(diverged, -1, "no event diverged")


func test_the_chain_replays_through_simlog_to_the_same_head() -> void:
	## The same proof, driven through SimLog.append rather than hash_event
	## directly: appending the recorded drafts in order must rebuild the exact
	## chain, and chain() must hand it back root-first and complete.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var events: Array = golden["events"]
	var log := SimLog.new()
	var head: Variant = null
	for event: Dictionary in events:
		head = (log.append(head, event) as Dictionary)["id"]
	assert_eq(head, golden["head"], "head rebuilt through append")
	assert_eq(log.events.size(), events.size(), "no event collapsed or doubled")
	var rebuilt: Array = log.chain(head)
	assert_eq(rebuilt.size(), events.size())
	for i: int in events.size():
		assert_eq((rebuilt[i] as Dictionary)["id"], (events[i] as Dictionary)["id"],
			"rebuilt chain matches at seq %d" % i)
