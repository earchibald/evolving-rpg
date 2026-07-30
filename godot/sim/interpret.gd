class_name SimInterpret
## Where a rule stops being data and starts being play — the byte-twin of
## src/canon/interpret.ts.
##
## Firing is decided HERE and recorded on the chain as a RULE_FIRED event
## carrying what was settled on; the reducer (apply.gd, Wave C) replays that
## without ever re-reading the rule. If it re-decided, ratifying a rule today
## would silently rewrite what a run did last week — the one thing an
## append-only log exists to prevent. There is deliberately no cascade:
## "RULE_FIRED" is not a member of SimRule.TRIGGERS, so a rule cannot trigger
## a rule — not by convention, the vocabulary simply has no token for it.
##
## A `Condition` / `Effect` / `Rule` (consumed here, never built here) is the
## plain Dictionary SimRule.validate produces. A `Blow` — what triggered this
## firing — is the SAME kind of plain Dictionary, but built by CALLERS and
## never validated: {"otherId": String, "hit": bool}, both keys ENTIRELY
## OPTIONAL. Per the absent-key law, an unset Blow field is an ABSENT KEY,
## never null: `blow.get("hit") == true` reads exactly like the reference's
## `blow.hit === true` — false for an explicit `false` AND for an absent key,
## which is the point (see "reads whether the blow landed" below): no blow at
## all is neither landed nor missed.
##
## `Resolved` — an effect with every "who" and "where" already worked out,
## which is what rides in a RULE_FIRED payload and what replay applies — has
## NO optional fields of its own (unlike Blow), so it needs no absent-key
## handling: it is a plain Dictionary shaped exactly like the reference's four
## variants, discriminated by "kind":
##   {"kind": "health", "entityId": String, "to": int}
##   {"kind": "stat",   "entityId": String, "stat": String, "to": int}
##   {"kind": "move",   "entityId": String, "to": {"x": int, "y": int}}
##   {"kind": "said",   "text": String}


## Manhattan distance.
static func _steps_between(a: Dictionary, b: Dictionary) -> int:
	return absi(a["x"] - b["x"]) + absi(a["y"] - b["y"])


## Distance to the nearest OTHER living entity, or INF with none alive (or no
## such actor at all) — the float twin of the reference's `Infinity`, since
## GDScript has no integer infinity and every comparison against INF (`<=`,
## `>`) promotes cleanly against an int n.
static func _nearest_creature(state: Dictionary, actor_id: String) -> float:
	var actor: Variant = SimEntity.find(state["entities"], actor_id)
	if actor == null:
		return INF
	var a: Dictionary = actor
	var a_pos: Dictionary = a["pos"]
	var best: float = INF
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] == actor_id or not SimEntity.is_alive(e):
			continue
		best = minf(best, float(_steps_between(a_pos, e["pos"])))
	return best


static func _living_others(state: Dictionary, actor_id: String) -> int:
	var count: int = 0
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != actor_id and SimEntity.is_alive(e):
			count += 1
	return count


## How far the way out is, or INF on a map without one.
static func _steps_to_exit(state: Dictionary, from: Dictionary) -> float:
	var grid: Dictionary = state["grid"]
	var width: int = grid["width"]
	var height: int = grid["height"]
	var best: float = INF
	for y: int in height:
		for x: int in width:
			if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
				best = minf(best, float(_steps_between(from, {"x": x, "y": y})))
	return best


static func _stat_of(e: Dictionary, stat: String) -> int:
	if stat == "maxHp":
		return e["maxHp"]
	var stats: Dictionary = e["stats"]
	return stats[stat]


## Whether one condition holds, from the actor's point of view.
##
## Total: an actor not in the state makes every condition false rather than
## asserting. A rule referring to something that has left the world should
## quietly not fire, not take the turn down with it.
static func holds(condition: Dictionary, state: Dictionary, actor_id: String, blow: Dictionary = {}) -> bool:
	var actor: Variant = SimEntity.find(state["entities"], actor_id)
	if actor == null:
		return false
	var a: Dictionary = actor
	var a_stats: Dictionary = a["stats"]
	var kind: String = condition["kind"]

	match kind:
		"hpAtMost":
			return a_stats["hp"] <= condition["n"]
		"hpAtLeast":
			return a_stats["hp"] >= condition["n"]
		"hpBelowPercent":
			# Guarded against a zero ceiling, which would otherwise divide by
			# zero and make a percentage condition NaN — silently false, and
			# maddening to debug.
			var max_hp: int = a["maxHp"]
			return max_hp > 0 and (float(a_stats["hp"] * 100) / float(max_hp)) < condition["n"]
		"hpAbovePercent":
			var max_hp2: int = a["maxHp"]
			return max_hp2 > 0 and (float(a_stats["hp"] * 100) / float(max_hp2)) > condition["n"]
		"creatureWithin":
			return _nearest_creature(state, actor_id) <= condition["n"]
		"noCreatureWithin":
			return _nearest_creature(state, actor_id) > condition["n"]
		"creaturesAtMost":
			return _living_others(state, actor_id) <= condition["n"]
		"creaturesAtLeast":
			return _living_others(state, actor_id) >= condition["n"]
		"exitWithin":
			return _steps_to_exit(state, a["pos"]) <= condition["n"]
		"exitBeyond":
			return _steps_to_exit(state, a["pos"]) > condition["n"]
		"turnAtLeast":
			return state["turn"] >= condition["n"]
		"depthAtLeast":
			return state["depth"] >= condition["n"]
		"statAtLeast":
			return _stat_of(a, condition["stat"]) >= condition["n"]
		# A floor that never recorded its cut has none — old logs make this
		# false rather than guessing, the same honesty as an absent blow.
		"motifIs":
			return state["motif"] == condition["motif"]
		"bodyHere":
			var a_pos: Dictionary = a["pos"]
			for b: Dictionary in (state["bodies"] as Array):
				if b["x"] == a_pos["x"] and b["y"] == a_pos["y"]:
					return true
			return false
		"blowLanded":
			return blow.get("hit") == true
		"blowMissed":
			return blow.get("hit") == false
		_:
			assert(false, "SimInterpret.holds: unhandled condition kind %s" % kind)
			return false


## Every condition, never merely one. A player who reads "with X and Y" and
## gets "with X or Y" has been lied to about their own game.
static func _matches(rule: Dictionary, state: Dictionary, actor_id: String, blow: Dictionary) -> bool:
	for c: Dictionary in (rule["require"] as Array):
		if not holds(c, state, actor_id, blow):
			return false
	return true


## Where a shove lands: straight away from the shover, stopping at the last
## square that is both open and empty. A push into a wall simply goes nowhere.
static func _shoved_to(state: Dictionary, from: Dictionary, victim: Dictionary, squares: int) -> Dictionary:
	var v_pos: Dictionary = victim["pos"]
	var dx: int = signi(v_pos["x"] - from["x"])
	var dy: int = signi(v_pos["y"] - from["y"])
	# Directly on top of the shover — no direction to shove in.
	if dx == 0 and dy == 0:
		return {"x": v_pos["x"], "y": v_pos["y"]}

	var grid: Dictionary = state["grid"]
	var entities: Array = state["entities"]
	var at: Dictionary = {"x": v_pos["x"], "y": v_pos["y"]}
	for _i: int in squares:
		var next: Dictionary = {"x": at["x"] + dx, "y": at["y"] + dy}
		if not SimGrid.is_passable(grid, next["x"], next["y"]):
			break
		var occupied: bool = false
		for e: Dictionary in entities:
			var e_pos: Dictionary = e["pos"]
			if SimEntity.is_alive(e) and e_pos["x"] == next["x"] and e_pos["y"] == next["y"]:
				occupied = true
				break
		if occupied:
			break
		at = next
	return at


## Turns one authored effect into concrete outcomes, or nothing at all when it
## has no one to act on.
##
## Health is clamped at both ends here rather than in the reducer, so the
## recorded number is the final one. Healing stops at the ceiling — without
## it, "recover 1 when nothing is near" becomes unbounded health for anyone
## willing to hold still. Harm stops at zero, so death happens once and by the
## same test as a blow.
static func _resolve(effect: Dictionary, state: Dictionary, actor: Dictionary, other: Variant) -> Array:
	var kind: String = effect["kind"]
	var a_stats: Dictionary = actor["stats"]

	match kind:
		"speak":
			return [{"kind": "said", "text": effect["text"]}]

		"heal":
			return [{"kind": "health", "entityId": actor["id"], "to": mini(a_stats["hp"] + effect["n"], actor["maxHp"])}]

		"harm":
			return [{"kind": "health", "entityId": actor["id"], "to": maxi(a_stats["hp"] - effect["n"], 0)}]

		"harmOther":
			if other == null:
				return []
			var o: Dictionary = other
			var o_stats: Dictionary = o["stats"]
			return [{"kind": "health", "entityId": o["id"], "to": maxi(o_stats["hp"] - effect["n"], 0)}]

		"grant":
			return [{"kind": "stat", "entityId": actor["id"], "stat": effect["stat"], "to": _stat_of(actor, effect["stat"]) + effect["n"]}]

		# Floored at 1: a stat of zero means never hitting anything again, or
		# never acting again, which is a rule that ends the game rather than
		# changes it.
		"drain":
			return [{"kind": "stat", "entityId": actor["id"], "stat": effect["stat"], "to": maxi(_stat_of(actor, effect["stat"]) - effect["n"], 1)}]

		"push":
			if other == null:
				return []
			var ov: Dictionary = other
			var to: Dictionary = _shoved_to(state, actor["pos"], ov, effect["n"])
			var ov_pos: Dictionary = ov["pos"]
			if to["x"] == ov_pos["x"] and to["y"] == ov_pos["y"]:
				return []
			return [{"kind": "move", "entityId": ov["id"], "to": to}]

		_:
			assert(false, "SimInterpret._resolve: unhandled effect kind %s" % kind)
			return []


## Every rule that fires for this trigger, in ratification order, at most once
## each. A single pass — no rule fires as a consequence of another.
##
## Effects are resolved against the state as it stands WHEN THAT RULE FIRES,
## so two rules on the same trigger compose in order rather than both reading
## the world as it was before either ran.
static func fire_rules(state: Dictionary, trigger: String, actor_id: String, blow: Dictionary = {}) -> Array:
	var fired: Array = []
	var running: Dictionary = state

	for rule: Dictionary in (running["rules"] as Array):
		if rule["when"] != trigger:
			continue
		if not _matches(rule, running, actor_id, blow):
			continue

		var actor: Variant = SimEntity.find(running["entities"], actor_id)
		if actor == null:
			continue
		var other_id: Variant = blow.get("otherId")
		var other: Variant = null if other_id == null else SimEntity.find(running["entities"], other_id)

		var outcomes: Array = []
		for e: Dictionary in (rule["then"] as Array):
			outcomes.append_array(_resolve(e, running, actor, other))
		if outcomes.is_empty():
			continue

		fired.append(SimEvents.draft("RULE_FIRED", running["rngCounter"], 0,
			{"ruleId": rule["id"], "actorId": actor_id, "outcomes": outcomes}))

		running = apply_resolved(running, outcomes)

	return fired


## Rewrites one entity for one outcome, or hands it back unchanged when the
## outcome names someone else — the byte-twin of the reference's `.map`
## callback. May return the SAME Dictionary reference `e` when nothing about
## it changes, matching the reference returning `e` itself from a non-matching
## map callback.
static func _apply_outcome_to_entity(e: Dictionary, o: Dictionary) -> Dictionary:
	if e["id"] != o["entityId"]:
		return e
	var kind: String = o["kind"]
	if kind == "health":
		var stats: Dictionary = (e["stats"] as Dictionary).duplicate()
		stats["hp"] = o["to"]
		var result: Dictionary = e.duplicate()
		result["stats"] = stats
		return result
	if kind == "move":
		var to: Dictionary = o["to"]
		var result: Dictionary = e.duplicate()
		result["pos"] = {"x": to["x"], "y": to["y"]}
		return result
	# kind == "stat"
	var stat: String = o["stat"]
	var result: Dictionary = e.duplicate()
	if stat == "maxHp":
		result["maxHp"] = o["to"]
	else:
		var stats: Dictionary = (e["stats"] as Dictionary).duplicate()
		stats[stat] = o["to"]
		result["stats"] = stats
	return result


## Replays resolved outcomes. Shared by fire_rules (to compose rules within
## one pass) and by the reducer (to replay history, Wave C) so there is
## exactly one meaning for what an outcome does.
##
## Returns `state` itself, unchanged, when every outcome was a spoken line —
## the byte-twin of the reference's `entities === state.entities ? state :
## { ...state, entities }`. Any other outcome kind rebuilds the entities array
## at least once, even where it ends up matching no one, exactly as the
## reference's `.map()` allocates a fresh array on every non-"said" pass.
static func apply_resolved(state: Dictionary, outcomes: Array) -> Dictionary:
	var entities: Array = state["entities"]
	var changed: bool = false

	for o: Dictionary in outcomes:
		if o["kind"] == "said":
			continue
		var next_entities: Array = []
		for e: Dictionary in entities:
			next_entities.append(_apply_outcome_to_entity(e, o))
		entities = next_entities
		changed = true

	if not changed:
		return state
	var result: Dictionary = state.duplicate()
	result["entities"] = entities
	return result
