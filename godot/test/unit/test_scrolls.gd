extends GutTest
## The item family's scrolls suite — the byte-twin of tests/core/scrolls.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can
## be diffed by eye.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 11 cases across three describe blocks.
## 11 = 10 PORTED + 1 DEFERRED. Line numbers are tests/core/scrolls.test.ts
## at ts-baseline.
##
## describe('reading') — 6
##   :57  unveiling names every hidden door and every waiting trap, and the
##        reducer keeps both
##   :78  the still hour reels everything hostile and breathing — except the
##        hidden lie
##   :93  the trap eater eats what it can walk to, and the eaten ground reads
##        as spent
##   :105 the blink step lands clear of every hostile, drawn and recorded
##   :121 stone song breaks only plain wall, never the border, and the grid
##        truly opens
##   :136 empty hands read nothing; the heart seals the reading
##
## describe('the scroll hand') — 2
##   :147 walking fills an empty hand; a held scroll waits for the deliberate
##        swap, which mints the old one down
##   :163 crosses the stairs like everything carried
##
## describe('the shelf and the labels') — 2
##   :175 floors lay scrolls from depth 2, visible items on honest tiles
##   :203 the deeper shelf only ever grows
##
## ── Deferrals ──────────────────────────────────────────────────────────
## :191 "labels are per-world, deterministic, and never shared between
##      kinds" — DEFERRED to Phase 5 (the task that ports canon/namesmith.ts,
##      master-plan.md:781: "Sonnet ports ... canon/{bible,namesmith,
##      rulesmith,chronicler}.ts"). `scrollLabel` has no port anywhere in
##      `godot/sim/` yet — no `canon/` directory exists under `sim/` at all,
##      only the two files (interpret.gd, rule.gd) Wave E itself consumes.
##
## ── Non-reference tests, and why each exists ──────────────────────────────
## TWO tests under the banner at the bottom of this file have no counterpart
## in scrolls.test.ts, so the file holds 12. Both are boundary pins on a
## constant a mutation MEASURED as unguarded:
##
##   test_the_blinks_clearance_stands_at_exactly_four_steps_of_walking
##   test_the_trap_eaters_reach_stops_at_three_steps_of_walking
##
## The reference's :105 and :93 both write their expectation as the constant
## itself (`>= BLINK_CLEAR`, `5 + TRAP_EATER_REACH`), so both goalposts move
## together and neither case can witness the number drifting. Changed and
## measured: `BLINK_CLEAR` 4 -> 6 and `TRAP_EATER_REACH` 3 -> 5 each failed
## ZERO of 629 tests. The ported cases now spell their tiles as literals and
## these two pin the boundary from both sides. Rows for both live in
## scripts/mutate-sim.py.
##
## :121 (stone song) was also given the witness its own name promises — the
## reference's fixture makes both of its loops iterate zero times. Disclosed
## in full at the test itself; the reference's assertions are untouched, a
## second reading beside real interior wall is added beneath them.


func _default_tiles() -> Array:
	var width := 24
	var height := 12
	var tiles: Array = []
	for i in range(width * height):
		tiles.append(SimGrid.WALL)
	for y in range(1, height - 1):
		for x in range(1, width - 1):
			tiles[y * width + x] = SimGrid.FLOOR
	return tiles


func _default_grid() -> Dictionary:
	return SimGrid.make(24, 12, _default_tiles())


func _room(entities: Array, grid: Variant = null, traps: Array = [], items: Array = []) -> Dictionary:
	var g: Dictionary = grid if grid != null else _default_grid()
	return {
		"grid": g,
		"entities": entities,
		"items": items,
		"turn": 1,
		"activeEntityId": (entities[0] as Dictionary)["id"] if entities.size() > 0 else null,
		"seed": 7,
		"rngCounter": 0,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 4,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": traps, "alarm": null, "unveiled": [],
	}


func _you(x: int, y: int, over: Dictionary = {}) -> Dictionary:
	var e: Dictionary = {
		"id": "player", "kind": "you", "pos": {"x": x, "y": y},
		"stats": {"hp": 12, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 12,
	}
	for k: String in over:
		e[k] = over[k]
	return e


func _foe(id: String, x: int, y: int) -> Dictionary:
	return {
		"id": id, "kind": "bruiser", "pos": {"x": x, "y": y},
		"stats": {"hp": 7, "might": 4, "wits": 1, "speed": 1}, "tags": [], "maxHp": 7,
	}


func _holding(kind: String) -> Dictionary:
	return {"scroll": {"kind": kind}}


func _sealed(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate(true)
	event["id"] = "e"
	event["parent"] = null
	event["seq"] = 1
	return event


func _trap(id: String, x: int, y: int) -> Dictionary:
	return {
		"id": id, "kind": "spike pit", "pos": {"x": x, "y": y}, "level": 2,
		"sightRolled": false, "nearRolled": false, "revealed": false, "sprung": false,
	}


# ── describe('reading') ────────────────────────────────────────────────────

func test_unveiling_names_every_hidden_door_and_every_waiting_trap_and_the_reducer_keeps_both() -> void:
	var tiles: Array = _default_tiles()
	tiles[5 * 24 + 12] = SimGrid.SECRET
	var state: Dictionary = _room(
		[_you(3, 3, _holding("scroll of unveiling"))],
		SimGrid.make(24, 12, tiles),
		[_trap("trap-1", 20, 9)])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "unveiling")
	assert_eq(effect["secrets"], [{"x": 12, "y": 5}])
	assert_eq(effect["traps"], ["trap-1"])
	assert_true(SimCommands.ends_turn(draft))

	var after: Dictionary = SimApply.apply(state, _sealed(draft))
	assert_eq(after["unveiled"], [{"x": 12, "y": 5}])
	var after_traps: Array = after["traps"]
	assert_true(bool((after_traps[0] as Dictionary)["revealed"]))
	assert_false(bool((after_traps[0] as Dictionary)["sprung"]))
	var after_entities: Array = after["entities"]
	assert_false((after_entities[0] as Dictionary).has("scroll"))


func test_the_still_hour_reels_everything_hostile_and_breathing_except_the_hidden_lie() -> void:
	var mimic: Dictionary = _foe("mimic-1", 15, 5)
	mimic["kind"] = "mimic"
	mimic["tags"] = ["hidden"]
	mimic["guise"] = "vital draught"
	var state: Dictionary = _room([
		_you(3, 3, _holding("scroll of the still hour")),
		_foe("foe-1", 10, 3),
		_foe("foe-2", 20, 9),
		mimic,
	])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "still hour")
	var staggered: Array = (effect["staggered"] as Array).duplicate()
	staggered.sort()
	assert_eq(staggered, ["foe-1", "foe-2"])
	var after: Dictionary = SimApply.apply(state, _sealed(draft))
	var foe1: Dictionary = SimEntity.find(after["entities"], "foe-1")
	assert_true((foe1["tags"] as Array).has("staggered"))
	var mimic_after: Dictionary = SimEntity.find(after["entities"], "mimic-1")
	assert_false((mimic_after["tags"] as Array).has("staggered"))


func test_the_trap_eater_eats_what_it_can_walk_to_and_the_eaten_ground_reads_as_spent() -> void:
	# The reader stands at (5,5) and trap-1 at LITERAL (8,5) — three steps of
	# walking east, which is what TRAP_EATER_REACH is. The reference writes
	# `5 + TRAP_EATER_REACH`; spelled out here because an expectation derived
	# from the constant it guards moves both goalposts together and can never
	# fail. Even as a literal this case only pins the reach from BELOW — a
	# longer reach still eats a trap three steps away — so the boundary itself
	# is pinned by test_the_trap_eaters_reach_stops_at_three_steps_of_walking
	# under the NON-REFERENCE banner at the bottom of this file.
	var state: Dictionary = _room(
		[_you(5, 5, _holding("scroll of the trap eater"))],
		null,
		[_trap("trap-1", 8, 5), _trap("trap-2", 20, 9)])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "trap eater")
	assert_eq(effect["eaten"], ["trap-1"])
	var after: Dictionary = SimApply.apply(state, _sealed(draft))
	var t1: Dictionary = {}
	var t2: Dictionary = {}
	for t: Dictionary in (after["traps"] as Array):
		if t["id"] == "trap-1":
			t1 = t
		elif t["id"] == "trap-2":
			t2 = t
	assert_true(bool(t1["sprung"]))
	assert_false(bool(t2["sprung"]))


func test_the_blink_step_lands_clear_of_every_hostile_drawn_and_recorded() -> void:
	var state: Dictionary = _room([
		_you(3, 3, _holding("scroll of the blink step")),
		_foe("foe-1", 4, 3),
	])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "blink")
	var to: Dictionary = effect["to"]
	assert_eq(int(draft["rngDraws"]), 1)
	# The LITERAL 4, not SimTables.BLINK_CLEAR: the reference writes the
	# constant, which re-reads the bound the flood itself enforced, so both
	# sides of the comparison move together and no drift can show. Manhattan is
	# a lower bound on walking, so this stays the strict check. A one-sided
	# floor still cannot see the clearance GROW; the exact boundary is pinned by
	# test_the_blinks_clearance_stands_at_exactly_four_steps_of_walking under
	# the NON-REFERENCE banner at the bottom of this file.
	assert_gte(absi(int(to["x"]) - 4) + absi(int(to["y"]) - 3), 4)
	var after: Dictionary = SimApply.apply(state, _sealed(draft))
	var after_entities: Array = after["entities"]
	assert_eq((after_entities[0] as Dictionary)["pos"], to)


func test_stone_song_breaks_only_plain_wall_never_the_border_and_the_grid_truly_opens() -> void:
	# ── the reference's own fixture, unchanged: the reader beside the border ──
	# Its two loops iterate ZERO times, and that is a property of the REFERENCE,
	# not of this port: room() is floor everywhere inside the border, the scan
	# clamps to x,y in 1..3 around a reader at (1,1), so every candidate is
	# floor and `broken` comes back empty. MEASURED by the Wave E reviewer:
	# removing the border clamp moved the run's assert total 63338 -> 63359,
	# i.e. these loops contributed exactly 0 asserts before and 21 after.
	#
	# The half that IS witnessed here is the important one — the clamp. With it
	# gone, the border wall enters `broken` and assert_gt(b.x, 0) fails.
	var state: Dictionary = _room([_you(1, 1, _holding("scroll of stone song"))])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "stone song")
	var broken: Array = effect["broken"]
	for b: Dictionary in broken:
		assert_gt(int(b["x"]), 0)
		assert_gt(int(b["y"]), 0)
	var after: Dictionary = SimApply.apply(state, _sealed(draft))
	for b: Dictionary in broken:
		assert_eq(SimGrid.tile_at(after["grid"], int(b["x"]), int(b["y"])), SimGrid.FLOOR)

	# ── the half of the case's own name that the reference never witnesses ──
	# "and the grid truly opens" had no witness anywhere, in any run, ever. A
	# second reading, beside REAL interior wall, gives it one. The reader stands
	# at (2,2); the walls are laid by hand at (4,2), (3,3), (2,4) and (4,4).
	#
	# SUNDER_RADIUS is 2 and the disc keeps `dx*dx + dy*dy <= r*r + r` = 6:
	#   (4,2)  dx 2, dy 0 -> 4  breaks
	#   (3,3)  dx 1, dy 1 -> 2  breaks
	#   (2,4)  dx 0, dy 2 -> 4  breaks
	#   (4,4)  dx 2, dy 2 -> 8  OUTSIDE the disc — stays wall
	# Written as literals: the count 3, the tiles themselves, and the corner
	# left standing. A reader at (2,2) also keeps the border half alive, because
	# the unclamped window would reach column 0 and row 0.
	var tiles: Array = _default_tiles()
	tiles[2 * 24 + 4] = SimGrid.WALL
	tiles[3 * 24 + 3] = SimGrid.WALL
	tiles[4 * 24 + 2] = SimGrid.WALL
	tiles[4 * 24 + 4] = SimGrid.WALL
	var walled: Dictionary = _room(
		[_you(2, 2, _holding("scroll of stone song"))], SimGrid.make(24, 12, tiles))
	var song: Dictionary = SimCommands.read_scroll(walled, "player")
	var sung: Array = ((song["payload"] as Dictionary)["effect"] as Dictionary)["broken"]
	assert_eq(sung.size(), 3, "three walls stand inside the disc")
	assert_eq(sung, [{"x": 4, "y": 2}, {"x": 3, "y": 3}, {"x": 2, "y": 4}])
	var opened: Dictionary = SimApply.apply(walled, _sealed(song))
	for b: Dictionary in sung:
		assert_gt(int(b["x"]), 0)
		assert_gt(int(b["y"]), 0)
		assert_eq(SimGrid.tile_at(opened["grid"], int(b["x"]), int(b["y"])), SimGrid.FLOOR,
			"the grid truly opens at %d,%d" % [int(b["x"]), int(b["y"])])
	assert_eq(SimGrid.tile_at(opened["grid"], 4, 4), SimGrid.WALL,
		"the corner lies outside the disc and keeps its shape")


func test_empty_hands_read_nothing_the_heart_seals_the_reading() -> void:
	assert_null(SimCommands.read_scroll(_room([_you(3, 3)]), "player"))
	var over: Dictionary = _holding("scroll of the blink step")
	over["satchel"] = [{"kind": SimTables.HEART_KIND}]
	var carrying: Dictionary = _room([_you(3, 3, over)])
	assert_null(SimCommands.read_scroll(carrying, "player"))


# ── describe('the scroll hand') ────────────────────────────────────────────

func test_walking_fills_an_empty_hand_a_held_scroll_waits_for_the_deliberate_swap_which_mints_the_old_one_down() -> void:
	var lying: Dictionary = {"id": "scroll-1", "kind": "scroll of unveiling", "pos": {"x": 3, "y": 3}, "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0}}
	var bare: Dictionary = _room([_you(3, 3)], null, [], [lying])
	var took: Variant = SimCommands.take_underfoot(bare, "player")
	assert_eq((took as Dictionary)["payload"]["scroll"], {"swappedOut": null})

	var full: Dictionary = _room([_you(3, 3, _holding("scroll of stone song"))], null, [], [lying])
	assert_null(SimCommands.take_underfoot(full, "player"))
	var swapped: Variant = SimCommands.take_underfoot(full, "player", true)
	assert_eq((swapped as Dictionary)["payload"]["scroll"], {"swappedOut": "scroll of stone song"})

	var after: Dictionary = SimApply.apply(full, _sealed(swapped as Dictionary))
	var after_entities: Array = after["entities"]
	assert_eq((after_entities[0] as Dictionary)["scroll"], {"kind": "scroll of unveiling"})
	var found_dropped := false
	for i: Dictionary in (after["items"] as Array):
		if i["kind"] == "scroll of stone song" and int(i["pos"]["x"]) == 3 and int(i["pos"]["y"]) == 3:
			found_dropped = true
	assert_true(found_dropped)


func test_crosses_the_stairs_like_everything_carried() -> void:
	var carried: Dictionary = {
		"stats": {"hp": 12, "might": 4, "wits": 3, "speed": 4}, "maxHp": 14, "xp": 80, "level": 4,
		"scroll": {"kind": "scroll of the blink step"},
	}
	var born: Dictionary = SimCommands.create_world(9, 48, 32, "player", 5, carried)
	assert_eq((born["payload"] as Dictionary)["playerScroll"], {"kind": "scroll of the blink step"})
	var base: Dictionary = _room([])
	base["entities"] = []
	var folded: Dictionary = SimApply.apply(base, _sealed(born))
	var you_entity: Variant = null
	for e: Dictionary in (folded["entities"] as Array):
		if e["kind"] == "you":
			you_entity = e
			break
	assert_eq((you_entity as Dictionary)["scroll"], {"kind": "scroll of the blink step"})


# ── describe('the shelf and the labels') ──────────────────────────────────

func test_floors_lay_scrolls_from_depth_2_visible_items_on_honest_tiles() -> void:
	var laid := 0
	for seed in range(1, 41):
		var d1: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 1)
		var d1_items: Array = (d1["payload"] as Dictionary)["items"]
		var d1_has_scroll := false
		for i: Dictionary in d1_items:
			if i["id"] == "scroll-1":
				d1_has_scroll = true
		assert_false(d1_has_scroll, "depth 1 laid a scroll at seed %d" % seed)

		var d3: Dictionary = SimCommands.create_world(seed, 96, 64, "player", 3)
		var d3_payload: Dictionary = d3["payload"]
		var page: Variant = null
		for i: Dictionary in (d3_payload["items"] as Array):
			if i["id"] == "scroll-1":
				page = i
				break
		if page == null:
			continue
		laid += 1
		var kinds: Array = []
		for s: Dictionary in SimTables.scrolls_at(3):
			kinds.append(s["kind"])
		assert_true(kinds.has((page as Dictionary)["kind"]))
		var page_pos: Dictionary = (page as Dictionary)["pos"]
		var on_opponent := false
		for o: Dictionary in (d3_payload["opponents"] as Array):
			if int(o["pos"]["x"]) == int(page_pos["x"]) and int(o["pos"]["y"]) == int(page_pos["y"]):
				on_opponent = true
		assert_false(on_opponent, "seed %d: the scroll shares a tile with an opponent" % seed)
		var on_trap := false
		if d3_payload.has("traps"):
			for t: Dictionary in (d3_payload["traps"] as Array):
				if int(t["pos"]["x"]) == int(page_pos["x"]) and int(t["pos"]["y"]) == int(page_pos["y"]):
					on_trap = true
		assert_false(on_trap, "seed %d: the scroll shares a tile with a trap" % seed)
	assert_gt(laid, 4)


# :191 "labels are per-world, deterministic, and never shared between
# kinds" is DEFERRED — see the file header's Deferrals section. scrollLabel
# (canon/namesmith.ts) has no port anywhere in godot/sim/ yet.


func test_the_deeper_shelf_only_ever_grows() -> void:
	assert_gt(SimTables.scrolls_at(2).size(), 0)
	assert_gte(SimTables.scrolls_at(4).size(), SimTables.scrolls_at(2).size())
	var at9: Array = []
	for s: Dictionary in SimTables.scrolls_at(9):
		at9.append(s["kind"])
	var all: Array = []
	for s: Dictionary in SimTables.SCROLLS:
		all.append(s["kind"])
	assert_eq(at9, all)


# ── NON-REFERENCE ─────────────────────────────────────────────────────────
# Two boundary pins. Both constants they guard were changed with ZERO tests
# failing, because every assertion that named them read its expectation OFF
# them — the exact anti-pattern this migration's quality rules forbid.


func test_the_blinks_clearance_stands_at_exactly_four_steps_of_walking() -> void:
	## NON-REFERENCE, and it exists because a mutation MEASURED the hole:
	## BLINK_CLEAR 4 -> 6 failed nothing in 629 tests. scrolls.test.ts's own
	## case asserts `|to - foe| >= BLINK_CLEAR`, which re-reads the bound the
	## flood just enforced — a WIDER clearance satisfies it even harder.
	##
	## The arithmetic, spelled out: the flood marks every tile within
	## BLINK_CLEAR steps of a hostile as forbidden, so the nearest tile the
	## blink may choose stands at BLINK_CLEAR + 1 = 5 steps of walking. Both
	## fixtures are one-tile corridors at y = 1 with the reader at x = 3 and
	## the one hostile at x = 4, so walking distance from the hostile is just
	## |x - 4| and the whole question is where the corridor ends.
	##
	##   floor x in 1..8   nothing reaches 5 -> the page is spent, the reader
	##                     stands exactly where it stood, 0 draws
	##   floor x in 1..9   exactly one tile reaches 5 -> x = 9, 1 draw
	##
	## Raise the clearance to 5 and the second corridor empties too; lower it
	## to 3 and the first corridor blinks to x = 8 instead of standing still.
	## Pinned from both sides, in literal tiles.
	var spent: Dictionary = SimCommands.read_scroll(_blink_corridor(10), "player")
	var spent_effect: Dictionary = (spent["payload"] as Dictionary)["effect"]
	assert_eq(int(spent["rngDraws"]), 0, "nowhere clear: nothing is drawn")
	assert_eq(spent_effect["to"], {"x": 3, "y": 1},
		"an eight-tile corridor holds no tile five steps off the foe")

	var blinked: Dictionary = SimCommands.read_scroll(_blink_corridor(11), "player")
	var blink_effect: Dictionary = (blinked["payload"] as Dictionary)["effect"]
	assert_eq(int(blinked["rngDraws"]), 1)
	assert_eq(blink_effect["to"], {"x": 9, "y": 1},
		"the one tile at five steps is the one tile the blink may take")


## A one-tile corridor `width` wide: wall everywhere but y = 1, x in
## 1..width-2. The reader holds the blink at (3,1); one hostile stands at
## (4,1). Local to the boundary pin above — the file's own _room() is an open
## 24x12 hall, where the clearance never binds.
func _blink_corridor(width: int) -> Dictionary:
	var height := 3
	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.WALL)
	for x in range(1, width - 1):
		tiles[width + x] = SimGrid.FLOOR
	return _room(
		[_you(3, 1, _holding("scroll of the blink step")), _foe("foe-1", 4, 1)],
		SimGrid.make(width, height, tiles))


func test_the_trap_eaters_reach_stops_at_three_steps_of_walking() -> void:
	## NON-REFERENCE, and it exists because a mutation MEASURED the hole:
	## TRAP_EATER_REACH 3 -> 5 failed nothing in 629 tests. scrolls.test.ts's
	## own case lays its near trap at `5 + TRAP_EATER_REACH` and its far one
	## nineteen steps off, so ANY reach from 3 to 18 eats exactly one trap.
	##
	## The arithmetic, in literal tiles on a one-tile corridor at y = 1: the
	## reader stands at x = 5, `trap-near` at x = 8 (three steps — eaten) and
	## `trap-far` at x = 9 (FOUR steps — the first one past the reach, and it
	## must survive). Lengthen the reach and trap-far joins the meal; shorten
	## it and trap-near stops being one.
	var width := 26
	var height := 3
	var tiles: Array = []
	tiles.resize(width * height)
	tiles.fill(SimGrid.WALL)
	for x in range(1, width - 1):
		tiles[width + x] = SimGrid.FLOOR
	var state: Dictionary = _room(
		[_you(5, 1, _holding("scroll of the trap eater"))],
		SimGrid.make(width, height, tiles),
		[_trap("trap-near", 8, 1), _trap("trap-far", 9, 1)])
	var draft: Dictionary = SimCommands.read_scroll(state, "player")
	var effect: Dictionary = (draft["payload"] as Dictionary)["effect"]
	assert_eq(effect["kind"], "trap eater")
	assert_eq(effect["eaten"], ["trap-near"],
		"three steps is inside the reach and four steps is not")
