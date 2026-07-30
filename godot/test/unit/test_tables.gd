extends GutTest
## sim/tables.gd — the byte-twin of tests/core/tables.test.ts (31 cases),
## tests/core/leveling.test.ts (9), tests/core/size.test.ts (12) and
## tests/core/motifs.test.ts (11): 63 TS `it(...)` blocks in total.
##
## The fixture sweep (test_every_numeric_table_matches_the_reference and its
## neighbours below) is the primary guard: all 23 of tables.ts's exported
## numeric functions, plus BESTIARY/VERB_THREAT/MOTIFS, asserted row-for-row
## against godot/test/fixtures/tables.json — nothing in that block is a
## hand-typed expected number. The 39 tests below it port the four suites'
## OWN named cases (monotonicities, totality, structural facts) — wherever
## one of those cases pins an exact output of a fixture-backed function, the
## expected value is looked up in the fixture too (via the `_row` helper),
## not retyped. Two small, disclosed exceptions where the exact args a TS
## case probes are not among the fixture's own dumped rows are noted inline
## at the point they occur, each substituting either a fixture-covered arg
## that demonstrates the same fact, or (twice, unavoidably) a literal kept
## from the TS source with a comment saying why.
##
## 24 of the 63 TS cases could not land here — they exercise modules that did
## not exist in sim/ when Task 2.B3 ran. Listed by source file and owning
## module, so the task that ports each module can find its cases without
## re-deriving which is which. TWENTY-TWO have since been DISCHARGED, each in
## the suite named beside it; the two that remain both name a later phase.
##
##   4 STILL DEFERRED   Phase 5 (assay/register.ts) x2, Phase 3 (ui/fov.ts) x2
##   20 DISCHARGED      leveling 9, mapgen 3, commands 8
##   4 + 20 = 24.
##
## From tables.test.ts (2 cases — need a Godot port of src/assay/register.ts,
## which nothing in sim/ provides yet. PHASE 5, still open):
##   - "keeps every kind inside the covenant's name rules" (assayName)
##   - "every kind still answers the register — the new names are names"
##
## From leveling.test.ts (all 9 — every case folds a chain through
## WORLD_INIT/STRIKE/RULE_FIRED via fold()/append()/emptyLog(), which needs
## the reducer in apply.gd). apply.gd landed in Task 2.C1 and ALL NINE ARE
## DISCHARGED in godot/test/unit/test_leveling.gd, whose header reconciles
## against this list one for one:
##   - "pays the victim's threat value, exactly"
##   - "pays nothing for a wound that does not finish"
##   - "pays nothing when creatures kill each other"
##   - "pays for a kill a rule made, when the player owned the rule's firing"
##   - "does not pay twice for a body"
##   - "raises the level when the xp arrives"
##   - "applies the growth table to the player"
##   - "heals to full at the moment of leveling — the ease tooth"
##   - "starts every world at level 1 with no xp"
##
## From size.test.ts (7 — need createWorld, owned by commands.gd; one also
## needs apply.gd's fold, one needs mapgen.gd's generateMap). ALL SEVEN ARE
## DISCHARGED — six into godot/test/unit/test_commands.gd (createWorld's own
## suite, under its ADOPTED banner) and one into test_mapgen.gd:
##   - "the stretched door spends on numbers, not menace — and the vale
##     keeps its variety" (commands.gd -> test_commands.gd)
##   - "a stretch-1 world is bit-identical to the world before boards could
##     breathe" (commands.gd -> test_commands.gd)
##   - "the expanse pays a doubled budget for a bigger population, spread
##     thinner" (commands.gd + apply.gd -> test_commands.gd)
##   - "the expanse owes more prizes and a fuller pantry; the teaching floor
##     holds one whatever the acreage" (commands.gd -> test_commands.gd)
##   - "the room cap scales with area, so the motif keeps its density"
##     (mapgen.gd -> test_mapgen.gd)
##   - "refuses a board past the chokepoint" (commands.gd -> test_commands.gd)
##   - "every floor of the expanse still stands its whole account in the
##     story" (commands.gd -> test_commands.gd)
##
## From motifs.test.ts (6 — mapgen.gd, commands.gd, or an fov equivalent).
## FOUR ARE DISCHARGED; the two fov cases are PHASE 3 and still open:
##   - "cuts the halls broad and the warren tight" (mapgen.gd ->
##     test_mapgen.gd)
##   - "keeps the warren inside its caps" (mapgen.gd -> test_mapgen.gd)
##   - "names the band in the story, where the ledger reads it" (commands.gd
##     -> test_commands.gd)
##   - "sees 9 on the first floor and 7 in the deep" (src/ui/fov.ts —
##     UI-layer field of view, no sim/ or stage port exists anywhere yet)
##   - "the raw sweep honors a passed radius" (src/ui/fov.ts, same as above)
##   - "records the cut in the birth event, matching the band" (commands.gd
##     -> test_commands.gd)
##
## The eight commands.gd cases were outstanding through the whole of Wave E:
## `commands.gd` shipped there, but the wave's audit asked only "is every
## export ported?" and never "does any existing ledger name commands.gd as an
## owner?" — and these eight are addressed to a MODULE, not to a task number,
## so no task-number grep could reach them. Closed by the Wave E fix pass.


## key -> expected row count, copied from the task brief's own table so a
## silently truncated dump is caught before any value is trusted.
const _EXPECTED_ROWS: Dictionary = {
	"damageDice": 23, "neededToHit": 441, "chanceIn20": 31, "critFloor": 23,
	"threatOf": 168, "creatureStats": 84, "xpToReach": 42, "levelForXp": 84,
	"sizeStretch": 7, "bountyStretch": 6, "meanDamage": 23, "braceWall": 23,
	"spawnBudget": 44, "wardenLevel": 11, "sightAt": 11, "grantValue": 73,
	"growthAt": 14, "valueOf": 20, "draughtCeiling": 11, "smokeTurns": 11,
	"trapCount": 44, "trapLevelAt": 11, "alarmTurns": 4, "bestiary": 8,
	"verbThreat": 8, "motifs": 3,
}


func _fx() -> Dictionary:
	return FixtureLoader.load_table_json("res://test/fixtures/tables.json")


## The row in `rows` (one of tables.json's {args, value} lists) whose args
## match exactly, or a loud test failure — every args tuple this file looks
## up was checked present in the fixture while this suite was written, so a
## miss here means the lookup itself is wrong, not that the row is absent.
func _row(rows: Array, args: Array) -> Dictionary:
	for row: Dictionary in rows:
		if row["args"] == args:
			return row
	fail_test("no fixture row for args %s" % [args])
	return {}


func _find_by_kind(list: Array, kind: String) -> Dictionary:
	for entry: Dictionary in list:
		if entry["kind"] == kind:
			return entry
	fail_test("no entry for kind %s" % kind)
	return {}


func _find_by_grants(armory: Array, stat: String) -> Dictionary:
	for r: Dictionary in armory:
		if r["grants"] == stat:
			return r
	fail_test("no relic grants %s" % stat)
	return {}


func _weight_at(bands: Array, level: int) -> int:
	for b: Dictionary in bands:
		if b["level"] == level:
			return b["weight"]
	return 0


## the fixture sweep ---------------------------------------------------------

func test_the_fixture_dump_is_not_silently_truncated() -> void:
	var fx: Dictionary = _fx()
	assert_eq(fx.size(), 26, "tables.json should carry exactly 26 top-level keys")
	for key: String in _EXPECTED_ROWS:
		var n: int = fx[key].size()
		assert_eq(n, _EXPECTED_ROWS[key], key)


## Every one of the 23 exported numeric functions, asserted row-for-row
## against the reference's own dump. threatOf's `null` kind means the arg
## was omitted in the reference call, per the fixture's documented
## convention (only threatOf's kind is ever optional) — calling
## threat_of(stats) rather than threat_of(stats, null), since the latter
## would hand a typed String parameter a Nil and fail before pricing
## anything.
func test_every_numeric_table_matches_the_reference() -> void:
	var fx: Dictionary = _fx()

	for row: Dictionary in fx["damageDice"]:
		assert_eq(SimTables.damage_dice(row["args"][0]), row["value"], "damage_dice%s" % [row["args"]])
	for row: Dictionary in fx["neededToHit"]:
		assert_eq(SimTables.needed_to_hit(row["args"][0], row["args"][1]), row["value"], "needed_to_hit%s" % [row["args"]])
	for row: Dictionary in fx["chanceIn20"]:
		assert_eq(SimTables.chance_in_20(row["args"][0]), row["value"], "chance_in_20%s" % [row["args"]])
	for row: Dictionary in fx["critFloor"]:
		assert_eq(SimTables.crit_floor(row["args"][0]), row["value"], "crit_floor%s" % [row["args"]])
	for row: Dictionary in fx["threatOf"]:
		var kind: Variant = row["args"][1]
		var got: int = SimTables.threat_of(row["args"][0]) if kind == null else SimTables.threat_of(row["args"][0], kind)
		assert_eq(got, row["value"], "threat_of%s" % [row["args"]])
	for row: Dictionary in fx["creatureStats"]:
		assert_eq(SimTables.creature_stats(row["args"][0], row["args"][1]), row["value"], "creature_stats%s" % [row["args"]])
	for row: Dictionary in fx["xpToReach"]:
		assert_eq(SimTables.xp_to_reach(row["args"][0], row["args"][1]), row["value"], "xp_to_reach%s" % [row["args"]])
	for row: Dictionary in fx["levelForXp"]:
		assert_eq(SimTables.level_for_xp(row["args"][0], row["args"][1]), row["value"], "level_for_xp%s" % [row["args"]])
	for row: Dictionary in fx["sizeStretch"]:
		assert_eq(SimTables.size_stretch(row["args"][0], row["args"][1]), row["value"], "size_stretch%s" % [row["args"]])
	for row: Dictionary in fx["bountyStretch"]:
		assert_eq(SimTables.bounty_stretch(row["args"][0]), row["value"], "bounty_stretch%s" % [row["args"]])
	for row: Dictionary in fx["meanDamage"]:
		assert_eq(SimTables.mean_damage(row["args"][0]), row["value"], "mean_damage%s" % [row["args"]])
	for row: Dictionary in fx["braceWall"]:
		assert_eq(SimTables.brace_wall(row["args"][0]), row["value"], "brace_wall%s" % [row["args"]])
	for row: Dictionary in fx["spawnBudget"]:
		assert_eq(SimTables.spawn_budget(row["args"][0], row["args"][1]), row["value"], "spawn_budget%s" % [row["args"]])
	for row: Dictionary in fx["wardenLevel"]:
		assert_eq(SimTables.warden_level(row["args"][0]), row["value"], "warden_level%s" % [row["args"]])
	for row: Dictionary in fx["sightAt"]:
		assert_eq(SimTables.sight_at(row["args"][0]), row["value"], "sight_at%s" % [row["args"]])
	for row: Dictionary in fx["grantValue"]:
		assert_eq(SimTables.grant_value(row["args"][0]), row["value"], "grant_value%s" % [row["args"]])
	for row: Dictionary in fx["growthAt"]:
		assert_eq(SimTables.growth_at(row["args"][0]), row["value"], "growth_at%s" % [row["args"]])
	for row: Dictionary in fx["valueOf"]:
		assert_eq(SimTables.value_of(row["args"][0]), row["value"], "value_of%s" % [row["args"]])
	for row: Dictionary in fx["draughtCeiling"]:
		assert_eq(SimTables.draught_ceiling(row["args"][0]), row["value"], "draught_ceiling%s" % [row["args"]])
	for row: Dictionary in fx["smokeTurns"]:
		assert_eq(SimTables.smoke_turns(row["args"][0]), row["value"], "smoke_turns%s" % [row["args"]])
	for row: Dictionary in fx["trapCount"]:
		assert_eq(SimTables.trap_count(row["args"][0], row["args"][1]), row["value"], "trap_count%s" % [row["args"]])
	for row: Dictionary in fx["trapLevelAt"]:
		assert_eq(SimTables.trap_level_at(row["args"][0]), row["value"], "trap_level_at%s" % [row["args"]])
	for row: Dictionary in fx["alarmTurns"]:
		assert_eq(SimTables.alarm_turns(row["args"][0]), row["value"], "alarm_turns%s" % [row["args"]])


func test_the_bestiary_is_the_reference_bestiary() -> void:
	var fx: Dictionary = _fx()
	assert_eq(SimCanonical.encode(SimTables.BESTIARY), SimCanonical.encode(fx["bestiary"]),
		"a retyped table is a forked game")


## Not a SimCanonical.encode comparison like the bestiary and motifs checks
## above: VERB_THREAT's multipliers are genuinely fractional (1.1-1.3), and
## SimCanonical rightly refuses to encode a fractional float — nothing
## fractional is ever meant to reach it, since the state stores only the
## integer RESULTS these coefficients produce. Compared key-by-key instead.
func test_the_verb_threat_table_matches_the_reference() -> void:
	var fx: Dictionary = _fx()
	var expected: Dictionary = fx["verbThreat"]
	assert_eq(SimTables.VERB_THREAT.keys().size(), expected.keys().size())
	for verb: String in expected:
		assert_eq(SimTables.VERB_THREAT[verb], expected[verb], verb)


func test_the_motifs_table_matches_the_reference() -> void:
	var fx: Dictionary = _fx()
	assert_eq(SimCanonical.encode(SimTables.MOTIFS), SimCanonical.encode(fx["motifs"]))


## tests/core/tables.test.ts ---------------------------------------------------

## bounded accuracy

func test_keeps_the_needed_roll_inside_the_band_whatever_the_gap() -> void:
	for might: int in range(-5, 31):
		for speed: int in range(-5, 31):
			var n: int = SimTables.needed_to_hit(might, speed)
			assert_true(n >= SimTables.NEEDED_FLOOR and n <= SimTables.NEEDED_CEILING,
				"needed_to_hit(%d,%d)=%d out of band" % [might, speed, n])


func test_anchors_the_starting_fight_at_a_60_percent_hit() -> void:
	# Player might 3 vs skirmisher speed 2: the "fighting feels good" anchor.
	var fx: Dictionary = _fx()
	var needed: int = SimTables.needed_to_hit(3, 2)
	assert_eq(needed, _row(fx["neededToHit"], [3, 2])["value"])
	assert_eq(SimTables.chance_in_20(needed), _row(fx["chanceIn20"], [needed])["value"])


func test_never_promises_certainty_in_either_direction() -> void:
	# Nat-1 misses and nat-20 hits, so chance lives in [1..19] twentieths.
	assert_true(SimTables.chance_in_20(SimTables.NEEDED_FLOOR) <= 19)
	assert_true(SimTables.chance_in_20(SimTables.NEEDED_CEILING) >= 1)
	assert_eq(SimTables.CRIT, 20)
	assert_eq(SimTables.WHIFF, 1)


func test_moves_five_points_per_point_of_stat_gap() -> void:
	var higher: int = SimTables.chance_in_20(SimTables.needed_to_hit(4, 2))
	var lower: int = SimTables.chance_in_20(SimTables.needed_to_hit(3, 2))
	assert_eq(higher - lower, 1)


## damage

func test_rises_with_might_and_never_dips() -> void:
	for m: int in range(1, 15):
		assert_true(SimTables.mean_damage(m + 1) >= SimTables.mean_damage(m))


func test_always_deals_at_least_one() -> void:
	for m: int in range(0, 16):
		var flat: int = SimTables.damage_dice(m)["flat"]
		assert_true(1 + flat >= 1)


func test_tames_the_low_end_swing_that_made_a_third_of_blows_deal_1() -> void:
	# might 3 used to be uniform 1..3; now 1d3+1 — floor of 2.
	var fx: Dictionary = _fx()
	assert_eq(SimTables.damage_dice(3), _row(fx["damageDice"], [3])["value"])


## experience

func test_thresholds_strictly_rise() -> void:
	for l: int in range(2, SimTables.XP_TO_REACH.size()):
		assert_true(SimTables.XP_TO_REACH[l] > SimTables.XP_TO_REACH[l - 1])


func test_maps_xp_to_the_highest_level_reached_totally() -> void:
	# Derived from the fixture rather than hardcoded, so tuning the
	# thresholds does not break the mapping's contract.
	var fx: Dictionary = _fx()
	var lfx: Array = fx["levelForXp"]
	assert_eq(SimTables.level_for_xp(0), _row(lfx, [0, 1])["value"])
	assert_eq(SimTables.level_for_xp(SimTables.XP_TO_REACH[2] - 1), _row(lfx, [15, 1])["value"])
	assert_eq(SimTables.level_for_xp(SimTables.XP_TO_REACH[2]), _row(lfx, [16, 1])["value"])
	assert_eq(SimTables.level_for_xp(SimTables.XP_TO_REACH[4] - 1), _row(lfx, [71, 1])["value"])
	assert_eq(SimTables.level_for_xp(SimTables.XP_TO_REACH[4]), _row(lfx, [72, 1])["value"])
	# The TS source probes 99999; the fixture's ladder-arg range tops out at
	# 9999, already well past every threshold — the same "total past the
	# end" fact, pinned against the ladder's own length rather than a
	# retyped level number.
	assert_eq(SimTables.level_for_xp(9999), SimTables.XP_TO_REACH.size() - 1)
	assert_eq(SimTables.level_for_xp(9999), _row(lfx, [9999, 1])["value"])
	# The TS source probes -5; the fixture's floor is -1, already below
	# every threshold — the same "total before the start" fact.
	assert_eq(SimTables.level_for_xp(-1), _row(lfx, [-1, 1])["value"])


func test_grows_hp_every_level_and_alternates_the_sharp_stats() -> void:
	for l: int in range(2, 10):
		assert_true(SimTables.growth_at(l)["hp"] > 0)
	assert_eq(SimTables.growth_at(2)["might"] + SimTables.growth_at(2)["speed"], 1)
	assert_eq(SimTables.growth_at(3)["might"] + SimTables.growth_at(3)["speed"], 1)
	assert_ne(SimTables.growth_at(2)["might"], SimTables.growth_at(3)["might"])
	assert_eq(SimTables.growth_at(3)["wits"] + SimTables.growth_at(6)["wits"] + SimTables.growth_at(9)["wits"], 3)


## the bestiary

func test_holds_six_spawnable_archetypes_and_one_boss_that_never_rolls() -> void:
	var fx: Dictionary = _fx()
	var bestiary_fx: Array = fx["bestiary"]

	var expected_spawnable := 0
	for a: Dictionary in bestiary_fx:
		if a["weight"] > 0:
			expected_spawnable += 1
	var got_spawnable := 0
	for a: Dictionary in SimTables.BESTIARY:
		if a["weight"] > 0:
			got_spawnable += 1
	assert_eq(got_spawnable, expected_spawnable)

	assert_eq(_find_by_kind(SimTables.BESTIARY, "warden")["weight"], _find_by_kind(bestiary_fx, "warden")["weight"])
	# The teaching floor's gate: the verbs that punish ignorance wait past
	# the first lesson.
	for kind: String in ["stinger", "caller", "slinger"]:
		assert_eq(_find_by_kind(SimTables.BESTIARY, kind)["fromDepth"], _find_by_kind(bestiary_fx, kind)["fromDepth"])


func test_scales_every_archetype_upward_with_its_level() -> void:
	for a: Dictionary in SimTables.BESTIARY:
		var l1: Dictionary = SimTables.creature_stats(a["kind"], 1)
		var l3: Dictionary = SimTables.creature_stats(a["kind"], 3)
		assert_true(SimTables.threat_of(l3) > SimTables.threat_of(l1), a["kind"])
		assert_true(l3["hp"] > l1["hp"], a["kind"])


func test_returns_nothing_for_a_kind_that_is_not_in_the_book() -> void:
	# The TS source probes 'dragon'; the fixture's own unmapped probe is
	# 'gremlin' (creatureStats' two null rows) — the same "kind not in the
	# book" fact, sourced from the fixture rather than an unlisted name.
	assert_null(SimTables.creature_stats("gremlin", 1))


func test_prices_the_warden_above_everything_of_its_level() -> void:
	var warden: int = SimTables.threat_of(SimTables.creature_stats("warden", 1))
	for a: Dictionary in SimTables.BESTIARY:
		if a["kind"] == "warden":
			continue
		assert_true(warden > SimTables.threat_of(SimTables.creature_stats(a["kind"], 1)), a["kind"])


## threat and budget — the sawtooth's teeth

func test_threat_rises_with_any_stat() -> void:
	var base: Dictionary = {"hp": 5, "might": 3, "wits": 1, "speed": 2}
	var more_might: Dictionary = base.duplicate()
	more_might["might"] = 6
	var more_hp: Dictionary = base.duplicate()
	more_hp["hp"] = 12
	assert_true(SimTables.threat_of(more_might) > SimTables.threat_of(base))
	assert_true(SimTables.threat_of(more_hp) > SimTables.threat_of(base))


func test_budget_strictly_deepens() -> void:
	for d: int in range(1, 8):
		assert_true(SimTables.spawn_budget(d + 1) > SimTables.spawn_budget(d))


func test_affords_roughly_three_modest_creatures_at_depth_1() -> void:
	var skirmisher: int = SimTables.threat_of(SimTables.creature_stats("skirmisher", 1))
	var afford: int = SimTables.spawn_budget(1) / skirmisher
	assert_true(afford >= 2)
	assert_true(afford <= 4)


func test_overlaps_bands_the_brogue_way_mostly_here_sometimes_shallower_rarely_deeper() -> void:
	# depth_bands is not one of the fixture's 23 functions — no dumped rows
	# exist to source these from, so this stays a faithful literal port.
	var bands: Array = SimTables.depth_bands(3)
	var levels: Array = []
	for b: Dictionary in bands:
		levels.append(b["level"])
	levels.sort()
	assert_eq(levels, [2, 3, 4])
	assert_true(_weight_at(bands, 3) > _weight_at(bands, 2))
	assert_true(_weight_at(bands, 2) > _weight_at(bands, 4))
	# Depth 1 is the teaching floor: level-1 only. The blur begins at 2.
	assert_eq(SimTables.depth_bands(1), [{"level": 1, "weight": 6}])


func test_guards_every_third_floor() -> void:
	for d: int in [1, 2, 4, 5]:
		assert_false(SimTables.warden_at(d))
	for d: int in [3, 6, 9]:
		assert_true(SimTables.warden_at(d))


## the armory

func test_always_grants_something_at_any_depth() -> void:
	for r: Dictionary in SimTables.ARMORY:
		for d: int in [1, 2, 5, 9]:
			var g: Dictionary = SimTables.relic_grant(r, d)
			assert_true(g["hp"] + g["might"] + g["wits"] + g["speed"] > 0, r["kind"])


func test_scales_with_depth_and_never_shrinks() -> void:
	for r: Dictionary in SimTables.ARMORY:
		for d: int in range(1, 8):
			var now: Dictionary = SimTables.relic_grant(r, d)
			var deeper: Dictionary = SimTables.relic_grant(r, d + 1)
			var now_sum: int = now["hp"] + now["might"] + now["wits"] + now["speed"]
			var deeper_sum: int = deeper["hp"] + deeper["might"] + deeper["wits"] + deeper["speed"]
			assert_true(deeper_sum >= now_sum, r["kind"])


func test_grants_the_stat_it_names_and_charges_only_its_stated_price() -> void:
	for r: Dictionary in SimTables.ARMORY:
		var g: Dictionary = SimTables.relic_grant(r, 4)
		var costs: Variant = r.get("costs", null)
		for stat: String in ["hp", "might", "wits", "speed"]:
			if stat == r["grants"]:
				assert_true(g[stat] > 0, "%s.%s" % [r["kind"], stat])
			elif costs != null and (costs as Dictionary)["stat"] == stat:
				assert_eq(g[stat], -(costs as Dictionary)["amount"], "%s.%s" % [r["kind"], stat])
			else:
				assert_eq(g[stat], 0, "%s.%s" % [r["kind"], stat])


func test_keeps_every_tradeoff_out_of_walkings_reach() -> void:
	# The dominance rule's premise: anything with a price is incomparable
	# with bare hands, so only the , key ever pays it.
	for r: Dictionary in SimTables.ARMORY:
		if r.get("costs", null) == null:
			continue
		assert_false(SimTables.dominates(SimTables.relic_grant(r, 4), {"hp": 0, "might": 0, "wits": 0, "speed": 0}))


func test_lets_might_compound_slowest_because_the_damage_bands_compound_it_again() -> void:
	var edge: Dictionary = _find_by_grants(SimTables.ARMORY, "might")
	var charm: Dictionary = _find_by_grants(SimTables.ARMORY, "hp")
	assert_true(edge["per"] > charm["per"])


## wits and the crit band

func test_gives_the_starting_player_only_the_natural_20() -> void:
	var fx: Dictionary = _fx()
	assert_eq(SimTables.crit_floor(3), _row(fx["critFloor"], [3])["value"])


func test_widens_one_step_per_four_wits_and_no_further_than_the_floor() -> void:
	var fx: Dictionary = _fx()
	var cfx: Array = fx["critFloor"]
	assert_eq(SimTables.crit_floor(4), _row(cfx, [4])["value"])
	assert_eq(SimTables.crit_floor(8), _row(cfx, [8])["value"])
	# The TS source also probes wits 40; the fixture's own range tops out at
	# 20, already deep in the same wits>=8 floor-clamp plateau as 8 and 40
	# both are.
	assert_eq(SimTables.crit_floor(20), _row(cfx, [20])["value"])


func test_is_total_over_nonsense() -> void:
	var fx: Dictionary = _fx()
	var cfx: Array = fx["critFloor"]
	# The TS source also probes wits -3; the fixture's own negative probe is
	# -5, the same "nonsense" regime.
	assert_eq(SimTables.crit_floor(-5), _row(cfx, [-5])["value"])
	assert_eq(SimTables.crit_floor(0), _row(cfx, [0])["value"])


## the volley enters the tables

func test_the_slinger_volleys_priced_and_gated_below_the_teaching_floor() -> void:
	var fx: Dictionary = _fx()
	assert_eq(SimTables.verb_of("slinger"), "volley")
	assert_eq(SimTables.verb_of("slinger-2"), "volley")
	assert_true(SimTables.VERB_THREAT["volley"] > 1)  # unpriced verbs overdraw floors
	var arch: Variant = SimTables.archetype("slinger")
	assert_not_null(arch)
	assert_eq((arch as Dictionary)["fromDepth"], _find_by_kind(fx["bestiary"], "slinger")["fromDepth"])
	# Mutation proof of the pricing: the kind must cost more than its bare stats.
	var stats: Dictionary = SimTables.creature_stats("slinger", 1)
	assert_true(SimTables.threat_of(stats, "slinger") > SimTables.threat_of(stats))


func test_the_leaden_sling_is_the_ranged_trait_and_never_dominates_the_keen_edge() -> void:
	assert_eq(SimTables.RELIC_TRAITS["leaden sling"], "ranged")
	var sling: Dictionary = _find_by_kind(SimTables.ARMORY, "leaden sling")
	var edge: Dictionary = _find_by_kind(SimTables.ARMORY, "keen edge")
	# They live in different hands now (dual wield) — this pins only that
	# the sling's grant stays the modest one, never the edge's rival.
	assert_false(SimTables.dominates(SimTables.relic_grant(sling, 3), SimTables.relic_grant(edge, 3)))
	assert_true(SimTables.wears_trait({"weapon": {"kind": "leaden sling"}}, "ranged"))
	assert_false(SimTables.wears_trait({"weapon": {"kind": "keen edge"}}, "ranged"))


## tests/core/size.test.ts -----------------------------------------------------

func test_reads_1_on_the_vale_and_every_test_board_2_on_the_expanse_3_on_the_waste() -> void:
	var fx: Dictionary = _fx()
	var sfx: Array = fx["sizeStretch"]
	assert_eq(SimTables.size_stretch(48, 32), _row(sfx, [48, 32])["value"])     # VALE
	assert_eq(SimTables.size_stretch(96, 64), _row(sfx, [96, 64])["value"])     # EXPANSE
	assert_eq(SimTables.size_stretch(128, 96), _row(sfx, [128, 96])["value"])   # WASTE
	# The TS source also probes 12x8 and 15x7 — dims not among the fixture's
	# dumped 7 rows. Its own comment names the property being pinned:
	# "stretch must never shrink below one, or every fixture's budget would
	# collapse" — asserted directly as that floor, rather than guessing a
	# fixture-shaped substitute pair of dims.
	assert_true(SimTables.size_stretch(12, 8) >= 1)
	assert_true(SimTables.size_stretch(15, 7) >= 1)


func test_multiplies_the_rent_by_the_bounty_past_the_teaching_floor_gentler_than_the_ground() -> void:
	# Measured (2026-07-29): the full stretch doubled fights-per-heal and the
	# depth-3 runner out-survived the fighter 2/10 v 1/10 — the one
	# domination the covenant forbids. The bounty (1 / 1.5 / 2) holds
	# fights-per-heal near the vale's while the ground stretches whole.
	for depth: int in [3, 5, 9]:
		assert_eq(SimTables.spawn_budget(depth, 1), SimTables.spawn_budget(depth))
		assert_eq(SimTables.spawn_budget(depth, 2), roundi(SimTables.spawn_budget(depth) * 1.5))
		assert_eq(SimTables.spawn_budget(depth, 3), SimTables.spawn_budget(depth) * 2)


func test_the_teaching_floor_pays_the_full_stretch() -> void:
	# "only two monsters on the whole first floor! ... quite boring" — the
	# designer's filing, 2026-07-29. The door pays the FULL stretch, not the
	# gentler bounty.
	assert_eq(SimTables.spawn_budget(1, 1), SimTables.spawn_budget(1))
	assert_eq(SimTables.spawn_budget(1, 2), SimTables.spawn_budget(1) * 2)
	assert_eq(SimTables.spawn_budget(1, 3), SimTables.spawn_budget(1) * 3)


func test_the_readout_and_the_reducer_share_one_ladder_xptoreach_wears_the_stretch() -> void:
	# The vitals row once read the raw table and told an expanse player
	# "22/16 xp" at level 1 while the engine levelled at 24 — one helper now,
	# so the two cannot drift.
	var fx: Dictionary = _fx()
	var xfx: Array = fx["xpToReach"]
	var lfx: Array = fx["levelForXp"]
	assert_eq(SimTables.xp_to_reach(2), _row(xfx, [2, 1])["value"])
	assert_eq(SimTables.xp_to_reach(2, 2), _row(xfx, [2, 2])["value"])
	assert_eq(SimTables.xp_to_reach(2, 3), _row(xfx, [2, 3])["value"])
	assert_eq(SimTables.xp_to_reach(3, 2), _row(xfx, [3, 2])["value"])
	# The TS source probes level 99; the fixture's ladder-arg range tops out
	# at 12, already past the 10-entry ladder — the same "undefined past the
	# end" fact.
	assert_null(SimTables.xp_to_reach(12, 2))
	# The helper IS levelForXp's own gate, proven at the boundary.
	assert_eq(SimTables.level_for_xp(int(SimTables.xp_to_reach(2, 2)) - 1, 2), _row(lfx, [23, 2])["value"])
	assert_eq(SimTables.level_for_xp(int(SimTables.xp_to_reach(2, 2)), 2), _row(lfx, [24, 2])["value"])


func test_stretches_the_xp_ladder_by_the_same_bounty_threat_in_xp_out_one_factor() -> void:
	# 16 XP reaches level 2 on the vale; the expanse asks 24 (x1.5, exact),
	# the waste 32.
	var fx: Dictionary = _fx()
	var lfx: Array = fx["levelForXp"]
	assert_eq(SimTables.level_for_xp(16), _row(lfx, [16, 1])["value"])
	# (16, 2) is not among the fixture's dumped levelForXp rows: each
	# stretch's rows cluster at THAT stretch's own thresholds (24, not 16,
	# for stretch 2), so this one pin — alone in this file — stays a literal
	# kept from the TS source rather than a fixture lookup. The xp value
	# itself is still sourced from the ladder constant, not retyped as "16".
	assert_eq(SimTables.level_for_xp(SimTables.XP_TO_REACH[2], 2), 1)
	assert_eq(SimTables.level_for_xp(24, 2), _row(lfx, [24, 2])["value"])
	assert_eq(SimTables.level_for_xp(23, 2), _row(lfx, [23, 2])["value"])
	assert_eq(SimTables.level_for_xp(32, 3), _row(lfx, [32, 3])["value"])


## tests/core/motifs.test.ts ---------------------------------------------------

func test_fixes_the_shallow_bands_and_never_draws_for_them() -> void:
	var counter := 40
	var cases: Array = [[1, "door"], [2, "door"], [3, "warren"], [4, "warren"], [5, "halls"], [6, "halls"]]
	for c: Array in cases:
		var depth: int = c[0]
		var key: String = c[1]
		var result: Dictionary = SimTables.motif_at(9, counter, depth)
		var motif: Dictionary = result["motif"]
		assert_eq(motif["name"], (SimTables.MOTIFS[key] as Dictionary)["name"])
		assert_eq(result["counterAfter"], counter)


func test_draws_the_deep_one_counted_draw_warren_or_halls_with_more_secrets() -> void:
	var seen: Dictionary = {}
	var counter := 40
	for seed: int in range(1, 13):
		var result: Dictionary = SimTables.motif_at(seed, counter, 7)
		var motif: Dictionary = result["motif"]
		assert_eq(result["counterAfter"], counter + 1)
		assert_true((motif["name"] as String).begins_with("the deep"))
		# The deep's own hardcoded override (tables.ts's motifAt), not a
		# MOTIFS-table value — door/warren/halls carry secretIn 4/3/3, all
		# different from this 2.
		assert_eq(motif["secretIn"], 2)
		seen[motif["name"]] = true
	# Both faces of the deep turn up across seeds.
	assert_eq(seen.size(), 2)


func test_closes_in_with_depth_and_never_goes_black() -> void:
	var fx: Dictionary = _fx()
	var sfx: Array = fx["sightAt"]
	# The TS source's last probe is depth 12; the fixture's own range tops
	# out at 10, already in the same depth>6 plateau as 7 and 12 both are.
	for depth: int in [1, 2, 3, 4, 5, 6, 7, 10]:
		assert_eq(SimTables.sight_at(depth), _row(sfx, [depth])["value"])


func test_pins_the_rule_tokens_to_the_tables_one_list_two_homes() -> void:
	var names: Array = SimRule.MOTIF_NAMES.duplicate()
	names.sort()
	var keys: Array = SimTables.MOTIFS.keys()
	keys.sort()
	assert_eq(names, keys)
	for k: String in SimTables.MOTIFS:
		assert_eq((SimTables.MOTIFS[k] as Dictionary)["key"], k)


func test_keeps_the_base_key_in_the_deep_where_only_the_name_grows() -> void:
	for seed: int in [1, 7, 23, 41]:
		var result: Dictionary = SimTables.motif_at(seed, 0, 9)
		var motif: Dictionary = result["motif"]
		assert_true(["warren", "halls"].has(motif["key"]))
		assert_true((motif["name"] as String).begins_with("the deep "))
