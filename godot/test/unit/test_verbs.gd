extends GutTest
## The verbs — the byte-twin of tests/core/verbs.test.ts. One test per TS
## `it(...)`, in the TS file's order, so the two suites can be diffed by eye.
##
## What makes a bruiser a bruiser rather than a stat row. Every test here
## drives the real command layer and the real reducer — the mechanics the
## keyboard reaches — because a verb that only exists in the brain (ai.gd) is
## a verb replay could disagree with.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 24 cases across five describe blocks.
## 24 = 24 PORTED + 0 DEFERRED. Line numbers are tests/core/verbs.test.ts at
## ts-baseline.
##
## describe('the trample (bruiser)') — 6
##   :77  shoves the target back a pace and lumbers into the gap, in one event
##   :93  does not shove into a wall — the blow lands plain
##   :101 never shoves onto the way out — an exit you are knocked through is
##        not an escape you chose
##   :106 does not shove through another body
##   :114 does not drive the dead anywhere
##   :122 is the bruiser's verb, not the player's
##
## describe('the lunge (skirmisher)') — 5
##   :129 decides to lunge at exactly two tiles of ground
##   :134 crosses the free tile and strikes in one event, east first on a tie
##   :147 still crosses the ground when the blow misses
##   :158 refuses when no free tile lies on the way
##   :168 refuses at any distance but two
##
## describe('the ambush (stalker)') — 6
##   :177 holds perfectly still while the quarry is beyond its spring
##   :182 commits when the quarry walks inside the spring
##   :187 hunts plain once the spring is spent
##   :192 rolls its first landed blow one band harder, then uncoils
##   :214 keeps the spring coiled through a miss
##   :225 is born coiled below the teaching floor, and springless on it
##
## describe('the vigil (warden)') — 6
##   :243 hunts what comes inside the leash
##   :248 will not be drawn past the leash — it turns for home
##   :255 measures the leash from the post, not from wherever the chase
##        dragged it
##   :262 stands its post, whole, when nothing intrudes
##   :267 knits shut at its post once the intruder is gone
##   :278 does not mend while watched — poking a boss buys nothing, running
##        buys less
##
## describe('the verbs are the archetypes\'') — 1
##   :286 reads the verb through a level suffix
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## FOUR tests under the banner at the bottom of this file have no counterpart
## in verbs.test.ts, so the file holds 28. Each carries its own docstring;
## listed here because a header that counts only its ported cases reads as a
## file with 24 tests in it.
##
##   test_the_ward_drinks_one_landing_blow_whole_and_is_spent_by_it
##   test_a_miss_never_wards_however_worn_the_ward        mutation-found
##   test_the_set_guard_raises_the_bar_by_two_plus_half_their_wits
##   test_the_vigils_leash_stands_at_exactly_five_steps   mutation-found
##
## ── Two constants this file is the only guard for ─────────────────────────
## `LURK_RANGE` and `VIGIL_LEASH` were both changed by the Wave E reviewer
## with ZERO of 629 tests failing, because all four cases that name them
## placed the quarry at an offset FROM the constant — `5 + LURK_RANGE + 1`,
## `5 + VIGIL_LEASH + 2` — so raising the constant moved the goalposts with
## it. All four now spell the tile as a literal. The ambush's pair pins its
## range from both sides on its own (hold at four steps, commit at three);
## the vigil's pair does not, so the boundary pin above closes it. Rows for
## both live in scripts/mutate-sim.py.
##
## ── What this file is the ONLY witness for ────────────────────────────────
## test_ai.gd's header records that `decide()` has eight branches with no
## witness anywhere in the migration — vigil, ambush, call, lunge, volley,
## feign, smoke, alarm — because ai.test.ts drives only the plain hunt and the
## golden run never calls decide() at all. This file DISCHARGES three of the
## eight: **vigil** (five cases), **ambush** (three), **lunge** (two). The
## remaining five (call, volley, feign, smoke, alarm) belong to Tasks 2.E3c
## and 2.E3d.
##
## `lunge_strike` and `vigil_kept` live in `sim/commands/movement.gd` rather
## than in a sibling family: both are a blow through `resolve_strike` (the
## lunge crosses ground and strikes; the vigil keeps the post that the blow
## is thrown from), verbs.test.ts is their only reference suite, and it is
## this task's. No other family's brief claims either.
##
## ── A reference oddity met and NOT fixed ──────────────────────────────────
## :248 and :255 both drive the warden's homeward walk, which takes
## `_first_step`'s DEFAULT reach (AWARENESS, eight steps) while the guard's
## identical walk passes width+height. A warden shoved more than eight steps
## of WALKING from its post waits forever instead of walking home. Both cases
## here stand well inside eight, so both pass either way; the divergence is
## already on the record (ai.gd's own note, and the Task 2.E2 report) and is
## deliberately reproduced, not repaired. A bug reproduced is a success.


const SEED := 5


# ── the reference's room(): an open 20x12 floor. Walls, an exit and a
# starting counter are added per test where they matter.
const _WIDTH := 20
const _HEIGHT := 12


func _room(entities: Array, opts: Dictionary = {}) -> Dictionary:
	var tiles: Array = []
	for i in range(_WIDTH * _HEIGHT):
		tiles.append(SimGrid.FLOOR)
	for w: Array in (opts.get("walls", []) as Array):
		tiles[int(w[1]) * _WIDTH + int(w[0])] = SimGrid.WALL
	if opts.has("exit"):
		var e: Array = opts["exit"]
		tiles[int(e[1]) * _WIDTH + int(e[0])] = SimGrid.EXIT
	return {
		"grid": SimGrid.make(_WIDTH, _HEIGHT, tiles),
		"entities": entities,
		"items": [],
		"turn": 1,
		"activeEntityId": (entities[0] as Dictionary)["id"] if entities.size() > 0 else null,
		"seed": SEED,
		"rngCounter": int(opts.get("counter", 0)),
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 3,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


func _being(id: String, kind: String, x: int, y: int, o: Dictionary = {}) -> Dictionary:
	var hp: int = int(o.get("hp", 5))
	var e: Dictionary = {
		"id": id, "kind": kind,
		"pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": int(o.get("might", 4)), "wits": 1, "speed": int(o.get("speed", 3))},
		"tags": (o.get("tags", []) as Array).duplicate(),
		"maxHp": int(o.get("maxHp", hp)),
	}
	# THE ABSENT-KEY LAW: `post` is one of Entity's nine absent-when-unset
	# fields, so an entity without a post carries no `post` key at all.
	if o.has("post"):
		e["post"] = o["post"]
	return e


func _you(x: int, y: int, hp: int = 10) -> Dictionary:
	return {
		"id": "player", "kind": "you", "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 3, "wits": 3, "speed": 4},
		"tags": [], "maxHp": hp,
	}


## Searches for a counter whose d20 satisfies the predicate, rather than
## hardcoding one — a hardcoded counter silently stops testing the case the
## moment the RNG or the to-hit maths changes.
func _counter_rolling(predicate: Callable) -> int:
	for c in range(5000):
		if predicate.call(SimRng.int_between(SEED, c, 1, 20)):
			return c
	assert_true(false, "no counter found — the generator or the range changed")
	return -1


func _as_event(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate()
	event["id"] = "x"
	event["parent"] = null
	event["seq"] = 0
	return event


func _at(entities: Array, id: String) -> Dictionary:
	return SimEntity.find(entities, id)


# ── describe('the trample (bruiser)') ─────────────────────────────────────

## Bruiser at (5,5) striking east into the player at (6,5); (7,5) is open.
func _line(player_hp: int = 10, opts: Dictionary = {}) -> Dictionary:
	var o: Dictionary = opts.duplicate()
	o["counter"] = _counter_rolling(func(r: int) -> bool: return r >= 10 and r < 20)
	return _room([_being("foe-1", "bruiser", 5, 5), _you(6, 5, player_hp)], o)


func test_shoves_the_target_back_a_pace_and_lumbers_into_the_gap_in_one_event() -> void:
	var state: Dictionary = _line()
	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	assert_eq(draft["type"], "STRIKE")
	var p: Dictionary = draft["payload"]
	assert_true(bool(p["hit"]))
	assert_eq(p["targetTo"], {"x": 7, "y": 5})
	assert_eq(p["attackerTo"], {"x": 6, "y": 5})

	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	var entities: Array = after["entities"]
	assert_eq(_at(entities, "player")["pos"], {"x": 7, "y": 5})
	assert_eq(_at(entities, "foe-1")["pos"], {"x": 6, "y": 5})
	# Still adjacent: the shove that opens a gap would be a self-defeating verb.
	assert_lt(int((_at(entities, "player")["stats"] as Dictionary)["hp"]), 10)


func test_does_not_shove_into_a_wall_the_blow_lands_plain() -> void:
	var draft: Dictionary = SimCommands.attempt_move(_line(10, {"walls": [[7, 5]]}), "foe-1", 1, 0)
	var p: Dictionary = draft["payload"]
	assert_true(bool(p["hit"]))
	# ABSENT, not null: the trample's two fields are spread into the payload
	# only when the shove happens, so a plain blow's payload has no such keys.
	assert_false(p.has("targetTo"), "a walled shove writes no targetTo")
	assert_false(p.has("attackerTo"), "a walled shove writes no attackerTo")


func test_never_shoves_onto_the_way_out() -> void:
	# An exit you are knocked through is not an escape you chose.
	var draft: Dictionary = SimCommands.attempt_move(_line(10, {"exit": [7, 5]}), "foe-1", 1, 0)
	assert_false((draft["payload"] as Dictionary).has("targetTo"))


func test_does_not_shove_through_another_body() -> void:
	var state: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5), _being("foe-2", "skirmisher", 7, 5)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r >= 10 and r < 20)})
	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	assert_false((draft["payload"] as Dictionary).has("targetTo"))


func test_does_not_drive_the_dead_anywhere() -> void:
	# One hit point: any landed blow kills, and a corpse stays where it fell.
	var draft: Dictionary = SimCommands.attempt_move(_line(1), "foe-1", 1, 0)
	var p: Dictionary = draft["payload"]
	assert_true(bool(p["hit"]))
	assert_false(p.has("targetTo"))


func test_is_the_bruisers_verb_not_the_players() -> void:
	var state: Dictionary = _room(
		[_you(5, 5), _being("foe-1", "bruiser", 6, 5)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r >= 11 and r < 20)})
	var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
	assert_false((draft["payload"] as Dictionary).has("targetTo"))


# ── describe('the lunge (skirmisher)') ────────────────────────────────────

func test_decides_to_lunge_at_exactly_two_tiles_of_ground() -> void:
	var state: Dictionary = _room([_being("foe-1", "skirmisher", 5, 5), _you(7, 5)])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "lunge", "targetId": "player"})


func test_crosses_the_free_tile_and_strikes_in_one_event_east_first_on_a_tie() -> void:
	var state: Dictionary = _room(
		[_being("foe-1", "skirmisher", 5, 5), _you(6, 6)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r >= 11 and r < 20)})
	var draft: Variant = SimCommands.lunge_strike(state, "foe-1", "player")
	assert_not_null(draft)
	var p: Dictionary = (draft as Dictionary)["payload"]
	assert_eq(p["attackerTo"], {"x": 6, "y": 5})
	assert_false(p.has("targetTo"), "the lunge crosses ground; it does not trample")

	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	var entities: Array = after["entities"]
	assert_eq(_at(entities, "foe-1")["pos"], {"x": 6, "y": 5})
	assert_lt(int((_at(entities, "player")["stats"] as Dictionary)["hp"]), 10)


func test_still_crosses_the_ground_when_the_blow_misses() -> void:
	var state: Dictionary = _room(
		[_being("foe-1", "skirmisher", 5, 5), _you(7, 5)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r > 1 and r < 11)})
	var draft: Variant = SimCommands.lunge_strike(state, "foe-1", "player")
	assert_not_null(draft)
	var p: Dictionary = (draft as Dictionary)["payload"]
	assert_false(bool(p["hit"]))
	assert_eq(p["attackerTo"], {"x": 6, "y": 5})
	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	var entities: Array = after["entities"]
	assert_eq(_at(entities, "foe-1")["pos"], {"x": 6, "y": 5})
	assert_eq(int((_at(entities, "player")["stats"] as Dictionary)["hp"]), 10)


func test_refuses_when_no_free_tile_lies_on_the_way() -> void:
	var state: Dictionary = _room(
		[_being("foe-1", "skirmisher", 5, 5), _you(7, 5)],
		{"walls": [[6, 5]]})
	# The straight tile is walled and no bent path closes to adjacency in two.
	assert_null(SimCommands.lunge_strike(state, "foe-1", "player"))
	assert_eq((SimAi.decide(state, "foe-1") as Dictionary)["kind"], "step")


func test_refuses_at_any_distance_but_two() -> void:
	var near: Dictionary = _room([_being("foe-1", "skirmisher", 5, 5), _you(6, 5)])
	var far: Dictionary = _room([_being("foe-1", "skirmisher", 5, 5), _you(9, 5)])
	assert_null(SimCommands.lunge_strike(near, "foe-1", "player"))
	assert_null(SimCommands.lunge_strike(far, "foe-1", "player"))


# ── describe('the ambush (stalker)') ──────────────────────────────────────

func test_holds_perfectly_still_while_the_quarry_is_beyond_its_spring() -> void:
	# The stalker stands at x = 5 and the quarry at LITERAL x = 9 — FOUR steps
	# of walking east, one past LURK_RANGE's three.
	#
	# The reference writes `you(5 + LURK_RANGE + 1, 5)`, and this file used to
	# copy it. That form cannot fail: raise the range and the quarry walks the
	# same distance further off, so the coil stays uncommitted and the test
	# stays green. MEASURED during the Wave E review — LURK_RANGE 3 -> 5 failed
	# ZERO of 629 tests. Spelled as a literal, this case and its partner below
	# pin the spring from BOTH sides: at four steps it must hold, at three it
	# must commit, and no other value of LURK_RANGE satisfies both.
	var state: Dictionary = _room([
		_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"]}),
		_you(9, 5),
	])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "wait"},
		"four steps of walking is one past the spring")


func test_commits_when_the_quarry_walks_inside_the_spring() -> void:
	# x = 8 — LITERAL three steps of walking east, exactly the spring's reach.
	# See the test above for why the reference's `5 + LURK_RANGE` is not
	# written here.
	var state: Dictionary = _room([
		_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"]}),
		_you(8, 5),
	])
	assert_eq((SimAi.decide(state, "foe-1") as Dictionary)["kind"], "step",
		"three steps of walking is inside the spring")


func test_hunts_plain_once_the_spring_is_spent() -> void:
	var state: Dictionary = _room([_being("foe-1", "stalker", 5, 5), _you(12, 5)])
	assert_eq((SimAi.decide(state, "foe-1") as Dictionary)["kind"], "step")


func test_rolls_its_first_landed_blow_one_band_harder_then_uncoils() -> void:
	# might 4 rolls 1d3+1 (2..4); the sprung blow rolls the might-6 band,
	# 1d4+2 (3..6). A non-crit landed roll keeps the bands tellable apart.
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 11 and r < 20)
	var state: Dictionary = _room(
		[_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"]}), _you(6, 5)],
		{"counter": counter})
	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	var p: Dictionary = draft["payload"]
	assert_true(bool(p["hit"]))
	assert_eq(p["ambush"], true)
	assert_gte(int(p["damage"]), 3)
	assert_lte(int(p["damage"]), 6)

	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	assert_eq(_at(after["entities"], "foe-1")["tags"], [])

	# The next blow is an ordinary one: the spring spends exactly once.
	var rewound: Dictionary = after.duplicate()
	rewound["rngCounter"] = counter
	var again: Dictionary = SimCommands.attempt_move(rewound, "foe-1", 1, 0)
	var q: Dictionary = again["payload"]
	assert_false(q.has("ambush"), "an uncoiled stalker writes no ambush tag")
	assert_lte(int(q["damage"]), 4)


func test_keeps_the_spring_coiled_through_a_miss() -> void:
	var state: Dictionary = _room(
		[_being("foe-1", "stalker", 5, 5, {"tags": ["ambush"]}), _you(6, 5)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r > 1 and r < 11)})
	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	assert_false((draft["payload"] as Dictionary).has("ambush"))
	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	assert_eq(_at(after["entities"], "foe-1")["tags"], ["ambush"])


func test_is_born_coiled_below_the_teaching_floor_and_springless_on_it() -> void:
	for seed in range(1, 13):
		for depth: int in [1, SimTables.AMBUSH_FROM_DEPTH]:
			var born: Dictionary = SimCommands.create_world(seed, 48, 32, "player", depth)
			for foe: Dictionary in ((born["payload"] as Dictionary)["opponents"] as Array):
				if SimTables.verb_of(foe["kind"]) != "ambush":
					continue
				var want: Array = ["ambush"] if depth >= SimTables.AMBUSH_FROM_DEPTH else []
				assert_eq(foe["tags"], want,
					"seed %d depth %d: %s" % [seed, depth, foe["id"]])


# ── describe('the vigil (warden)') ────────────────────────────────────────

const _POST := {"x": 5, "y": 5}


func _warden(x: int, y: int, hp: int) -> Dictionary:
	return _being("foe-1", "warden", x, y,
		{"hp": hp, "maxHp": 16, "post": _POST, "might": 5, "speed": 2})


func test_hunts_what_comes_inside_the_leash() -> void:
	# The post is (5,5) and the intruder stands at LITERAL x = 10 — five steps
	# of walking, exactly VIGIL_LEASH. The reference writes
	# `you(5 + VIGIL_LEASH, 5)`, which moves with the constant; see the pin at
	# the bottom of this file for what that cost.
	var state: Dictionary = _room([_warden(5, 5, 16), _you(10, 5)])
	assert_eq((SimAi.decide(state, "foe-1") as Dictionary)["kind"], "step",
		"five steps of walking from the post is inside the leash")


func test_will_not_be_drawn_past_the_leash_it_turns_for_home() -> void:
	# Dragged two tiles off its post, the intruder beyond the leash: the warden
	# walks back rather than chasing across the floor. LITERAL x = 12 — seven
	# steps of walking from the post at (5,5), two past the leash.
	var state: Dictionary = _room([_warden(7, 5, 16), _you(12, 5)])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "step", "dx": -1, "dy": 0})


func test_measures_the_leash_from_the_post_not_from_wherever_the_chase_dragged_it() -> void:
	# The intruder stands two tiles from the warden but seven of walking from
	# the post — outside the vigil's world. Home wins.
	var state: Dictionary = _room([_warden(10, 5, 16), _you(12, 5)])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "step", "dx": -1, "dy": 0})


func test_stands_its_post_whole_when_nothing_intrudes() -> void:
	var state: Dictionary = _room([_warden(5, 5, 16), _you(15, 5)])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "wait"})


func test_knits_shut_at_its_post_once_the_intruder_is_gone() -> void:
	var state: Dictionary = _room([_warden(5, 5, 6), _you(15, 5)])
	assert_eq(SimAi.decide(state, "foe-1"), {"kind": "mend"})

	var draft: Dictionary = SimCommands.vigil_kept(state, "foe-1")
	assert_eq(draft["type"], "VIGIL_KEPT")
	assert_eq(int(draft["rngDraws"]), 0)
	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	assert_eq(int((_at(after["entities"], "foe-1")["stats"] as Dictionary)["hp"]), 16)


func test_does_not_mend_while_watched() -> void:
	# Poking a boss buys nothing, running buys less.
	var state: Dictionary = _room([_warden(5, 5, 6), _you(7, 5)])
	# Intruder inside the leash: the warden fights; the wound stays open.
	assert_eq((SimAi.decide(state, "foe-1") as Dictionary)["kind"], "step")


# ── describe('the verbs are the archetypes\'') ────────────────────────────

func test_reads_the_verb_through_a_level_suffix() -> void:
	assert_eq(SimTables.verb_of("bruiser-2"), "trample")
	assert_eq(SimTables.verb_of("warden-3"), "vigil")
	assert_null(SimTables.verb_of("you"))


# ── NON-REFERENCE ─────────────────────────────────────────────────────────

func test_the_ward_drinks_one_landing_blow_whole_and_is_spent_by_it() -> void:
	## NON-REFERENCE. `warded` is STRIKE v5's other new field and the ash
	## ward is resolved at COMMAND time — damage recorded 0, the tag stripped
	## by the reducer on exactly that blow. Its reference suite is
	## tests/core/scrolls.test.ts (Task 2.E3b, which ships the scroll that
	## grants the ward); this task ships the resolution, so without a witness
	## here the one blow path's ward branch would go untested until 2.E3b
	## lands. Named in this task's brief as a hazard, so it gets a guard.
	var counter := _counter_rolling(func(r: int) -> bool: return r >= 11 and r < 20)
	var state: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5)],
		{"counter": counter})
	var warded_player: Dictionary = _you(6, 5)
	warded_player["tags"] = ["warded"]
	state["entities"] = [(state["entities"] as Array)[0], warded_player]

	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	var p: Dictionary = draft["payload"]
	assert_true(bool(p["hit"]), "the ward changes the wound, never the roll")
	assert_eq(p["warded"], true)
	assert_eq(int(p["damage"]), 0, "the ward drinks the blow whole")
	# The draws are spent either way — the ward changes the wound, never the
	# stream. Literal 2, not STRIKE_DRAWS.
	assert_eq(int(draft["rngDraws"]), 2)
	# A landed blow that deals nothing still does not trample: the reference
	# gates the shove on `occupant.stats.hp > outcome.damage`, which holds, so
	# the shove DOES ride along. Pinned as it is, not as it reads.
	assert_eq(p["targetTo"], {"x": 7, "y": 5})

	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	var them: Dictionary = _at(after["entities"], "player")
	assert_eq(int((them["stats"] as Dictionary)["hp"]), 10, "no hit points taken")
	assert_eq(them["tags"], [], "the reducer strips the ward on exactly that blow")


func test_a_miss_never_wards_however_worn_the_ward() -> void:
	## NON-REFERENCE, and the pair to the test above: `warded` is
	## `landing > 0 && tags.includes('warded')`, so a MISS must not consume it.
	## Without this, a ward that fired on every swing would still pass the
	## test above.
	var state: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5)],
		{"counter": _counter_rolling(func(r: int) -> bool: return r > 1 and r < 11)})
	var warded_player: Dictionary = _you(6, 5)
	warded_player["tags"] = ["warded"]
	state["entities"] = [(state["entities"] as Array)[0], warded_player]

	var draft: Dictionary = SimCommands.attempt_move(state, "foe-1", 1, 0)
	var p: Dictionary = draft["payload"]
	assert_false(bool(p["hit"]))
	assert_false(p.has("warded"), "a miss spends no ward")
	var after: Dictionary = SimApply.apply(state, _as_event(draft))
	assert_eq(_at(after["entities"], "player")["tags"], ["warded"], "the ward still stands")


func test_the_set_guard_raises_the_bar_by_two_plus_half_their_wits() -> void:
	## NON-REFERENCE. `needed` carries the brace wall so that the recorded
	## event and every tooltip say the truth the roll actually faced. The
	## arithmetic, spelled out rather than read off brace_wall():
	##   base   = 10 + their speed (4) - my might (4) = 10
	##   wall   = 2 + floor(wits 3 / 2) = 2 + 1 = 3
	##   needed = 13
	## Both numbers are literals here on purpose — a test that computes its
	## expectation from brace_wall() moves with it and can never fail.
	var braced: Dictionary = _you(6, 5)
	braced["tags"] = ["braced"]
	var state: Dictionary = _room([_being("foe-1", "bruiser", 5, 5), braced])

	var plain: Dictionary = SimCommands.resolve_strike(
		SEED, 0, (state["entities"] as Array)[0], _you(6, 5))
	var guarded: Dictionary = SimCommands.resolve_strike(
		SEED, 0, (state["entities"] as Array)[0], braced)
	assert_eq(int(plain["needed"]), 10, "an unguarded target needs 10")
	assert_eq(int(guarded["needed"]), 13, "a set guard needs 13")
	# The roll is the same roll — the guard raises the bar, it does not
	# re-draw. Same seed, same counter, same d20.
	assert_eq(int(plain["roll"]), int(guarded["roll"]))


func test_the_vigils_leash_stands_at_exactly_five_steps_of_walking() -> void:
	## NON-REFERENCE, and it exists because a mutation MEASURED the hole:
	## VIGIL_LEASH 5 -> 6 failed ZERO of 629 tests. verbs.test.ts's own two
	## leash cases stand the intruder at `5 + VIGIL_LEASH` and
	## `5 + VIGIL_LEASH + 2`, so the constant carries them both with it. Even
	## rewritten as the literals 10 and 12 — which they now are — they pin the
	## leash only from BELOW: at five steps it must hunt, at seven it must go
	## home, and 6 satisfies both.
	##
	## The arithmetic, in literal tiles: the post is (5,5), the warden is
	## dragged two east to (7,5) so "home" and "hunt" point opposite ways, and
	## the intruder walks the open floor at y = 5.
	##   x = 10  -> five steps from the post, AT the leash    -> hunts, east
	##   x = 11  -> six steps from the post, ONE past it      -> home, west
	## Nothing but 5 satisfies both lines. Six would hunt the second; four
	## would go home on the first.
	assert_eq(SimAi.decide(_room([_warden(7, 5, 16), _you(10, 5)]), "foe-1"),
		{"kind": "step", "dx": 1, "dy": 0},
		"five steps from the post is inside the leash — it hunts")
	assert_eq(SimAi.decide(_room([_warden(7, 5, 16), _you(11, 5)]), "foe-1"),
		{"kind": "step", "dx": -1, "dy": 0},
		"six steps from the post is one past the leash — it turns for home")
