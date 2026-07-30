extends GutTest
## The item family's loot suite — the byte-twin of tests/core/loot.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can
## be diffed by eye.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 15 cases across four describe blocks.
## 15 = 14 PORTED + 1 DEFERRED. Line numbers are tests/core/loot.test.ts at
## ts-baseline.
##
## describe('the chosen take is answered either way') — 4
##   :80  a bare floor refuses out loud: nothing
##   :89  heart-sealed hands over a provision refuse out loud: sealed, naming
##        the item
##   :100 a strict downgrade is still TAKEN when chosen — the "no better
##        than" line was the liar
##   :108 a refusal spends no turn and folds to nothing
##
## describe('the dominance rule') — 5
##   :117 takes a strict upgrade by walking, as ever
##   :122 refuses a tradeoff underfoot — the price is nobody's to pay unasked
##   :129 takes the tradeoff deliberately, price and all
##   :140 leaves a sidegrade lying until chosen
##   :147 is exactly "at least as good everywhere, better in total"
##
## describe('the named properties') — 3
##   :155 steady boots hold the ground a trample would take
##   :167 the sure edge sends a crit survivor reeling
##   :183 reads traits off worn gear alone
##
## describe('the flare') — 3
##   :191 records where it burst and how far
##   :223 stands third in the teaching trio, which still owns floor one
##
## ── Deferrals ──────────────────────────────────────────────────────────
## :202 "is spent for knowledge: the fog admits the circle, walls included"
##      — DEFERRED to Phase 3 (`stage/`, the task that ports src/ui/fov.ts's
##      `fogAt`). No `SimFov`/fog derivation exists anywhere in `godot/sim/`
##      yet — the migration plan places fog under the presentation layer
##      (master-plan.md:738, "stage/board/ ... repaint on WORLD_INIT"), not
##      under the sim port this task belongs to. The ITEM_USED command side
##      this test also exercises (`useCarried` producing the flare's effect)
##      IS ported and covered above, by "records where it burst and how far".


const _GRANTLESS := {"hp": 0, "might": 0, "wits": 0, "speed": 0}


func _room(entities: Array, items: Array, walls: Array = [], counter: int = 0) -> Dictionary:
	var width := 20
	var height := 12
	var tiles: Array = []
	for i in range(width * height):
		tiles.append(SimGrid.FLOOR)
	for w: Array in walls:
		tiles[int(w[1]) * width + int(w[0])] = SimGrid.WALL
	return {
		"grid": SimGrid.make(width, height, tiles),
		"entities": entities,
		"items": items,
		"turn": 1,
		"activeEntityId": (entities[0] as Dictionary)["id"] if entities.size() > 0 else null,
		"seed": 5,
		"rngCounter": counter,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 3,
		"gold": 0,
		"story": "", "motif": null, "bodies": [], "bible": null, "smoke": null,
		"traps": [], "alarm": null, "unveiled": [],
	}


func _you(x: int, y: int, gear: Variant = null, satchel: Variant = null) -> Dictionary:
	var e: Dictionary = {
		"id": "player", "kind": "you", "pos": {"x": x, "y": y},
		"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": [], "maxHp": 10,
	}
	if gear != null:
		e["gear"] = gear
	if satchel != null:
		e["satchel"] = satchel
	return e


func _being(id: String, kind: String, x: int, y: int, hp: int = 8, gear: Variant = null) -> Dictionary:
	var e: Dictionary = {
		"id": id, "kind": kind, "pos": {"x": x, "y": y},
		"stats": {"hp": hp, "might": 4, "wits": 1, "speed": 3}, "tags": [], "maxHp": hp,
	}
	if gear != null:
		e["gear"] = gear
	return e


func _relic_item(kind: String, grants: Dictionary, x: int, y: int) -> Dictionary:
	return {"id": "it-%s" % kind, "kind": kind, "pos": {"x": x, "y": y}, "grants": grants}


func _find_armory(kind: String) -> Dictionary:
	for r: Dictionary in SimTables.ARMORY:
		if r["kind"] == kind:
			return r
	assert_true(false, "no armory relic named %s" % kind)
	return {}


## Searches for a counter that rolls to satisfy `predicate`, rather than
## hardcoding one — a hardcoded counter would silently stop testing the
## branch it targets the moment the RNG or the to-hit maths changed.
func _counter_rolling(predicate: Callable) -> int:
	for c in range(5000):
		if predicate.call(SimRng.int_between(5, c, 1, 20)):
			return c
	assert_true(false, "no counter found — the generator or the range changed")
	return -1


func _seal(draft: Dictionary) -> Dictionary:
	var event: Dictionary = draft.duplicate(true)
	event["id"] = "x"
	event["parent"] = null
	event["seq"] = 0
	return event


# ── describe('the chosen take is answered either way') ───────────────────

func test_a_bare_floor_refuses_out_loud_nothing() -> void:
	var draft: Variant = SimCommands.take_or_refuse(_room([_you(5, 5)], []), "player")
	assert_not_null(draft)
	var d: Dictionary = draft
	assert_eq(d["type"], "ITEM_REFUSED")
	var p: Dictionary = d["payload"]
	assert_eq(p["reason"], "nothing")
	assert_null(p["itemId"])
	assert_eq(int(d["rngDraws"]), 0)


func test_heart_sealed_hands_over_a_provision_refuse_out_loud_sealed_naming_the_item() -> void:
	var state: Dictionary = _room(
		[_you(5, 5, null, [{"kind": SimTables.HEART_KIND}])],
		[{"id": "p1", "kind": "still smoke", "pos": {"x": 5, "y": 5}, "grants": _GRANTLESS}])
	var draft: Dictionary = SimCommands.take_or_refuse(state, "player")
	assert_eq(draft["type"], "ITEM_REFUSED")
	var p: Dictionary = draft["payload"]
	assert_eq(p["reason"], "sealed")
	assert_eq(p["itemId"], "p1")


func test_a_strict_downgrade_is_still_taken_when_chosen_the_no_better_than_line_was_the_liar() -> void:
	var worn: Dictionary = {"weapon": {"kind": "keen edge", "grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0}}}
	var state: Dictionary = _room(
		[_you(5, 5, worn)],
		[_relic_item("wax blade", {"hp": 0, "might": 1, "wits": 0, "speed": 0}, 5, 5)])
	assert_null(SimCommands.take_underfoot(state, "player"))
	var draft: Variant = SimCommands.take_or_refuse(state, "player")
	assert_eq((draft as Dictionary)["type"], "ITEM_TAKEN")


func test_a_refusal_spends_no_turn_and_folds_to_nothing() -> void:
	var state: Dictionary = _room([_you(5, 5)], [])
	var draft: Dictionary = SimCommands.take_or_refuse(state, "player")
	assert_false(SimCommands.ends_turn(draft))
	assert_eq(SimApply.apply(state, _seal(draft)), state)


# ── describe('the dominance rule') ────────────────────────────────────────

func test_takes_a_strict_upgrade_by_walking_as_ever() -> void:
	var state: Dictionary = _room([_you(5, 5)], [_relic_item("keen edge", {"hp": 0, "might": 2, "wits": 0, "speed": 0}, 5, 5)])
	assert_not_null(SimCommands.take_underfoot(state, "player"))


func test_refuses_a_tradeoff_underfoot_the_price_is_nobodys_to_pay_unasked() -> void:
	var heavy: Dictionary = SimTables.relic_grant(_find_armory("heavy edge"), 1)
	assert_lt(int(heavy["speed"]), 0)
	var state: Dictionary = _room([_you(5, 5)], [_relic_item("heavy edge", heavy, 5, 5)])
	assert_null(SimCommands.take_underfoot(state, "player"))


func test_takes_the_tradeoff_deliberately_price_and_all() -> void:
	var heavy: Dictionary = SimTables.relic_grant(_find_armory("heavy edge"), 1)
	var state: Dictionary = _room([_you(5, 5)], [_relic_item("heavy edge", heavy, 5, 5)])
	var draft: Variant = SimCommands.take_underfoot(state, "player", true)
	assert_not_null(draft)
	var after: Dictionary = SimApply.apply(state, _seal(draft as Dictionary))
	var me: Dictionary = SimEntity.find(after["entities"], "player")
	assert_eq(int((me["stats"] as Dictionary)["might"]), 3 + int(heavy["might"]))
	assert_eq(int((me["stats"] as Dictionary)["speed"]), 4 + int(heavy["speed"]))


func test_leaves_a_sidegrade_lying_until_chosen() -> void:
	var worn: Dictionary = {"weapon": {"kind": "keen edge", "grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0}}}
	var state: Dictionary = _room(
		[_you(5, 5, worn)],
		[_relic_item("sure edge", {"hp": 0, "might": 2, "wits": 0, "speed": 0}, 5, 5)])
	assert_null(SimCommands.take_underfoot(state, "player"))
	assert_not_null(SimCommands.take_underfoot(state, "player", true))


func test_is_exactly_at_least_as_good_everywhere_better_in_total() -> void:
	assert_true(SimTables.dominates(
		{"hp": 0, "might": 3, "wits": 0, "speed": 0}, {"hp": 0, "might": 2, "wits": 0, "speed": 0}))
	assert_false(SimTables.dominates({"hp": 0, "might": 3, "wits": 0, "speed": -1}, _GRANTLESS))
	assert_false(SimTables.dominates(
		{"hp": 0, "might": 2, "wits": 0, "speed": 0}, {"hp": 0, "might": 2, "wits": 0, "speed": 0}))


# ── describe('the named properties') ──────────────────────────────────────

func test_steady_boots_hold_the_ground_a_trample_would_take() -> void:
	var boots: Dictionary = {"boots": {"kind": "steady boots", "grants": {"hp": 0, "might": 0, "wits": 0, "speed": 1}}}
	var counter: int = _counter_rolling(func(r: int) -> bool: return r >= 12 and r < 20)
	var held: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5, boots)], [], [], counter)
	var blow: Dictionary = (SimCommands.attempt_move(held, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_true(bool(blow["hit"]))
	assert_false(blow.has("targetTo"))

	var bare: Dictionary = _room(
		[_being("foe-1", "bruiser", 5, 5), _you(6, 5)], [], [], counter)
	var bare_blow: Dictionary = (SimCommands.attempt_move(bare, "foe-1", 1, 0) as Dictionary)["payload"]
	assert_true(bare_blow.has("targetTo"))


func test_the_sure_edge_sends_a_crit_survivor_reeling() -> void:
	var sure: Dictionary = {"weapon": {"kind": "sure edge", "grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0}}}
	var counter: int = _counter_rolling(func(r: int) -> bool: return r >= SimTables.crit_floor(3))
	var state: Dictionary = _room(
		[_you(5, 5, sure), _being("foe-1", "bruiser", 6, 5, 30)], [], [], counter)
	var draft: Dictionary = SimCommands.attempt_move(state, "player", 1, 0)
	assert_true(bool((draft["payload"] as Dictionary)["crit"]))
	var after: Dictionary = SimApply.apply(state, _seal(draft))
	var foe: Dictionary = SimEntity.find(after["entities"], "foe-1")
	assert_true((foe["tags"] as Array).has("staggered"))

	var plain: Dictionary = _room(
		[_you(5, 5), _being("foe-1", "bruiser", 6, 5, 30)], [], [], counter)
	var bare_draft: Dictionary = SimCommands.attempt_move(plain, "player", 1, 0)
	var bare: Dictionary = SimApply.apply(plain, _seal(bare_draft))
	var bare_foe: Dictionary = SimEntity.find(bare["entities"], "foe-1")
	assert_false((bare_foe["tags"] as Array).has("staggered"))


func test_reads_traits_off_worn_gear_alone() -> void:
	assert_true(SimTables.wears_trait({"weapon": {"kind": "sure edge"}}, "stagger-crit"))
	assert_false(SimTables.wears_trait({"weapon": {"kind": "keen edge"}}, "stagger-crit"))
	assert_false(SimTables.wears_trait(null, "hold-ground"))


# ── describe('the flare') ──────────────────────────────────────────────────

func test_records_where_it_burst_and_how_far() -> void:
	var state: Dictionary = _room([_you(5, 5, null, [{"kind": "tallow flare"}])], [])
	var used: Variant = SimCommands.use_carried(state, "player")
	assert_not_null(used)
	var d: Dictionary = used
	assert_eq(int(d["rngDraws"]), 0)
	# The LITERAL 7, not SimTables.FLARE_RADIUS. The reference writes the
	# constant into its expected payload, so the recorded radius is compared
	# against the very number that produced it and no drift can show —
	# MEASURED during the Wave E review: FLARE_RADIUS 7 -> 9 failed ZERO of
	# 629 tests. Seven is how far the flare's knowledge reaches; if that
	# changes, this line is meant to be edited by hand.
	assert_eq(d["payload"]["effect"], {"kind": "flare", "at": {"x": 5, "y": 5}, "radius": 7})
	var after: Dictionary = SimApply.apply(state, _seal(d))
	var player: Dictionary = SimEntity.find(after["entities"], "player")
	assert_false(player.has("satchel"))


# :202 "is spent for knowledge: the fog admits the circle, walls included"
# is DEFERRED — see the file header's Deferrals section. fogAt has no port
# anywhere in godot/sim/ yet; it belongs to Phase 3 (stage/).


func test_stands_third_in_the_teaching_trio_which_still_owns_floor_one() -> void:
	var first_three: Array = []
	for i in range(3):
		first_three.append((SimTables.PROVISIONS[i] as Dictionary)["kind"])
	assert_eq(first_three, ["vital draught", "still smoke", "tallow flare"])
	var at_one: Array = []
	for p: Dictionary in SimTables.provisions_at(1):
		at_one.append(p["kind"])
	assert_eq(at_one, ["vital draught", "still smoke", "tallow flare"])
