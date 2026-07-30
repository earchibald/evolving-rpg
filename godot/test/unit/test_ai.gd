extends GutTest
## The brain — the byte-twin of tests/core/ai.test.ts. One test per TS
## `it(...)`, in the TS file's order, so the two suites can be diffed by eye.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference's single describe('decide') block holds 16 cases. 16 = 16
## PORTED + 0 DEFERRED. Line numbers are tests/core/ai.test.ts at ts-baseline:
##   :37  strikes what is next to it
##   :42  does not strike diagonally, because it cannot move that way either
##   :47  closes the larger gap first
##   :53  breaks an exact tie toward x, every time
##   :58  decides the same thing regardless of where it sits in the entity list
##   :69  takes the other axis when its first choice is walled
##   :74  waits when both ways toward you are walled
##   :79  does not walk through another creature
##   :88  walks over the dead
##   :97  ignores you from beyond its awareness
##   :102 cannot smell you through a wall
##   :112 counts the detour, not the crow-flight, and takes it when it is
##        short enough
##   :123 notices you at the very edge of it
##   :128 does nothing when dead
##   :133 does nothing when there is no living quarry
##   :138 draws no randomness at all, so the counter never moves for a decision
##
## Plus TWO tests with no counterpart in the reference, both marked as such
## where they stand at the bottom of this file:
##
## test_a_quarry_off_the_east_edge_is_never_smelled_through_the_wrap guards the
## LATENT HUNT BUG NIGHTLOG records against _first_step (keying a neighbour by
## y*width+x before bounds-checking it), which the reference found and fixed
## but which no reference case exercises — every grid in ai.test.ts is
## borderless, yet no case ever stands the quarry on column 0. Task 2.D2 added
## the twin of this guard to test_reachability.gd for the same reason.
##
## test_the_awareness_wall_stands_at_exactly_eight_walking_steps exists
## because the two reference cases that look like they pin AWARENESS do not.
## Both write the quarry's position AS an offset from the constant —
## `you(5 + AWARENESS + 1, 5)` and `you(5 + AWARENESS, 5)` — so raising
## AWARENESS moves the test's own goalposts with it and the suite stays green.
## MEASURED, not predicted, during Task 2.E2: with only the sixteen ported
## cases present, `mutate-sim.py ai-awareness-plus-one` failed NOTHING —
## 27 scripts, 343 tests, 343 passing, exit 0. The plan's own Step 4 for this
## task ("raise AWARENESS by one; confirm failure") was therefore
## unsatisfiable against the reference suite as written. This test spells the
## distance out in literal tiles instead, which is the only form that can
## fail.
##
## ── Where the REST of decide()'s witnesses live ───────────────────────────
## This file is not the whole guard for ai.gd. `decide` has ten branches and
## ai.test.ts drives only the plain hunt; nine other reference suites import
## `src/core/ai.js` and each belongs to a later task:
##   tests/core/dispositions.test.ts   -> six cases ADOPTED by this task, and
##                                        they live in test_dispositions.gd
##                                        (guard leash, wanderer round)
##   tests/core/volley-mind.test.ts    -> Task 2.E3d (draw/shoot)
##   tests/core/new-verbs.test.ts      -> Task 2.E3d (call, venom)
##   tests/core/player-verbs.test.ts   -> Task 2.E3d (shove, brace)
##   tests/core/mimics.test.ts         -> Task 2.E3c (feign)
##   tests/core/secrets.test.ts        -> Task 2.E3c
##   tests/core/traps.test.ts          -> Task 2.E3c (smoke, alarm)
##   tests/core/verbs.test.ts          -> Task 2.E3a (lunge, vigil, ambush)
##   tests/play/satchel.test.ts        -> Task 2.E3b
## Until those land, ai.gd's vigil, ambush, call, lunge, volley, feign, smoke
## and alarm branches have NO witness anywhere in the migration. Stated here
## rather than left to be discovered.


## The reference's room(): an open 20x12 floor, wide enough that awareness
## rather than geometry is what limits a creature. BORDERLESS on purpose —
## the outermost column IS floor — which is what makes the wrap guard above
## meaningful. Walls are added per test where they matter.
const _ROOM_WIDTH := 20
const _ROOM_HEIGHT := 12


func _room(entities: Array, walls: Array = []) -> Dictionary:
	var tiles: Array = []
	for i in range(_ROOM_WIDTH * _ROOM_HEIGHT):
		tiles.append(SimGrid.FLOOR)
	for w: Array in walls:
		tiles[w[1] * _ROOM_WIDTH + w[0]] = SimGrid.WALL
	return {
		"grid": SimGrid.make(_ROOM_WIDTH, _ROOM_HEIGHT, tiles),
		"entities": entities,
		"items": [],
		"turn": 1,
		"activeEntityId": entities[0]["id"] if entities.size() > 0 else null,
		"seed": 7,
		"rngCounter": 0,
		"rules": [],
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


## The reference's being(id, kind, x, y, hp = 5).
func _being(id: String, kind: String, x: int, y: int, hp: int = 5) -> Dictionary:
	return {
		"id": id, "kind": kind, "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 4, "wits": 1, "speed": 3}, "tags": [], "maxHp": hp,
	}


## The reference's you(x, y, hp = 10).
func _you(x: int, y: int, hp: int = 10) -> Dictionary:
	return _being("player", "you", x, y, hp)


func test_strikes_what_is_next_to_it() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(6, 5)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "strike", "targetId": "player"})


func test_does_not_strike_diagonally_because_it_cannot_move_that_way_either() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(6, 6)])
	assert_eq(SimAi.decide(state, "thing-1")["kind"], "step")


func test_closes_the_larger_gap_first() -> void:
	# Six across, two down: it should move across, not down.
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(11, 7)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 1, "dy": 0})


func test_breaks_an_exact_tie_toward_x_every_time() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(8, 8)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 1, "dy": 0})


func test_decides_the_same_thing_regardless_of_where_it_sits_in_the_entity_list() -> void:
	# The bug this guards is subtle and fatal to replay: if a decision depended
	# on array position, two folds of one log could disagree about what a
	# creature did.
	var creature: Dictionary = _being("thing-1", "thing", 5, 5)
	var player: Dictionary = _you(11, 7)
	var forwards: Dictionary = SimAi.decide(_room([creature, player]), "thing-1")
	var backwards: Dictionary = SimAi.decide(_room([player, creature]), "thing-1")
	assert_eq(forwards, backwards)


func test_takes_the_other_axis_when_its_first_choice_is_walled() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(11, 7)], [[6, 5]])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 0, "dy": 1})


func test_waits_when_both_ways_toward_you_are_walled() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(11, 7)], [[6, 5], [5, 6]])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "wait"})


func test_does_not_walk_through_another_creature() -> void:
	var state: Dictionary = _room([
		_being("thing-1", "thing", 5, 5),
		_being("thing-2", "thing", 6, 5),
		_you(11, 7),
	])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 0, "dy": 1})


func test_walks_over_the_dead() -> void:
	var state: Dictionary = _room([
		_being("thing-1", "thing", 5, 5),
		_being("corpse", "thing", 6, 5, 0),
		_you(11, 7),
	])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "step", "dx": 1, "dy": 0})


func test_ignores_you_from_beyond_its_awareness() -> void:
	var far: Dictionary = _you(5 + SimAi.AWARENESS + 1, 5)
	assert_eq(SimAi.decide(_room([_being("thing-1", "thing", 5, 5), far]), "thing-1"),
		{"kind": "wait"})


func test_cannot_smell_you_through_a_wall() -> void:
	# Four tiles away in a straight line, but the line is bricked over and the
	# way round is longer than awareness. Manhattan distance would say "close";
	# walking distance says "no path", and walking distance is the rule — a
	# wall you cannot walk through is a wall you cannot hunt through.
	var bar: Array = []
	for y in range(_ROOM_HEIGHT):
		bar.append([7, y])
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(9, 5)], bar)
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "wait"})


func test_counts_the_detour_not_the_crow_flight_and_takes_it_when_it_is_short_enough() -> void:
	# Four away in a line, wall in between with a gap two rows down: the walk
	# is seven steps, inside awareness, so the creature sets off along it —
	# stepping the detour's way, not into the brick.
	var wall: Array = [[7, 4], [7, 5], [7, 6]]
	var state: Dictionary = _room([_being("thing-1", "thing", 6, 5), _you(9, 5)], wall)
	var action: Dictionary = SimAi.decide(state, "thing-1")
	assert_eq(action["kind"], "step")
	assert_ne(action, {"kind": "step", "dx": 1, "dy": 0})


func test_notices_you_at_the_very_edge_of_it() -> void:
	var edge: Dictionary = _you(5 + SimAi.AWARENESS, 5)
	assert_eq(SimAi.decide(_room([_being("thing-1", "thing", 5, 5), edge]), "thing-1")["kind"],
		"step")


func test_does_nothing_when_dead() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5, 0), _you(6, 5)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "wait"})


func test_does_nothing_when_there_is_no_living_quarry() -> void:
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(6, 5, 0)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "wait"})


func test_draws_no_randomness_at_all_so_the_counter_never_moves_for_a_decision() -> void:
	# Stated as a property because it is the reason creatures decide this way:
	# randomness here would have to be threaded through the counter protocol on
	# every creature's every turn, and replay would then hinge on the order they
	# were asked in.
	var state: Dictionary = _room([_being("thing-1", "thing", 5, 5), _you(11, 7)])
	var first: Dictionary = SimAi.decide(state, "thing-1")
	for i in range(50):
		assert_eq(SimAi.decide(state, "thing-1"), first)
	# The reference asserts only the repeatability; the counter half of its own
	# title is checked here too, because in GDScript a decision COULD reach
	# SimRng and the reference's `expect` could not have caught it either way.
	assert_eq(state["rngCounter"], 0, "no decision spends a draw")


# ── not reference cases: the two things ai.test.ts cannot catch ─────────────


func test_the_awareness_wall_stands_at_exactly_eight_walking_steps() -> void:
	# NOT ported from ai.test.ts. Its two awareness cases place the quarry at
	# `5 + AWARENESS` and `5 + AWARENESS + 1`, so the constant moves them with
	# it and neither can ever witness AWARENESS drifting. The distances here
	# are LITERAL tiles on an open floor, which is what makes the number
	# falsifiable: eight steps of walking is noticed, nine is not.
	var hunter: Dictionary = _being("thing-1", "thing", 5, 5)
	assert_eq(SimAi.decide(_room([hunter, _you(13, 5)]), "thing-1"),
		{"kind": "step", "dx": 1, "dy": 0}, "eight steps away: the hunt is on")
	assert_eq(SimAi.decide(_room([hunter, _you(14, 5)]), "thing-1"),
		{"kind": "wait"}, "nine steps away: beyond the wall of awareness")


# ── not a reference case: the wrap NIGHTLOG records ─────────────────────────


func test_a_quarry_off_the_east_edge_is_never_smelled_through_the_wrap() -> void:
	# NOT ported from ai.test.ts — there is no such case. `_first_step`'s key
	# is plain y*width+x, so one column EAST of the map is the next row's west
	# door by arithmetic: key(20, 5) == key(0, 6) on a 20-wide board. Bounds
	# are therefore checked BEFORE the key, never after. NIGHTLOG records this
	# exact bug alive in the reference's hunt ("a quarry at x=0 read reachable
	# one step EAST off the world"), found by borderless test grids like this
	# file's own room().
	#
	# The hunter stands on the last column; the quarry stands on column 0 of
	# the NEXT row. Their true walking distance is 20 — far beyond awareness —
	# so the only way a step comes back at all is through the wrap.
	var state: Dictionary = _room([_being("thing-1", "thing", _ROOM_WIDTH - 1, 5), _you(0, 6)])
	assert_eq(SimAi.decide(state, "thing-1"), {"kind": "wait"})
