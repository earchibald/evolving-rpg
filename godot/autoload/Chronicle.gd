extends Node
## The chain, and the ONLY thing allowed to write to it.
##
## Every other node in `stage/` is a projection: it calls a command function in
## `sim/`, hands the returned draft to `commit()`, and repaints from the state
## it is given back. Nothing else calls `log.append`. That single-writer rule is
## what makes "the stage is a projection" a fact you can check with a grep
## rather than a claim in a docstring — see the Phase 3 plan's exit gates.
##
## ── Why `commit` takes a Variant ────────────────────────────────────────
## Half the command surface returns `null`, and it does not mean failure — it
## means THE WORLD SAID NO. There is nothing underfoot to take; the scroll hand
## is empty; that shove has nowhere to put anybody. Those are routine outcomes
## the game is made of, and the reference treats them the same way.
##
## So `commit(null)` is a legal call that appends nothing, emits nothing, and
## returns null. The alternative — a `Dictionary` parameter and a null check at
## every one of the twenty-odd call sites — is a rule that holds until the first
## caller forgets, and the failure mode of forgetting is a crash in the middle
## of someone's turn.
##
## ── Why the signals carry the state ─────────────────────────────────────
## `event_appended` hands listeners the folded state rather than letting each
## one fold for itself. One fold per event instead of one per listener, and —
## more importantly — every listener repaints from the SAME state. A board and a
## HUD that folded separately could disagree, and the disagreement would show up
## as a rendering bug hours from its cause.
##
## `world_replaced` is separate because WORLD_INIT replaces state wholesale.
## The board's incremental repaint has no way to express "everything you knew is
## gone"; a distinct signal says it plainly. Both fire for a WORLD_INIT, with
## `world_replaced` first, so a listener that only cares about the wholesale
## case can ignore the other.

## A new event has been sealed onto the chain. `state` is the fold AFTER it.
signal event_appended(event: Dictionary, state: Dictionary)

## A whole new world stands. Repaint everything; nothing you cached survives.
signal world_replaced(state: Dictionary)

var log: SimLog
var head: Variant = null


func _ready() -> void:
	reset()


## A fresh log and a null head. The old chain is simply dropped — this is
## "begin again", not "rewind", and rewinding is what SimRefs is for.
func reset() -> void:
	log = SimLog.new()
	head = null


## The state as of the current head. `SimState.empty()` before anything has been
## committed, which is exactly what `fold(null)` returns — the empty state is a
## real state, not a missing one.
func state() -> Dictionary:
	return log.fold(head)


## Seal a draft onto the chain and tell everyone. Returns the sealed event, or
## null when there was nothing to seal.
##
## `null` in, `null` out, nothing appended, nothing emitted — see the class
## docstring for why that is the contract rather than a caller's problem.
func commit(draft: Variant) -> Variant:
	if draft == null:
		return null

	var sealed: Dictionary = log.append(head, draft)
	head = sealed["id"]
	# Folded once, here, and handed to every listener. Order matters: the head
	# moves BEFORE the fold, or listeners would be told about an event using the
	# state from before it happened.
	var now: Dictionary = state()

	if sealed["type"] == "WORLD_INIT":
		world_replaced.emit(now)
	event_appended.emit(sealed, now)
	return sealed
