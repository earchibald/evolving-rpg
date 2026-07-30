extends GutTest
## Whose turn it is — the byte-twin of tests/core/turns.test.ts. One test per
## TS `it(...)`, in the TS file's order, so the two suites can be diffed by
## eye: 10 of 10 ported (4 under the reference's `describe('initiativeOrder')`,
## 6 under `describe('nextActive')`). Nothing is deferred.
##
## One test beyond the ported ten, with no TS counterpart:
##
## - test_a_non_active_roster_member_dying_mid_round_does_not_disturb_the_wrap
##   closes a gap flagged by Increment 1's own review of turns.ts: no existing
##   case calls next_active on a roster that mixes a LIVING active entity with
##   a DEAD member who is NOT the active one. Every ported death case
##   (leaves_out_the_dead, has_nobody_active_when_everyone_is_dead) puts the
##   casualty at the whole roster's edge or makes it the only entity; none
##   puts a corpse in the roster while stepping past a different, living
##   member. Cheap to close directly — a pure function, no fixture needed —
##   by choosing the active entity to be the LAST survivor in the (filtered)
##   initiative order while a dead, non-active entity would have been last of
##   all in the UNFILTERED roster, so an implementation that indexed or took
##   a modulus against the wrong length answers this one differently from
##   every ported case above it.


func _entity(id: String, speed: int, hp: int = 5) -> Dictionary:
	return {
		"id": id,
		"kind": "test",
		"pos": {"x": 0, "y": 0},
		"stats": {"hp": hp, "might": 1, "wits": 1, "speed": speed},
		"tags": [],
		"maxHp": hp,
	}


## The shared three-entity roster the reference's `describe('nextActive', ...)`
## builds once at module scope — a(9), b(5), c(1), already in initiative
## order. Rebuilt fresh per call rather than cached (see test_sight.gd's
## _open() for why that is safe here: immutable data, no GUT lifecycle
## dependency).
func _roster() -> Array:
	return [_entity("a", 9), _entity("b", 5), _entity("c", 1)]


# ── initiativeOrder (tests/core/turns.test.ts:8-30) ─────────────────────────


func test_orders_by_speed_fastest_first() -> void:
	var order: Array = SimTurns.initiative_order([_entity("slow", 1), _entity("fast", 9), _entity("mid", 5)])
	assert_eq(order, ["fast", "mid", "slow"])


## THE mutation-critical case: two input orderings that disagree on nothing
## but the tie-break must still land on the SAME output. A reversed
## (descending-id) tie-break would leave "backwards" at ['c','b','a'] as-is
## (already "sorted" by its own broken rule) and turn "forwards" into
## ['c','b','a'] too — BOTH assertions below fail, not just one. See
## scripts/mutate-sim.py's "turns-tiebreak-reversed" row for the measured
## proof (Task 2.E1 report has the observed failure output).
func test_breaks_speed_ties_by_ascending_id_so_order_never_depends_on_input_order() -> void:
	var forwards: Array = SimTurns.initiative_order([_entity("a", 4), _entity("b", 4), _entity("c", 4)])
	var backwards: Array = SimTurns.initiative_order([_entity("c", 4), _entity("b", 4), _entity("a", 4)])
	assert_eq(forwards, ["a", "b", "c"])
	assert_eq(backwards, ["a", "b", "c"])


func test_leaves_out_the_dead() -> void:
	var order: Array = SimTurns.initiative_order([_entity("alive", 3), _entity("dead", 9, 0)])
	assert_eq(order, ["alive"])


func test_does_not_mutate_its_input() -> void:
	var list: Array = [_entity("slow", 1), _entity("fast", 9)]
	SimTurns.initiative_order(list)
	var ids: Array = []
	for e: Dictionary in list:
		ids.append(e["id"])
	assert_eq(ids, ["slow", "fast"])


# ── nextActive (tests/core/turns.test.ts:32-59) ─────────────────────────────


func test_starts_at_the_fastest_when_nobody_is_active() -> void:
	assert_eq(SimTurns.next_active(_roster(), null), {"activeEntityId": "a", "wrapped": false})


func test_steps_down_the_order_without_wrapping() -> void:
	assert_eq(SimTurns.next_active(_roster(), "a"), {"activeEntityId": "b", "wrapped": false})
	assert_eq(SimTurns.next_active(_roster(), "b"), {"activeEntityId": "c", "wrapped": false})


func test_wraps_after_the_last_which_is_what_ends_a_round() -> void:
	assert_eq(SimTurns.next_active(_roster(), "c"), {"activeEntityId": "a", "wrapped": true})


func test_restarts_the_order_and_reports_a_wrap_when_the_active_entity_has_left() -> void:
	assert_eq(SimTurns.next_active(_roster(), "gone"), {"activeEntityId": "a", "wrapped": true})


func test_has_nobody_active_when_everyone_is_dead() -> void:
	assert_eq(SimTurns.next_active([_entity("a", 9, 0)], "a"), {"activeEntityId": null, "wrapped": false})


func test_stays_on_the_only_survivor_and_reports_a_wrap_each_time() -> void:
	assert_eq(SimTurns.next_active([_entity("solo", 4)], "solo"), {"activeEntityId": "solo", "wrapped": true})


# ── beyond the ported suite ──────────────────────────────────────────────────


func test_a_non_active_roster_member_dying_mid_round_does_not_disturb_the_wrap() -> void:
	# b is alive and active, and is the LAST survivor once c (dead) is
	# excluded from initiative order — so the correct wrap (b -> a) depends
	# on computing "last" against the ALIVE order (size 2), not the raw
	# roster (size 3). c is dead but is neither the active entity nor
	# adjacent to it in id or speed, so nothing about this case is reachable
	# by accident from any of the ported cases above.
	var entities: Array = [_entity("a", 9), _entity("b", 5), _entity("c", 1, 0)]
	assert_eq(SimTurns.next_active(entities, "b"), {"activeEntityId": "a", "wrapped": true})
