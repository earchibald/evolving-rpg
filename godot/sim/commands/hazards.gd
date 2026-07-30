class_name SimHazards
## The hazards family — traps, secrets, mimics, pockets — the byte-twin of
## src/core/commands.ts's hazard verbs. Reached through SimCommands, never
## directly, per the house rule movement.gd set (Task 2.E3a): the facade is
## the one surface the stage and autoplay see.
##
## Of the four named verbs, only TRAPS has a function that actually lives in
## this file:
##   senseTrap  commands.ts:872   the two wits chances, sight then near,
##                                 each offered once, a miss recorded silent
##   ringAround commands.ts:906   private BFS helper springTrap's hatch
##                                 effect uses, lifted out below as
##                                 _ring_around for the same reason
##                                 sight.gd's own header gives for its
##                                 extracted helpers: GDScript static funcs
##                                 cannot close over a mutable outer local
##                                 the way a TS closure can
##   springTrap commands.ts:941   the trap underfoot paying out, whole, in
##                                 one draft — the dodge, the die, the
##                                 risers, the landing, all resolved here
##
## SECRETS, MIMICS and POCKETS have no verb of their own — there is no player
## input "seal a room" or "carry a pocket" — so there is nothing left of them
## to PORT into this file. What each still needed was a WITNESS, and that is
## what this task actually delivers for them:
##   - SECRETS: SimMapgen.seal_secret_room / repair_with_secret (mapgen.gd,
##     Task 2.D1) do the sealing and the repair at generation time, called
##     from create_world (movement.gd, Task 2.E3a). mapgen.gd's own header
##     (line 50) names secrets.test.ts as this task's, and until
##     test_secrets.gd landed neither function had a reference-suite test
##     anywhere in sim/ — only the six-board fixture sweep exercised them,
##     and only by accident of create_world calling them.
##   - MIMICS: the seeding (create_world) and the bump-to-UNMASK
##     (attempt_move) are movement.gd's; the tag swap on UNMASKED is
##     apply.gd's; the ambush-band bonus on the first landed blow is
##     resolve_strike's (movement.gd again). All pre-existing and reviewed.
##     test_mimics.gd is the first suite to exercise any of it end to end.
##   - POCKETS: what a creature is born carrying is drawn at generation
##     (movement.gd's _draw_pocket); what spills on its death is apply.gd's
##     _drop_pockets, already wired into every death path (STRIKE,
##     RULE_FIRED, and the shove Task 2.E3d has not landed in this worktree
##     yet). Same relationship: test_pockets.gd is the witness, not new code.
##
## ── Reconciliation, src/core/commands.ts ──────────────────────────────────
## senseTrap and springTrap (with ringAround, their shared private helper)
## are the whole of this file's surface, and both are PORTED whole — nothing
## in THIS file is deferred.
##
## See test_traps.gd / test_secrets.gd / test_mimics.gd / test_pockets.gd for
## the four TEST SUITES' own per-case reconciliations: six of their combined
## 39 reference cases are deferred there — to Phase 3 (the stage, which will
## own src/play/session.ts and src/ui/fov.ts; neither exists under godot/
## yet, and sight.gd's own header already calls the fog "a stage-side
## concern, not sim's") and to Tasks 2.E3b/2.E3d (sibling Wave E worktrees,
## running concurrently and not yet merged into this one, whose
## useCarried/shoveAt/shotTarget those six cases also need). None of the six
## touches senseTrap, ringAround or springTrap themselves.


## The next pending chance to know a trap, or null when every chance is
## spent. Each trap offers two, each exactly once: `sight` the first time it
## stands inside the engine's own sight disc with a clear line (walls and
## secrets block; bodies do not — a bruiser is not a curtain), and `near` the
## first time you walk within TRAP_NEAR_RADIUS steps of it still unknowing.
## One draft per call, drafted against the state the caller just folded — the
## caller loops until silence, so every roll's counter stays honest.
##
## A miss is recorded exactly like a find: the flag that stops the SAME
## chance rolling twice is set by the reducer either way (apply.gd's
## TRAP_SENSED arm), and nothing about a miss is louder than the event
## itself — the floor does not narrate what it hid.
static func sense_trap(state: Dictionary, player_id: String = "player") -> Variant:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null or not SimEntity.is_alive(found):
		return null
	var eye: Dictionary = found
	var eye_pos: Dictionary = eye["pos"]
	var eye_wits: int = int((eye["stats"] as Dictionary)["wits"])
	var grid: Dictionary = state["grid"]

	for t: Dictionary in (state["traps"] as Array):
		if bool(t["sprung"]) or bool(t["revealed"]):
			continue
		var trap_pos: Dictionary = t["pos"]
		if not bool(t["sightRolled"]) \
			and SimSight.within_reach(eye_pos, trap_pos, SimTables.sight_at(int(state["depth"]))) \
			and SimSight.clear_shot(grid, [], eye_pos, trap_pos):
			return _sensed(state, t, "sight", SimTables.TRAP_SIGHT_NEED, eye_wits)
		if not bool(t["nearRolled"]) \
			and SimMapgen.walk_distance(grid, eye_pos, trap_pos) <= SimTables.TRAP_NEAR_RADIUS:
			return _sensed(state, t, "near", SimTables.TRAP_NEAR_NEED, eye_wits)
	return null


## One TRAP_SENSED draft. Recorded the way strikes record: `needed` is what
## the d20 itself had to beat, wits already folded in, so a reader never
## redoes the arithmetic to know whether the roll shown was good enough.
static func _sensed(state: Dictionary, t: Dictionary, method: String, base: int, wits: int) -> Dictionary:
	var counter: int = int(state["rngCounter"])
	var roll := SimRng.int_between(int(state["seed"]), counter, 1, 20)
	var needed := base + 2 * int(t["level"]) - wits
	return SimEvents.draft("TRAP_SENSED", counter, 1, {
		"trapId": t["id"], "method": method, "roll": roll, "needed": needed,
		"revealed": roll >= needed,
	})


## Walkable tiles a band of steps out from a point, in index order — where a
## hatch's risers stand up. One BFS, not one per tile. `queue` is walked with
## a head pointer rather than popped from the front: the same FIFO order
## Array.pop_front() would give, at less cost per visit.
static func _ring_around(state: Dictionary, from: Dictionary, band: Array) -> Array:
	var grid: Dictionary = state["grid"]
	var from_x: int = int(from["x"])
	var from_y: int = int(from["y"])
	var seen: Dictionary = {}
	var queue: Array = [{"x": from_x, "y": from_y, "d": 0}]
	seen[SimGrid.idx(grid, from_x, from_y)] = 0

	var head := 0
	while head < queue.size():
		var here: Dictionary = queue[head]
		head += 1
		if int(here["d"]) >= int(band[1]):
			continue
		var hx: int = int(here["x"])
		var hy: int = int(here["y"])
		var d: int = int(here["d"]) + 1
		for step: Array in [[hx + 1, hy], [hx - 1, hy], [hx, hy + 1], [hx, hy - 1]]:
			var nx: int = step[0]
			var ny: int = step[1]
			if not SimGrid.is_passable(grid, nx, ny):
				continue
			var key := SimGrid.idx(grid, nx, ny)
			if seen.has(key):
				continue
			seen[key] = d
			queue.append({"x": nx, "y": ny, "d": d})

	var stood: Dictionary = {}
	for e: Dictionary in (state["entities"] as Array):
		if SimEntity.is_alive(e):
			var epos: Dictionary = e["pos"]
			stood[SimGrid.idx(grid, int(epos["x"]), int(epos["y"]))] = true

	var keys: Array = seen.keys()
	keys.sort()
	var width: int = int(grid["width"])
	var tiles: Array = grid["tiles"]
	var out: Array = []
	for key: int in keys:
		var dist: int = int(seen[key])
		if dist < int(band[0]) or dist > int(band[1]):
			continue
		if stood.has(key):
			continue
		if int(tiles[key]) == SimGrid.EXIT:
			continue
		out.append({"x": key % width, "y": floori(float(key) / float(width))})
	return out


## The trap underfoot paying out, or null when the ground is honest.
## Everything resolves HERE — the dodge (where the kind's law grants one,
## rolled at the victim's level, never the trap's), the die, the risers, the
## landing — and the event records it whole. Draws are spent the same
## whether the dodge saves you: the STRIKE discipline (resolve_strike,
## movement.gd), so the counter's path never depends on the outcome.
static func spring_trap(state: Dictionary, victim_id: String = "player") -> Variant:
	var found: Variant = SimEntity.find(state["entities"], victim_id)
	if found == null or not SimEntity.is_alive(found):
		return null
	var victim: Dictionary = found
	var vpos: Dictionary = victim["pos"]

	var trap: Variant = null
	for t: Dictionary in (state["traps"] as Array):
		if bool(t["sprung"]):
			continue
		var tp: Dictionary = t["pos"]
		if int(tp["x"]) == int(vpos["x"]) and int(tp["y"]) == int(vpos["y"]):
			trap = t
			break
	if trap == null:
		return null
	var the_trap: Dictionary = trap

	var kind_row: Variant = SimTables.trap_of(the_trap["kind"])
	var law: Variant = (kind_row as Dictionary)["dodge"] if kind_row != null else "never"

	var seed: int = int(state["seed"])
	var start: int = int(state["rngCounter"])
	var c := start
	# `is` gates each branch BEFORE any `==`/`int()` touches `law`: comparing
	# an int Variant to a String literal with `==` is itself a runtime error
	# in Godot ("Invalid operands 'int' and 'String'"), not a quiet `false`,
	# so the type has to be known first rather than discovered by comparing.
	var may_dodge: bool = (law is String and law == "always") \
		or (law is int and int(state["level"]) >= int(law))
	var dodge: Variant = null
	var dodged := false
	if may_dodge:
		var roll := SimRng.int_between(seed, c, 1, 20)
		c += 1
		var needed := SimTables.TRAP_DODGE_NEED + 2 * int(the_trap["level"]) \
			- int((victim["stats"] as Dictionary)["speed"])
		dodge = {"roll": roll, "needed": needed}
		dodged = roll >= needed

	var resolved: Dictionary = _trap_effect(state, the_trap, victim, c)
	c = int(resolved["counterAfter"])

	return SimEvents.draft("TRAP_SPRUNG", start, c - start, {
		"trapId": the_trap["id"], "victimId": victim_id,
		"dodge": dodge, "dodged": dodged, "effect": resolved["effect"],
	})


## The trap's payout: which effect fires and what it costs, resolved as one
## unit so spring_trap never reasons about a mid-resolution counter. One IIFE
## in the reference; a helper here for the same reason movement.gd split
## _choose_spawns out of create_world — GDScript has no closure over a
## mutable outer `c`. Returns {"effect": Dictionary, "counterAfter": int}.
static func _trap_effect(state: Dictionary, trap: Dictionary, victim: Dictionary, counter: int) -> Dictionary:
	var seed: int = int(state["seed"])
	var c := counter
	var kind: String = trap["kind"]

	if kind == "spike pit":
		var damage := SimRng.int_between(seed, c, 1, SimTables.SPIKE_DIE) \
			+ floori(float(state["depth"]) / 2.0)
		c += 1
		return {"effect": {"kind": "spikes", "damage": damage}, "counterAfter": c}
	if kind == "venom needle":
		return {"effect": {"kind": "venom", "turns": SimTables.NEEDLE_VENOM_TURNS}, "counterAfter": c}
	if kind == "strangling snare":
		return {"effect": {"kind": "snare", "turns": SimTables.SNARE_TURNS}, "counterAfter": c}
	if kind == "alarm bell":
		var grid: Dictionary = state["grid"]
		var stretch := SimTables.size_stretch(int(grid["width"]), int(grid["height"]))
		return {
			"effect": {"kind": "alarm", "until": int(state["turn"]) + SimTables.alarm_turns(stretch)},
			"counterAfter": c,
		}
	if kind == "the maw":
		var damage := SimRng.int_between(seed, c, 1, SimTables.MAW_DIE) + SimTables.MAW_FLAT
		c += 1
		return {"effect": {"kind": "maw", "damage": damage}, "counterAfter": c}
	if kind == "lodestone":
		return _lodestone_effect(state, victim, c)
	return _hatch_effect(state, trap, c)


## The lodestone's landing: a drawn far tile — past the wave's own distance,
## passable, empty, never the way out. A floor with nowhere far enough leaves
## the victim standing, recorded as a spent stone that moved nothing.
static func _lodestone_effect(state: Dictionary, victim: Dictionary, counter: int) -> Dictionary:
	var grid: Dictionary = state["grid"]
	var vpos: Dictionary = victim["pos"]
	var vx: int = int(vpos["x"])
	var vy: int = int(vpos["y"])
	var entities: Array = state["entities"]
	var candidates: Array = []
	for y in range(int(grid["height"])):
		for x in range(int(grid["width"])):
			if not SimGrid.is_passable(grid, x, y):
				continue
			if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
				continue
			if absi(x - vx) + absi(y - vy) < SimTables.WAVE_DISTANCE:
				continue
			var occupied := false
			for e: Dictionary in entities:
				if SimEntity.is_alive(e):
					var epos: Dictionary = e["pos"]
					if int(epos["x"]) == x and int(epos["y"]) == y:
						occupied = true
						break
			if occupied:
				continue
			candidates.append({"x": x, "y": y})

	if candidates.is_empty():
		return {"effect": {"kind": "lodestone", "to": {"x": vx, "y": vy}}, "counterAfter": counter}
	var at := SimRng.int_between(int(state["seed"]), counter, 0, candidates.size() - 1)
	return {"effect": {"kind": "lodestone", "to": candidates[at]}, "counterAfter": counter + 1}


## The hatches' risers: LEVEL-1 BODIES ALWAYS (creature_stats(arch.kind, 1),
## commands.ts:1019) — never the floor's own band, and never the trap's own
## level either; those are two different numbers the effect never reads back
## in. Drawn from the floor's archetype weights (never a caller — a riser
## with an unspent cry of its own is not the point) and stood up in the ring
## around the trap. Kept after measurement: floor-band risers fed the
## depth-5 brawler 14/20 survival against a pinned ceiling of 13 — a trap
## that pays more XP than it costs is a vending machine, not a hazard.
static func _hatch_effect(state: Dictionary, trap: Dictionary, counter: int) -> Dictionary:
	var seed: int = int(state["seed"])
	var c := counter
	var count := 1
	if trap["kind"] == "nest hatch":
		count = SimRng.int_between(seed, c, 2, 3)
		c += 1

	var spawnable: Array = []
	for a: Dictionary in SimTables.BESTIARY:
		if int(a["weight"]) > 0 and int(state["depth"]) >= int(a.get("fromDepth", 1)) \
			and SimTables.verb_of(a["kind"]) != "call":
			spawnable.append(a)
	var arch_total := 0
	for a: Dictionary in spawnable:
		arch_total += int(a["weight"])

	var rising: Array = []
	for i in range(count):
		var pick := SimRng.int_between(seed, c, 1, arch_total)
		c += 1
		var arch: Dictionary = spawnable[0]
		for a: Dictionary in spawnable:
			pick -= int(a["weight"])
			if pick <= 0:
				arch = a
				break

		var ring: Array = _ring_around(state, trap["pos"], SimTables.HATCH_BAND)
		var free: Array = []
		for p: Dictionary in ring:
			var taken := false
			for r: Dictionary in rising:
				var rp: Dictionary = r["pos"]
				if int(rp["x"]) == int(p["x"]) and int(rp["y"]) == int(p["y"]):
					taken = true
					break
			if not taken:
				free.append(p)
		if free.is_empty():
			break
		var at := SimRng.int_between(seed, c, 0, free.size() - 1)
		c += 1
		var spot: Dictionary = free[at]
		rising.append({
			"id": "hatched-%d-%d" % [int(state["turn"]), i],
			"kind": arch["kind"],
			"pos": {"x": int(spot["x"]), "y": int(spot["y"])},
			"stats": SimTables.creature_stats(arch["kind"], 1),
			"tags": [],
		})

	return {"effect": {"kind": "hatch", "opponents": rising}, "counterAfter": c}
