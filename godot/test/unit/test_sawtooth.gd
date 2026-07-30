extends GutTest
## The sawtooth, pinned — the byte-twin of tests/balance/sawtooth.test.ts.
## 8 of 8 ported (5 vale under "the rising sawtooth, measured on fixed
## seeds", 3 expanse under "the sawtooth on the expanse"), in the reference's
## order. Nothing deferred: 5 + 3 = 8, matching the reference's 8 `it(...)`
## blocks exactly.
##
## Every seed is fixed and every run deterministic, so these counts are
## exact — not flaky, exact. The bands are deliberately wide: they exist to
## catch a broken table (a flattened growth row, a budget that stopped
## deepening), not to freeze tuning. NEVER widen a band to make a pin go
## green — a band widened to fit is a balance change smuggled in as a test
## fix. If a pin misses, the right move is to report it, not this file.
##
## ── the harness this file has to build, and why ────────────────────────────
## The reference test drives four modules this migration has not ported as
## modules of their own: src/play/{autoplay,session,policies}.ts and (for the
## log/refs half) src/log/{chain,refs}.ts. The log/refs half is already here
## (SimLog is chain.ts's twin, SimRefs is refs.ts's twin — both merged by
## earlier waves); the play/ half is not assigned to any task in this
## migration's plan, sim/ has no `play/` counterpart, and this suite is the
## ONLY thing in the whole migration that needs one. So the minimal slice of
## autoplay.ts + session.ts + policies.ts this suite actually exercises is
## reimplemented below as private methods on this test script, each headed
## by the reference function and line range it stands in for. This is the
## first place in the migration SimCommands and SimAi are driven together
## over hundreds of turns — see this file's own report for what that found.
##
## Three branches of the reimplemented session.ts are PROVABLE dead code for
## this specific harness and are omitted rather than stubbed (reasoned at
## each site below, not assumed):
##   - RULE_FIRED never fires: state["rules"] starts `[]` (WORLD_INIT,
##     apply.gd:379) and only RULE_RATIFIED ever appends to it; this harness
##     never drafts RULE_RATIFIED, so SimInterpret.fire_rules's own loop
##     (`for rule in state["rules"]`, interpret.gd:250) runs zero times,
##     every time, for the life of the suite. `commit`'s and `passTurn`'s
##     rule-firing halves are the TS twin of that call and are dropped with
##     it — firingFor() has no ported equivalent because nothing is ever
##     left to fire it at.
##   - descend()'s WORLD_BIBLE re-append never fires: WORLD_INIT always
##     writes bible: null (apply.gd:398) and only WORLD_BIBLE (foundWorld)
##     ever sets it; this harness never drafts WORLD_BIBLE.
##   - descend()'s fallen-bodies and rule-carry loops never fire: the former
##     needs a grave-named ref, and refs here is a brand new SimRefs.empty()
##     built fresh on every floor transition (mirroring session.ts:34's own
##     per-call construction) — nothing this harness does ever forks or
##     buries, so no grave can exist to find; the latter walks
##     state["rules"], already established empty forever.
## The world-stir half of passTurn (heartHeld/stirWorld at BOTTOM_DEPTH) IS
## ported despite being unreachable at the depths this suite plays to
## (deepest pin is 5; SimTables.BOTTOM_DEPTH is 9) — cheap to keep faithful,
## unlike the three branches above which would need real machinery.
##
## floors() (:31-42) and expanseFloors() (:118-130) are identical but for
## dims, seed list and per-floor action cap; folded into one parameterised
## _floors() rather than ported as two copies that could quietly drift.


# ── src/play/policies.ts, the two policies this suite plays ────────────────

## Fixed neighbour order (east, west, south, north) — the same order
## SimAi._NEIGHBOURS uses, so the two BFS's disagree only in what counts as
## passable, never in which of two equally-short paths a tie picks.
const _NEIGHBOURS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const _WAIT: Dictionary = {"kind": "wait", "dx": 0, "dy": 0}


## policies.ts:49-82 firstStepToward — a SEPARATE breadth-first search from
## SimAi._first_step, deliberately: here a living creature is walkable
## ground (bumping into one is a strike, which is how the game itself reads
## a bump), where the hunt's search treats one as a wall. Unbounded depth,
## not capped at AWARENESS — a policy is allowed to see the whole board.
## `goal` is a predicate `Callable(Dictionary) -> bool`, matching the
## reference's `(p: Pos) => boolean`.
func _first_step_toward(state: Dictionary, from: Dictionary, goal: Callable) -> Variant:
	var grid: Dictionary = state["grid"]
	var width: int = grid["width"]
	var height: int = grid["height"]
	var from_x: int = int(from["x"])
	var from_y: int = int(from["y"])

	var seen: Dictionary = {}
	seen[from_y * width + from_x] = true
	var prev: Dictionary = {}
	var queue: Array = [[from_x, from_y]]
	var qi := 0
	var found_x := -1
	var found_y := -1
	var found := false

	while qi < queue.size() and not found:
		var at: Array = queue[qi]
		qi += 1
		for d: Array in _NEIGHBOURS:
			var nx: int = int(at[0]) + int(d[0])
			var ny: int = int(at[1]) + int(d[1])
			if nx < 0 or ny < 0 or nx >= width or ny >= height:
				continue
			var k: int = ny * width + nx
			if seen.has(k):
				continue
			seen[k] = true
			prev[k] = at
			if goal.call({"x": nx, "y": ny}):
				found_x = nx
				found_y = ny
				found = true
				break
			if SimGrid.is_passable(grid, nx, ny):
				queue.append([nx, ny])

	if not found:
		return null

	# Unwind prev back to the step adjacent to `from` — the FIRST step of
	# the shortest path, which is all a policy ever needs.
	var walk: Array = [found_x, found_y]
	while true:
		var k2: int = int(walk[1]) * width + int(walk[0])
		if not prev.has(k2):
			return null
		var back: Array = prev[k2]
		if int(back[0]) == from_x and int(back[1]) == from_y:
			break
		walk = back
	return {"kind": "step", "dx": signi(int(walk[0]) - from_x), "dy": signi(int(walk[1]) - from_y)}


## policies.ts:91-94 quaffWish — the fixed-threshold satchel reflex both
## fighters share: drink the vital draught once hp falls below the table's
## BOT_QUAFF_BELOW fraction of max.
func _quaff_wish(me: Dictionary) -> Variant:
	var satchel: Array = me["satchel"] if me.has("satchel") else []
	var at := -1
	for i in range(satchel.size()):
		if (satchel[i] as Dictionary)["kind"] == "vital draught":
			at = i
			break
	if at < 0:
		return null
	var stats: Dictionary = me["stats"]
	if float(stats["hp"]) < float(me["maxHp"]) * SimTables.BOT_QUAFF_BELOW:
		return {"kind": "use", "dx": 0, "dy": 0, "slot": at}
	return null


## policies.ts:99-107 bottomWish, GUARD LINE ONLY. Every depth this suite
## reaches is < BOTTOM_DEPTH (9; the deepest pin plays to depth 5), so the
## guard is the only line the reference itself would ever execute here — the
## heart-seeking body below it is dead for this harness and is not ported.
## push_error rather than a silent null so a future pin reaching depth 9
## fails loudly instead of quietly playing an un-ported policy.
func _bottom_wish(state: Dictionary) -> Variant:
	if int(state["depth"]) < SimTables.BOTTOM_DEPTH:
		return null
	push_error("_bottom_wish: sawtooth reached BOTTOM_DEPTH — the elided branch is now live")
	return null


func _living_others(state: Dictionary, player_id: String) -> Array:
	var out: Array = []
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != player_id and SimEntity.is_alive(e):
			out.append(e)
	return out


## policies.ts:117-124 rusher — heads for the way out, fighting through
## whatever stands in the path.
func _policy_rusher(state: Dictionary, player_id: String) -> Dictionary:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null:
		return _WAIT
	var me: Dictionary = found
	var wish: Variant = _quaff_wish(me)
	if wish == null:
		wish = _bottom_wish(state)
	if wish == null:
		var grid: Dictionary = state["grid"]
		wish = _first_step_toward(state, me["pos"], func(p: Dictionary) -> bool:
			return SimGrid.tile_at(grid, int(p["x"]), int(p["y"])) == SimGrid.EXIT)
	return wish if wish != null else _WAIT


## policies.ts:126-134 brawler — hunts the nearest living thing and keeps
## swinging until nothing is left, then leaves. The policy this whole suite
## is named for.
func _policy_brawler(state: Dictionary, player_id: String) -> Dictionary:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null:
		return _WAIT
	var me: Dictionary = found
	var drink: Variant = _quaff_wish(me)
	if drink != null:
		return drink
	var prey: Array = _living_others(state, player_id)
	if prey.is_empty():
		return _policy_rusher(state, player_id)
	var wish: Variant = _first_step_toward(state, me["pos"], func(p: Dictionary) -> bool:
		for e: Dictionary in prey:
			var ep: Dictionary = e["pos"]
			if int(ep["x"]) == int(p["x"]) and int(ep["y"]) == int(p["y"]):
				return true
		return false)
	return wish if wish != null else _WAIT


# ── src/play/session.ts, the subset autoplay actually drives ───────────────

## session.ts:154-181 draftFor — turns a creature's Action into a draft.
func _draft_for(state: Dictionary, entity_id: String, action: Dictionary) -> Variant:
	var kind: String = action["kind"]
	if kind == "wait":
		var found: Variant = SimEntity.find(state["entities"], entity_id)
		var reeling: bool = found != null and ((found as Dictionary)["tags"] as Array).has("staggered")
		return SimCommands.wait(state, entity_id) if reeling else null
	if kind == "step":
		return SimCommands.attempt_move(state, entity_id, int(action["dx"]), int(action["dy"]))
	if kind == "lunge":
		return SimCommands.lunge_strike(state, entity_id, action["targetId"])
	if kind == "mend":
		return SimCommands.vigil_kept(state, entity_id)
	if kind == "call":
		return SimCommands.call_out(state, entity_id)
	if kind == "draw":
		return SimCommands.draw_stance(state, entity_id)
	if kind == "shoot":
		return SimCommands.loose_shot(state, entity_id, action["targetId"])
	# "strike": the only remaining kind. Only ever chosen at range 1, so
	# exactly one axis of the sign is non-zero.
	var self_found: Variant = SimEntity.find(state["entities"], entity_id)
	var target_found: Variant = SimEntity.find(state["entities"], action["targetId"])
	if self_found == null or target_found == null:
		return null
	var self_pos: Dictionary = (self_found as Dictionary)["pos"]
	var target_pos: Dictionary = (target_found as Dictionary)["pos"]
	return SimCommands.attempt_move(state, entity_id,
		signi(int(target_pos["x"]) - int(self_pos["x"])),
		signi(int(target_pos["y"]) - int(self_pos["y"])))


## session.ts:99-112 commit, minus the rule-firing half — see this file's
## header for why that half is provably a no-op for every call this harness
## ever makes. `log` is mutated in place by SimLog.append; only the new
## head needs to come back.
func _commit(log: SimLog, head: Variant, draft: Dictionary, player_id: String) -> Variant:
	var acted: Dictionary = log.append(head, draft)
	if not SimCommands.ends_turn(draft):
		return acted["id"]
	return _pass_turn(log, acted["id"], player_id)


## session.ts:119-140 passTurn, minus the rule-firing half (see header). The
## world-stir half IS kept, though it is unreachable below BOTTOM_DEPTH (9)
## and this suite never plays past depth 5 — cheap enough to port faithfully
## rather than reason away.
func _pass_turn(log: SimLog, head: Variant, player_id: String) -> Variant:
	var before: Dictionary = log.fold(head)
	var turned: Dictionary = log.append(head, SimCommands.advance_turn(before))
	var new_head: Variant = turned["id"]
	var after: Dictionary = log.fold(new_head)
	if int(after["turn"]) != int(before["turn"]):
		if int(after["depth"]) >= SimTables.BOTTOM_DEPTH and SimCommands.heart_held(after, player_id) \
				and int(after["turn"]) % SimTables.WAVE_EVERY == 0:
			var stirred: Variant = SimCommands.stir_world(after, player_id)
			if stirred != null:
				new_head = (log.append(new_head, stirred))["id"]
	return new_head


## session.ts:183-186 collect — rides along with the move that reached
## whatever is underfoot, costing no turn of its own.
func _collect(log: SimLog, head: Variant, entity_id: String) -> Variant:
	var taken: Variant = SimCommands.take_underfoot(log.fold(head), entity_id)
	if taken == null:
		return head
	return _commit(log, head, taken, entity_id)


## session.ts:196-210 settleTraps — the floor settling its account with the
## player after every action: spring first (bounded 8, a lodestone can chain
## onto another trap), then every pending sensed-chance (bounded 64).
func _settle_traps(log: SimLog, head: Variant, player_id: String) -> Variant:
	var cur: Variant = head
	for _guard in range(8):
		var sprung: Variant = SimCommands.spring_trap(log.fold(cur), player_id)
		if sprung == null:
			break
		cur = _commit(log, cur, sprung, player_id)
	for _guard in range(64):
		var sensed: Variant = SimCommands.sense_trap(log.fold(cur), player_id)
		if sensed == null:
			break
		cur = _commit(log, cur, sensed, player_id)
	return cur


## session.ts:212-224 playerStep.
func _player_step(log: SimLog, head: Variant, player_id: String, dx: int, dy: int) -> Variant:
	var state: Dictionary = log.fold(head)
	if SimCommands.outcome(state, player_id) != "playing":
		return head
	var draft: Dictionary = SimCommands.attempt_move(state, player_id, dx, dy)
	return _settle_traps(log, _collect(log, _commit(log, head, draft, player_id), player_id), player_id)


## session.ts:227-235 playerWait.
func _player_wait(log: SimLog, head: Variant, player_id: String) -> Variant:
	var state: Dictionary = log.fold(head)
	if SimCommands.outcome(state, player_id) != "playing":
		return head
	var draft: Dictionary = SimCommands.wait(state, player_id)
	return _settle_traps(log, _commit(log, head, draft, player_id), player_id)


## session.ts:238-247 playerUse.
func _player_use(log: SimLog, head: Variant, player_id: String, slot: int) -> Variant:
	var state: Dictionary = log.fold(head)
	if SimCommands.outcome(state, player_id) != "playing":
		return head
	var draft: Variant = SimCommands.use_carried(state, player_id, slot)
	if draft == null:
		return head
	return _settle_traps(log, _commit(log, head, draft, player_id), player_id)


## session.ts:340-375 runWorldTurns — every other creature, until it is the
## player's turn again or the bounded 64 steps run out.
func _run_world_turns(log: SimLog, head: Variant, player_id: String, max_steps: int = 64) -> Variant:
	var cur: Variant = head
	for _i in range(max_steps):
		var state: Dictionary = log.fold(cur)
		var player: Variant = SimEntity.find(state["entities"], player_id)
		if player == null or not SimEntity.is_alive(player):
			return cur
		# A reached exit ends the world's turn too — nothing gets a parting shot.
		if SimCommands.outcome(state, player_id) != "playing":
			return cur

		var active_raw: Variant = state["activeEntityId"]
		if active_raw == null or active_raw == player_id:
			return _settle_traps(log, cur, player_id)
		var active: String = active_raw

		var draft: Variant = _draft_for(state, active, SimAi.decide(state, active))
		if draft == null:
			cur = _pass_turn(log, cur, player_id)
			continue
		cur = _commit(log, cur, draft, player_id)
		# A creature whose action earned no turn (a blocked move) must still
		# yield, or the round-robin hangs on the first pocketed creature.
		if log.fold(cur)["activeEntityId"] == active:
			cur = _pass_turn(log, cur, player_id)
	return cur


# ── src/play/session.ts, the descent ceremony ───────────────────────────────

## session.ts:283-329 descend, reduced to exactly what this suite exercises
## — see this file's header for why the WORLD_BIBLE re-append, the fallen-
## bodies record and the rule-carry loop are each provably unreachable here
## and are omitted rather than stubbed. `refs` is the fresh
## SimRefs.empty()-plus-one-ref that _floors() builds on every floor
## transition, mirroring the reference's own per-call construction
## (sawtooth.test.ts:34).
func _descend(log: SimLog, refs: Dictionary, active: String, width: int, height: int, player_id: String = "player") -> Variant:
	var ref: Dictionary = SimRefs.get_ref(refs, active)
	var state: Dictionary = log.fold(ref["head"])
	if SimCommands.outcome(state, player_id) != "escaped":
		return null

	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null:
		return null
	var you: Dictionary = found

	# Rest at the stairs: descend a cleared floor and you descend healed.
	var cleared := true
	for e: Dictionary in (state["entities"] as Array):
		if e["id"] != player_id and SimEntity.is_alive(e):
			cleared = false
			break

	var you_stats: Dictionary = you["stats"]
	var hp: int = int(you["maxHp"]) if cleared else int(you_stats["hp"])

	var next_depth: int = int(state["depth"]) + 1
	var next_seed: int = SimRng.u32(int(state["seed"]), 1_000_003 + int(state["depth"]))

	var stats: Dictionary = you_stats.duplicate()
	stats["hp"] = hp
	var carried: Dictionary = {
		"stats": stats,
		"maxHp": you["maxHp"],
		"xp": state["xp"],
		"level": state["level"],
	}
	if you.has("gear"):
		carried["gear"] = you["gear"]
	if you.has("satchel"):
		var kinds: Array = []
		for c: Dictionary in (you["satchel"] as Array):
			kinds.append(c["kind"])
		carried["satchel"] = {"kinds": kinds}
	if you.has("scroll"):
		carried["scroll"] = {"kind": (you["scroll"] as Dictionary)["kind"]}

	var born: Dictionary = log.append(ref["head"], SimCommands.create_world(
		next_seed, width, height, player_id, next_depth, carried))

	return {"refs": SimRefs.set_head(refs, active, born["id"]), "depth": next_depth}


# ── src/play/autoplay.ts:29-45 autoplay ─────────────────────────────────────

## Drives one policy through the session layer above, capped by ACTIONS (not
## turns — a blocked move costs no turn, and a wall-bumping policy would
## otherwise run forever under a turn cap). Returns only `head` and `ended`:
## the two fields this suite's `floors()`/`expanseFloors()` actually read
## from the reference's richer `Played`.
func _autoplay(log: SimLog, start_head: Variant, policy: Callable, max_actions: int, player_id: String = "player") -> Dictionary:
	var head: Variant = start_head
	var actions := 0
	while actions < max_actions:
		var state: Dictionary = log.fold(head)
		if SimCommands.outcome(state, player_id) != "playing":
			break
		var wish: Dictionary = policy.call(state, player_id)
		actions += 1
		match wish["kind"]:
			"wait":
				head = _player_wait(log, head, player_id)
			"use":
				head = _player_use(log, head, player_id, int(wish.get("slot", 0)))
			_:
				head = _player_step(log, head, player_id, int(wish["dx"]), int(wish["dy"]))
		head = _run_world_turns(log, head, player_id)
	return {"head": head, "ended": SimCommands.outcome(log.fold(head), player_id)}


# ── the harness sawtooth.test.ts itself builds ──────────────────────────────

const VALE_WIDTH := 48
const VALE_HEIGHT := 32
const VALE_MAX_ACTIONS := 1500
const VALE_SEEDS: Array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

const EXPANSE_WIDTH := 96
const EXPANSE_HEIGHT := 64
const EXPANSE_MAX_ACTIONS := 4000
const EXPANSE_SEEDS: Array = [3, 7, 11, 15, 21, 29, 33, 44, 51, 60]


## sawtooth.test.ts:31-42 floors() and :118-130 expanseFloors(), folded into
## one (see header). Plays one seed to `count` floors deep (or until the run
## stops being 'escaped'), returning the final outcome.
func _floors(seed: int, policy: Callable, count: int, width: int, height: int, max_actions: int) -> String:
	var log := SimLog.new()
	var born: Dictionary = log.append(null, SimCommands.create_world(seed, width, height))
	var done: Dictionary = _autoplay(log, born["id"], policy, max_actions)

	var floor := 2
	while floor <= count and done["ended"] == "escaped":
		var refs: Dictionary = SimRefs.create(SimRefs.empty(), "run", done["head"], 0, "balance")
		var down: Variant = _descend(log, refs, "run", width, height)
		if down == null:
			break
		var head: Variant = SimRefs.get_ref((down as Dictionary)["refs"], "run")["head"]
		if head == null:
			break
		done = _autoplay(log, head, policy, max_actions)
		floor += 1
	return done["ended"]


## sawtooth.test.ts:45-46 survived.
func _survived(policy: Callable, depth: int) -> int:
	var n := 0
	for s: int in VALE_SEEDS:
		if _floors(s, policy, depth, VALE_WIDTH, VALE_HEIGHT, VALE_MAX_ACTIONS) == "escaped":
			n += 1
	return n


## sawtooth.test.ts:132-133 expanseSurvived.
func _expanse_survived(policy: Callable, depth: int) -> int:
	var n := 0
	for s: int in EXPANSE_SEEDS:
		if _floors(s, policy, depth, EXPANSE_WIDTH, EXPANSE_HEIGHT, EXPANSE_MAX_ACTIONS) == "escaped":
			n += 1
	return n


# ── tests/balance/sawtooth.test.ts:48-102 — the vale, 20 seeds ─────────────


## :49-52 — the door is gentle.
func test_lets_most_fighters_clear_the_first_floor_the_door_is_gentle() -> void:
	var n: int = _survived(Callable(self, "_policy_brawler"), 1)
	assert_gte(n, 14, "brawler clears floor 1 on >=14 of 20 vale seeds")


## :54-60 — the boss floor is a peak, not a wall.
func test_bites_harder_with_each_depth() -> void:
	var d1: int = _survived(Callable(self, "_policy_brawler"), 1)
	var d3: int = _survived(Callable(self, "_policy_brawler"), 3)
	assert_lt(d3, d1, "depth 3 survivors < depth 1 survivors")
	assert_gte(d3, 6, "depth 3 survivors >= 6 of 20")
	assert_lte(d3, 17, "depth 3 survivors <= 17 of 20")


## :62-71 — the Covenant's phrasing, exactly: the rusher must not dominate.
func test_never_lets_running_dominate_fighting() -> void:
	var fighter: int = _survived(Callable(self, "_policy_brawler"), 3)
	var runner: int = _survived(Callable(self, "_policy_rusher"), 3)
	assert_gte(fighter, runner, "brawler depth-3 survivors >= rusher depth-3 survivors")


## :73-78 — XP, relics and rest-at-the-stairs compound.
func test_pays_the_fighter_where_the_snowball_tells_five_floors_down() -> void:
	var fighter: int = _survived(Callable(self, "_policy_brawler"), 5)
	var runner: int = _survived(Callable(self, "_policy_rusher"), 5)
	assert_gt(fighter, runner, "brawler depth-5 survivors > rusher depth-5 survivors")


## :80-101 — the deep is earned but never given.
func test_makes_the_deep_earned_but_never_given() -> void:
	var d5: int = _survived(Callable(self, "_policy_brawler"), 5)
	assert_gte(d5, 1, "depth 5 survivors >= 1 of 20")
	assert_lte(d5, 16, "depth 5 survivors <= 16 of 20")


# ── tests/balance/sawtooth.test.ts:135-152 — the expanse, 10 seeds ─────────


## :136-138 — the door stays gentle at four times the ground.
func test_the_door_stays_gentle_at_four_times_the_ground() -> void:
	var n: int = _expanse_survived(Callable(self, "_policy_brawler"), 1)
	assert_gte(n, 7, "brawler clears floor 1 on >=7 of 10 expanse seeds")


## :140-146 — running never dominates, whatever the acreage.
func test_fighting_still_pays_at_depth_3_running_never_dominates_whatever_the_acreage() -> void:
	var fighter: int = _expanse_survived(Callable(self, "_policy_brawler"), 3)
	var runner: int = _expanse_survived(Callable(self, "_policy_rusher"), 3)
	assert_gte(fighter, runner, "brawler expanse depth-3 survivors >= rusher's")
	assert_gte(fighter, 3, "brawler expanse depth-3 survivors >= 3 of 10")
	assert_lte(fighter, 9, "brawler expanse depth-3 survivors <= 9 of 10")


## :148-151 — the deep stays earned, never given.
func test_the_deep_stays_earned_never_given() -> void:
	var d5: int = _expanse_survived(Callable(self, "_policy_brawler"), 5)
	assert_gte(d5, 1, "expanse depth 5 survivors >= 1 of 10")
	assert_lte(d5, 7, "expanse depth 5 survivors <= 7 of 10")
