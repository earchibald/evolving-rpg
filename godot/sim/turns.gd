class_name SimTurns
## Whose turn it is — the byte-twin of src/core/turns.ts (33 lines, both
## exports ported whole; no deferrals — see the reconciliation below).
##
## Initiative order is a RECORDED consequence, not a rendering detail: the
## roster's marching order decides who acts next, and commands.gd (Wave E)
## folds that choice into a TURN_ADVANCED draft at command time. Two replays
## of one chain must agree on that order byte-for-byte (Covenant M4), which
## makes the tie-break exactly as load-bearing as the primary sort key — a
## "corrected" descending-id tie-break looks equivalent right up until two
## entities share a speed, and then it is a different chain.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## turns.ts:6   initiativeOrder -> initiative_order (below)
## turns.ts:19  nextActive      -> next_active      (below)
## Both reference functions are PORTED. Nothing in this file is DEFERRED.


## Living entities only, speed descending, id ascending on ties. Ties MUST
## break the same way every run, or two replays of one log could disagree
## about whose turn it is (the reference's own docstring, turns.ts:4-5).
## Returns an Array[String] of entity ids.
static func initiative_order(entities: Array) -> Array:
	var living: Array = []
	for e: Dictionary in entities:
		if SimEntity.is_alive(e):
			living.append(e)
	# The reference calls .slice() here too, immediately after .filter()
	# already returned a fresh array — a redundant, plan-mandated no-op
	# (Task 2.E1 brief, citing Increment 1's own review). Ported as the
	# reference has it rather than tidied away: `living` is already a fresh
	# Array from the loop above, so this duplicate() changes nothing either.
	living = living.duplicate()
	living.sort_custom(_by_speed_then_id)
	var order: Array = []
	for e: Dictionary in living:
		order.append(e["id"])
	return order


## sort_custom's comparator: true when `a` belongs strictly before `b`.
## Faster first; on a tie, the LOWER id first — ascending, not descending,
## and never "whichever the caller listed first" (a fresh array is sorted on
## every call, so the input order must not leak through). This predicate is
## the one line in the whole port worth reading twice: flip either branch and
## the chain still builds, still folds to a hash, and simply disagrees with
## the reference about whose turn it is.
static func _by_speed_then_id(a: Dictionary, b: Dictionary) -> bool:
	var a_speed: int = (a["stats"] as Dictionary)["speed"]
	var b_speed: int = (b["stats"] as Dictionary)["speed"]
	if a_speed != b_speed:
		return a_speed > b_speed
	return (a["id"] as String) < (b["id"] as String)


## The active entity after one step, and whether that step rolled the round
## over. `current_id` is the previous activeEntityId — a String, or null
## before anyone has gone. Called once at command time by commands.gd (Wave
## E) to build a TURN_ADVANCED draft's payload (see commands.ts:1897-1904's
## advanceTurn, out of this file's scope); apply.gd's reducer only ever reads
## the already-decided activeEntityId back off the sealed event. Nothing here
## is re-derived on replay — it is recorded once, exactly here.
static func next_active(entities: Array, current_id: Variant) -> Dictionary:
	var order: Array = initiative_order(entities)
	if order.is_empty():
		return {"activeEntityId": null, "wrapped": false}
	var first: String = order[0]
	if current_id == null:
		return {"activeEntityId": first, "wrapped": false}

	var at: int = order.find(current_id)
	if at == -1:
		# The previously-active id is not in this round's order at all — it
		# died, or it was never on this roster. The reference treats a
		# vanished actor exactly like the end of a round: restart at the top
		# and report a wrap.
		return {"activeEntityId": first, "wrapped": true}

	var next: int = (at + 1) % order.size()
	# order[next] is always in bounds: order is non-empty here (checked
	# above) and `next` is that same size's own modulus. The reference's
	# "?? first" fallback is equally unreachable in the TS — ported for
	# shape, not because it can fire.
	var active_id: String = order[next] if next < order.size() else first
	return {"activeEntityId": active_id, "wrapped": next == 0}
