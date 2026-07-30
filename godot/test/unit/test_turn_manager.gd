extends GutTest
## TurnManager — the shell that sequences turns and resolves nothing.
##
## RECONCILIATION: 0 reference cases ported. `src/play/session.ts` has no test
## suite of its own at ts-baseline; its behaviour is covered there only
## indirectly, through the balance suite. So every case here is NON-REFERENCE
## and written against the Phase 3 plan's contract for this file.
##
## What these tests assert is THE CHAIN, never the pixels. A turn manager is
## right when the events it caused are the events that should have happened, in
## the order they should have happened, and wrong otherwise — what any of it
## looked like is the board's business.

const _W := 9
const _H := 5


func _tiles() -> Array:
	var out: Array = []
	for i in range(_W * _H):
		out.append(SimGrid.FLOOR)
	return out


func _world(opponents: Array = []) -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": _W, "height": _H, "tiles": _tiles(), "seed": 4242,
		"items": [], "opponents": opponents,
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 2},
			"stats": {"hp": 12, "might": 4, "wits": 3, "speed": 4}, "tags": [],
		},
	})


func _foe(id: String, x: int, y: int, speed: int = 1) -> Dictionary:
	return {
		"id": id, "kind": "bruiser", "pos": {"x": x, "y": y},
		"stats": {"hp": 7, "might": 4, "wits": 1, "speed": speed}, "tags": [],
	}


func _types_since(from_len: int) -> Array:
	var out: Array = []
	var chain: Array = Chronicle.log.chain(Chronicle.head)
	for i in range(from_len, chain.size()):
		out.append((chain[i] as Dictionary)["type"])
	return out


func before_each() -> void:
	Chronicle.reset()


func after_all() -> void:
	Chronicle.reset()


func test_a_refused_action_costs_no_turn_and_records_nothing() -> void:
	## A command returning null is the world saying no — nothing underfoot, no
	## scroll in hand. It must not burn a turn, and it must not run the floor's
	## settling or anyone else's move.
	Chronicle.commit(_world())
	var head_before: Variant = Chronicle.head
	var turn_before: int = Chronicle.state()["turn"]

	var turns := TurnManager.new()
	assert_false(turns.player_acts(null), "a refusal reports that nothing happened")
	assert_eq(Chronicle.head, head_before, "and seals nothing")
	assert_eq(Chronicle.state()["turn"], turn_before, "and costs no turn")


func test_a_step_records_the_move_then_passes_the_turn() -> void:
	Chronicle.commit(_world())
	var before: int = Chronicle.log.chain(Chronicle.head).size()
	var turns := TurnManager.new()
	turns.player_acts(SimCommands.attempt_move(Chronicle.state(), "player", 1, 0))

	var types: Array = _types_since(before)
	assert_true(types.has("MOVE"), "the step is recorded: %s" % [types])
	assert_true(types.has("TURN_ADVANCED"), "and the turn passes: %s" % [types])
	assert_eq(types[0], "MOVE", "the act comes first, before anything answers it")
	var player: Dictionary = SimEntity.find(Chronicle.state()["entities"], "player")
	assert_eq(player["pos"], {"x": 1, "y": 2}, "and the player is where the step put them")


func test_the_order_is_act_then_collect_then_settle_then_pass() -> void:
	## Load-bearing, and spelled out because shuffling it is invisible until it
	## bites: a player who collects after the turn passes picks things up a turn
	## late, and a floor that settles before the act springs a trap on a tile
	## nobody has reached yet.
	var world: Dictionary = _world()
	(world["payload"] as Dictionary)["items"] = [{
		"id": "relic-1", "kind": "iron brand", "pos": {"x": 1, "y": 2},
		"grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0},
	}]
	Chronicle.commit(world)
	var before: int = Chronicle.log.chain(Chronicle.head).size()

	var turns := TurnManager.new()
	turns.player_acts(SimCommands.attempt_move(Chronicle.state(), "player", 1, 0))
	var types: Array = _types_since(before)

	var move_at: int = types.find("MOVE")
	var took_at: int = types.find("ITEM_TAKEN")
	var turned_at: int = types.find("TURN_ADVANCED")
	assert_true(move_at >= 0, "the step happened: %s" % [types])
	assert_true(took_at > move_at, "what the step reached is taken AFTER the step")
	assert_true(turned_at > took_at, "and the turn passes after the taking")


func test_a_strict_upgrade_underfoot_rides_along_free() -> void:
	## The collect costs no turn of its own — it is part of the move that
	## reached it. One TURN_ADVANCED, not two.
	var world: Dictionary = _world()
	(world["payload"] as Dictionary)["items"] = [{
		"id": "relic-1", "kind": "iron brand", "pos": {"x": 1, "y": 2},
		"grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0},
	}]
	Chronicle.commit(world)
	var before: int = Chronicle.log.chain(Chronicle.head).size()
	var turns := TurnManager.new()
	turns.player_acts(SimCommands.attempt_move(Chronicle.state(), "player", 1, 0))

	var advanced := 0
	for t: String in _types_since(before):
		if t == "TURN_ADVANCED":
			advanced += 1
	assert_eq(advanced, 1, "picking something up on the way does not cost a second turn")


# ── the enemies, and the mind that moves them ─────────────────────────────

func test_a_creature_takes_its_turn_and_the_player_gets_theirs_back() -> void:
	Chronicle.commit(_world([_foe("brute", 6, 2)]))
	var before: int = Chronicle.log.chain(Chronicle.head).size()
	var turns := TurnManager.new()
	turns.player_acts(SimCommands.wait(Chronicle.state(), "player"))

	assert_eq(Chronicle.state()["activeEntityId"], "player",
		"control comes back to the player when everyone else has moved")
	var types: Array = _types_since(before)
	assert_true(types.has("WAIT"), "the player's hold is recorded: %s" % [types])
	# The brute is faster than nothing and slower than the player; whatever it
	# chose, SOMETHING of its own must be on the chain between the two turns.
	assert_true(types.size() >= 3,
		"a round with a creature in it records more than the player's own act: %s" % [types])


func test_a_creature_beside_the_player_strikes_by_walking_into_them() -> void:
	## The reference has no separate melee verb — you walk into what you mean to
	## hit. The Action says "strike"; the command is a bump. This is the one
	## place the mind's vocabulary and the verb's vocabulary meet, so it is
	## pinned rather than assumed.
	Chronicle.commit(_world([_foe("brute", 1, 2, 9)]))
	var before: int = Chronicle.log.chain(Chronicle.head).size()
	var turns := TurnManager.new()
	turns.player_acts(SimCommands.wait(Chronicle.state(), "player"))

	var types: Array = _types_since(before)
	assert_true(types.has("STRIKE"),
		"a creature at arm's reach swings rather than shuffling: %s" % [types])


func test_command_for_translates_every_action_kind_the_mind_can_return() -> void:
	## ai.gd's own docstring lists the union: call, mend, strike, draw, step,
	## shoot, lunge, wait. If a kind were missing from the match, the creature
	## carrying it would silently do nothing forever — so every arm is exercised
	## and asked only to produce SOMETHING or a clean null, never to crash.
	Chronicle.commit(_world([_foe("brute", 3, 2)]))
	var turns := TurnManager.new()
	var kinds := ["wait", "step", "strike", "draw", "mend", "call", "shoot", "lunge"]
	for kind: String in kinds:
		var action: Dictionary = {"kind": kind}
		if kind == "step":
			action["dx"] = 1
			action["dy"] = 0
		elif kind in ["strike", "shoot", "lunge"]:
			action["targetId"] = "player"
		var got: Variant = turns.command_for(action, "brute")
		# A null is legitimate — a verb can refuse — but an ENGINE ERROR is not,
		# and an unhandled kind would raise one.
		assert_true(got == null or got is Dictionary,
			"the '%s' arm produced a draft or a clean refusal" % kind)
	assert_eq(kinds.size(), 8, "all eight members of the union, spelled out")


func test_an_action_kind_the_mind_cannot_return_is_refused_loudly() -> void:
	Chronicle.commit(_world())
	var turns := TurnManager.new()
	turns.command_for({"kind": "ASCEND_BODILY"}, "player")
	assert_engine_error("unknown action kind")
	assert_push_error("unknown action kind")


# ── the whole thing, audited ──────────────────────────────────────────────

func test_a_played_round_produces_a_chain_that_verifies() -> void:
	## The end of the argument. Whatever the loop sequenced, the chain it built
	## has to survive the same audit the golden run does — hash, type, schema
	## version, sequence and rng counter, all accounted for.
	Chronicle.commit(_world([_foe("brute", 6, 2), _foe("runner", 7, 3, 5)]))
	var turns := TurnManager.new()
	for i in range(6):
		var state: Dictionary = Chronicle.state()
		turns.player_acts(SimCommands.attempt_move(state, "player", 1, 0))
	assert_null(Chronicle.log.verify_chain(Chronicle.head),
		"six rounds of real play, and the chain audits clean")
	SimState.assert_shape(Chronicle.state())
