class_name TurnManager
extends RefCounted
## Whose turn it is, and nothing else — the stage's twin of src/play/session.ts.
##
## IT SEQUENCES. IT NEVER RESOLVES. Every outcome in this file is decided by a
## command function in `sim/` and recorded by `Chronicle`; this class only
## decides *whose* command gets called next and in what order. The moment it
## computes damage, picks a tile, or reads a die, the stage has become a second
## source of truth and the whole migration's guarantee is gone.
##
## ── Why this is a RefCounted and not a Node ──────────────────────────────
## The phase's exit gate replays a documented keystroke list headlessly, with no
## window and no scene tree, and compares the resulting chain head. A turn loop
## that needed `_process` or a node path could not be driven that way. Animation
## pacing belongs to whoever OWNS this object — it awaits between calls, rather
## than this class awaiting inside them. A turn's events must all land in the
## same chain before anything can save, or a save taken mid-animation records
## half a turn.
##
## ── A twin, disclosed ────────────────────────────────────────────────────
## `godot/test/unit/test_sawtooth.gd` carries its own private port of this same
## session loop — it had to, because it was written for Phase 2's balance pins
## before any stage existed, and it is validated by eight balance pins over
## hundreds of played floors. That makes it a FOURTH twin in this migration
## (after the flood fill, the walking distance and `_stood`, all three since
## collapsed). It is left standing for now because re-verifying that suite costs
## nine minutes and this file is not yet proven by anything comparable — but the
## two must not be allowed to drift, and whoever next touches `test_sawtooth.gd`
## should collapse its copy onto this one. Recorded here rather than in a report
## nobody rereads.

## The player's own id. The reference threads it as a parameter with this
## default rather than assuming it, and so does this.
var player_id: String = "player"

## How many times a single action may cascade before the loop refuses to keep
## going. Traps chain — a lodestone can drop you onto another trap — and the
## reference bounds both loops for exactly that reason. These are the
## reference's own bounds, spelled as literals so that changing one is a visible
## decision rather than a silent drift.
const _SPRING_GUARD := 8
const _SENSE_GUARD := 64
const _ENEMY_GUARD := 64


## The whole of one player action, from the draft to the world's answer.
##
## Order is the reference's and is load-bearing: the act, then what the act
## reached, then what the floor does about it, then the turn passing, then
## everyone else. Shuffle it and a player picks things up a turn late, or steps
## onto a trap that springs before they arrive.
##
## `draft` may be null — that is a command refusing, which is a routine outcome
## and not an error. A refused action costs no turn and nothing else runs.
func player_acts(draft: Variant) -> bool:
	if draft == null:
		return false
	Chronicle.commit(draft)
	_collect()
	_settle_traps()
	_pass_turn()
	_run_enemies()
	return true


## Whatever the step arrived on, taken free — it rides along with the move that
## reached it and costs no turn of its own. Only a strict upgrade is taken
## unasked; a tradeoff waits for the deliberate key. That rule lives in
## `SimCommands.take_underfoot`, not here.
func _collect() -> void:
	Chronicle.commit(SimCommands.take_underfoot(Chronicle.state(), player_id))


## The floor settling its account with the player after every action: anything
## sprung first, then every pending sensed-chance. Both bounded, because a
## lodestone can land you on another trap and a chain of them would otherwise
## have no floor.
func _settle_traps() -> void:
	for _guard in range(_SPRING_GUARD):
		var sprung: Variant = SimCommands.spring_trap(Chronicle.state(), player_id)
		if sprung == null:
			break
		Chronicle.commit(sprung)
	for _guard in range(_SENSE_GUARD):
		var sensed: Variant = SimCommands.sense_trap(Chronicle.state(), player_id)
		if sensed == null:
			break
		Chronicle.commit(sensed)


## The turn passing, and the one thing that happens only when it wraps: at the
## bottom, while the heart is carried, the floor answers back every WAVE_EVERY
## rounds. Everything about that stir is drawn and recorded inside
## `stir_world` — this only asks whether the moment has come.
func _pass_turn() -> void:
	var before: Dictionary = Chronicle.state()
	Chronicle.commit(SimCommands.advance_turn(before))
	var after: Dictionary = Chronicle.state()
	if int(after["turn"]) == int(before["turn"]):
		return
	if int(after["depth"]) >= SimTables.BOTTOM_DEPTH \
			and SimCommands.heart_held(after, player_id) \
			and int(after["turn"]) % SimTables.WAVE_EVERY == 0:
		Chronicle.commit(SimCommands.stir_world(after, player_id))


## Everyone who is not the player, until it is the player's turn again.
##
## Bounded, and the bound is not paranoia: a roster of creatures that all wait
## forever is a real state this game can reach (a warden out of reach of its
## post — see NIGHTLOG), and an unbounded loop would hang the stage rather than
## simply playing a dull round.
func _run_enemies() -> void:
	for _guard in range(_ENEMY_GUARD):
		var state: Dictionary = Chronicle.state()
		var active: Variant = state["activeEntityId"]
		if active == null or active == player_id:
			return
		enemy_acts(str(active))
		_pass_turn()


## One creature's turn. Ask the mind what it wants, turn that into the verb that
## means it, and record the verb's answer. The mind's Action is an argument, not
## an event — `sim/ai.gd`'s own docstring says so — and this is the only place
## the two vocabularies meet.
func enemy_acts(entity_id: String) -> void:
	Chronicle.commit(command_for(SimAi.decide(Chronicle.state(), entity_id), entity_id))


## An Action from `SimAi.decide` turned into the command that performs it.
## Every arm returns a draft or null; nothing here decides an outcome.
##
## The Action union, member for member, is documented at the top of
## `sim/ai.gd`: call, mend, strike, draw, step, shoot, lunge, wait.
func command_for(action: Dictionary, entity_id: String) -> Variant:
	var state: Dictionary = Chronicle.state()
	var kind: String = action["kind"]
	match kind:
		"step":
			return SimCommands.attempt_move(state, entity_id, int(action["dx"]), int(action["dy"]))
		"lunge":
			return SimCommands.lunge_strike(state, entity_id, action["targetId"])
		"mend":
			return SimCommands.vigil_kept(state, entity_id)
		"call":
			return SimCommands.call_out(state, entity_id)
		"draw":
			return SimCommands.draw_stance(state, entity_id)
		"shoot":
			return SimCommands.loose_shot(state, entity_id, action["targetId"])
		"wait":
			return SimCommands.wait(state, entity_id)
		"strike":
			# A strike is a BUMP. The reference has no separate melee verb: you
			# walk into what you mean to hit, and `attempt_move` reads the
			# occupied tile as a blow. Only ever chosen at range 1, so exactly
			# one axis of the sign is non-zero.
			var me: Variant = SimEntity.find(state["entities"], entity_id)
			var it: Variant = SimEntity.find(state["entities"], action["targetId"])
			if me == null or it == null:
				return null
			var from: Dictionary = (me as Dictionary)["pos"]
			var to: Dictionary = (it as Dictionary)["pos"]
			return SimCommands.attempt_move(state, entity_id,
				signi(int(to["x"]) - int(from["x"])),
				signi(int(to["y"]) - int(from["y"])))

	# Unreachable while ai.gd's union holds. Loud rather than silent, and paired
	# with an explicit return because assert() unwinds exactly one frame and is
	# compiled out of a release build entirely.
	push_error("TurnManager: unknown action kind %s" % kind)
	assert(false, "TurnManager: unknown action kind %s" % kind)
	return null
