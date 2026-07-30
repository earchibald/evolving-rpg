extends GutTest
## The volley commands — the byte-twin of tests/core/volley-commands.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye.
##
## Draw, mark, loose. The command-time gates are covenant M7 (the line, the
## reach) and M8 (no shot unfired stances) made real.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 12 cases across three describe blocks.
## 12 = 12 PORTED + 0 DEFERRED. Line numbers are
## tests/core/volley-commands.test.ts at ts-baseline.
##
## describe('drawStance — who may even lift the thing') — 2
##   :51  a slinger may; a skirmisher may not
##   :61  the bare player may not; the slung player may; a drawn one is done
##        drawing
##
## describe('shotTarget — the mark, chosen the same way forever') — 5
##   :72  picks the nearest hostile in the disc with a clear line
##   :81  refuses the adjacent — the bump owns range 1
##   :89  a body on the line disqualifies the one behind it
##   :99  a wall on the line refuses; past the disc refuses
##   :112 breaks a tie of distance by birth order
##
## describe('looseShot — the shot itself') — 5
##   :129 refuses the undrawn — covenant M8's gate
##   :133 flies on the shared dice, two draws, mode ranged, no movement riders
##   :145 faces the raised bar of a set guard
##   :154 refuses the adjacent, the blocked, and the out-of-reach
##   :172 through the chain: a killing shot pays XP, and the stance is spent
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## ONE test at the bottom of this file has no counterpart in the reference:
##   test_the_shots_two_draws_are_the_two_CONSECUTIVE_draws_it_declares
## The reference's :133 asserts the draw COUNT (2) and the `needed` bar, and
## never looks at the roll or the damage at all — so the entire ranged blow
## path could be drawing from any offsets whatsoever and the whole suite would
## stay green. Task 2.E3a measured that blindness on the MELEE path and pinned
## it there; `loose_shot` is a second door into the same dice and gets its own
## pin, because a family that shares a blow path must also share its proofs.


const _SEED := 41

## The sling, worn in the `weapon` slot exactly as the reference's fixture
## wears it. `wears_trait` reads every slot, so the slot is not the gate — the
## RELIC_TRAITS entry for "leaden sling" is.
const _SLING := {"weapon": {"kind": "leaden sling",
	"grants": {"hp": 0, "might": 1, "wits": 0, "speed": 0}}}


var _seq := 0


## The reference's world(seeds, rows?): seeds[0] is the player, the rest are
## opponents. `rows` paints the floor with '#' for wall; absent means an open
## 8x1 corridor.
func _world(seeds: Array, rows: Array = []) -> Dictionary:
	return SimApply.apply(SimState.empty(), _init_event(seeds, rows))


func _init_event(seeds: Array, rows: Array = []) -> Dictionary:
	var width: int = str(rows[0]).length() if not rows.is_empty() else 8
	var height: int = rows.size() if not rows.is_empty() else 1
	var tiles: Array = []
	if rows.is_empty():
		for i in range(width * height):
			tiles.append(SimGrid.FLOOR)
	else:
		for row: String in rows:
			for i in range(row.length()):
				tiles.append(SimGrid.WALL if row[i] == "#" else SimGrid.FLOOR)

	var player: Dictionary = seeds[0]
	var opponents: Array = []
	for i in range(1, seeds.size()):
		var o: Dictionary = seeds[i]
		opponents.append({
			"id": o["id"], "kind": o["kind"], "pos": {"x": int(o["x"]), "y": int(o["y"])},
			"stats": {"hp": int(o["hp"]) if o.has("hp") else 4, "might": 2, "wits": 2, "speed": 2},
			"tags": o["tags"] if o.has("tags") else [],
		})

	var payload: Dictionary = {
		"width": width, "height": height, "tiles": tiles, "seed": _SEED, "items": [],
		"player": {
			"id": player["id"], "kind": player["kind"],
			"pos": {"x": int(player["x"]), "y": int(player["y"])},
			"stats": {
				"hp": int(player["hp"]) if player.has("hp") else 10,
				"might": int(player["might"]) if player.has("might") else 3,
				"wits": 3, "speed": 4,
			},
			"tags": player["tags"] if player.has("tags") else [],
		},
		"opponents": opponents,
	}
	# ABSENT, never null, when the player wears nothing.
	if player.has("gear"):
		payload["playerGear"] = player["gear"]

	_seq += 1
	var event: Dictionary = SimEvents.draft("WORLD_INIT", 0, 0, payload)
	event["id"] = "w%d" % _seq
	event["parent"] = null
	event["seq"] = 0
	return event


# ── describe('drawStance — who may even lift the thing') ──────────────────

func test_a_slinger_may_a_skirmisher_may_not() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 4, "y": 0},
		{"id": "foe-2", "kind": "skirmisher", "x": 6, "y": 0},
	])
	assert_eq((SimCommands.draw_stance(s, "foe-1") as Dictionary)["type"], "DRAWN")
	assert_null(SimCommands.draw_stance(s, "foe-2"), "a skirmisher has nothing to lift")


func test_the_bare_player_may_not_the_slung_player_may_a_drawn_one_is_done_drawing() -> void:
	var bare: Dictionary = _world([{"id": "player", "kind": "you", "x": 0, "y": 0}])
	assert_null(SimCommands.draw_stance(bare, "player"), "bare hands throw nothing")
	var armed: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING}])
	assert_eq((SimCommands.draw_stance(armed, "player") as Dictionary)["type"], "DRAWN")
	var held: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": ["drawn"]}])
	assert_null(SimCommands.draw_stance(held, "player"), "a mispress, not a turn")


# ── describe('shotTarget — the mark, chosen the same way forever') ────────

func test_picks_the_nearest_hostile_in_the_disc_with_a_clear_line() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING},
		{"id": "far", "kind": "slinger", "x": 5, "y": 0},
		{"id": "near", "kind": "skirmisher", "x": 3, "y": 0},
	])
	assert_eq((SimCommands.shot_target(s, "player") as Dictionary)["id"], "near")


func test_refuses_the_adjacent_the_bump_owns_range_1() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING},
		{"id": "close", "kind": "skirmisher", "x": 1, "y": 0},
	])
	assert_null(SimCommands.shot_target(s, "player"))


func test_a_body_on_the_line_disqualifies_the_one_behind_it() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING},
		{"id": "shield", "kind": "bruiser", "x": 2, "y": 0},
		{"id": "behind", "kind": "slinger", "x": 4, "y": 0},
	])
	# The shield itself is a legal mark (range 2); the one behind is not.
	assert_eq((SimCommands.shot_target(s, "player") as Dictionary)["id"], "shield")


func test_a_wall_on_the_line_refuses_past_the_disc_refuses() -> void:
	var walled: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING},
		{"id": "hidden", "kind": "slinger", "x": 4, "y": 0},
	], ["..#....."])
	assert_null(SimCommands.shot_target(walled, "player"))
	var past: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING},
		{"id": "distant", "kind": "slinger", "x": 6, "y": 0},
	])
	assert_null(SimCommands.shot_target(past, "player"))


func test_breaks_a_tie_of_distance_by_birth_order() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 2, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 0, "y": 0},
		{"id": "foe-2", "kind": "slinger", "x": 4, "y": 0},
	])
	assert_eq((SimCommands.shot_target(s, "foe-1") as Dictionary)["id"], "player")
	assert_eq((SimCommands.shot_target(s, "player") as Dictionary)["id"], "foe-1")


# ── describe('looseShot — the shot itself') ───────────────────────────────

## The reference's armedWorld(): a slung, drawn player and a slinger three
## tiles down an open corridor.
func _armed_world(tags: Array = ["drawn"]) -> Dictionary:
	return _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": tags},
		{"id": "foe-1", "kind": "slinger", "x": 3, "y": 0},
	])


func test_refuses_the_undrawn_covenant_m8s_gate() -> void:
	assert_null(SimCommands.loose_shot(_armed_world([]), "player", "foe-1"),
		"no shot without the warning that precedes it")


func test_flies_on_the_shared_dice_two_draws_mode_ranged_no_movement_riders() -> void:
	var draft: Variant = SimCommands.loose_shot(_armed_world(), "player", "foe-1")
	assert_not_null(draft)
	var d: Dictionary = draft
	assert_eq(d["type"], "STRIKE")
	assert_eq(int(d["rngDraws"]), SimCommands.STRIKE_DRAWS)
	var p: Dictionary = d["payload"]
	assert_eq(p["mode"], "ranged")
	assert_eq(int(p["needed"]), SimTables.needed_to_hit(3, 2))
	# ABSENT, never null: a stone moves nothing but blood.
	assert_false(p.has("attackerTo"), "the archer does not travel with the stone")
	assert_false(p.has("targetTo"), "and the mark is not driven back by it")


func test_faces_the_raised_bar_of_a_set_guard() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": ["drawn"]},
		{"id": "foe-1", "kind": "slinger", "x": 3, "y": 0, "tags": ["braced"]},
	])
	var p: Dictionary = (SimCommands.loose_shot(s, "player", "foe-1") as Dictionary)["payload"]
	assert_eq(int(p["needed"]), SimTables.needed_to_hit(3, 2) + SimTables.brace_wall(2),
		"the guard raises the bar against a stone too")


func test_refuses_the_adjacent_the_blocked_and_the_out_of_reach() -> void:
	var adjacent: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": ["drawn"]},
		{"id": "foe-1", "kind": "slinger", "x": 1, "y": 0},
	])
	assert_null(SimCommands.loose_shot(adjacent, "player", "foe-1"), "the bump owns range 1")
	var blocked: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": ["drawn"]},
		{"id": "foe-1", "kind": "slinger", "x": 4, "y": 0},
	], ["..#....."])
	assert_null(SimCommands.loose_shot(blocked, "player", "foe-1"), "a wall stops a stone")
	var far: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0, "gear": _SLING, "tags": ["drawn"]},
		{"id": "foe-1", "kind": "slinger", "x": 6, "y": 0},
	])
	assert_null(SimCommands.loose_shot(far, "player", "foe-1"), "past the disc is past the disc")


func test_through_the_chain_a_killing_shot_pays_xp_and_the_stance_is_spent() -> void:
	# Seated on a real chain so the shot folds like live play.
	var log: SimLog = SimLog.new()
	var born: Dictionary = log.append(null, SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 8, "height": 1, "tiles": _floor_row(8), "seed": _SEED, "items": [],
		"playerGear": _SLING,
		"player": {
			"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 9, "wits": 3, "speed": 4}, "tags": ["drawn"],
		},
		"opponents": [{
			"id": "foe-1", "kind": "slinger", "pos": {"x": 2, "y": 0},
			"stats": {"hp": 1, "might": 2, "wits": 2, "speed": 2}, "tags": [],
		}],
	}))
	var state: Dictionary = log.fold(born["id"])
	var draft: Variant = SimCommands.loose_shot(state, "player", "foe-1")
	assert_not_null(draft)
	# might 9's damage floor is 5 — the shot kills whatever the roll, unless it
	# misses; walk the possibility honestly instead of pinning the die.
	var done: Dictionary = log.append(born["id"], draft)
	var after: Dictionary = log.fold(done["id"])
	assert_does_not_have(SimEntity.find(after["entities"], "player")["tags"], "drawn",
		"the stance is spent by the loosing")
	var foe_hp: int = int((SimEntity.find(after["entities"], "foe-1")["stats"] as Dictionary)["hp"])
	if bool((draft as Dictionary)["payload"]["hit"]):
		assert_eq(foe_hp, 0)
		assert_gt(int(after["xp"]), 0)
	else:
		assert_eq(foe_hp, 1)


func _floor_row(n: int) -> Array:
	var out: Array = []
	for i in range(n):
		out.append(SimGrid.FLOOR)
	return out


# ── non-reference ─────────────────────────────────────────────────────────

func test_the_shots_two_draws_are_the_two_CONSECUTIVE_draws_it_declares() -> void:
	## NON-REFERENCE. :133 above checks that the shot declares TWO draws and
	## that `needed` is the right bar — and never reads `roll` or `damage` at
	## all. So the ranged path could draw its roll and its damage from any pair
	## of counters in the stream and every reference case here would still pass.
	##
	## Task 2.E3a MEASURED exactly that on the melee path: moving the damage
	## draw off `counter + 1` failed NOTHING across 456 tests, because every
	## damage assertion in the reference is a RANGE and the golden run re-hashes
	## rather than re-derives. `loose_shot` is the second door into the same
	## dice, so it gets the same pin: the roll is the counter's OWN draw and the
	## damage is the very next one, recomputed from SimRng on the test's side of
	## the fence so the two cannot move together.
	##
	## The band is spelled as literals rather than read back through
	## damage_dice(): might 3 is the 1d3+1 band. Deriving it from the table
	## would be deriving the expectation from the thing it guards.
	var counter := 1  # seed 41, counter 1 rolls 14 — a hit, well under the crit floor
	var s: Dictionary = _armed_world()
	s = s.duplicate()
	s["rngCounter"] = counter

	var d: Dictionary = SimCommands.loose_shot(s, "player", "foe-1")
	assert_eq(int(d["rngCounter"]), counter, "the draft declares where it started")
	var p: Dictionary = d["payload"]

	# The roll is drawn at the counter the event declares.
	assert_eq(int(p["roll"]), SimRng.int_between(_SEED, counter, 1, 20), "the roll is draw one")
	# ...and the damage is the very next draw, undoubled because this is no crit.
	assert_true(bool(p["hit"]), "the chosen counter lands the shot")
	assert_false(bool(p["crit"]), "and rolls under the crit floor")
	assert_eq(int(p["damage"]), SimRng.int_between(_SEED, counter + 1, 1, 3) + 1,
		"the damage is draw two, immediately after the roll")

	# The two draws are genuinely different numbers at these counters, so an
	# offset that collapsed them onto each other could not pass by coincidence.
	assert_ne(SimRng.int_between(_SEED, counter, 1, 20),
		SimRng.int_between(_SEED, counter + 1, 1, 20),
		"roll and damage do not share a draw")
