extends GutTest
## holds, fire_rules, apply_resolved — the byte-twin of tests/canon/interpret.test.ts
## (22 `it(...)` blocks), PLUS the 19 cases Task 2.A4 deferred here from
## tests/canon/vocabulary.test.ts (Step 1b of Task 2.B6 — see
## godot/test/unit/test_vocabulary.gd's own docstring for the authoritative
## list of which 19 and why). One test per TS `it(...)`, in each source file's
## own order, so the suites can be diffed by eye.
##
## Reconciliation: interpret.test.ts has 22 cases, and ALL 22 are now ported.
## 15 landed when this file was first written (in TS order, under "what
## fires" / "conditions" / "the past does not change" / "who it fires for").
## The remaining 7 all called the reducer `apply()`, which did not exist in
## sim/ yet, and were deferred to Task 2.C1 — now discharged, appended below
## in the reference's own section order:
##   - describe('applying what fired'), all 5: "resolves a heal to an
##     absolute figure, clamped at the ceiling", "harms, without going below
##     zero", "kills by the same path as a blow — dead is dead", "leaves
##     state alone for a spoken line", "does not mutate the state it was
##     given"
##   - describe('the past does not change'), the 2 of 3 that needed apply():
##     "applies the recorded effect even when the rule would no longer
##     match", "applies an effect for a rule the world no longer holds at
##     all" (the third case in this describe block, "never treats a firing
##     as a trigger for more firing", needed only fire_rules and was ported
##     from the start)
##
## The adopted 19 are ALL portable now — none of them touch apply(); the one
## that looks like it might ("raises the ceiling without raising current
## health") calls `applyResolved`, which is THIS file's own apply_resolved,
## not the reducer.
##
## tests/canon/rules-in-log.test.ts (11 cases, the third suite Task 2.C1
## hand-off B ports) lives entirely in test_rules_in_log.gd — see that
## file's own header for its reconciliation; none of its cases belong here.
##
## Faithfulness note: "never treats a firing as a trigger for more firing"
## (interpret.test.ts:205) asserts against a LOCAL 4-element literal
## (interpret.test.ts:213: `const triggers: string[] = ['WAIT', 'STRIKE',
## 'MOVE_BLOCKED', 'ITEM_TAKEN']`), not the real exported TRIGGERS list — a
## strictly weaker check than `SimRule.TRIGGERS.has('RULE_FIRED')` would be.
## Reproduced exactly as written below rather than strengthened: this is a
## port, and the comment directly above it in the reference ("RULE_FIRED is
## not in the Trigger union at all, which is the strongest form of this
## guarantee: it cannot be expressed") is the actual claim under test, which
## the local literal only illustrates.


## Byte-identical in both source TS files (interpret.test.ts's `rule()` and
## vocabulary.test.ts's `rule()`), so one helper serves both halves of this
## file.
const _RULE_BASE := {
	"id": "r", "when": "WAIT", "require": [], "then": [{"kind": "heal", "n": 1}],
	"provenance": {"events": ["e"], "notes": [], "because": "testing"},
	"ratifiedAt": "2026-07-25T00:00:00.000Z",
}


func _rule(over: Dictionary = {}) -> Dictionary:
	var d: Dictionary = _RULE_BASE.duplicate(true)
	for k: String in over:
		d[k] = over[k]
	var r: Dictionary = SimRule.validate(d)
	if SimRule.is_rejected(r):
		fail_test("_rule() setup was unexpectedly rejected: %s" % r["rejected"])
	return r


## Also byte-identical between the two source files (interpret.test.ts's
## `entity()` and vocabulary.test.ts's `being()` — same body, different name).
func _entity(id: String, x: int, y: int, hp: int, max_hp: int = -1) -> Dictionary:
	var mhp: int = hp if max_hp == -1 else max_hp
	return {
		"id": id,
		"kind": "you" if id == "player" else "thing",
		"pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 3, "wits": 1, "speed": 2},
		"tags": [],
		"maxHp": mhp,
	}


func _rule_ids(events: Array) -> Array:
	var out: Array = []
	for e: Dictionary in events:
		out.append(e["payload"]["ruleId"])
	return out


## interpret.test.ts's own fixture: a fixed 8x8 open floor. Not interchangeable
## with vocabulary.test.ts's `world()` below (different dimensions, no opts) —
## kept separate rather than unified, matching how the two TS files never
## shared this helper either.
func _state_with(rules: Array, entities: Variant = null) -> Dictionary:
	var ents: Array = entities if entities != null else [_entity("player", 0, 0, 5, 10)]
	var tiles: Array = []
	for _i: int in 64:
		tiles.append(SimGrid.FLOOR)
	return {
		"grid": SimGrid.make(8, 8, tiles),
		"entities": ents,
		"items": [],
		"turn": 1,
		"activeEntityId": "player",
		"seed": 1,
		"rngCounter": 7,
		"rules": rules,
		"xp": 0,
		"level": 1,
		"depth": 1,
		"gold": 0,
		"story": "",
		"motif": null,
		"bodies": [],
		"bible": null,
		"smoke": null,
		"traps": [],
		"alarm": null,
		"unveiled": [],
	}


## what fires ------------------------------------------------------------------

func test_produces_nothing_when_the_world_has_no_rules() -> void:
	assert_eq(SimInterpret.fire_rules(_state_with([]), "WAIT", "player"), [])


func test_fires_a_rule_whose_trigger_matches_and_not_one_whose_does_not() -> void:
	var s: Dictionary = _state_with([_rule({"id": "on-wait", "when": "WAIT"}), _rule({"id": "on-strike", "when": "STRIKE"})])
	assert_eq(_rule_ids(SimInterpret.fire_rules(s, "WAIT", "player")), ["on-wait"])
	assert_eq(_rule_ids(SimInterpret.fire_rules(s, "STRIKE", "player")), ["on-strike"])


func test_fires_in_ratification_order() -> void:
	var s: Dictionary = _state_with([_rule({"id": "first"}), _rule({"id": "second"}), _rule({"id": "third"})])
	assert_eq(_rule_ids(SimInterpret.fire_rules(s, "WAIT", "player")), ["first", "second", "third"])


func test_fires_each_rule_at_most_once_per_trigger() -> void:
	var s: Dictionary = _state_with([_rule({"id": "only-once"})])
	assert_eq(SimInterpret.fire_rules(s, "WAIT", "player").size(), 1)


func test_draws_no_randomness_ever() -> void:
	var s: Dictionary = _state_with([_rule({"id": "a"}), _rule({"id": "b", "then": [{"kind": "harm", "n": 3}]})])
	for e: Dictionary in SimInterpret.fire_rules(s, "WAIT", "player"):
		assert_eq(e["rngDraws"], 0)
		assert_eq(e["rngCounter"], s["rngCounter"])


func test_carries_the_recorded_effects_not_a_reference_to_the_rule() -> void:
	var s: Dictionary = _state_with([_rule({"id": "a", "then": [{"kind": "heal", "n": 2}]})])
	var fired: Array = SimInterpret.fire_rules(s, "WAIT", "player")
	assert_eq(fired[0]["payload"]["outcomes"], [{"kind": "health", "entityId": "player", "to": 7}])


## conditions --------------------------------------------------------------------

func _near_entities() -> Array:
	return [_entity("player", 0, 0, 5, 10), _entity("beast", 2, 0, 4)]


func _far_entities() -> Array:
	return [_entity("player", 0, 0, 5, 10), _entity("beast", 7, 7, 4)]


func test_reads_distance_to_the_nearest_living_creature() -> void:
	assert_true(SimInterpret.holds({"kind": "creatureWithin", "n": 3}, _state_with([], _near_entities()), "player"))
	assert_false(SimInterpret.holds({"kind": "creatureWithin", "n": 3}, _state_with([], _far_entities()), "player"))
	assert_true(SimInterpret.holds({"kind": "noCreatureWithin", "n": 3}, _state_with([], _far_entities()), "player"))
	assert_false(SimInterpret.holds({"kind": "noCreatureWithin", "n": 3}, _state_with([], _near_entities()), "player"))


func test_ignores_the_dead_when_measuring_what_is_near() -> void:
	var corpse: Array = [_entity("player", 0, 0, 5, 10), _entity("beast", 1, 0, 0)]
	assert_true(SimInterpret.holds({"kind": "noCreatureWithin", "n": 4}, _state_with([], corpse), "player"))


func test_reads_hit_points() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 5, 10)])
	assert_true(SimInterpret.holds({"kind": "hpAtMost", "n": 5}, s, "player"))
	assert_false(SimInterpret.holds({"kind": "hpAtMost", "n": 4}, s, "player"))
	assert_true(SimInterpret.holds({"kind": "hpAtLeast", "n": 5}, s, "player"))
	assert_false(SimInterpret.holds({"kind": "hpAtLeast", "n": 6}, s, "player"))


func test_requires_every_condition_never_merely_one() -> void:
	# AND, not OR. A player who reads "with X and Y" and gets "with X or Y"
	# has been lied to about their own game.
	var both: Array = [{"kind": "hpAtMost", "n": 5}, {"kind": "noCreatureWithin", "n": 3}]
	var one_true: Dictionary = _state_with([_rule({"require": both})], _near_entities())  # hp 5 yes, creature near no
	assert_eq(SimInterpret.fire_rules(one_true, "WAIT", "player"), [])

	var both_true: Dictionary = _state_with([_rule({"require": both})], _far_entities())
	assert_eq(SimInterpret.fire_rules(both_true, "WAIT", "player").size(), 1)


func test_does_not_fire_when_a_condition_fails() -> void:
	var s: Dictionary = _state_with([_rule({"require": [{"kind": "hpAtLeast", "n": 9}]})])
	assert_eq(SimInterpret.fire_rules(s, "WAIT", "player"), [])


func test_holds_is_total_an_unknown_actor_makes_conditions_false_never_an_exception() -> void:
	var s: Dictionary = _state_with([])
	assert_false(SimInterpret.holds({"kind": "hpAtMost", "n": 5}, s, "nobody"))


## the past does not change --------------------------------------------------
## 2 of this describe block's 3 cases need apply() and are deferred — see the
## file docstring above.

func test_never_treats_a_firing_as_a_trigger_for_more_firing() -> void:
	# A rule whose effect satisfies its own condition would otherwise loop
	# forever. RULE_FIRED is not in SimRule.TRIGGERS at all, which is the
	# strongest form of this guarantee: it cannot be expressed.
	var self_feeding: Dictionary = _state_with(
		[_rule({"when": "WAIT", "require": [{"kind": "hpAtMost", "n": 9}], "then": [{"kind": "heal", "n": 1}]})],
		[_entity("player", 0, 0, 5, 10)])
	# Ported exactly as interpret.test.ts:213 wrote it: a local 4-element
	# literal, not the real TRIGGERS export — see the file docstring's
	# faithfulness note.
	var triggers: Array = ["WAIT", "STRIKE", "MOVE_BLOCKED", "ITEM_TAKEN"]
	assert_false(triggers.has("RULE_FIRED"))
	# And firing is a single pass: one rule, one event, no cascade.
	assert_eq(SimInterpret.fire_rules(self_feeding, "WAIT", "player").size(), 1)


## who it fires for ------------------------------------------------------------

func test_records_the_actor_the_trigger_belonged_to() -> void:
	var s: Dictionary = _state_with([_rule({"id": "a"})], [_entity("player", 0, 0, 5, 10), _entity("beast", 4, 4, 4)])
	assert_eq(SimInterpret.fire_rules(s, "WAIT", "beast")[0]["payload"]["actorId"], "beast")


func test_measures_conditions_from_the_actor_not_always_from_the_player() -> void:
	var entities: Array = [_entity("player", 0, 0, 5, 10), _entity("beast", 7, 0, 4), _entity("other", 6, 0, 4)]
	# From beast, other is one square away; from the player it is six.
	assert_true(SimInterpret.holds({"kind": "creatureWithin", "n": 2}, _state_with([], entities), "beast"))
	assert_false(SimInterpret.holds({"kind": "creatureWithin", "n": 2}, _state_with([], entities), "player"))


## ═══ adopted from tests/canon/vocabulary.test.ts (Step 1b of Task 2.B6) ═══
## These 19 cases were deferred by Task 2.A4 because their actual subject is
## this file, not the vocabulary: 10 drive `holds`, 9 drive
## `fire_rules`/`apply_resolved`. Ported in the TS file's order, using
## vocabulary.test.ts's OWN `world()` fixture shape (an 8x1 corridor with
## exitAt/wallAt/turn/rules/depth/motif/bodies overrides) rather than this
## file's `_state_with` above — the two TS helpers are not interchangeable
## (stateWith is a fixed 8x8 square with no opts at all), while `rule()` and
## `being()`/`entity()` really are byte-identical between the two TS files, so
## this section reuses `_rule`/`_entity` from above rather than redefining
## them.

func _world(entities: Variant = null, opts: Dictionary = {}) -> Dictionary:
	var ents: Array = entities if entities != null else [_entity("player", 0, 0, 5, 10)]
	var tiles: Array = []
	for _i: int in 8:
		tiles.append(SimGrid.FLOOR)
	if opts.has("exitAt"):
		tiles[opts["exitAt"] as int] = SimGrid.EXIT
	if opts.has("wallAt"):
		tiles[opts["wallAt"] as int] = SimGrid.WALL
	return {
		"grid": SimGrid.make(8, 1, tiles),
		"entities": ents,
		"items": [],
		"turn": opts.get("turn", 1),
		"activeEntityId": "player",
		"seed": 1,
		"rngCounter": 0,
		"rules": opts.get("rules", []),
		"xp": 0,
		"level": 1,
		"depth": opts.get("depth", 1),
		"gold": 0,
		"story": "",
		"bible": null,
		"smoke": null,
		"traps": [],
		"alarm": null,
		"unveiled": [],
		"motif": opts.get("motif"),
		"bodies": opts.get("bodies", []),
	}


## health as a proportion -------------------------------------------------------

func test_reads_a_fraction_of_the_ceiling_not_an_absolute() -> void:
	var half: Dictionary = _world([_entity("player", 0, 0, 5, 10)])
	assert_true(SimInterpret.holds({"kind": "hpBelowPercent", "n": 60}, half, "player"))
	assert_false(SimInterpret.holds({"kind": "hpBelowPercent", "n": 50}, half, "player"))
	assert_true(SimInterpret.holds({"kind": "hpAbovePercent", "n": 40}, half, "player"))
	assert_false(SimInterpret.holds({"kind": "hpAbovePercent", "n": 50}, half, "player"))


func test_does_not_divide_by_a_ceiling_of_zero() -> void:
	# Written first with hp 0 and a ceiling of 0, this could not fail: the
	# division gives NaN and every NaN comparison is already false. The case
	# that actually distinguishes the guard is health ABOVE a zero ceiling,
	# where an unguarded "above 50%" would read Infinity and come back true
	# for a thing with no health at all.
	var impossible: Dictionary = _world([_entity("player", 0, 0, 3, 0)])
	assert_false(SimInterpret.holds({"kind": "hpAbovePercent", "n": 50}, impossible, "player"))
	assert_false(SimInterpret.holds({"kind": "hpBelowPercent", "n": 50}, impossible, "player"))

	var empty: Dictionary = _world([_entity("player", 0, 0, 0, 0)])
	assert_false(SimInterpret.holds({"kind": "hpAbovePercent", "n": 50}, empty, "player"))
	assert_false(SimInterpret.holds({"kind": "hpBelowPercent", "n": 50}, empty, "player"))


## reading the rest of the world -------------------------------------------------

func test_counts_what_is_still_alive() -> void:
	var busy: Dictionary = _world([_entity("player", 0, 0, 5, 10), _entity("a", 3, 0, 4), _entity("b", 5, 0, 0)])
	assert_true(SimInterpret.holds({"kind": "creaturesAtLeast", "n": 1}, busy, "player"))
	assert_false(SimInterpret.holds({"kind": "creaturesAtLeast", "n": 2}, busy, "player"))
	assert_true(SimInterpret.holds({"kind": "creaturesAtMost", "n": 1}, busy, "player"))


func test_measures_the_way_out() -> void:
	var w: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"exitAt": 6})
	assert_true(SimInterpret.holds({"kind": "exitWithin", "n": 6}, w, "player"))
	assert_false(SimInterpret.holds({"kind": "exitWithin", "n": 5}, w, "player"))
	assert_true(SimInterpret.holds({"kind": "exitBeyond", "n": 5}, w, "player"))


func test_says_the_exit_is_unreachably_far_on_a_map_without_one() -> void:
	var w: Dictionary = _world([_entity("player", 0, 0, 5, 10)])
	assert_false(SimInterpret.holds({"kind": "exitWithin", "n": 40}, w, "player"))
	assert_true(SimInterpret.holds({"kind": "exitBeyond", "n": 40}, w, "player"))


func test_reads_the_turn_count_and_the_stats_including_wits() -> void:
	var late: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"turn": 30})
	assert_true(SimInterpret.holds({"kind": "turnAtLeast", "n": 30}, late, "player"))
	assert_false(SimInterpret.holds({"kind": "turnAtLeast", "n": 31}, late, "player"))
	# wits had no job at all before this — now a rule can gate on it.
	assert_true(SimInterpret.holds({"kind": "statAtLeast", "stat": "wits", "n": 1}, late, "player"))
	assert_false(SimInterpret.holds({"kind": "statAtLeast", "stat": "wits", "n": 2}, late, "player"))
	assert_true(SimInterpret.holds({"kind": "statAtLeast", "stat": "maxHp", "n": 10}, late, "player"))


func test_reads_whether_the_blow_landed() -> void:
	var w: Dictionary = _world()
	assert_true(SimInterpret.holds({"kind": "blowLanded"}, w, "player", {"hit": true}))
	assert_false(SimInterpret.holds({"kind": "blowLanded"}, w, "player", {"hit": false}))
	assert_true(SimInterpret.holds({"kind": "blowMissed"}, w, "player", {"hit": false}))
	# No blow at all is neither landed nor missed.
	assert_false(SimInterpret.holds({"kind": "blowLanded"}, w, "player", {}))
	assert_false(SimInterpret.holds({"kind": "blowMissed"}, w, "player", {}))


## effects that reach past the actor ----------------------------------------------

func _pair() -> Array:
	return [_entity("player", 2, 0, 5, 10), _entity("beast", 3, 0, 6, 6)]


func test_hurts_the_other_party() -> void:
	var w: Dictionary = _world(_pair(), {"rules": [_rule({"when": "STRIKE", "then": [{"kind": "harmOther", "n": 4}]})]})
	var ev: Array = SimInterpret.fire_rules(w, "STRIKE", "player", {"otherId": "beast", "hit": true})
	assert_eq(ev[0]["payload"]["outcomes"], [{"kind": "health", "entityId": "beast", "to": 2}])


func test_shoves_the_other_party_directly_away() -> void:
	var w: Dictionary = _world(_pair(), {"rules": [_rule({"when": "STRIKE", "then": [{"kind": "push", "n": 2}]})]})
	var ev: Array = SimInterpret.fire_rules(w, "STRIKE", "player", {"otherId": "beast", "hit": true})
	assert_eq(ev[0]["payload"]["outcomes"], [{"kind": "move", "entityId": "beast", "to": {"x": 5, "y": 0}}])


func test_stops_a_shove_at_a_wall_rather_than_through_it() -> void:
	var w: Dictionary = _world(_pair(), {"wallAt": 5, "rules": [_rule({"when": "STRIKE", "then": [{"kind": "push", "n": 3}]})]})
	var ev: Array = SimInterpret.fire_rules(w, "STRIKE", "player", {"otherId": "beast", "hit": true})
	assert_eq(ev[0]["payload"]["outcomes"], [{"kind": "move", "entityId": "beast", "to": {"x": 4, "y": 0}}])


func test_fires_nothing_when_a_shove_has_nowhere_to_go() -> void:
	# Against a wall already. A rule that produces no outcome writes no event,
	# rather than an event recording that nothing happened.
	var w: Dictionary = _world([_entity("player", 2, 0, 5, 10), _entity("beast", 3, 0, 6, 6)],
		{"wallAt": 4, "rules": [_rule({"when": "STRIKE", "then": [{"kind": "push", "n": 2}]})]})
	assert_eq(SimInterpret.fire_rules(w, "STRIKE", "player", {"otherId": "beast", "hit": true}).size(), 0)


func test_raises_and_lowers_a_stat_and_never_drains_one_to_nothing() -> void:
	var grant: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"rules": [_rule({"then": [{"kind": "grant", "stat": "might", "n": 2}]})]})
	assert_eq(SimInterpret.fire_rules(grant, "WAIT", "player")[0]["payload"]["outcomes"],
		[{"kind": "stat", "entityId": "player", "stat": "might", "to": 5}])

	# might is 3; draining 5 would leave 0 — never hitting anything again.
	var drain: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"rules": [_rule({"then": [{"kind": "drain", "stat": "might", "n": 5}]})]})
	assert_eq(SimInterpret.fire_rules(drain, "WAIT", "player")[0]["payload"]["outcomes"],
		[{"kind": "stat", "entityId": "player", "stat": "might", "to": 1}])


func test_raises_the_ceiling_without_raising_current_health() -> void:
	var w: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"rules": [_rule({"then": [{"kind": "grant", "stat": "maxHp", "n": 3}]})]})
	var outcomes: Array = SimInterpret.fire_rules(w, "WAIT", "player")[0]["payload"]["outcomes"]
	var after: Dictionary = SimInterpret.apply_resolved(w, outcomes)
	var after_entities: Array = after["entities"]
	var after_player: Dictionary = after_entities[0]
	assert_eq(after_player["maxHp"], 13)
	assert_eq((after_player["stats"] as Dictionary)["hp"], 5)


func test_drops_an_effect_that_has_nobody_to_act_on() -> void:
	var w: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"rules": [_rule({"when": "STRIKE", "then": [{"kind": "harmOther", "n": 3}]})]})
	assert_eq(SimInterpret.fire_rules(w, "STRIKE", "player", {"hit": true}).size(), 0)


## rules compose within one pass --------------------------------------------------

func test_lets_a_second_rule_see_what_the_first_did() -> void:
	# Both fire on the same trigger. If the second read the world as it was
	# before the first ran, the arithmetic would silently be wrong.
	var w: Dictionary = _world([_entity("player", 0, 0, 4, 10)], {"rules": [
		_rule({"id": "first", "then": [{"kind": "heal", "n": 3}]}),
		_rule({"id": "second", "require": [{"kind": "hpAtLeast", "n": 7}], "then": [{"kind": "heal", "n": 2}]}),
	]})
	var events: Array = SimInterpret.fire_rules(w, "WAIT", "player")
	assert_eq(_rule_ids(events), ["first", "second"])
	assert_eq(events[1]["payload"]["outcomes"], [{"kind": "health", "entityId": "player", "to": 9}])


## the world-shape words (VOCABULARY.md §3) ---------------------------------------

func test_reads_the_depth_of_the_run() -> void:
	var deep: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"depth": 5})
	assert_true(SimInterpret.holds({"kind": "depthAtLeast", "n": 5}, deep, "player"))
	assert_false(SimInterpret.holds({"kind": "depthAtLeast", "n": 6}, deep, "player"))
	# The first floor is depth 1, so 1 holds everywhere — harmless, not wrong.
	assert_true(SimInterpret.holds({"kind": "depthAtLeast", "n": 1}, _world(), "player"))


func test_reads_the_floors_cut_and_an_unrecorded_cut_as_no_cut_at_all() -> void:
	var warren: Dictionary = _world([_entity("player", 0, 0, 5, 10)], {"motif": "warren"})
	assert_true(SimInterpret.holds({"kind": "motifIs", "motif": "warren"}, warren, "player"))
	assert_false(SimInterpret.holds({"kind": "motifIs", "motif": "halls"}, warren, "player"))
	# Logs from before floors recorded their cut: the condition is false,
	# never a guess — old floors do not retroactively acquire a shape.
	assert_false(SimInterpret.holds({"kind": "motifIs", "motif": "door"}, _world(), "player"))


func test_knows_where_you_fell() -> void:
	var haunted: Dictionary = _world([_entity("player", 2, 0, 5, 10)], {"bodies": [{"x": 2, "y": 0}, {"x": 5, "y": 0}]})
	assert_true(SimInterpret.holds({"kind": "bodyHere"}, haunted, "player"))
	var beside: Dictionary = _world([_entity("player", 1, 0, 5, 10)], {"bodies": [{"x": 2, "y": 0}]})
	assert_false(SimInterpret.holds({"kind": "bodyHere"}, beside, "player"))
	assert_false(SimInterpret.holds({"kind": "bodyHere"}, _world(), "player"))


func test_fires_through_the_interpreter_composed() -> void:
	# The three words together, gating a heal on MOVE: the full path from
	# validated rule to RULE_FIRED, not just the predicate in isolation.
	var r: Dictionary = _rule({"when": "MOVE", "require": [
		{"kind": "bodyHere"}, {"kind": "depthAtLeast", "n": 3}, {"kind": "motifIs", "motif": "warren"},
	]})
	var fires: Dictionary = _world([_entity("player", 2, 0, 5, 10)],
		{"depth": 3, "motif": "warren", "bodies": [{"x": 2, "y": 0}], "rules": [r]})
	assert_eq(SimInterpret.fire_rules(fires, "MOVE", "player").size(), 1)
	var wrong_floor: Dictionary = _world([_entity("player", 2, 0, 5, 10)],
		{"depth": 3, "motif": "halls", "bodies": [{"x": 2, "y": 0}], "rules": [r]})
	assert_eq(SimInterpret.fire_rules(wrong_floor, "MOVE", "player").size(), 0)


## ═══ adopted from interpret.test.ts's own 'applying what fired' and part of
## 'the past does not change' (Task 2.C1 hand-off B) ═══
## These 7 all drive SimApply.apply(state, RULE_FIRED-event) directly — not
## fire_rules — so they use SimEvents.draft rather than this file's asEvent()
## helper (apply() reads only type/payload/rngCounter/rngDraws; it has no use
## for the id/parent/seq asEvent() adds, and nothing here folds a chain).
## _state_with/_entity above (this file's own, not _world/_rule below them)
## are what the reference's stateWith/entity build too.

func test_resolves_a_heal_to_an_absolute_figure_clamped_at_the_ceiling() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 9, 10)])
	var draft: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 10}],
	})
	var after: Dictionary = SimApply.apply(s, draft)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 10)


func test_harms_without_going_below_zero() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 2, 10)])
	var draft: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 0}],
	})
	var after: Dictionary = SimApply.apply(s, draft)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 0)


func test_kills_by_the_same_path_as_a_blow_dead_is_dead() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 1, 10)])
	var draft: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 0}],
	})
	var after: Dictionary = SimApply.apply(s, draft)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 0)


func test_leaves_state_alone_for_a_spoken_line() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 5, 10)])
	var draft: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "said", "text": "the stone is cold"}],
	})
	var after: Dictionary = SimApply.apply(s, draft)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 5)


func test_does_not_mutate_the_state_it_was_given() -> void:
	var s: Dictionary = _state_with([], [_entity("player", 0, 0, 5, 10)])
	var draft: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 5}],
	})
	SimApply.apply(s, draft)
	var player: Dictionary = (s["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 5)


func test_applies_the_recorded_effect_even_when_the_rule_would_no_longer_match() -> void:
	## The load-bearing property of the whole design. `apply` must replay what
	## happened, never re-decide it — if it re-evaluated conditions, ratifying
	## a rule today would silently rewrite what a run last week did. Proven
	## directly: a rule sits in state whose condition is false right now, and
	## the recorded RULE_FIRED still applies (apply.gd's RULE_FIRED arm never
	## reads state["rules"] at all).
	var would_not_match_now: Dictionary = _state_with(
		[_rule({"require": [{"kind": "hpAtLeast", "n": 9}]})],
		[_entity("player", 0, 0, 2, 10)])  # hp 2 — the condition is false now
	var recorded: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "r", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 5}],
	})
	var after: Dictionary = SimApply.apply(would_not_match_now, recorded)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 5)


func test_applies_an_effect_for_a_rule_the_world_no_longer_holds_at_all() -> void:
	var no_rules: Dictionary = _state_with([], [_entity("player", 0, 0, 2, 10)])
	var recorded: Dictionary = SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "long-gone", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "player", "to": 5}],
	})
	var after: Dictionary = SimApply.apply(no_rules, recorded)
	var player: Dictionary = (after["entities"] as Array)[0]
	assert_eq((player["stats"] as Dictionary)["hp"], 5)
