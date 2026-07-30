class_name SimItems
## The item family — the byte-twin of src/core/commands.ts's take, use and
## read verbs. Reached through `SimCommands`, never directly: the facade is
## the one surface the stage and autoplay see.
##
## src/core/commands.ts is 1,907 lines and is being split into five files by
## verb family (see movement.gd's header for the full table). This one ships:
##   takeUnderfoot :1432  the walk-over take, and the , key's deliberate one
##   takeOrRefuse  :1556  the , key answered either way — silence was a bug
##   useCarried    :1582  the satchel spent: draught, flare, ward, burr, bell,
##                        smoke
##   readScroll    :1713  the scroll hand spent: unveiling, still hour, trap
##                        eater, blink step, stone song
##
## **EVERY function here returns a DRAFT, never state, or null when the verb
## does not apply.** The caller appends a non-null draft through the log.
## That is what keeps authority in the chain and lets the stage be a
## projection rather than a second source of truth.
##
## ── Family hazards (from the plan) ────────────────────────────────────────
## THE DOMINANCE RULE: walking takes only a STRICT upgrade
## (`SimTables.dominates`) — a tradeoff (or a sidegrade) waits on the floor
## for the deliberate `,` key. The old total order made every take a
## foregone conclusion; this is the smallest concession to there being a
## choice.
##
## RANGED RELICS ROUTE BY TRAIT: `SimTables.slot_for` checks the trait table
## first (a 'ranged' relic goes to 'sling', the dual-wield hand) and only
## then falls back to `slot_of`'s grant-shape routing for everything else.
## The slot is resolved HERE, at command time, and rides the ITEM_TAKEN event
## (schemaVersion 5, `gearSlot` + `shed`) so replay never re-derives routing
## and a shed relic mints back onto the floor instead of vanishing.
##
## THE SATCHEL HOLDS TWO: `takeUnderfoot` fills the first empty slot, then
## the second; full hands silently refuse the walk-over, and only the
## deliberate `,` key swaps — recorded, never silent, because
## `takeOrRefuse` turns that silence into a spoken ITEM_REFUSED (the
## player's own filing: "press , and get nothing, hear nothing").
##
## THE ABSENT-KEY LAW, the sharpest edge in this family: `gear` is an ABSENT
## key on an entity until something is worn, and an unworn SLOT is an ABSENT
## key *inside* a present `gear` Dictionary — never a null value either way.
## Settled against the reference in Task 2.C1 (apply.gd's WORLD_INIT
## construction) and pinned by three tests; this file must never write a
## null gear or a null slot. Contrast the payload's own `shed` field, which
## the reference writes as an explicit `null` (not omitted) when nothing was
## worn — that is a normal Dictionary value, not an entity field, and stays
## exactly as written.


## Fixed neighbour order for the blink step's multi-source flood — the same
## four directions movement.gd's lunge crosses in, though unlike the lunge
## this order is not itself load-bearing: a flood fill's final forbidden SET
## does not depend on visit order, only its membership does, which every
## order reaches alike. Kept as a literal here (not reached into
## `SimMovement`'s own private one) because a "private" const is a naming
## convention in GDScript, not an enforced boundary.
const _STEPS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]


## The walk-over take, and the deliberate `,` key. Four ladders, each
## returning its own ITEM_TAKEN shape, tried in the reference's own order:
## the heart (seals the satchel), a provision (the satchel's two slots), a
## scroll (the one-hand shelf), then gear (the dominance rule). Null when no
## taker, no item, or the branch reached refuses without being asked twice.
static func take_underfoot(state: Dictionary, entity_id: String, deliberate: bool = false) -> Variant:
	var found: Variant = SimEntity.find(state["entities"], entity_id)
	if found == null:
		return null
	var taker: Dictionary = found

	var pos: Dictionary = taker["pos"]
	var item_v: Variant = SimItem.at(state["items"], int(pos["x"]), int(pos["y"]))
	if item_v == null:
		return null
	var item: Dictionary = item_v
	var counter: int = int(state["rngCounter"])
	var grants: Dictionary = item["grants"]

	# The heart fills your hands. It takes the first slot — shoving out
	# whatever rode there (left on the tile, like any swap) — and SEALS the
	# whole satchel: nothing can be taken up or used, either hand, while you
	# carry the world's ending. Recorded like any satchel take; the weight is
	# in what it refuses after (useCarried, takeUnderfoot's own provision and
	# scroll ladders).
	if item["kind"] == SimTables.HEART_KIND:
		var first_held: Variant = null
		if taker.has("satchel") and not (taker["satchel"] as Array).is_empty():
			first_held = (taker["satchel"] as Array)[0]
		var swapped_out: Variant = null if first_held == null else (first_held as Dictionary)["kind"]
		return SimEvents.draft("ITEM_TAKEN", counter, 0, {
			"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
			"satchel": {"swappedOut": swapped_out, "slot": 0},
		})

	# A provision rides in the satchel, not on the body — two slots, filled in
	# order, duplicates welcome: two flares are two flares. Full hands refuse
	# the walk-over (the caller says so out loud via takeOrRefuse); the `,`
	# key swaps the FIRST slot out onto this tile, reversible by one step
	# back. Hands sealed by something that is not a provision (the heart) do
	# not open at all.
	if SimTables.provision_of(item["kind"]) != null:
		var carried: Array = (taker["satchel"] as Array) if taker.has("satchel") else []
		for held: Dictionary in carried:
			if SimTables.provision_of(held["kind"]) == null:
				return null
		if carried.size() < 2:
			return SimEvents.draft("ITEM_TAKEN", counter, 0, {
				"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
				"satchel": {"swappedOut": null, "slot": carried.size()},
			})
		if not deliberate:
			return null
		return SimEvents.draft("ITEM_TAKEN", counter, 0, {
			"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
			"satchel": {"swappedOut": (carried[0] as Dictionary)["kind"], "slot": 0},
		})

	# The scroll hand (v13): one carried. Walking fills an empty hand; a held
	# scroll refuses the walk-over (the view says so) and the `,` key swaps —
	# the satchel's law, one hand's worth. The heart fills your hands
	# entirely: no scroll joins the carry.
	if SimTables.scroll_of(item["kind"]) != null:
		if taker.has("satchel"):
			for held: Dictionary in (taker["satchel"] as Array):
				if held["kind"] == SimTables.HEART_KIND:
					return null
		if not taker.has("scroll"):
			return SimEvents.draft("ITEM_TAKEN", counter, 0, {
				"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
				"scroll": {"swappedOut": null},
			})
		if not deliberate:
			return null
		return SimEvents.draft("ITEM_TAKEN", counter, 0, {
			"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
			"scroll": {"swappedOut": (taker["scroll"] as Dictionary)["kind"]},
		})

	# Walking takes only what DOMINATES — at least as good on every axis,
	# better in total. A tradeoff relic (the heavy edge's speed for its blow)
	# is incomparable by construction, so it waits on the floor for a chosen
	# take; a strict downgrade waits forever unless chosen too.
	#
	# The slot resolves HERE, kind in hand (slot_for: trait first, grants for
	# the rest — the sling to the sling hand), and rides the event, so replay
	# never re-derives routing. What comes off rides too, kind and grants, and
	# the reducer lands it on this tile — a set-down relic that used to vanish.
	var gear_slot: String = SimTables.slot_for(item["kind"], grants)
	var gear: Dictionary = taker["gear"] if taker.has("gear") else {}
	var worn: Variant = gear.get(gear_slot)
	var worn_grants: Dictionary = SimItem.NOTHING if worn == null else (worn as Dictionary)["grants"]
	if not deliberate and not SimTables.dominates(grants, worn_grants):
		return null

	var shed: Variant = null
	if worn != null:
		shed = {
			"kind": (worn as Dictionary)["kind"],
			"grants": ((worn as Dictionary)["grants"] as Dictionary).duplicate(),
		}
	return SimEvents.draft("ITEM_TAKEN", counter, 0, {
		"entityId": entity_id, "itemId": item["id"], "grants": grants.duplicate(),
		"gearSlot": gear_slot,
		"shed": shed,
	})


## The chosen take, answered either way — what the `,` key means. A
## walk-over refusal stays silent machinery (the view explains the
## comparison), but a deliberate take is a question asked out loud, and the
## world must answer: silence here was filed as a bug ("press , and get
## nothing, hear nothing"). The reason DERIVES, never re-decides: when
## `take_underfoot(deliberate=true)` returns null with a taker standing,
## every branch that could have said yes has said it — what remains is a
## bare floor ('nothing') or hands the heart has sealed ('sealed'). A
## refusal spends no draws and no turn.
static func take_or_refuse(state: Dictionary, entity_id: String) -> Variant:
	var found: Variant = SimEntity.find(state["entities"], entity_id)
	if found == null:
		return null
	var taker: Dictionary = found

	var taken: Variant = take_underfoot(state, entity_id, true)
	if taken != null:
		return taken

	var pos: Dictionary = taker["pos"]
	var item: Variant = SimItem.at(state["items"], int(pos["x"]), int(pos["y"]))
	var item_id: Variant = null if item == null else (item as Dictionary)["id"]
	var reason: String = "nothing" if item == null else "sealed"
	return SimEvents.draft("ITEM_REFUSED", int(state["rngCounter"]), 0, {
		"entityId": entity_id, "itemId": item_id, "reason": reason,
	})


## Spends what the satchel holds. Effects resolve HERE — how much the
## draught mends, who the smoke fools — and the event records the
## resolution, so replay applies rather than re-decides. Null when the hands
## are empty, the named slot is empty, or the hand holds something that is
## not a tool (the heart seals the satchel).
static func use_carried(state: Dictionary, entity_id: String, slot: int = 0) -> Variant:
	var found: Variant = SimEntity.find(state["entities"], entity_id)
	if found == null:
		return null
	var user: Dictionary = found

	# The heart seals both hands — a flare beside the world's ending stays lit.
	var satchel: Array = user["satchel"] if user.has("satchel") else []
	for held: Dictionary in satchel:
		if SimTables.provision_of(held["kind"]) == null:
			return null

	var kind: Variant = null
	if slot >= 0 and slot < satchel.size():
		kind = (satchel[slot] as Dictionary)["kind"]
	if kind == null or SimTables.provision_of(kind) == null:
		return null

	var counter: int = int(state["rngCounter"])
	var pos: Dictionary = user["pos"]
	var here := {"x": int(pos["x"]), "y": int(pos["y"])}

	if kind == "vital draught":
		# Brogue's answer to the pure-heal no-brainer: the mend and a
		# permanent raise in one swallow. Drunk early it banks the ceiling;
		# drunk late it banks the blood; no timing wastes it.
		var ceiling_to: int = int(user["maxHp"]) + SimTables.draught_ceiling(int(state["depth"]))
		return SimEvents.draft("ITEM_USED", counter, 0, {
			"entityId": entity_id, "kind": kind, "slot": slot,
			"effect": {"kind": "draught", "healedTo": ceiling_to, "ceilingTo": ceiling_to},
		})

	if kind == "tallow flare":
		# The floor admits its shape — layout, never occupants. The whole
		# effect is the fog's to apply; here it is only recorded.
		return SimEvents.draft("ITEM_USED", counter, 0, {
			"entityId": entity_id, "kind": kind, "slot": slot,
			"effect": {"kind": "flare", "at": here, "radius": SimTables.FLARE_RADIUS},
		})

	if kind == "ash ward":
		# Worn until a blow spends it. One warding per body — a second
		# swallow while the first holds would be a wasted hand, so it refuses
		# (a mispress, not a turn; the view says why).
		if (user["tags"] as Array).has("warded"):
			return null
		return SimEvents.draft("ITEM_USED", counter, 0, {
			"entityId": entity_id, "kind": kind, "slot": slot,
			"effect": {"kind": "ward"},
		})

	if kind == "iron burr":
		# Everyone hostile standing beside you reels — resolved here,
		# recorded whole, replay staggers the same bodies forever. Casting it
		# at empty air is allowed and honest. The hidden mimic is furniture
		# to the burr too: staggering "an item" would name the lie.
		var beside: Array = []
		for e: Dictionary in (state["entities"] as Array):
			if e["id"] == entity_id or not SimEntity.is_alive(e):
				continue
			if not SimMovement.is_hostile(user, e):
				continue
			if (e["tags"] as Array).has("hidden"):
				continue
			var epos: Dictionary = e["pos"]
			if absi(int(epos["x"]) - here["x"]) + absi(int(epos["y"]) - here["y"]) != 1:
				continue
			beside.append(e["id"])
		return SimEvents.draft("ITEM_USED", counter, 0, {
			"entityId": entity_id, "kind": kind, "slot": slot,
			"effect": {"kind": "burr", "staggered": beside},
		})

	if kind == "hollow bell":
		# Rings once and the way out answers — the exit and every unfound
		# prize, resolved here so the fog can read positions off the chain
		# without re-deriving a dead floor's layout.
		var grid: Dictionary = state["grid"]
		var tiles: Array = grid["tiles"]
		var width: int = int(grid["width"])
		var exit_at: int = tiles.find(SimGrid.EXIT)
		var exit: Dictionary = here if exit_at < 0 \
			else {"x": exit_at % width, "y": floori(float(exit_at) / float(width))}
		var prizes: Array = []
		for i: Dictionary in (state["items"] as Array):
			var ip: Dictionary = i["pos"]
			prizes.append({"x": int(ip["x"]), "y": int(ip["y"])})
		return SimEvents.draft("ITEM_USED", counter, 0, {
			"entityId": entity_id, "kind": kind, "slot": slot,
			"effect": {"kind": "bell", "exit": exit, "prizes": prizes},
		})

	# The smoke (the fall-through kind, exactly as the reference falls
	# through to it): for a while, every hunt chases where you WERE. Whatever
	# is already in your claws' reach is not fooled — it has you by touch,
	# not by trail — which also keeps the smoke from powering hit-and-run
	# whittling: it must rise BEFORE they reach you, or not at all.
	var unfooled: Array = []
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] == entity_id or not SimEntity.is_alive(e):
			continue
		if not SimMovement.is_hostile(user, e):
			continue
		var epos2: Dictionary = e["pos"]
		if absi(int(epos2["x"]) - here["x"]) + absi(int(epos2["y"]) - here["y"]) != 1:
			continue
		unfooled.append(e["id"])
	return SimEvents.draft("ITEM_USED", counter, 0, {
		"entityId": entity_id, "kind": kind, "slot": slot,
		"effect": {
			"kind": "smoke",
			"until": int(state["turn"]) + SimTables.smoke_turns(int(state["depth"])),
			"at": here,
			"unfooled": unfooled,
		},
	})


## The scroll spent by the reading. Effects resolve HERE and record whole:
## the unveiling enumerates, the still hour lists who reels, the eater names
## what it ate, the blink draws its landing, the song counts its broken
## walls. Null when no scroll is held, the reader is dead, or the heart is
## carried: the world's ending fills both hands, and the ending will not be
## trivialized by a pocketful of elsewhere.
static func read_scroll(state: Dictionary, entity_id: String) -> Variant:
	var found: Variant = SimEntity.find(state["entities"], entity_id)
	if found == null or not SimEntity.is_alive(found):
		return null
	var reader: Dictionary = found

	if reader.has("satchel"):
		for held: Dictionary in (reader["satchel"] as Array):
			if held["kind"] == SimTables.HEART_KIND:
				return null

	var kind: Variant = null
	if reader.has("scroll"):
		kind = (reader["scroll"] as Dictionary)["kind"]
	if kind == null or SimTables.scroll_of(kind) == null:
		return null

	var counter: int = int(state["rngCounter"])
	var draws := 0
	var grid: Dictionary = state["grid"]
	var width: int = int(grid["width"])
	var height: int = int(grid["height"])
	var reader_pos: Dictionary = reader["pos"]
	var effect: Dictionary

	if kind == "scroll of unveiling":
		var secrets: Array = []
		for y in range(height):
			for x in range(width):
				if SimGrid.tile_at(grid, x, y) == SimGrid.SECRET:
					secrets.append({"x": x, "y": y})
		var traps: Array = []
		for t: Dictionary in (state["traps"] as Array):
			if not bool(t["revealed"]) and not bool(t["sprung"]):
				traps.append(t["id"])
		effect = {"kind": "unveiling", "secrets": secrets, "traps": traps}

	elif kind == "scroll of the still hour":
		# Everything hostile and breathing reels — except the hidden mimic,
		# furniture to this tool like every other (naming it would be the
		# detector the guise forbids).
		var staggered: Array = []
		for e: Dictionary in (state["entities"] as Array):
			if e["id"] == entity_id or not SimEntity.is_alive(e):
				continue
			if not SimMovement.is_hostile(reader, e):
				continue
			if (e["tags"] as Array).has("hidden"):
				continue
			staggered.append(e["id"])
		effect = {"kind": "still hour", "staggered": staggered}

	elif kind == "scroll of the trap eater":
		var eaten: Array = []
		for t: Dictionary in (state["traps"] as Array):
			if bool(t["sprung"]):
				continue
			if SimMapgen.walk_distance(grid, reader_pos, t["pos"]) <= SimTables.TRAP_EATER_REACH:
				eaten.append(t["id"])
		effect = {"kind": "trap eater", "eaten": eaten}

	elif kind == "scroll of the blink step":
		# A drawn tile at least BLINK_CLEAR steps of walking from every living
		# hostile: multi-source flood from the hostiles marks the forbidden
		# ground, one draw picks from what remains. A floor with nowhere
		# clear leaves you standing — a spent page, honestly.
		var forbidden: Dictionary = {}
		var frontier: Array = []
		for e: Dictionary in (state["entities"] as Array):
			if e["id"] == entity_id or not SimEntity.is_alive(e):
				continue
			if not SimMovement.is_hostile(reader, e):
				continue
			var epos: Dictionary = e["pos"]
			var ex: int = int(epos["x"])
			var ey: int = int(epos["y"])
			frontier.append({"x": ex, "y": ey, "d": 0})
			forbidden[SimGrid.idx(grid, ex, ey)] = true
		# A read head instead of shift(): identical FIFO order, without the
		# O(n) re-shuffle Array.pop_front() would pay — mapgen.gd's own flood
		# fills use the same idiom.
		var head := 0
		while head < frontier.size():
			var here: Dictionary = frontier[head]
			head += 1
			if int(here["d"]) >= SimTables.BLINK_CLEAR:
				continue
			for step: Array in _STEPS:
				var nx: int = int(here["x"]) + int(step[0])
				var ny: int = int(here["y"]) + int(step[1])
				if not SimGrid.is_passable(grid, nx, ny):
					continue
				var key: int = SimGrid.idx(grid, nx, ny)
				if forbidden.has(key):
					continue
				forbidden[key] = true
				frontier.append({"x": nx, "y": ny, "d": int(here["d"]) + 1})

		var candidates: Array = []
		for y in range(height):
			for x in range(width):
				if not SimGrid.is_passable(grid, x, y):
					continue
				if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
					continue
				if forbidden.has(SimGrid.idx(grid, x, y)):
					continue
				var occupied := false
				for e: Dictionary in (state["entities"] as Array):
					if not SimEntity.is_alive(e):
						continue
					var epos2: Dictionary = e["pos"]
					if int(epos2["x"]) == x and int(epos2["y"]) == y:
						occupied = true
						break
				if occupied:
					continue
				candidates.append({"x": x, "y": y})

		if candidates.is_empty():
			effect = {"kind": "blink", "to": {"x": int(reader_pos["x"]), "y": int(reader_pos["y"])}}
		else:
			var at: int = SimRng.int_between(int(state["seed"]), counter, 0, candidates.size() - 1)
			draws = 1
			effect = {"kind": "blink", "to": candidates[at]}

	else:
		# Stone song, the reference's unconditional fallthrough (four kinds
		# named, this one default). The walls within the disc sing to dust.
		# The border, the way out and the secrets keep their shapes; only
		# plain wall breaks.
		var broken: Array = []
		var rx: int = int(reader_pos["x"])
		var ry: int = int(reader_pos["y"])
		var r := SimTables.SUNDER_RADIUS
		for y in range(maxi(1, ry - r), mini(height - 2, ry + r) + 1):
			for x in range(maxi(1, rx - r), mini(width - 2, rx + r) + 1):
				var dx: int = x - rx
				var dy: int = y - ry
				if dx * dx + dy * dy > r * r + r:
					continue
				if SimGrid.tile_at(grid, x, y) != SimGrid.WALL:
					continue
				broken.append({"x": x, "y": y})
		effect = {"kind": "stone song", "broken": broken}

	return SimEvents.draft("SCROLL_READ", counter, draws, {
		"entityId": entity_id, "kind": kind, "effect": effect,
	})
