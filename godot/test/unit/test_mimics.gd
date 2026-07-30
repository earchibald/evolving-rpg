extends GutTest
## The mimic's whole lie — the byte-twin of tests/core/mimics.test.ts (6
## cases across two describe blocks). Every function this suite exercises
## already shipped in an earlier task (movement.gd's create_world and
## attempt_move, apply.gd's UNMASKED and _drop_pockets, resolve_strike's
## ambush bonus) — this file is their first reference-suite witness, the
## same relationship test_secrets.gd has to mapgen.gd's two functions.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## 6 = 5 PORTED + 1 DEFERRED. Line numbers are tests/core/mimics.test.ts at
## ts-baseline.
##
## describe('the mimic') — 5, 4 PORTED + 1 DEFERRED
##   :48  is unmasked by the walk, never struck through its guise — PORTED
##   :62  holds perfectly still while hidden, whatever stands beside it —
##        PORTED
##   :67  gets the first strike one band harder — the stalker's own spring,
##        recorded — PORTED
##   :82  "reads as furniture to every tool: no shove, no mark, no burr" —
##        PORTED, after the Wave E merge. Deferred when this file was
##        written because shove_at/shot_target (2.E3d) and use_carried
##        (2.E3b) were in sibling worktrees running CONCURRENTLY and not
##        yet merged — calling them would not have compiled, which trips
##        test.sh's script-count guard for the whole suite.
##   :95  pays feign-priced XP when it dies — the disguise is threat, threat
##        is reward — PORTED
##
## describe('generation deals the lie') — 1, PORTED
##   :102 never on the teaching floor; rarely, at most once, past it —
##        wearing a plausible kind
##
## 6 ported, 0 deferred — the file's ledger closes.


func _corridor(entities: Array) -> Dictionary:
	var width := 20
	var height := 3
	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.WALL)
	for x in range(1, width - 1):
		tiles[width + x] = SimGrid.FLOOR
	var state: Dictionary = SimState.empty()
	state["grid"] = SimGrid.make(width, height, tiles)
	state["entities"] = entities
	state["turn"] = 1
	state["activeEntityId"] = entities[0]["id"] if entities.size() > 0 else null
	state["seed"] = 7
	state["depth"] = 3
	return state


func _mimic(x: int, hidden: bool = true) -> Dictionary:
	var stats: Dictionary = (SimTables.creature_stats("mimic", 1) as Dictionary).duplicate()
	return {
		"id": "mimic-1", "kind": "mimic", "pos": {"x": x, "y": 1},
		"stats": stats, "tags": (["hidden"] if hidden else ["ambush"]),
		"maxHp": int(stats["hp"]), "guise": "vital draught",
	}


func _you(x: int) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": 1},
		"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 10,
	}


func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return event


# ── describe('the mimic') ─────────────────────────────────────────────────

func test_is_unmasked_by_the_walk_never_struck_through_its_guise() -> void:
	var state: Dictionary = _corridor([_you(5), _mimic(6)])
	var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
	assert_eq(draft["type"], "UNMASKED")
	assert_true(SimCommands.ends_turn(draft))

	var after: Dictionary = SimApply.apply(state, _seal(draft))
	var it: Dictionary = SimEntity.find(after["entities"], "mimic-1")
	var tags: Array = it["tags"]
	assert_false(tags.has("hidden"))
	assert_true(tags.has("ambush"))
	# The player did not move: the reach was the whole turn.
	var player: Dictionary = SimEntity.find(after["entities"], "player")
	assert_eq(int((player["pos"] as Dictionary)["x"]), 5)


func test_holds_perfectly_still_while_hidden_whatever_stands_beside_it() -> void:
	var state: Dictionary = _corridor([_mimic(6), _you(5)])
	assert_eq(SimAi.decide(state, "mimic-1"), {"kind": "wait"})


func test_gets_the_first_strike_one_band_harder_the_stalkers_own_spring_recorded() -> void:
	# Scan seeds until the unmasked mimic's blow lands: the payload must say
	# ambush, the spring spent by the reducer like any stalker's.
	for seed in range(1, 80):
		var state: Dictionary = _corridor([_mimic(6, false), _you(5)])
		state["seed"] = seed
		var draft: Dictionary = SimCommands.attempt_move(state, "mimic-1", -1, 0)
		var payload: Dictionary = draft["payload"]
		if draft.get("type", "") != "STRIKE" or not bool(payload.get("hit", false)):
			continue
		assert_true(bool(payload["ambush"]))
		var after: Dictionary = SimApply.apply(state, _seal(draft))
		var it: Dictionary = SimEntity.find(after["entities"], "mimic-1")
		assert_false((it["tags"] as Array).has("ambush"))
		return
	assert_true(false, "no seed under 80 landed the mimic's first blow")


func test_reads_as_furniture_to_every_tool_no_shove_no_mark_no_burr() -> void:
	## ":82". Deferred by Task 2.E3c only because shove_at, shot_target and
	## use_carried lived in sibling worktrees that had not merged yet — calling
	## them would not have compiled, which trips test.sh's script-count guard
	## for the whole suite. All three have landed, so the deferral is discharged
	## here rather than left standing against tasks that are already done.
	##
	## The lie is total while `hidden` holds: a mimic is not a body any tool can
	## address. Nothing may shove it, nothing may mark it for a shot, and the
	## burr's scatter must not count it among the things it staggers.
	var you: Dictionary = _you(5)
	you["satchel"] = [{"kind": "iron burr"}]
	var state: Dictionary = _corridor([you, _mimic(6)])

	assert_null(SimCommands.shove_at(state, "player", 1, 0),
		"a hidden mimic cannot be shoved — there is nothing there to shove")
	assert_null(SimCommands.shot_target(state, "player"),
		"nor marked: a shot needs a target the shooter believes in")

	var burr: Variant = SimCommands.use_carried(state, "player", 0)
	assert_not_null(burr, "the burr itself still resolves")
	var draft: Dictionary = burr
	assert_eq(draft["type"], "ITEM_USED")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "burr")
	assert_eq(effect["staggered"], [],
		"the scatter finds nobody: furniture does not reel")


func test_pays_feign_priced_xp_when_it_dies_the_disguise_is_threat_threat_is_reward() -> void:
	var stats: Dictionary = SimTables.creature_stats("mimic", 1)
	assert_gt(SimTables.threat_of(stats, "mimic"), SimTables.threat_of(stats))


# ── describe('generation deals the lie') ──────────────────────────────────

func test_never_on_the_teaching_floor_rarely_at_most_once_past_it_wearing_a_plausible_kind() -> void:
	var held := 0
	var trials := 60
	for seed in range(1, trials + 1):
		var d1: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 1)
		var d1_opponents: Array = (d1["payload"] as Dictionary)["opponents"]
		for o: Dictionary in d1_opponents:
			assert_false(o.has("guise"), "seed %d: depth 1 wears a guise" % seed)

		var d3: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 3)
		var d3_payload: Dictionary = d3["payload"]
		var d3_opponents: Array = d3_payload["opponents"]
		var lies: Array = []
		for o: Dictionary in d3_opponents:
			if o.has("guise"):
				lies.append(o)
		assert_lte(lies.size(), 1, "seed %d: more than one lie on the floor" % seed)
		if lies.is_empty():
			continue
		held += 1
		var it: Dictionary = lies[0]
		assert_true((it["tags"] as Array).has("hidden"))
		assert_true((SimTables.mimic_guises(3) as Array).has(it["guise"]))
		# Never on a real prize's tile: the mimic IS the item of its square.
		var pos: Dictionary = it["pos"]
		var items: Array = d3_payload["items"]
		for i: Dictionary in items:
			var ipos: Dictionary = i["pos"]
			assert_false(int(ipos["x"]) == int(pos["x"]) and int(ipos["y"]) == int(pos["y"]),
				"seed %d: the mimic shares a tile with a real prize" % seed)
		# The floor admits a lie exists — like the secret room, never where.
		assert_true(str(d3_payload["story"]).contains("not what it seems"))
	# The rarity, pinned as a LITERAL count rather than as a band read off
	# MIMIC_IN. MEASURED during the Wave E review: MIMIC_IN 6 -> 8 failed ZERO
	# of 629 tests, because the ceiling was `2 * trials / MIMIC_IN` — raise the
	# constant and the ceiling comes down to meet the thinner rate.
	#
	# A band cannot be made to work at this sample size, and that is measured
	# too, not assumed. 1-in-6 over 60 floors predicts 10 with a standard
	# deviation of 2.9; this seed range actually draws 14, and 1-in-8 draws 9.
	# Any band wide enough to hold 14 also holds 9. So the count itself is the
	# assertion: sixty fixed seeds are a deterministic sample, and 14 is what
	# the shipped rarity yields from them. If generation legitimately changes,
	# this number is meant to be re-measured by hand — the same contract the
	# golden-run pin carries.
	assert_eq(trials, 60, "the count below is pinned to this many floors")
	assert_eq(held, 14,
		"1-in-6 over 60 floors: predicted 10, drawn 14 (1-in-8 would draw 9)")
