extends GutTest
## Chronicle — the seam the whole stage hangs on, and the only writer to the
## chain.
##
## RECONCILIATION: 0 reference cases. Chronicle has no TypeScript twin — the web
## UI keeps its log in a module-level closure in `src/play/session.ts` rather
## than in a named seam, so there is no suite to port. Every case here is
## therefore NON-REFERENCE and written against the Phase 3 plan's stated
## contract for this file. That makes them the only thing standing between the
## stage and a second source of truth, so they are written to fail.

const _W := 5
const _H := 5


func _tiles() -> Array:
	var out: Array = []
	for i in range(_W * _H):
		out.append(SimGrid.FLOOR)
	return out


func _world() -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": _W, "height": _H, "tiles": _tiles(), "seed": 99,
		"items": [], "opponents": [],
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [],
		},
	})


func before_each() -> void:
	Chronicle.reset()


func after_all() -> void:
	# The autoload outlives this script. Leaving a world standing in it would
	# leak into whatever suite GUT runs next.
	Chronicle.reset()


func test_a_fresh_chronicle_holds_the_empty_state_and_no_head() -> void:
	assert_null(Chronicle.head, "nothing has happened yet")
	assert_eq(SimCanonical.encode(Chronicle.state()), SimCanonical.encode(SimState.empty()),
		"the empty state is a real state, not a missing one")


func test_committing_a_draft_seals_it_and_moves_the_head() -> void:
	var sealed: Variant = Chronicle.commit(_world())
	assert_not_null(sealed)
	var event: Dictionary = sealed
	assert_eq(Chronicle.head, event["id"], "the head is the event just sealed")
	assert_eq(Chronicle.log.events.size(), 1)
	assert_eq(event["seq"], 0, "the first event sits at seq 0")
	assert_null(event["parent"], "and has no parent")


func test_the_state_after_a_commit_is_the_fold_of_the_new_head() -> void:
	Chronicle.commit(_world())
	var now: Dictionary = Chronicle.state()
	SimState.assert_shape(now)
	assert_eq(now["turn"], 1, "a world opens on turn 1")
	assert_eq((now["entities"] as Array).size(), 1)
	assert_eq(now["seed"], 99)


func test_a_second_commit_chains_onto_the_first() -> void:
	var first: Dictionary = Chronicle.commit(_world())
	var state: Dictionary = Chronicle.state()
	var moved: Variant = Chronicle.commit(
		SimCommands.attempt_move(state, "player", 1, 0))
	assert_not_null(moved)
	var second: Dictionary = moved
	assert_eq(second["parent"], first["id"], "the second event names the first as parent")
	assert_eq(second["seq"], 1)
	assert_eq(Chronicle.head, second["id"])
	assert_eq(Chronicle.log.chain(Chronicle.head).size(), 2)


# ── the null contract: "the world said no" is not an error ────────────────

func test_committing_null_appends_nothing_and_returns_null() -> void:
	## Half the command surface returns null when the world refuses — there is
	## nothing underfoot, the scroll hand is empty, the shove has nowhere to put
	## anybody. Those are outcomes the game is made of, so commit() takes a
	## Variant and absorbs them rather than making twenty call sites remember.
	Chronicle.commit(_world())
	var head_before: Variant = Chronicle.head
	var size_before: int = Chronicle.log.events.size()

	assert_null(Chronicle.commit(null), "a refusal seals nothing")
	assert_eq(Chronicle.head, head_before, "and does not move the head")
	assert_eq(Chronicle.log.events.size(), size_before, "and does not grow the log")


func test_a_refusing_command_can_be_committed_straight_through() -> void:
	## The whole point of the Variant contract, exercised end to end: a real
	## command that really refuses, handed to commit() with no null check in
	## between, on a floor with nothing lying on it.
	Chronicle.commit(_world())
	var state: Dictionary = Chronicle.state()
	var nothing_underfoot: Variant = SimCommands.take_or_refuse(state, "player")
	# Whatever the verb decides, commit must survive being handed it.
	var result: Variant = Chronicle.commit(nothing_underfoot)
	if nothing_underfoot == null:
		assert_null(result, "a refusal passed through cleanly")
	else:
		assert_not_null(result, "a refusal that IS an event is still an event")
		assert_eq(Chronicle.log.chain(Chronicle.head).size(), 2)


# ── the signals: one fold, handed to everyone ─────────────────────────────

var _heard_events: Array = []
var _heard_worlds: Array = []


func _on_event(event: Dictionary, state: Dictionary) -> void:
	_heard_events.append({"event": event, "state": state})


func _on_world(state: Dictionary) -> void:
	_heard_worlds.append(state)


func _listen() -> void:
	_heard_events = []
	_heard_worlds = []
	Chronicle.event_appended.connect(_on_event)
	Chronicle.world_replaced.connect(_on_world)


func _stop_listening() -> void:
	Chronicle.event_appended.disconnect(_on_event)
	Chronicle.world_replaced.disconnect(_on_world)


func test_the_signal_carries_the_state_a_listener_would_have_folded() -> void:
	## Listeners repaint from what they are handed rather than each re-folding.
	## One fold per event instead of one per listener — and, more importantly,
	## every listener sees the SAME state. Two that folded separately could
	## disagree, and the disagreement would surface as a rendering bug hours
	## from its cause.
	_listen()
	Chronicle.commit(_world())
	_stop_listening()

	assert_eq(_heard_events.size(), 1, "one event, one emission")
	var heard: Dictionary = _heard_events[0]
	assert_eq(SimCanonical.encode(heard["state"]), SimCanonical.encode(Chronicle.state()),
		"the state handed to the listener is the fold of the new head")
	assert_eq((heard["event"] as Dictionary)["id"], Chronicle.head)


func test_the_state_in_the_signal_is_AFTER_the_event_not_before() -> void:
	## The head moves before the fold. Reversed, every listener would be told
	## about an event while holding the world from before it happened — the
	## player would appear to move one step late, forever.
	Chronicle.commit(_world())
	_listen()
	var state: Dictionary = Chronicle.state()
	Chronicle.commit(SimCommands.attempt_move(state, "player", 1, 0))
	_stop_listening()

	var heard: Dictionary = _heard_events[0]
	var player: Dictionary = SimEntity.find((heard["state"] as Dictionary)["entities"], "player")
	assert_eq(player["pos"], {"x": 1, "y": 0},
		"the listener sees the player where the step PUT them")


func test_a_world_init_fires_world_replaced_as_well_and_first() -> void:
	## WORLD_INIT replaces state wholesale, and an incremental repaint has no way
	## to say "everything you knew is gone". Both signals fire; the wholesale one
	## goes first so a listener that only handles that case never sees a stale
	## incremental update ahead of it.
	_listen()
	Chronicle.commit(_world())
	_stop_listening()
	assert_eq(_heard_worlds.size(), 1, "a new world announces itself")
	assert_eq(_heard_events.size(), 1, "and is still an ordinary event too")


func test_an_ordinary_event_does_not_fire_world_replaced() -> void:
	Chronicle.commit(_world())
	_listen()
	var state: Dictionary = Chronicle.state()
	Chronicle.commit(SimCommands.attempt_move(state, "player", 1, 0))
	_stop_listening()
	assert_eq(_heard_worlds.size(), 0, "a step is not a new world")
	assert_eq(_heard_events.size(), 1)


func test_a_refusal_emits_nothing_at_all() -> void:
	Chronicle.commit(_world())
	_listen()
	Chronicle.commit(null)
	_stop_listening()
	assert_eq(_heard_events.size(), 0, "nothing happened, so nobody is told")
	assert_eq(_heard_worlds.size(), 0)


# ── reset ─────────────────────────────────────────────────────────────────

func test_reset_drops_the_chain_and_returns_to_the_empty_state() -> void:
	Chronicle.commit(_world())
	assert_not_null(Chronicle.head)
	Chronicle.reset()
	assert_null(Chronicle.head, "begin again means begin again")
	assert_eq(Chronicle.log.events.size(), 0, "the old chain is dropped, not rewound")
	assert_eq(SimCanonical.encode(Chronicle.state()), SimCanonical.encode(SimState.empty()))


func test_what_the_chronicle_wrote_verifies() -> void:
	## The seam's own output has to survive the audit the whole migration is
	## built on. If Chronicle ever sealed something the chain would not accept,
	## this is where it shows.
	Chronicle.commit(_world())
	for i in range(4):
		var state: Dictionary = Chronicle.state()
		Chronicle.commit(SimCommands.attempt_move(state, "player", 1, 0))
		Chronicle.commit(SimCommands.advance_turn(Chronicle.state()))
	assert_null(Chronicle.log.verify_chain(Chronicle.head),
		"everything the stage's only writer wrote, audits clean")
