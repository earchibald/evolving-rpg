extends GutTest
## The stance law — the byte-twin of tests/core/volley-stance.test.ts. One test
## per TS `it(...)`, in the TS file's order, so the two suites can be diffed by
## eye.
##
## Covenant M8's reducer half: ONE STANCE PER BODY; waiting holds a draw;
## everything else the holder does — and everything that lands on them — shakes
## it loose.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 12 cases across five describe blocks.
## 12 = 12 PORTED + 0 DEFERRED. Line numbers are
## tests/core/volley-stance.test.ts at ts-baseline.
##
## describe('one stance per body') — 2
##   :53  DRAWN writes the tag and evicts a brace
##   :59  BRACED evicts a draw
##
## describe('what the holder does') — 3
##   :67  a move drops the draw
##   :74  a wait holds the draw — the archer may stand at full draw
##   :82  a melee swing drops the attacker's draw
##
## describe('what lands on the holder') — 3
##   :89  a landed, damaging blow shakes the target's draw loose
##   :94  a miss leaves the draw standing
##   :99  a shove's slam staggers, and the reel shakes the draw loose
##
## describe('the mode gates') — 3
##   :109 a ranged miss against a set guard does not stagger the far shooter
##   :114 a melee miss against a set guard still staggers — overcommitment is a
##        fact about bodies
##   :119 a v3 strike without a mode folds as melee — old chains read unchanged
##
## describe('the shot is still a blow') — 1
##   :126 reduces hit points, and a killing shot pays XP like any kill
##
## ── Why a reducer suite lives in a commands task ──────────────────────────
## Every case here drives `SimApply` rather than `SimStances`, and the plan
## still hands the SUITE to 2.E3d — correctly, because these twelve are the
## other half of this family's contract: the commands write DRAWN, BRACED,
## SHOVE and a ranged STRIKE, and this is the only file in the migration that
## says what the reducer does when it reads one. test_apply.gd's own table
## drives all 25 event types through four structural LAWS (purity, shape, no
## fractions, absent keys) and asserts no stance BEHAVIOUR at all, so without
## this file the stance law would ship with no witness anywhere.
##
## ── The ABSENT `mode`, and why :119 is not a version test ─────────────────
## The reference builds :119's event with `schemaVersion: 3`, but nothing in
## the reducer reads the version — what makes it fold as melee is that the
## payload has NO `mode` key at all, and `SimApply._or(p.get("mode"), "melee")`
## reads an absent key as melee. The version is set here for fidelity to the
## reference's bytes; the absent key is the thing under test. This is THE
## ABSENT-KEY LAW at work in a live branch: a `mode` of null instead of an
## absent `mode` would fold identically here and diverge in the encoder.


var _seq := 0


## The reference's ev(): a payload sealed into a chain-shaped event.
func _ev(type: String, payload: Dictionary, version: Variant = null) -> Dictionary:
	_seq += 1
	var event: Dictionary = SimEvents.draft(type, 0, 0, payload)
	if version != null:
		event["schemaVersion"] = int(version)
	event["id"] = "t%d" % _seq
	event["parent"] = null
	event["seq"] = _seq
	return event


## The reference's world(): a 6x1 corridor, the player at one end and a slinger
## three tiles along, born with whatever tags the case needs.
func _world(player_tags: Array = [], foe_tags: Array = []) -> Dictionary:
	var tiles: Array = []
	for i in range(6):
		tiles.append(SimGrid.FLOOR)
	return SimApply.apply(SimState.empty(), _ev("WORLD_INIT", {
		"width": 6, "height": 1,
		"tiles": tiles,
		"seed": 7,
		"items": [],
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": player_tags,
		},
		"opponents": [{
			"id": "foe-1", "kind": "slinger", "pos": {"x": 3, "y": 0},
			"stats": {"hp": 3, "might": 2, "wits": 2, "speed": 2}, "tags": foe_tags,
		}],
	}))


func _tags_of(state: Dictionary, id: String) -> Array:
	return SimEntity.find(state["entities"], id)["tags"]


func _drawn(id: String) -> Dictionary:
	return _ev("DRAWN", {"entityId": id})


func _braced(id: String) -> Dictionary:
	return _ev("BRACED", {"entityId": id})


## The reference's strike(): a landed melee-shaped blow by default, with the
## fields each case cares about overridden. `over` may carry `mode`; leaving it
## out is what makes the payload MODE-ABSENT, which is a real branch.
func _strike(attacker_id: String, target_id: String, over: Dictionary = {},
		version: Variant = null) -> Dictionary:
	var p: Dictionary = {
		"attackerId": attacker_id, "targetId": target_id,
		"roll": 10, "needed": 8, "hit": true, "crit": false, "damage": 1,
	}
	p.merge(over, true)
	return _ev("STRIKE", p, version)


# ── describe('one stance per body') ───────────────────────────────────────

func test_drawn_writes_the_tag_and_evicts_a_brace() -> void:
	var s: Dictionary = SimApply.apply(_world([], ["braced"]), _drawn("foe-1"))
	assert_has(_tags_of(s, "foe-1"), "drawn")
	assert_does_not_have(_tags_of(s, "foe-1"), "braced")


func test_braced_evicts_a_draw() -> void:
	var s: Dictionary = SimApply.apply(_world(["drawn"]), _braced("player"))
	assert_has(_tags_of(s, "player"), "braced")
	assert_does_not_have(_tags_of(s, "player"), "drawn")


# ── describe('what the holder does') ──────────────────────────────────────

func test_a_move_drops_the_draw() -> void:
	var s: Dictionary = SimApply.apply(_world(["drawn"]), _ev("MOVE", {
		"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0},
	}))
	assert_does_not_have(_tags_of(s, "player"), "drawn")


func test_a_wait_holds_the_draw_the_archer_may_stand_at_full_draw() -> void:
	var s: Dictionary = SimApply.apply(_world(["drawn"]), _ev("WAIT", {"entityId": "player"}))
	assert_has(_tags_of(s, "player"), "drawn", "stillness is the draw's one exception")
	# ...while the same wait still spends a brace, the old law untouched.
	var b: Dictionary = SimApply.apply(_world(["braced"]), _ev("WAIT", {"entityId": "player"}))
	assert_does_not_have(_tags_of(b, "player"), "braced")


func test_a_melee_swing_drops_the_attackers_draw() -> void:
	var s: Dictionary = SimApply.apply(_world(["drawn"]), _strike("player", "foe-1", {
		"mode": "melee", "damage": 0, "hit": false, "roll": 2, "needed": 8,
	}))
	assert_does_not_have(_tags_of(s, "player"), "drawn")


# ── describe('what lands on the holder') ──────────────────────────────────

func test_a_landed_damaging_blow_shakes_the_targets_draw_loose() -> void:
	var s: Dictionary = SimApply.apply(_world([], ["drawn"]),
		_strike("player", "foe-1", {"mode": "melee", "damage": 1}))
	assert_does_not_have(_tags_of(s, "foe-1"), "drawn")


func test_a_miss_leaves_the_draw_standing() -> void:
	var s: Dictionary = SimApply.apply(_world([], ["drawn"]),
		_strike("player", "foe-1", {"mode": "melee", "hit": false, "damage": 0, "roll": 2}))
	assert_has(_tags_of(s, "foe-1"), "drawn")


func test_a_shoves_slam_staggers_and_the_reel_shakes_the_draw_loose() -> void:
	var s: Dictionary = SimApply.apply(_world([], ["drawn"]), _ev("SHOVE", {
		"shoverId": "player", "targetId": "foe-1",
		"to": null, "slammed": true, "struckId": null,
	}))
	assert_has(_tags_of(s, "foe-1"), "staggered")
	assert_does_not_have(_tags_of(s, "foe-1"), "drawn")


# ── describe('the mode gates') ────────────────────────────────────────────

func test_a_ranged_miss_against_a_set_guard_does_not_stagger_the_far_shooter() -> void:
	var s: Dictionary = SimApply.apply(_world(["braced"]), _strike("foe-1", "player", {
		"mode": "ranged", "hit": false, "damage": 0, "roll": 2, "needed": 14,
	}))
	assert_does_not_have(_tags_of(s, "foe-1"), "staggered",
		"the far shooter never lent their body to the swing")


func test_a_melee_miss_against_a_set_guard_still_staggers() -> void:
	var s: Dictionary = SimApply.apply(_world(["braced"]), _strike("foe-1", "player", {
		"mode": "melee", "hit": false, "damage": 0, "roll": 2, "needed": 14,
	}))
	assert_has(_tags_of(s, "foe-1"), "staggered", "overcommitment is a fact about bodies")


func test_a_v3_strike_without_a_mode_folds_as_melee() -> void:
	# NO `mode` key at all — see this file's header. The v3 version number is
	# the reference's bytes; the ABSENT key is the branch.
	var event: Dictionary = _strike("foe-1", "player",
		{"hit": false, "damage": 0, "roll": 2, "needed": 14}, 3)
	assert_false((event["payload"] as Dictionary).has("mode"), "the payload is mode-absent")
	var s: Dictionary = SimApply.apply(_world(["braced"]), event)
	assert_has(_tags_of(s, "foe-1"), "staggered", "old chains read unchanged")


# ── describe('the shot is still a blow') ──────────────────────────────────

func test_reduces_hit_points_and_a_killing_shot_pays_xp_like_any_kill() -> void:
	var before: Dictionary = _world()
	var s: Dictionary = SimApply.apply(before,
		_strike("player", "foe-1", {"mode": "ranged", "damage": 3}))
	assert_eq(int((SimEntity.find(s["entities"], "foe-1")["stats"] as Dictionary)["hp"]), 0)
	assert_gt(int(s["xp"]), int(before["xp"]), "distance does not cheapen a kill")
