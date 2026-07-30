extends GutTest
## What a creature carries, and what spills when it dies — the byte-twin of
## tests/core/pockets.test.ts (6 cases across two describe blocks). Every
## function this suite exercises already shipped in an earlier task
## (movement.gd's create_world / _draw_pocket, apply.gd's _drop_pockets,
## already wired into STRIKE and RULE_FIRED) — this file is their first
## reference-suite witness, the same relationship test_secrets.gd has to
## mapgen.gd's two functions.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## 6 = 6 PORTED + 0 DEFERRED. Line numbers are tests/core/pockets.test.ts at
## ts-baseline.
##
## describe('the pocket spills') — 4, all PORTED
##   :52  a killing blow sets the carried thing down where the body falls —
##        PORTED
##   :70  "a slam kill spills too — any death, one law" — PORTED after the
##        Wave E merge (it needed 2.E3d's shove_at, which had not landed
##        when this file was written).
##   :79  a taken tile nudges the spill one pace by fixed order — PORTED
##   :95  the survivor keeps its pocket: no drop without a death — PORTED
##
## describe('generation deals the pockets') — 2, both PORTED
##   :110 about one in three carries; the carried kind is always a real
##        kind; the mimic always hoards
##   :134 what a body carries is not on the floor: the pocket stays out of
##        items until the death — PORTED, with one vacuous half dropped: the
##        reference also asserts `pocketKinds >= 0` on an Array.length,
##        which cannot fail (a length is never negative) and is exactly the
##        "inequality against a ceiling nothing could violate" pattern this
##        migration's own quality rules forbid adding new instances of. The
##        meaningful half — no item on the floor carries a "pocket-" id
##        before any death — is ported whole.
##
## 3 + 2 = 5 ported. 1 deferred. 5 + 1 = 6.


func _corridor(entities: Array, over: Dictionary = {}) -> Dictionary:
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
	state.merge(over, true)
	return state


func _you(x: int) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": 1},
		"stats": {"hp": 12, "might": 9, "wits": 3, "speed": 4}, "tags": [], "maxHp": 12,
	}


func _carrier(x: int, hp: int = 1) -> Dictionary:
	return {
		"id": "foe-1", "kind": "skirmisher", "pos": {"x": x, "y": 1},
		"stats": {"hp": hp, "might": 2, "wits": 1, "speed": 3}, "tags": [], "maxHp": 4,
		"pocket": {"kind": "vital draught", "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}},
	}


func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return event


func _known_kinds() -> Dictionary:
	var out: Dictionary = {}
	for p: Dictionary in SimTables.PROVISIONS:
		out[p["kind"]] = true
	for s: Dictionary in SimTables.SCROLLS:
		out[s["kind"]] = true
	for r: Dictionary in SimTables.ARMORY:
		out[r["kind"]] = true
	return out


func _find_item(items: Array, id: String) -> Variant:
	for i: Dictionary in items:
		if i["id"] == id:
			return i
	return null


# ── describe('the pocket spills') ─────────────────────────────────────────

func test_a_killing_blow_sets_the_carried_thing_down_where_the_body_falls() -> void:
	# Might 9 against hp 1: scan seeds for a landed blow.
	for seed in range(1, 40):
		var state: Dictionary = _corridor([_you(5), _carrier(6)], {"seed": seed})
		var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
		var payload: Dictionary = draft["payload"]
		if draft.get("type", "") != "STRIKE" or not bool(payload.get("hit", false)):
			continue
		var after: Dictionary = SimApply.apply(state, _seal(draft))
		var drop: Variant = _find_item(after["items"], "pocket-foe-1")
		assert_not_null(drop)
		var drop_dict: Dictionary = drop
		assert_eq(drop_dict["kind"], "vital draught")
		assert_eq(drop_dict["pos"], {"x": 6, "y": 1})
		# The kill still pays its XP beside the spill.
		var entities: Array = state["entities"]
		var carrier_stats: Dictionary = (entities[1] as Dictionary)["stats"]
		assert_eq(int(after["xp"]), SimTables.threat_of(carrier_stats, "skirmisher"))
		return
	assert_true(false, "no seed under 40 landed the blow")


func test_a_slam_kill_spills_too_any_death_one_law() -> void:
	## ":70". Deferred by Task 2.E3c only because `shove_at` lived in a sibling
	## worktree (2.E3d) that had not merged yet. It has, so the deferral is
	## discharged here rather than left standing against a finished task.
	##
	## The carrier is against the corridor's east wall, so the shove has nowhere
	## to put it and slams it instead — and a slam that finishes a wounded thing
	## is still a death, so the pocket is still set down. Any death, one law:
	## blow, slam, or rule.
	var state: Dictionary = _corridor([_you(17), _carrier(18)])
	var shoved: Variant = SimCommands.shove_at(state, "player", 1, 0)
	assert_not_null(shoved, "there is a body to shove")
	var draft: Dictionary = shoved
	assert_true(bool((draft["payload"] as Dictionary)["slammed"]),
		"nowhere to go, so it is slammed into the wall")

	var after: Dictionary = SimApply.apply(state, _seal(draft))
	assert_not_null(_find_item(after["items"], "pocket-foe-1"),
		"the slam killed it, so what it carried lies where it fell")


func test_a_taken_tile_nudges_the_spill_one_pace_by_fixed_order() -> void:
	var lying: Dictionary = {
		"id": "already", "kind": "tallow flare", "pos": {"x": 6, "y": 1},
		"grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0},
	}
	for seed in range(1, 40):
		var state: Dictionary = _corridor([_you(5), _carrier(6)], {"seed": seed, "items": [lying]})
		var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
		var payload: Dictionary = draft["payload"]
		if draft.get("type", "") != "STRIKE" or not bool(payload.get("hit", false)):
			continue
		var after: Dictionary = SimApply.apply(state, _seal(draft))
		var drop: Variant = _find_item(after["items"], "pocket-foe-1")
		assert_not_null(drop)
		# East first in the fixed order: x+1.
		assert_eq((drop as Dictionary)["pos"], {"x": 7, "y": 1})
		return
	assert_true(false, "no seed under 40 landed the blow")


func test_the_survivor_keeps_its_pocket_no_drop_without_a_death() -> void:
	for seed in range(1, 40):
		var state: Dictionary = _corridor([_you(5), _carrier(6, 4)], {"seed": seed})
		var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
		if draft.get("type", "") != "STRIKE":
			continue
		var payload: Dictionary = draft["payload"]
		if bool(payload.get("hit", false)) and int(payload.get("damage", 0)) >= 4:
			continue
		var after: Dictionary = SimApply.apply(state, _seal(draft))
		assert_null(_find_item(after["items"], "pocket-foe-1"))
		return
	assert_true(false, "no seed under 40 produced a surviving carrier")


# ── describe('generation deals the pockets') ──────────────────────────────

func test_about_one_in_three_carries_the_carried_kind_is_always_a_real_kind_the_mimic_always_hoards() -> void:
	var known: Dictionary = _known_kinds()
	var carried := 0
	var bodies := 0
	var mimics := 0
	for seed in range(1, 31):
		var born: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 3)
		var opponents: Array = (born["payload"] as Dictionary)["opponents"]
		for o: Dictionary in opponents:
			if o.has("guise"):
				mimics += 1
				assert_true(o.has("pocket"), "seed %d: the mimic carries nothing" % seed)
				continue
			bodies += 1
			if not o.has("pocket"):
				continue
			carried += 1
			var pocket: Dictionary = o["pocket"]
			assert_true(known.has(pocket["kind"]), "seed %d: unknown pocket kind %s" % [seed, pocket["kind"]])
	# The band, in LITERALS rather than read off POCKET_IN. MEASURED during the
	# Wave E review: POCKET_IN 3 -> 4 failed ZERO of 629 tests, because both
	# goalposts were `1/POCKET_IN ± 0.15` and moved down with the rate.
	#
	# The arithmetic that sets the width: one body in three is 0.333, one in
	# four is 0.250, one in two is 0.500. A band of ±0.05 around a third —
	# 0.283 to 0.383 — excludes both neighbours and still leaves room for
	# sampling noise, which over these thirty seeds is about 0.04 (132 bodies,
	# so one standard deviation is sqrt(.333*.667/132)). Measured on the
	# shipped constant: 44 of 132, dead on 0.3333.
	var rate: float = float(carried) / float(bodies)
	assert_gt(rate, 0.283, "one body in FOUR would carry at 0.250")
	assert_lt(rate, 0.383, "one body in TWO would carry at 0.500")
	assert_gt(mimics, 0)


func test_what_a_body_carries_is_not_on_the_floor_the_pocket_stays_out_of_items_until_the_death() -> void:
	var born: Dictionary = SimCommands.create_world(11, 96, 64, "player", 3)
	var payload: Dictionary = born["payload"]
	for i: Dictionary in (payload["items"] as Array):
		assert_false(str(i["id"]).begins_with("pocket-"))
