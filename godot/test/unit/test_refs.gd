extends GutTest
## create/get_ref/set_head/is_ancestor/fork/reset/list_refs — the byte-twin of
## tests/log/refs.test.ts.
##
## The reference's own build() helper drives createWorld / attemptMove / a
## fold() / advanceTurn to grow a nine-event chain (1 WORLD_INIT root + four
## (MOVE, TURN_ADVANCED) pairs). commands.gd (createWorld/attemptMove/
## advanceTurn) is still unwritten (Wave E), so this stands in with nine
## hand-appended drafts of the same shape, built the same way test_log.gd and
## test_golden_chain.gd already build chains: SimEvents.draft() +
## SimLog.append(), no commands involved.
##
## What every test below actually exercises is refs/log STRUCTURE — heads,
## seq, chain shape, branch membership — never game meaning. Three tests do
## also fold(): Task 2.C2 brought fold() to SimLog, and _build()'s payloads
## are shaped to be REDUCER-VALID (a real grid, a real TURN_ADVANCED payload)
## precisely so those three could stop deferring the assertions they had
## parked in place with a comment:
##   - 'the two worlds then diverge independently'         (fold(...).turn)
##   - 'can be undone, because the abandoned events...'    (fold(...).turn, x2)
##   - 'resets all the way back to nothing'                (fold(...) == EMPTY_STATE)
## All restored below. None needed commands.gd — only fold() itself, which
## reads whatever chain it is given regardless of how that chain was built.


func _build() -> Dictionary:
	var log := SimLog.new()
	var floor_tiles: Array = []
	for i in range(16 * 12):
		floor_tiles.append(SimGrid.FLOOR)
	var root: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 16, "height": 12, "tiles": floor_tiles, "seed": 31337, "opponents": [], "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
	}))
	var head: Variant = root["id"]
	# Real payloads, not {} — this chain is folded by three tests below, and
	# an empty TURN_ADVANCED payload would hand apply.gd's _turn_advanced a
	# missing "turn"/"activeEntityId". Turn climbs 1..5 across the four
	# pairs, which is also what lets "diverge independently" and "can be
	# undone" compare an earlier fold's turn against a later one meaningfully
	# rather than trivially.
	var turn := 1
	for d: Array in [[1, 0], [0, 1], [1, 0], [0, 1]]:
		var moved: Dictionary = log.append(head, SimEvents.draft("MOVE", 0, 0,
			{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": d[0], "y": d[1]}}))
		head = moved["id"]
		turn += 1
		var turned: Dictionary = log.append(head, SimEvents.draft("TURN_ADVANCED", 0, 0,
			{"turn": turn, "activeEntityId": "player"}))
		head = turned["id"]
	return {"log": log, "head": head}


## Grows a branch by one event, standing in for the reference's
## `append(log, at, attemptMove(fold(log, at), 'player', 0, 1))`. Only the
## branch's existence and hash matter to the tests that call this — never
## its payload's game meaning.
func _grow(log: SimLog, at: Variant) -> Dictionary:
	return log.append(at, SimEvents.draft("MOVE", 0, 0,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 0, "y": 1}}))


# --- create and get_ref ---------------------------------------------------

func test_stores_a_named_ref_stamped_with_the_engine_version() -> void:
	var head: Variant = _build()["head"]
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "first run")
	var ref := SimRefs.get_ref(refs, "Ashfall")
	assert_eq(ref["head"], head)
	assert_eq(ref["engineVersion"], SimRefs.ENGINE_VERSION)
	assert_eq(ref["note"], "first run")


func test_refuses_to_overwrite_an_existing_name() -> void:
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", null, 0, "")
	SimRefs.create(refs, "Ashfall", null, 0, "")
	assert_engine_error("already exists")


func test_throws_for_a_name_it_does_not_know() -> void:
	SimRefs.get_ref(SimRefs.empty(), "nowhere")
	assert_engine_error("unknown ref")


func test_does_not_mutate_the_refs_it_was_given() -> void:
	var refs := SimRefs.empty()
	SimRefs.create(refs, "Ashfall", null, 0, "")
	assert_eq((refs["byName"] as Dictionary).size(), 0)


# --- is_ancestor ------------------------------------------------------------

func test_is_true_for_any_event_on_the_chain_including_the_head_itself() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var events: Array = log.chain(head)
	var root: Dictionary = events[0]
	var middle: Dictionary = events[3]
	assert_true(SimRefs.is_ancestor(log, head, root["id"]))
	assert_true(SimRefs.is_ancestor(log, head, middle["id"]))
	assert_true(SimRefs.is_ancestor(log, head, head))


func test_is_false_for_something_not_on_the_chain() -> void:
	var built := _build()
	assert_false(SimRefs.is_ancestor(built["log"], built["head"], "f".repeat(64)))


# --- fork --------------------------------------------------------------------

func test_creates_a_second_world_sharing_the_prefix_with_no_events_copied() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var at: Dictionary = log.chain(head)[4]

	var before: int = log.events.size()
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.fork(log, refs, "Ashfall", "Ashfall-b", at["id"], "what if")

	assert_eq(log.events.size(), before)
	assert_eq(SimRefs.get_ref(refs, "Ashfall")["head"], head)
	assert_eq(SimRefs.get_ref(refs, "Ashfall-b")["head"], at["id"])


func test_forks_at_the_current_head_when_no_hash_is_given() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.fork(log, refs, "Ashfall", "Ashfall-b", null, "")
	assert_eq(SimRefs.get_ref(refs, "Ashfall-b")["head"], head)


func test_records_the_fork_point_sequence_not_the_source_head_sequence() -> void:
	## Every other fork test checks only .head, so dropping the "-1" from the
	## seq arithmetic would ship silently.
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var at: Dictionary = log.chain(head)[4]

	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.fork(log, refs, "Ashfall", "Ashfall-b", at["id"], "")

	assert_eq(at["seq"], 4)
	assert_eq(SimRefs.get_ref(refs, "Ashfall-b")["createdAtSeq"], 4)


func test_forks_a_ref_whose_head_is_null_into_another_empty_world() -> void:
	var log: SimLog = _build()["log"]
	var refs := SimRefs.create(SimRefs.empty(), "Unstarted", null, 0, "")
	refs = SimRefs.fork(log, refs, "Unstarted", "Unstarted-b", null, "")
	assert_null(SimRefs.get_ref(refs, "Unstarted-b")["head"])
	assert_eq(SimRefs.get_ref(refs, "Unstarted-b")["createdAtSeq"], 0)


func test_the_two_worlds_then_diverge_independently() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var at: Dictionary = log.chain(head)[4]
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.fork(log, refs, "Ashfall", "Ashfall-b", at["id"], "")

	var fork_head: Variant = SimRefs.get_ref(refs, "Ashfall-b")["head"]
	var grown: Dictionary = _grow(log, fork_head)
	refs = SimRefs.set_head(refs, "Ashfall-b", grown["id"])

	assert_ne(SimRefs.get_ref(refs, "Ashfall-b")["head"], SimRefs.get_ref(refs, "Ashfall")["head"])
	# The reference folds `grown.log` — its OWN copy, since EventLog is
	# immutable there. SimLog mutates in place (see the file header), so
	# there is only one `log`, already extended by the grow above; folding
	# Ashfall's own (unmoved) head through it proves the shared log is still
	# sound after a sibling ref grew a branch off it.
	assert_gte(log.fold(SimRefs.get_ref(refs, "Ashfall")["head"])["turn"], 1)


func test_rejects_a_fork_point_absent_from_the_log() -> void:
	var built := _build()
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", built["head"], 8, "")
	SimRefs.fork(built["log"], refs, "Ashfall", "Ashfall-b", "a".repeat(64), "")
	assert_engine_error("not on the chain")


func test_rejects_a_fork_point_that_is_in_the_log_but_on_another_branch() -> void:
	## The case above proves less than it appears to: a hash absent from the
	## log is refused by chain()'s own missing-event guard even without the
	## ancestry check, so it never exercises that check. This one uses a hash
	## genuinely in the log, just not an ancestor of the ref being forked.
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var at: Dictionary = log.chain(head)[4]

	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.fork(log, refs, "Ashfall", "Sidetrack", at["id"], "")

	var side_head: Variant = SimRefs.get_ref(refs, "Sidetrack")["head"]
	var grown: Dictionary = _grow(log, side_head)
	refs = SimRefs.set_head(refs, "Sidetrack", grown["id"])

	SimRefs.fork(log, refs, "Ashfall", "Bogus", grown["id"], "")
	assert_engine_error("not on the chain")


func test_rejects_a_name_already_in_use() -> void:
	var built := _build()
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", built["head"], 8, "")
	SimRefs.fork(built["log"], refs, "Ashfall", "Ashfall", null, "")
	assert_engine_error("already exists")


# --- reset -------------------------------------------------------------------

func test_reset_moves_a_head_backwards_without_destroying_anything() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var target: Dictionary = log.chain(head)[2]

	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	var size_before: int = log.events.size()
	refs = SimRefs.reset(log, refs, "Ashfall", target["id"])

	assert_eq(SimRefs.get_ref(refs, "Ashfall")["head"], target["id"])
	assert_eq(log.events.size(), size_before)


func test_reset_can_be_undone_because_the_abandoned_events_are_still_there() -> void:
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var target: Dictionary = log.chain(head)[2]

	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.reset(log, refs, "Ashfall", target["id"])

	# The name of this test claims the events survive, so check that rather
	# than only that a pointer can be reassigned. Restoring a string would
	# pass even if reset had deleted everything it abandoned.
	assert_eq(log.chain(head).size(), 9)
	assert_gt(log.fold(head)["turn"], log.fold(target["id"])["turn"])

	refs = SimRefs.set_head(refs, "Ashfall", head)
	assert_eq(SimRefs.get_ref(refs, "Ashfall")["head"], head)
	assert_eq(log.fold(SimRefs.get_ref(refs, "Ashfall")["head"])["turn"], log.fold(head)["turn"])


func test_reset_refuses_a_target_that_is_not_an_ancestor_of_the_current_head() -> void:
	var built := _build()
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", built["head"], 8, "")
	SimRefs.reset(built["log"], refs, "Ashfall", "b".repeat(64))
	assert_engine_error("not on the chain")


func test_reset_resets_all_the_way_back_to_nothing() -> void:
	## A null target skips ancestry validation, since there is no chain to be
	## on. The log keeps every event regardless.
	var built := _build()
	var log: SimLog = built["log"]
	var head: Variant = built["head"]
	var refs := SimRefs.create(SimRefs.empty(), "Ashfall", head, 8, "")
	refs = SimRefs.reset(log, refs, "Ashfall", null)

	assert_null(SimRefs.get_ref(refs, "Ashfall")["head"])
	assert_eq(SimCanonical.encode(log.fold(null)), SimCanonical.encode(SimState.empty()),
		"a null head folds to the empty state")
	assert_eq(log.events.size(), 9)


# --- list_refs -----------------------------------------------------------

func test_lists_by_name_so_display_order_never_wobbles() -> void:
	var refs := SimRefs.create(SimRefs.empty(), "Zephyr", null, 0, "")
	refs = SimRefs.create(refs, "Ashfall", null, 0, "")
	var names: Array = []
	for r: Dictionary in SimRefs.list_refs(refs):
		names.append(r["name"])
	assert_eq(names, ["Ashfall", "Zephyr"])
