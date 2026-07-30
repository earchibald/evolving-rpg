class_name SimApply
## The only way state changes — the byte-twin of src/core/apply.ts.
##
## Pure: no RNG, no clock, no I/O. Everything random was resolved when the
## command ran and is recorded in the event, which is what makes a replay
## faithful rather than merely similar. `apply()` returns a NEW state and never
## touches the one it was handed.
##
## ── Purity, and the safety net GDScript took away ───────────────────────
## In TypeScript, EMPTY_STATE is Object.freeze'd, so a reducer that mutated the
## fold's accumulator threw AT the mutation site. SimState.empty() returns a
## fresh Dictionary instead, which structurally kills the shared-baseline
## corruption — but it also means an in-place mutation now fails SILENTLY,
## surfacing as a hash mismatch hundreds of events later. So the discipline here
## is written down rather than enforced by the engine: every write goes through
## `.duplicate()` of the dictionary being changed, and nested structures are
## copied only where the reference copies them. test_apply.gd pins this with an
## input-unchanged assertion per mutating event kind.
##
## The copies are SHALLOW on purpose, exactly mirroring the reference's `{...x}`:
## an unchanged entity is the very same Dictionary in both the old and the new
## array. That is safe only because nothing in this file ever writes through a
## reference it did not itself duplicate. It is also what lets the reference's
## identity returns (`return state` for an event that changes nothing) survive
## the port — see is_same() below.
##
## ── The absent-key law ──────────────────────────────────────────────────
## canonicalJson drops a key whose value is `undefined`; GDScript has no
## undefined, so a TS-optional field that is unset must be an ABSENT key, never
## a null one. This file is where entities are actually CONSTRUCTED (WORLD_INIT,
## WORLD_STIRRED, CALLED, the hatch), which makes it the only place the law can
## be guarded non-tautologically — entity.gd has no builder to break.
##
## SETTLED HERE, the open `gear` question the plan left to whoever wrote gear
## first. Both halves are absent-when-unset, and the reference says so directly:
##   * `gear` ITSELF is absent until something is worn. ITEM_TAKEN builds it with
##     `{ ...e.gear, [slot]: ... }` — spreading an undefined gear yields `{}` —
##     so no entity grows a gear key by any path but wearing something (or being
##     born with `playerGear`).
##   * An UNWORN SLOT is an absent key INSIDE gear, not a null one. The reference
##     reads it as `e.gear?.[slot]` and only ever assigns the slot being filled;
##     nothing writes a null slot. SimTables.wears_trait already documents the
##     same reading from the other side.
##
## ── `!== undefined` vs `??` ─────────────────────────────────────────────
## Two distinct TS tests, ported distinctly: `x !== undefined` is `p.has("x")`,
## and `x ?? fallback` is `_or(p.get("x"), fallback)` (absent OR null takes the
## fallback). They differ only for an explicit null, which a payload written by
## JSON.stringify cannot carry for an optional field — but the distinction is
## preserved rather than collapsed, because a hand-built test fixture can.
##
## ── Integers ────────────────────────────────────────────────────────────
## Every number in GameState is an integer, and SimCanonical.encode REFUSES a
## fractional one. SimTables.bounty_stretch and SimTables.mean_damage return
## floats — correctly, they are coefficients — so nothing here stores a table
## result raw: threat_of and level_for_xp both return ints and are the only
## table calls this file makes. test_apply.gd walks every returned state and
## asserts no number in it is fractional.


## The grants of nothing. The reference writes this literal inline at each of
## its three sites; SimItem.NOTHING is deliberately NOT used here — 2.A3's
## review established that `granted` and `NOTHING` are dead code in the
## reference, and routing through them would be a refactor, not a port.
const _NO_GRANTS := {"hp": 0, "might": 0, "wits": 0, "speed": 0}

const _VENOM_PREFIX := "venom-"
const _SNARED_PREFIX := "snared-"


## The TS `??`: absent OR explicitly null takes the fallback. GDScript's
## `== null` was verified during 2.B5 never to match 0/false/""/[]/{} , so this
## is an exact mirror and cannot swallow a falsy-but-real value.
static func _or(value: Variant, fallback: Variant) -> Variant:
	return fallback if value == null else value


static func _pos(p: Dictionary) -> Dictionary:
	return {"x": p["x"], "y": p["y"]}


## `tags.filter(t => !drop.includes(t))` — always a fresh Array, like filter().
static func _without(tags: Array, drop: Array) -> Array:
	var out: Array = []
	for t: String in tags:
		if not drop.has(t):
			out.append(t)
	return out


## Reeling, at most once — a second stagger on a staggered thing is spent.
## The reel shakes any drawn shot loose (covenant M8's flinch).
static func _staggered(tags: Array) -> Array:
	var shaken: Array = _without(tags, ["drawn"])
	if shaken.has("staggered"):
		return shaken
	shaken.append("staggered")
	return shaken


## A stance ends the moment its holder acts — both stances, one law. Every
## event with an actor runs its actor through here; BRACED and DRAWN are the
## tags' only writers. WAIT is the draw's deliberate exception (its own arm
## below): an archer may stand at full draw as long as they dare stand still,
## while a brace is strictly one round.
##
## Returns the SAME Array when there is nothing to unstance, which is what lets
## STRIKE's miss arm reproduce the reference's `after === state.entities` test.
static func _unstanced(entities: Array, actor_id: String) -> Array:
	var held: Variant = SimEntity.find(entities, actor_id)
	if held == null:
		return entities
	var tags: Array = (held as Dictionary)["tags"]
	if not tags.has("braced") and not tags.has("drawn"):
		return entities
	var out: Array = []
	for e: Dictionary in entities:
		if e["id"] != actor_id:
			out.append(e)
			continue
		var next: Dictionary = e.duplicate()
		next["tags"] = _without(e["tags"], ["braced", "drawn"])
		out.append(next)
	return out


## A creature seated into the world: the six always-present keys plus the post
## it was born on. The reference writes this same object literal three times
## (WORLD_STIRRED, TRAP_SPRUNG's hatch, CALLED) with identical fields; one
## helper is the same construction, not a behaviour change. WORLD_INIT does NOT
## come through here — its seeds carry the optional birth fields and the
## player's ceiling override, which risers never have.
static func _risen(s: Dictionary) -> Dictionary:
	var stats: Dictionary = s["stats"]
	return {
		"id": s["id"],
		"kind": s["kind"],
		"pos": _pos(s["pos"]),
		"stats": stats.duplicate(),
		"tags": (s["tags"] as Array).duplicate(),
		"post": _pos(s["pos"]),
		"maxHp": stats["hp"],
	}


## Experience, paid at the moment of the kill.
##
## Derived rather than evented: XP is a function of which creatures the player
## finished, so the log and the level can never disagree and there is nothing to
## upcast. `before` is the world as the blow found it — a creature counts
## exactly once, on the event that took it from alive to not.
##
## Crossing a threshold applies the growth table and heals to full: the
## sawtooth's ease tooth, one breath before the next floor bites.
static func _credit_kills(before: Dictionary, after: Dictionary, killer_id: String, player_id: String = "player") -> Dictionary:
	if killer_id != player_id:
		return after

	var gained: int = 0
	var after_entities: Array = after["entities"]
	for was: Dictionary in (before["entities"] as Array):
		var was_stats: Dictionary = was["stats"]
		if was["id"] == player_id or int(was_stats["hp"]) <= 0:
			continue
		var now: Variant = SimEntity.find(after_entities, was["id"])
		if now == null:
			continue
		var now_stats: Dictionary = (now as Dictionary)["stats"]
		if int(now_stats["hp"]) <= 0:
			gained += SimTables.threat_of(was_stats, was["kind"])
	if gained == 0:
		return after

	var xp: int = int(after["xp"]) + gained
	var level: int = after["level"]
	var entities: Array = after_entities
	# The ladder stretches with the board it stands on (size_stretch): a
	# stretched floor pays stretched XP, and reading the factor off the grid's
	# own dims keeps the level derived — never evented, never able to disagree
	# with the log.
	var grid: Dictionary = after["grid"]
	var target: int = SimTables.level_for_xp(xp, SimTables.size_stretch(grid["width"], grid["height"]))

	while level < target:
		level += 1
		var g: Dictionary = SimTables.growth_at(level)
		var grown: Array = []
		for e: Dictionary in entities:
			if e["id"] != player_id:
				grown.append(e)
				continue
			var max_hp: int = int(e["maxHp"]) + int(g["hp"])
			var st: Dictionary = e["stats"]
			var next: Dictionary = e.duplicate()
			next["maxHp"] = max_hp
			next["stats"] = {
				# Full heal at the moment of leveling — the breath between teeth.
				"hp": max_hp,
				"might": int(st["might"]) + int(g["might"]),
				"wits": int(st["wits"]) + int(g["wits"]),
				"speed": int(st["speed"]) + int(g["speed"]),
			}
			grown.append(next)
		entities = grown

	var result: Dictionary = after.duplicate()
	result["xp"] = xp
	result["level"] = level
	result["entities"] = entities
	return result


## Whether a tile can take a spilled pocket: passable, and nothing lying there.
## `items` is passed in rather than read off the state because the reference's
## closure sees each spill's own additions — two creatures dying on the same
## tile must not stack invisibly.
static func _open(grid: Dictionary, items: Array, x: int, y: int) -> bool:
	if not SimGrid.is_passable(grid, x, y):
		return false
	for i: Dictionary in items:
		var pos: Dictionary = i["pos"]
		if int(pos["x"]) == x and int(pos["y"]) == y:
			return false
	return true


## The pockets spilled: every creature that crossed from alive to dead in this
## event sets down what it carried, on its death tile — nudged one pace by fixed
## order if an item already lies there, swallowed by the floor only when every
## neighbouring tile is taken too (poverty is honest; a stack of invisible items
## is not). Derived, silent, any death — blow, slam, rule — the _credit_kills
## precedent exactly, which is why the two walk together at every site.
static func _drop_pockets(before: Dictionary, after: Dictionary) -> Dictionary:
	var items: Array = after["items"]
	var spilled: bool = false
	var grid: Dictionary = after["grid"]
	var after_entities: Array = after["entities"]
	for was: Dictionary in (before["entities"] as Array):
		var was_stats: Dictionary = was["stats"]
		if not was.has("pocket") or int(was_stats["hp"]) <= 0:
			continue
		var now: Variant = SimEntity.find(after_entities, was["id"])
		if now == null:
			continue
		var now_dict: Dictionary = now
		var now_stats: Dictionary = now_dict["stats"]
		if int(now_stats["hp"]) > 0:
			continue
		var at: Dictionary = now_dict["pos"]
		var ax: int = at["x"]
		var ay: int = at["y"]
		var tile: Variant = null
		for c: Array in [[ax, ay], [ax + 1, ay], [ax - 1, ay], [ax, ay + 1], [ax, ay - 1]]:
			if _open(grid, items, c[0], c[1]):
				tile = c
				break
		if tile == null:
			continue
		var pocket: Dictionary = was["pocket"]
		items = items.duplicate()
		items.append({
			"id": "pocket-%s" % was["id"],
			"kind": pocket["kind"],
			"pos": {"x": (tile as Array)[0], "y": (tile as Array)[1]},
			"grants": (pocket["grants"] as Dictionary).duplicate(),
		})
		spilled = true
	if not spilled:
		return after
	var result: Dictionary = after.duplicate()
	result["items"] = items
	return result


## The shape change for one event, with the RNG counter deliberately left alone
## — `apply` below is the single authority on that, so no branch here can forget
## it or advance it twice.
static func _reduce(state: Dictionary, event: Dictionary) -> Dictionary:
	var type: String = event["type"]
	var p: Dictionary = event.get("payload", {})
	var entities: Array = state["entities"]

	match type:
		"WORLD_INIT":
			# Copied out of the payload rather than referenced into state: the
			# event is shared by every fork, so aliasing it would let one world
			# rewrite another's history.
			var player: Dictionary = p["player"]
			var player_id: String = player["id"]
			var seeds: Array = [player]
			seeds.append_array(p["opponents"] as Array)
			var seeded: Array = []
			for s: Dictionary in seeds:
				var stats: Dictionary = s["stats"]
				var e: Dictionary = {
					"id": s["id"],
					"kind": s["kind"],
					"pos": _pos(s["pos"]),
					"stats": stats.duplicate(),
					"tags": (s["tags"] as Array).duplicate(),
					# Where it was born — the warden's vigil is anchored here. A
					# universal fact, not a warden field: every creature has a
					# post, and only the vigil happens to read it.
					"post": _pos(s["pos"]),
				}
				# The temper (v10): guards own their posts, wanderers carry
				# their recorded round, leg 0 — the reducer advances it as steps
				# land. Absent fields read the old stillness, exactly as they
				# always did.
				if s.has("disposition"):
					e["disposition"] = s["disposition"]
				if s.has("route"):
					var route: Array = []
					for w: Dictionary in (s["route"] as Array):
						route.append(_pos(w))
					e["route"] = route
					e["leg"] = 0
				if s.has("guise"):
					e["guise"] = s["guise"]
				if s.has("pocket"):
					var pocket: Dictionary = s["pocket"]
					e["pocket"] = {
						"kind": pocket["kind"],
						"grants": (pocket["grants"] as Dictionary).duplicate(),
					}
				# A creature's ceiling is its birth hp; the player's crossed a
				# floor and may arrive wounded, so the ceiling rides in the
				# payload.
				if s["id"] == player_id:
					e["maxHp"] = _or(p.get("playerMaxHp"), stats["hp"])
					if p.has("playerGear"):
						e["gear"] = p["playerGear"]
					if p.has("playerSatchel"):
						var carried: Array = []
						for k: String in ((p["playerSatchel"] as Dictionary)["kinds"] as Array):
							carried.append({"kind": k})
						e["satchel"] = carried
					if p.has("playerScroll"):
						e["scroll"] = {"kind": (p["playerScroll"] as Dictionary)["kind"]}
				else:
					e["maxHp"] = stats["hp"]
				seeded.append(e)

			var items: Array = []
			for i: Dictionary in (p["items"] as Array):
				items.append({
					"id": i["id"],
					"kind": i["kind"],
					"pos": _pos(i["pos"]),
					"grants": (i["grants"] as Dictionary).duplicate(),
				})

			# The traps as generation laid them (v12), nothing yet known about
			# any of them. Absence reads a trapless floor — every floor before.
			var traps: Array = []
			for t: Dictionary in (_or(p.get("traps"), []) as Array):
				traps.append({
					"id": t["id"],
					"kind": t["kind"],
					"pos": _pos(t["pos"]),
					"level": t["level"],
					"sightRolled": false,
					"nearRolled": false,
					"revealed": false,
					"sprung": false,
				})

			return {
				"grid": SimGrid.make(p["width"], p["height"], p["tiles"]),
				"entities": seeded,
				"items": items,
				"turn": 1,
				"activeEntityId": player_id,
				"seed": p["seed"],
				"rngCounter": 0,
				# A new world plays under no rules, whatever stood before it on
				# the log. WORLD_INIT replaces state wholesale, and rules are
				# state.
				"rules": [],
				# Depth-crossing worlds may carry the player's earned progress
				# in the payload; a bare world starts at nothing. Read
				# defensively — older events never wrote these.
				"xp": _or(p.get("xp"), 0),
				"level": _or(p.get("level"), 1),
				"depth": _or(p.get("depth"), 1),
				# The purse crosses the stairs (v15), like the satchel and the
				# gear. Absence is an empty purse: every chain written before
				# the economy carried nothing, and that is simply true of them.
				"gold": _or(p.get("playerGold"), 0),
				"story": _or(p.get("story"), ""),
				"motif": _or(p.get("motif"), null),
				# The floor is born empty; the graveyard speaks separately, via
				# WORLD_BODIES in the rebirth and descent ceremonies.
				"bodies": [],
				# Identity resets with the floor; descend re-appends WORLD_BIBLE
				# right after, the way it re-ratifies rules. Null, never absent:
				# the carry guards test `!== null`.
				"bible": null,
				# New floor, clear air.
				"smoke": null,
				"unveiled": [],
				"traps": traps,
				"alarm": null,
			}

		"RULE_FIRED":
			# Replays the recorded effects. It does not look at `state.rules`,
			# does not re-read the rule, and does not re-evaluate a single
			# condition — that is what keeps folded history stable as rules
			# accumulate. A kill the rule made belongs to whoever it fired for.
			var resolved: Dictionary = SimInterpret.apply_resolved(state, p["outcomes"])
			return _credit_kills(state, _drop_pockets(state, resolved), p["actorId"])

		"RULE_RATIFIED":
			# A fresh list. The old one is shared with every fold that has
			# already observed this state, so pushing in place would rewrite
			# history that something else is already holding.
			var rules: Array = (state["rules"] as Array).duplicate()
			rules.append(p["rule"])
			var ratified: Dictionary = state.duplicate()
			ratified["rules"] = rules
			return ratified

		"WORLD_BIBLE":
			# The world's identity, replacing whatever stood (WORLD_INIT resets
			# it to null, and descend re-appends it — the rules pattern exactly:
			# the world changes, what it has agreed to does not).
			var bibled: Dictionary = state.duplicate()
			bibled["bible"] = p["bible"]
			return bibled

		"WORLD_BODIES":
			# Copied out of the payload, like WORLD_INIT's seeds: the event is
			# shared by every fork that descends from it.
			var bodies: Array = []
			for b: Dictionary in (p["bodies"] as Array):
				bodies.append(_pos(b))
			var buried: Dictionary = state.duplicate()
			buried["bodies"] = bodies
			return buried

		"MOVE":
			var entity_id: String = p["entityId"]
			var to: Dictionary = p["to"]
			var walked: Array = []
			for e: Dictionary in _unstanced(entities, entity_id):
				if e["id"] != entity_id:
					walked.append(e)
					continue
				var landed: Dictionary = e.duplicate()
				landed["pos"] = _pos(to)
				# The wanderer's round advances when a step lands on ANY of its
				# waypoints — the next leg is the one after the waypoint struck,
				# so a skipped or coincidental stop can never turn the round
				# backwards. Derived, silent, replay-exact (the venom precedent).
				if e.has("route"):
					var route: Array = e["route"]
					if route.size() > 0:
						for i in range(route.size()):
							var w: Dictionary = route[i]
							if int(w["x"]) == int(to["x"]) and int(w["y"]) == int(to["y"]):
								landed["leg"] = (i + 1) % route.size()
								break
				walked.append(landed)
			var moved_state: Dictionary = state.duplicate()
			moved_state["entities"] = walked
			return moved_state

		"MOVE_BLOCKED":
			return state

		"WAIT":
			# Waiting changes almost nothing by itself. It exists so that
			# passing time is a choice a player can make rather than something
			# only walls impose on them — and so the chronicle can tell "held
			# position" apart from "had no move". What it does spend: a stagger
			# reels itself out on the skipped action, and a stance is an
			# action's worth of standing.
			var waiter_id: String = p["entityId"]
			var me: Variant = SimEntity.find(entities, waiter_id)
			if me == null:
				return state
			var my_tags: Array = (me as Dictionary)["tags"]
			if not my_tags.has("staggered") and not my_tags.has("braced"):
				return state
			var rested: Array = []
			for e: Dictionary in entities:
				if e["id"] != waiter_id:
					rested.append(e)
					continue
				var next: Dictionary = e.duplicate()
				next["tags"] = _without(e["tags"], ["staggered", "braced"])
				rested.append(next)
			var waited: Dictionary = state.duplicate()
			waited["entities"] = rested
			return waited

		"ITEM_TAKEN":
			return _item_taken(state, p)

		"STRIKE":
			return _strike(state, p)

		"SHOVE":
			var shover_id: String = p["shoverId"]
			var shoved_id: String = p["targetId"]
			var struck_id: Variant = p["struckId"]
			var slammed: bool = bool(p["slammed"])
			var to_v: Variant = p["to"]
			var shoved: Array = []
			for e: Dictionary in _unstanced(entities, shover_id):
				if e["id"] == shoved_id:
					var reels: bool = slammed or struck_id != null
					var next: Dictionary = e.duplicate()
					if to_v != null:
						next["pos"] = _pos(to_v)
					var st: Dictionary = e["stats"]
					var ns: Dictionary = st.duplicate()
					if slammed:
						ns["hp"] = maxi(0, int(st["hp"]) - SimTables.SLAM_DAMAGE)
					next["stats"] = ns
					if reels:
						next["tags"] = _staggered(e["tags"])
					shoved.append(next)
					continue
				if struck_id != null and e["id"] == struck_id:
					var bystander: Dictionary = e.duplicate()
					bystander["tags"] = _staggered(e["tags"])
					shoved.append(bystander)
					continue
				shoved.append(e)
			var shove_state: Dictionary = state.duplicate()
			shove_state["entities"] = shoved
			# A slam can finish a wounded thing; the kill pays — and spills.
			return _credit_kills(state, _drop_pockets(state, shove_state), shover_id)

		"BRACED":
			# One stance per body: setting the guard lowers any drawn shot.
			return _stanced(state, p["entityId"], "braced")

		"DRAWN":
			# The warning covenant M8 requires, written where replay reads it.
			# One stance per body: drawing drops any set guard.
			return _stanced(state, p["entityId"], "drawn")

		"ITEM_REFUSED":
			# The world saying no, kept where it can be read. Applying one
			# changes nothing — WORLD_REMEMBERED's precedent: an event that
			# exists for the chain's readers, not the fold.
			return state

		"ITEM_USED":
			return _item_used(state, p)

		"WORLD_STIRRED":
			# The risen join the world exactly as WORLD_INIT seats its seeds:
			# copied, posted where they stand, ceilinged at their birth hp.
			var stirred: Array = entities.duplicate()
			for s: Dictionary in (p["opponents"] as Array):
				stirred.append(_risen(s))
			var stirred_state: Dictionary = state.duplicate()
			stirred_state["entities"] = stirred
			return stirred_state

		"VIGIL_KEPT":
			# The warden, home and unwatched, knits shut. Heal to the ceiling in
			# one event: the point is the reset, not a drip — poking a boss and
			# running must buy nothing at all, or the mandatory fight erodes.
			var vigil_id: String = p["entityId"]
			var mended: Array = []
			for e: Dictionary in entities:
				if e["id"] != vigil_id:
					mended.append(e)
					continue
				var next: Dictionary = e.duplicate()
				var st: Dictionary = e["stats"]
				var ns: Dictionary = st.duplicate()
				ns["hp"] = e["maxHp"]
				next["stats"] = ns
				mended.append(next)
			var vigil_state: Dictionary = state.duplicate()
			vigil_state["entities"] = mended
			return vigil_state

		"WORLD_REMEMBERED":
			# The remembrance changes nothing: it exists to be read, and it
			# arrives after the last turn a run will ever take. State passes
			# through whole.
			return state

		"GOLD_MOVED":
			# A sum, and nothing else. No clamp at zero: the spender is what
			# gates affordability, and a reducer that quietly floored the purse
			# would turn a command letting you buy what you cannot afford into a
			# plausible balance that hides its own bug. An impossible purse
			# should be visible.
			var paid: Dictionary = state.duplicate()
			paid["gold"] = int(state["gold"]) + int(p["delta"])
			return paid

		"SCROLL_READ":
			return _scroll_read(state, p)

		"TRAP_SENSED":
			# The chance is spent whether it was taken: the flags are what stop
			# a second roll forever, and `revealed` only ever turns on.
			var sensed_id: String = p["trapId"]
			var method: String = p["method"]
			var revealed: bool = bool(p["revealed"])
			var sensed: Array = []
			for t: Dictionary in (state["traps"] as Array):
				if t["id"] != sensed_id:
					sensed.append(t)
					continue
				var next: Dictionary = t.duplicate()
				next["sightRolled"] = bool(t["sightRolled"]) or method == "sight"
				next["nearRolled"] = bool(t["nearRolled"]) or method == "near"
				next["revealed"] = bool(t["revealed"]) or revealed
				sensed.append(next)
			var sensed_state: Dictionary = state.duplicate()
			sensed_state["traps"] = sensed
			return sensed_state

		"TRAP_SPRUNG":
			return _trap_sprung(state, p)

		"UNMASKED":
			# The guise drops and the spring loads: `hidden` off, `ambush` on —
			# the stalker's machinery, so the mimic's first landed blow rolls
			# one band harder and the reducer already knows how to spend it.
			var mimic_id: String = p["mimicId"]
			var unmasked: Array = []
			for e: Dictionary in entities:
				if e["id"] != mimic_id:
					unmasked.append(e)
					continue
				var next: Dictionary = e.duplicate()
				var tags: Array = _without(e["tags"], ["hidden"])
				tags.append("ambush")
				next["tags"] = tags
				unmasked.append(next)
			var unmasked_state: Dictionary = state.duplicate()
			unmasked_state["entities"] = unmasked
			return unmasked_state

		"TURN_ADVANCED":
			return _turn_advanced(state, p)

		"CALLED":
			var caller_id: String = p["callerId"]
			# The floor answers; the voice is spent. Risers arrive exactly as
			# recorded — kinds, stats and tiles were all drawn at command time.
			var answered: Array = []
			for e: Dictionary in entities:
				if e["id"] != caller_id:
					answered.append(e)
					continue
				var next: Dictionary = e.duplicate()
				next["tags"] = _without(e["tags"], ["call"])
				answered.append(next)
			for o: Dictionary in (p["opponents"] as Array):
				answered.append(_risen(o))
			var called_state: Dictionary = state.duplicate()
			called_state["entities"] = answered
			return called_state

	# Unreachable in a shipped chain: apply() refuses a type SCHEMA_VERSIONS does
	# not know before ever calling here, and test_apply.gd pins that table
	# against this switch's arms. What is left for this arm is the
	# DEVELOPMENT-time mistake — a type added to SCHEMA_VERSIONS with no case
	# written for it — where the assert's message is what the author reads.
	assert(false, "SimApply: event type %s is in SCHEMA_VERSIONS with no reducer case" % type)
	return state


## BRACED and DRAWN, one law with one tag's difference: the new stance replaces
## whichever stance stood.
static func _stanced(state: Dictionary, entity_id: String, stance: String) -> Dictionary:
	var stanced: Array = []
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != entity_id:
			stanced.append(e)
			continue
		var next: Dictionary = e.duplicate()
		var tags: Array = _without(e["tags"], ["braced", "drawn"])
		tags.append(stance)
		next["tags"] = tags
		stanced.append(next)
	var result: Dictionary = state.duplicate()
	result["entities"] = stanced
	return result


static func _item_taken(state: Dictionary, p: Dictionary) -> Dictionary:
	var entity_id: String = p["entityId"]
	var item_id: String = p["itemId"]
	var items_in: Array = state["items"]
	var entities: Array = state["entities"]

	var item: Variant = null
	for i: Dictionary in items_in:
		if i["id"] == item_id:
			item = i
			break

	# The floor after the take, whatever branch runs: the taken thing is gone.
	var floor_items: Array = []
	for i: Dictionary in items_in:
		if i["id"] != item_id:
			floor_items.append(i)

	# The satchel's take: carried, not worn. The swap is recorded in the payload
	# (v3) because it MINTS a floor item — what was carried lies where the new
	# thing lay — and replay must mint the same one forever. v4 records WHICH
	# slot the take filled; absence reads the first (an old chain carried one
	# thing, and it lived there).
	if p.has("satchel"):
		var satchel: Dictionary = p["satchel"]
		var slot: int = int(_or(satchel.get("slot"), 0))
		var dropped_kind: Variant = satchel["swappedOut"]
		var carriers: Array = []
		for e: Dictionary in entities:
			if e["id"] != entity_id:
				carriers.append(e)
				continue
			var held: Array = (e["satchel"] as Array).duplicate() if e.has("satchel") else []
			# `held[slot] = x` on a JS array shorter than slot leaves holes,
			# which JSON.stringify renders as null. Filling with null here is
			# the exact mirror; a chain from the command layer never reaches it
			# (a take fills the first EMPTY slot), so this is a faithfulness
			# guard, not a live path.
			while held.size() <= slot:
				held.append(null)
			held[slot] = {"kind": "carried" if item == null else (item as Dictionary)["kind"]}
			var next: Dictionary = e.duplicate()
			next["satchel"] = held
			carriers.append(next)
		var swap_items: Array = floor_items
		if dropped_kind != null and item != null:
			swap_items = floor_items.duplicate()
			swap_items.append({
				"id": "drop-%s" % item_id,
				"kind": dropped_kind,
				"pos": _pos((item as Dictionary)["pos"]),
				"grants": _NO_GRANTS.duplicate(),
			})
		var satchel_state: Dictionary = state.duplicate()
		satchel_state["entities"] = carriers
		satchel_state["items"] = swap_items
		return satchel_state

	# The scroll hand (v5): filled, and any displaced scroll set down where the
	# new one lay — the satchel swap's law, one hand's worth.
	if p.has("scroll"):
		var scroll: Dictionary = p["scroll"]
		var swapped: Variant = scroll["swappedOut"]
		var readers: Array = []
		for e: Dictionary in entities:
			if e["id"] != entity_id:
				readers.append(e)
				continue
			var next: Dictionary = e.duplicate()
			next["scroll"] = {"kind": "scroll" if item == null else (item as Dictionary)["kind"]}
			readers.append(next)
		var scroll_items: Array = floor_items
		if swapped != null and item != null:
			scroll_items = floor_items.duplicate()
			scroll_items.append({
				"id": "drop-%s" % item_id,
				"kind": swapped,
				"pos": _pos((item as Dictionary)["pos"]),
				"grants": _NO_GRANTS.duplicate(),
			})
		var scroll_state: Dictionary = state.duplicate()
		scroll_state["entities"] = readers
		scroll_state["items"] = scroll_items
		return scroll_state

	# Equipment, not accumulation. The item goes into its slot; whatever was
	# worn there comes off, its grants subtracted, before the new grants apply —
	# and (v4) the shed relic LANDS where the new one lay, kind and grants
	# recorded so replay mints it identically forever. Old events carried
	# neither field: the slot re-derives from grants and nothing is minted,
	# exactly as their present always was.
	var grants: Dictionary = p["grants"]
	var gear_slot: String = str(_or(p.get("gearSlot"), SimTables.slot_of(grants)))
	var wearers: Array = []
	for e: Dictionary in entities:
		if e["id"] != entity_id:
			wearers.append(e)
			continue
		var gear: Dictionary = e["gear"] if e.has("gear") else {}
		var worn: Variant = gear.get(gear_slot)
		var off: Dictionary = _NO_GRANTS if worn == null else (worn as Dictionary)["grants"]
		var st: Dictionary = e["stats"]
		var max_hp: int = int(e["maxHp"]) - int(off["hp"]) + int(grants["hp"])
		var next: Dictionary = e.duplicate()
		next["stats"] = {
			# hp never exceeds the (possibly lowered) ceiling.
			"hp": mini(int(st["hp"]), max_hp),
			"might": int(st["might"]) - int(off["might"]) + int(grants["might"]),
			"wits": int(st["wits"]) - int(off["wits"]) + int(grants["wits"]),
			"speed": int(st["speed"]) - int(off["speed"]) + int(grants["speed"]),
		}
		next["maxHp"] = max_hp
		var new_gear: Dictionary = gear.duplicate()
		new_gear[gear_slot] = {
			"kind": "worn" if item == null else (item as Dictionary)["kind"],
			"grants": grants.duplicate(),
		}
		next["gear"] = new_gear
		wearers.append(next)

	var gear_items: Array = floor_items
	var shed: Variant = p.get("shed")
	if shed != null and item != null:
		gear_items = floor_items.duplicate()
		gear_items.append({
			"id": "drop-%s" % item_id,
			"kind": (shed as Dictionary)["kind"],
			"pos": _pos((item as Dictionary)["pos"]),
			"grants": ((shed as Dictionary)["grants"] as Dictionary).duplicate(),
		})

	var gear_state: Dictionary = state.duplicate()
	gear_state["entities"] = wearers
	gear_state["items"] = gear_items
	return gear_state


static func _strike(state: Dictionary, p: Dictionary) -> Dictionary:
	var entities: Array = state["entities"]
	var attacker_id: String = p["attackerId"]
	var target_id: String = p["targetId"]

	# Whether the blow found a set guard — read before anything moves, because
	# it is the state the blow was thrown into.
	var target_before: Variant = SimEntity.find(entities, target_id)
	var guarded: bool = target_before != null and ((target_before as Dictionary)["tags"] as Array).has("braced")

	# The attacker's own stance (a player striking out of a brace) ends with the
	# action.
	var acted: Array = _unstanced(entities, attacker_id)

	# The verbs' movement applies whether or not the blow landed: a lunge that
	# whiffs still crossed the ground (attackerTo rides on misses for lunges;
	# trample fields are only ever written on landed, surviving blows — the
	# command decides, replay applies).
	var moved: Array = acted
	if p.has("attackerTo") or p.has("targetTo"):
		moved = []
		for e: Dictionary in acted:
			if e["id"] == attacker_id and p.has("attackerTo"):
				var lunged: Dictionary = e.duplicate()
				lunged["pos"] = _pos(p["attackerTo"])
				moved.append(lunged)
				continue
			if e["id"] == target_id and p.has("targetTo"):
				var trampled: Dictionary = e.duplicate()
				trampled["pos"] = _pos(p["targetTo"])
				moved.append(trampled)
				continue
			moved.append(e)

	if not bool(p["hit"]):
		# Missing a set guard is overcommitment: the attacker reels. This is the
		# brace's tooth — derived from the tag the blow was thrown at, so replay
		# reads it the same forever. Melee only: overcommitment is a fact about
		# bodies, and the far shooter never lent theirs (absent mode reads
		# melee — v3 chains fold unchanged).
		var after: Array = moved
		if guarded and str(_or(p.get("mode"), "melee")) == "melee":
			after = []
			for e: Dictionary in moved:
				if e["id"] != attacker_id:
					after.append(e)
					continue
				var reeling: Dictionary = e.duplicate()
				reeling["tags"] = _staggered(e["tags"])
				after.append(reeling)
		# The reference's `after === state.entities ? state : {...}`: an event
		# that changed nothing returns the very same state, so a whiff into open
		# air stays free of allocation as well as free of consequence.
		if is_same(after, entities):
			return state
		var missed: Dictionary = state.duplicate()
		missed["entities"] = after
		return missed

	# Whether this landed blow leaves venom behind — derived from the attacker's
	# kind, which replay reads identically forever. And whether it lands hard
	# enough to stagger: the sure edge's one rule, a crit that sends the
	# survivor reeling.
	var attacker: Variant = SimEntity.find(entities, attacker_id)
	var venomous: bool = attacker != null and SimTables.verb_of((attacker as Dictionary)["kind"]) == "venom"
	var surely: bool = p.get("crit") == true and attacker != null \
		and SimTables.wears_trait((attacker as Dictionary).get("gear"), "stagger-crit")
	var damage: int = int(p["damage"])

	var wounded: Array = []
	for e: Dictionary in moved:
		if e["id"] == target_id:
			# The ward drank this blow whole (resolved at command time, damage
			# recorded 0): no wound, no venom, no reeling, the draw unbroken —
			# and the warding is spent by exactly this blow.
			if p.get("warded") == true:
				var unwarded: Dictionary = e.duplicate()
				unwarded["tags"] = _without(e["tags"], ["warded"])
				wounded.append(unwarded)
				continue
			var st: Dictionary = e["stats"]
			# Clamped at zero: a corpse is dead, not increasingly dead, and
			# letting hp run negative would make "how badly did it lose" a
			# number nothing reads and every display has to special-case.
			var hp: int = maxi(0, int(st["hp"]) - damage)
			# A landed, hurting blow shakes any drawn shot loose — the flinch,
			# covenant M8's half that melee enforces on archers.
			var flinched: Array = _without(e["tags"], ["drawn"]) if damage > 0 else (e["tags"] as Array)
			# A surviving, bitten body burns: fresh venom replaces stale — the
			# wound re-opened, never stacked.
			var tags: Array = flinched
			if venomous and hp > 0:
				tags = []
				for t: String in flinched:
					if not t.begins_with(_VENOM_PREFIX):
						tags.append(t)
				tags.append("%s%d" % [_VENOM_PREFIX, SimTables.VENOM_TURNS])
			if surely and hp > 0:
				tags = _staggered(tags)
			var hurt: Dictionary = e.duplicate()
			var ns: Dictionary = st.duplicate()
			ns["hp"] = hp
			hurt["stats"] = ns
			hurt["tags"] = tags
			wounded.append(hurt)
			continue
		if e["id"] == attacker_id and p.get("ambush") == true:
			# The spring is spent the moment it lands. One coiled blow per
			# birth — the tag leaves, and the stalker fights plain after.
			var sprung: Dictionary = e.duplicate()
			sprung["tags"] = _without(e["tags"], ["ambush"])
			wounded.append(sprung)
			continue
		wounded.append(e)

	var struck_state: Dictionary = state.duplicate()
	struck_state["entities"] = wounded
	return _credit_kills(state, _drop_pockets(state, struck_state), attacker_id)


static func _item_used(state: Dictionary, p: Dictionary) -> Dictionary:
	# The satchel spent. Effects were resolved when the command ran and are
	# applied verbatim — replay never re-decides how much a draught mended or
	# who the smoke fooled.
	var entity_id: String = p["entityId"]
	var effect: Dictionary = p["effect"]
	var kind: String = effect["kind"]
	var slot: int = int(_or(p.get("slot"), 0))

	var emptied: Array = []
	for e: Dictionary in _unstanced(state["entities"], entity_id):
		if e["id"] != entity_id:
			emptied.append(e)
			continue
		# The recorded slot empties; what remains compacts forward (the second
		# thing becomes the first — q always spends the first).
		var current: Array = e["satchel"] if e.has("satchel") else []
		var left: Array = []
		for i in range(current.size()):
			if i != slot:
				left.append(current[i])
		var carried: Dictionary = e.duplicate()
		carried.erase("satchel")
		if left.size() > 0:
			carried["satchel"] = left
		if kind == "draught":
			carried["maxHp"] = effect["ceilingTo"]
			var ns: Dictionary = (e["stats"] as Dictionary).duplicate()
			ns["hp"] = effect["healedTo"]
			carried["stats"] = ns
		emptied.append(carried)

	var result: Dictionary = state.duplicate()

	if kind == "smoke":
		result["entities"] = emptied
		result["smoke"] = {
			"until": effect["until"],
			"at": _pos(effect["at"]),
			"unfooled": (effect["unfooled"] as Array).duplicate(),
		}
		return result

	# The ward is worn: a tag, spent later by the one blow it drinks (the STRIKE
	# that pays it says so and this reducer strips it there).
	if kind == "ward":
		var warded: Array = []
		for e: Dictionary in emptied:
			var tags: Array = e["tags"]
			if e["id"] != entity_id or tags.has("warded"):
				warded.append(e)
				continue
			var next: Dictionary = e.duplicate()
			var grown: Array = tags.duplicate()
			grown.append("warded")
			next["tags"] = grown
			warded.append(next)
		result["entities"] = warded
		return result

	# The burr: the recorded list reels — same staggered tag the shove writes,
	# same recorded WAIT spends it. Replay staggers the same bodies forever;
	# nobody is re-decided here.
	if kind == "burr":
		var reeling: Array = effect["staggered"]
		var burred: Array = []
		for e: Dictionary in emptied:
			if not reeling.has(e["id"]):
				burred.append(e)
				continue
			var next: Dictionary = e.duplicate()
			next["tags"] = _staggered(e["tags"])
			burred.append(next)
		result["entities"] = burred
		return result

	# The bell is knowledge alone — the fog reads it off the chain; the world's
	# state does not move.
	result["entities"] = emptied
	return result


static func _scroll_read(state: Dictionary, p: Dictionary) -> Dictionary:
	# The scroll leaves the hand whatever it did; the effects were resolved when
	# the reading happened and apply verbatim forever.
	var entity_id: String = p["entityId"]
	var effect: Dictionary = p["effect"]
	var kind: String = effect["kind"]

	var unhanded: Array = []
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != entity_id:
			unhanded.append(e)
			continue
		var next: Dictionary = e.duplicate()
		next.erase("scroll")
		unhanded.append(next)

	var result: Dictionary = state.duplicate()

	if kind == "unveiling":
		var unveiled: Array = (state["unveiled"] as Array).duplicate()
		for s: Dictionary in (effect["secrets"] as Array):
			unveiled.append(_pos(s))
		var named: Array = effect["traps"]
		var traps: Array = []
		for t: Dictionary in (state["traps"] as Array):
			if not named.has(t["id"]):
				traps.append(t)
				continue
			var next: Dictionary = t.duplicate()
			next["revealed"] = true
			traps.append(next)
		result["entities"] = unhanded
		result["unveiled"] = unveiled
		result["traps"] = traps
		return result

	if kind == "still hour":
		var reeling: Array = effect["staggered"]
		var stilled: Array = []
		for e: Dictionary in unhanded:
			if not reeling.has(e["id"]):
				stilled.append(e)
				continue
			var next: Dictionary = e.duplicate()
			next["tags"] = _staggered(e["tags"])
			stilled.append(next)
		result["entities"] = stilled
		return result

	if kind == "trap eater":
		var eaten: Array = effect["eaten"]
		var traps: Array = []
		for t: Dictionary in (state["traps"] as Array):
			if not eaten.has(t["id"]):
				traps.append(t)
				continue
			var next: Dictionary = t.duplicate()
			next["revealed"] = true
			next["sprung"] = true
			traps.append(next)
		result["entities"] = unhanded
		result["traps"] = traps
		return result

	if kind == "blink":
		var blinked: Array = []
		for e: Dictionary in unhanded:
			if e["id"] != entity_id:
				blinked.append(e)
				continue
			var next: Dictionary = e.duplicate()
			next["pos"] = _pos(effect["to"])
			blinked.append(next)
		result["entities"] = blinked
		return result

	# Stone song: the enumerated walls become floor. Only ever ADDS ground, so
	# total-reachability (M5) cannot break — the grid is rebuilt because grids
	# are frozen, like every honest copy here.
	var grid: Dictionary = state["grid"]
	var tiles: Array = (grid["tiles"] as Array).duplicate()
	var width: int = grid["width"]
	for b: Dictionary in (effect["broken"] as Array):
		tiles[int(b["y"]) * width + int(b["x"])] = SimGrid.FLOOR
	result["entities"] = unhanded
	result["grid"] = SimGrid.make(width, grid["height"], tiles)
	return result


static func _trap_sprung(state: Dictionary, p: Dictionary) -> Dictionary:
	# Applied verbatim: the dodge, the die, the risers and the landing were all
	# resolved when the step happened. A sprung trap is spent and marked — the
	# floor admits it afterwards, whoever missed it.
	var trap_id: String = p["trapId"]
	var victim_id: String = p["victimId"]
	var traps: Array = []
	for t: Dictionary in (state["traps"] as Array):
		if t["id"] != trap_id:
			traps.append(t)
			continue
		var next: Dictionary = t.duplicate()
		next["revealed"] = true
		next["sprung"] = true
		traps.append(next)
	var marked: Dictionary = state.duplicate()
	marked["traps"] = traps
	if bool(p["dodged"]):
		return marked

	var effect: Dictionary = p["effect"]
	var kind: String = effect["kind"]
	var entities: Array = marked["entities"]

	if kind == "spikes" or kind == "maw":
		var damage: int = int(effect["damage"])
		var hurt: Array = []
		for e: Dictionary in entities:
			if e["id"] != victim_id:
				hurt.append(e)
				continue
			var next: Dictionary = e.duplicate()
			var st: Dictionary = e["stats"]
			var ns: Dictionary = st.duplicate()
			ns["hp"] = maxi(0, int(st["hp"]) - damage)
			next["stats"] = ns
			hurt.append(next)
		marked["entities"] = hurt
		return marked

	if kind == "venom":
		# The stinger's wound, re-opened never stacked — the same tag law.
		marked["entities"] = _retagged(entities, victim_id, _VENOM_PREFIX, int(effect["turns"]))
		return marked

	if kind == "snare":
		marked["entities"] = _retagged(entities, victim_id, _SNARED_PREFIX, int(effect["turns"]))
		return marked

	if kind == "alarm":
		marked["alarm"] = {"until": effect["until"]}
		return marked

	if kind == "lodestone":
		var pulled: Array = []
		for e: Dictionary in entities:
			if e["id"] != victim_id:
				pulled.append(e)
				continue
			var next: Dictionary = e.duplicate()
			next["pos"] = _pos(effect["to"])
			pulled.append(next)
		marked["entities"] = pulled
		return marked

	# The hatch: risers join the world exactly as the call's do.
	var hatched: Array = entities.duplicate()
	for o: Dictionary in (effect["opponents"] as Array):
		hatched.append(_risen(o))
	marked["entities"] = hatched
	return marked


## One victim's countdown tag replaced wholesale — the venom and snare law:
## re-opened, never stacked.
static func _retagged(entities: Array, victim_id: String, prefix: String, turns: int) -> Array:
	var out: Array = []
	for e: Dictionary in entities:
		if e["id"] != victim_id:
			out.append(e)
			continue
		var tags: Array = []
		for t: String in (e["tags"] as Array):
			if not t.begins_with(prefix):
				tags.append(t)
		tags.append("%s%d" % [prefix, turns])
		var next: Dictionary = e.duplicate()
		next["tags"] = tags
		out.append(next)
	return out


static func _turn_advanced(state: Dictionary, p: Dictionary) -> Dictionary:
	var advanced: Dictionary = state.duplicate()
	advanced["turn"] = p["turn"]
	advanced["activeEntityId"] = p["activeEntityId"]
	# Venom burns and snares slacken on the round, not on the activation — once
	# each time the turn wraps. Deterministic arithmetic on tags already on the
	# chain (the _credit_kills precedent).
	if int(p["turn"]) == int(state["turn"]):
		return advanced

	var entities: Array = state["entities"]
	var ticking: bool = false
	for e: Dictionary in entities:
		for t: String in (e["tags"] as Array):
			if t.begins_with(_VENOM_PREFIX) or t.begins_with(_SNARED_PREFIX):
				ticking = true
				break
		if ticking:
			break
	if not ticking:
		return advanced

	var ticked: Array = []
	for e: Dictionary in entities:
		var st: Dictionary = e["stats"]
		if int(st["hp"]) <= 0:
			ticked.append(e)
			continue
		var tags_in: Array = e["tags"]
		var burning: Variant = null
		var held: Variant = null
		for t: String in tags_in:
			if burning == null and t.begins_with(_VENOM_PREFIX):
				burning = t
			if held == null and t.begins_with(_SNARED_PREFIX):
				held = t
		if burning == null and held == null:
			ticked.append(e)
			continue

		var tags: Array = tags_in
		var hp: int = st["hp"]
		if burning != null:
			var left: int = int(str(burning).substr(_VENOM_PREFIX.length())) - 1
			hp = maxi(0, hp - SimTables.VENOM_HARM)
			tags = _countdown(tags, _VENOM_PREFIX, left)
		if held != null:
			var loosens: int = int(str(held).substr(_SNARED_PREFIX.length())) - 1
			tags = _countdown(tags, _SNARED_PREFIX, loosens)

		var next: Dictionary = e.duplicate()
		var ns: Dictionary = st.duplicate()
		ns["hp"] = hp
		next["stats"] = ns
		next["tags"] = tags
		ticked.append(next)

	advanced["entities"] = ticked
	return advanced


## A countdown tag one round on: dropped at zero, rewritten otherwise. Mirrors
## the reference's filter-or-map pair, which allocates a fresh Array either way.
static func _countdown(tags: Array, prefix: String, left: int) -> Array:
	var out: Array = []
	for t: String in tags:
		if not t.begins_with(prefix):
			out.append(t)
		elif left > 0:
			out.append("%s%d" % [prefix, left])
	return out


## The only way state changes. Pure: no RNG, no clock, no network.
##
## The counter advances by `rngCounter + rngDraws` for every event type without
## exception. Before v2 only WORLD_INIT moved it, reading a `counterAfter` field
## out of its payload — a special case that could not survive a second consumer
## of randomness. Handling it in one place here means a new event type cannot
## forget to account for its own draws.
##
## An event that changes nothing returns the very same state Dictionary, so a
## blocked move stays free of allocation as well as free of consequence.
##
## Total over *validated* events. A WORLD_INIT payload internally inconsistent
## with the grid it describes — a tile count disagreeing with the declared size,
## or a non-positive width or height — trips SimGrid.make's assertions. That is
## deliberate rather than a gap: it happens only to a corrupted log, where
## failing loudly beats folding nonsense. Verify an untrusted log with
## verify_chain before folding it.
static func apply(state: Dictionary, event: Dictionary) -> Dictionary:
	# The reference's default arm is a compile-time exhaustiveness proof plus a
	# runtime THROW, and it throws rather than returning the state unchanged
	# because a log from a newer engine is an expected input, not an exotic one:
	# folding an event this engine cannot read would produce a state every later
	# read then dereferences.
	#
	# The refusal lives HERE, in the outermost frame, rather than at _reduce's
	# fallthrough — because GDScript's assert() unwinds exactly ONE frame and
	# then lets the caller carry on with the return type's default. Refusing
	# inside _reduce would hand this function an empty Dictionary and cascade a
	# second, misleading "invalid access to rngCounter" over the real message.
	# From apply() the unwind reaches the fold with nothing, which is as close to
	# the reference's throw as GDScript gets. (Measured, not assumed: upcast.gd's
	# docstring claims assert "CONTINUES past it rather than unwinding" — the
	# one-frame unwind above is what a probe actually shows. That file pairs
	# every assert with an explicit `return {}`, which is the same value the
	# unwind produces, so its behaviour is right even where its comment is not.)
	#
	# push_error rides ALONGSIDE the assert rather than instead of it, because
	# assert() is COMPILED OUT of a release build. Without this line an exported
	# build would fall through the match and fold an unknown event as a silent
	# no-op — precisely the "quietly return the state unchanged" the reference's
	# default arm exists to forbid, and it would show up only in the one build
	# nobody runs the suite against. push_error survives release, so the refusal
	# is loud in both, and test_apply.gd asserts both channels.
	#
	# Every other `assert` in `sim/` shares the debug-only property. That is a
	# migration-wide question for the designer rather than one this file may
	# answer alone — but the reducer is where a silent no-op does the most
	# damage, so it gets the belt as well as the braces.
	if not SimEvents.SCHEMA_VERSIONS.has(event["type"]):
		push_error("SimApply: unknown event type %s" % event["type"])
	assert(SimEvents.SCHEMA_VERSIONS.has(event["type"]),
		"SimApply: unknown event type %s" % event["type"])
	var next: Dictionary = _reduce(state, event)
	var rng_counter: int = int(event["rngCounter"]) + int(event["rngDraws"])
	if int(next["rngCounter"]) == rng_counter:
		return next
	var result: Dictionary = next.duplicate()
	result["rngCounter"] = rng_counter
	return result
