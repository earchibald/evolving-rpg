extends GutTest
## Leveling is derived, never evented — the byte-twin of tests/core/leveling.test.ts
## (9 `it(...)` blocks). XP and level are functions of the kill history,
## computed inside SimApply.apply's _credit_kills, so there is no LEVELED
## event to upcast and replay stays exact by construction. Every case here
## folds a chain and reads the consequences — which is exactly why none of
## them could port before apply.gd existed: Task 2.B3 recorded the whole
## suite as deferred in test_tables.gd's own header ("every case folds a
## chain through WORLD_INIT/STRIKE/RULE_FIRED via fold()/append()/emptyLog(),
## which needs the reducer in apply.gd"). apply.gd is written now (Task
## 2.C1); this file discharges that deferral in full and reconciles against
## it — the 9 titles below match test_tables.gd's header list one for one.
##
## Reconciliation: 9 = 9 ported + 0 deferred. One test per TS `it(...)`, same
## order, same describe grouping (comments below), so the two suites can be
## diffed by eye.
##
## SimLog does not yet have fold() (Task 2.C2, immediately after this one —
## see log.gd's own docstring: "fold() and verify_chain() need the reducer
## and join in Phase 2"). The reference's played() threads its drafts through
## emptyLog()/append()/fold(); _played() below is a hand-rolled stand-in that
## applies each draft through SimApply.apply in order from SimState.empty(),
## which is exactly what fold() will do. No log/ref structure is inspected
## anywhere in this suite, only the folded STATE, so the stand-in loses
## nothing these 9 cases need.
##
## Mechanics under test, all inside apply.gd's _credit_kills: a kill pays
## SimTables.threat_of(stats, kind) — the VICTIM's stats and kind, priced by
## verb — exactly once, on the event that took it from alive to not, and only
## when the killer is the player (a RULE_FIRED credits whoever it fired for,
## exactly like a STRIKE credits its attacker). Crossing a level applies
## SimTables.growth_at(level) once per level crossed and heals to full at
## each — the sawtooth's ease tooth. xp and level are DERIVED — no event
## payload carries them (the one exception, WORLD_INIT's carried progress
## across the stairs, is not exercised by this suite).


func _tiles(w: int, h: int) -> Array:
	var out: Array = []
	for i in range(w * h):
		out.append(SimGrid.FLOOR)
	return out


## The reference's module-level `skirmisher` const: creatureStats('skirmisher', 1).
func _skirmisher() -> Dictionary:
	return SimTables.creature_stats("skirmisher", 1)


## The reference's world(opponents): a 10x1 floor, the player at the left
## edge, one skirmisher per opponent spec, spaced out from x=2.
func _world(opponents: Array) -> Dictionary:
	var skirmisher: Dictionary = _skirmisher()
	var built: Array = []
	for i in range(opponents.size()):
		var o: Dictionary = opponents[i]
		var stats: Dictionary = skirmisher.duplicate()
		if o.has("hp"):
			stats["hp"] = o["hp"]
		built.append({
			"id": o["id"], "kind": "skirmisher", "pos": {"x": 2 + i, "y": 0},
			"stats": stats, "tags": [],
		})
	return SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 10, "height": 1, "tiles": _tiles(10, 1), "seed": 1, "items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 1, "speed": 3}, "tags": []},
		"opponents": built,
	})


## The reference's kill(targetId, damage, attackerId = 'player').
func _kill(target_id: String, damage: int, attacker_id: String = "player") -> Dictionary:
	return SimEvents.draft("STRIKE", 0, 2, {
		"attackerId": attacker_id, "targetId": target_id, "hit": true, "crit": false,
		"damage": damage, "roll": 15, "needed": 9,
	})


## The reference's hurt(targetId, damage) — kill() under a different name,
## for a blow that does not finish the target.
func _hurt(target_id: String, damage: int) -> Dictionary:
	return _kill(target_id, damage)


## Hand-rolled fold pending Task 2.C2 (see file docstring): applies each
## draft through SimApply.apply in order, starting from SimState.empty().
func _played(drafts: Array) -> Dictionary:
	var state: Dictionary = SimState.empty()
	for d: Dictionary in drafts:
		state = SimApply.apply(state, d)
	return state


# describe('experience arrives with the kill') ------------------------------

func test_pays_the_victims_threat_value_exactly() -> void:
	var state: Dictionary = _played([_world([{"id": "a"}]), _kill("a", 99)])
	assert_eq(state["xp"], SimTables.threat_of(_skirmisher(), "skirmisher"))


func test_pays_nothing_for_a_wound_that_does_not_finish() -> void:
	var state: Dictionary = _played([_world([{"id": "a"}]), _hurt("a", 1)])
	assert_eq(state["xp"], 0)


func test_pays_nothing_when_creatures_kill_each_other() -> void:
	var state: Dictionary = _played([_world([{"id": "a"}, {"id": "b"}]), _kill("a", 99, "b")])
	assert_eq(state["xp"], 0)


func test_pays_for_a_kill_a_rule_made_when_the_player_owned_the_rules_firing() -> void:
	var fired: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "a", "to": 0}],
	})
	var state: Dictionary = _played([_world([{"id": "a", "hp": 2}]), fired])
	var wounded: Dictionary = _skirmisher().duplicate()
	wounded["hp"] = 2
	assert_eq(state["xp"], SimTables.threat_of(wounded, "skirmisher"))


func test_does_not_pay_twice_for_a_body() -> void:
	var state: Dictionary = _played([_world([{"id": "a"}]), _kill("a", 99), _kill("a", 99)])
	assert_eq(state["xp"], SimTables.threat_of(_skirmisher(), "skirmisher"))


# describe('crossing a threshold') -------------------------------------------

## Enough weak kills to cross XP_TO_REACH[2]. NOTE the reference's own
## perKill is the UNPRICED threat_of(skirmisher) — no kind argument — not
## the priced value the reducer actually pays per kill (see
## test_pays_the_victims_threat_value_exactly above, which passes the kind
## and gets a higher number). Ported exactly as written: `needed` overshoots
## the real per-kill price on purpose, which is what proves leveling rather
## than merely arithmetic.
func _to_level_2() -> Array:
	var per_kill: int = SimTables.threat_of(_skirmisher())
	# Integer ceiling division of positive ints — exact for Math.ceil(a / b).
	var needed: int = (int(SimTables.XP_TO_REACH[2]) + per_kill - 1) / per_kill
	var foes: Array = []
	for i in range(needed):
		foes.append({"id": "f%d" % i})
	var drafts: Array = [_world(foes)]
	for f: Dictionary in foes:
		drafts.append(_kill(f["id"], 99))
	return drafts


func test_raises_the_level_when_the_xp_arrives() -> void:
	var state: Dictionary = _played(_to_level_2())
	assert_true(int(state["level"]) >= 2)


func test_applies_the_growth_table_to_the_player() -> void:
	var state: Dictionary = _played(_to_level_2())
	var you: Dictionary = (state["entities"] as Array)[0]
	var g: Dictionary = SimTables.growth_at(2)
	# The reference adds a trailing `+ (state.level >= 3 ? 0 : 0)` to this
	# expected value — always zero on either branch of that ternary — so it
	# contributes nothing and is omitted here rather than transliterated into
	# a GDScript ternary that would only echo dead code.
	assert_eq(int(you["maxHp"]), 10 + int(g["hp"]) * (int(state["level"]) - 1))
	var stats: Dictionary = you["stats"]
	assert_true(int(stats["might"]) + int(stats["speed"]) > 3 + 3)


func test_heals_to_full_at_the_moment_of_leveling_the_ease_tooth() -> void:
	# Take a wound first, then cross the threshold.
	var per_kill: int = SimTables.threat_of(_skirmisher())
	var needed: int = (int(SimTables.XP_TO_REACH[2]) + per_kill - 1) / per_kill
	var foes: Array = []
	for i in range(needed):
		foes.append({"id": "f%d" % i})
	var wound_me: Dictionary = SimEvents.draft("STRIKE", 0, 2, {
		"attackerId": "f0", "targetId": "player", "hit": true, "crit": false,
		"damage": 6, "roll": 15, "needed": 9,
	})
	var drafts: Array = [_world(foes), wound_me]
	for f: Dictionary in foes:
		drafts.append(_kill(f["id"], 99))
	var state: Dictionary = _played(drafts)
	var you: Dictionary = (state["entities"] as Array)[0]
	var stats: Dictionary = you["stats"]
	assert_eq(stats["hp"], you["maxHp"])


func test_starts_every_world_at_level_1_with_no_xp() -> void:
	var state: Dictionary = _played([_world([{"id": "a"}])])
	assert_eq(state["level"], 1)
	assert_eq(state["xp"], 0)
