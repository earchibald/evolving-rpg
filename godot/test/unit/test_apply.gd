extends GutTest
## SimApply — the reducer's laws, exercised across ALL TWENTY-FIVE event types.
##
## WHY THIS FILE OPENS WITH A TABLE RATHER THAN PORTED CASES. The golden run
## exercises only 5 of the 25 types (WORLD_INIT, MOVE, STRIKE, TURN_ADVANCED,
## ITEM_TAKEN), so the 2.F1 fold gate proves five of this reducer's cases and
## says nothing about the other twenty. `_events()` below builds one live event
## per type and every law in this section runs against all of them, which is the
## only place in the migration where all 25 cases are executed at once.
##
## The ported behavioural cases from tests/core/apply.test.ts follow the laws.
## Sibling suites: test_leveling.gd (tests/core/leveling.test.ts) and
## test_dispositions.gd (tests/core/dispositions.test.ts).
##
## The four laws here are the ones Task 2.C1 was specifically charged with,
## because nothing else in the migration can hold them:
##   1. PURITY. TypeScript froze EMPTY_STATE, so a reducer mutating the fold's
##      accumulator threw AT the mutation site. SimState.empty() returns a fresh
##      Dictionary, which kills the shared-baseline corruption but makes an
##      in-place mutation fail SILENTLY — a hash mismatch hundreds of events
##      from its cause. test_no_event_type_touches_the_state_it_was_handed is
##      the replacement for that lost freeze.
##   2. SHAPE. SimState.assert_shape on every returned state.
##   3. NO FRACTIONAL NUMBERS. SimTables.bounty_stretch and mean_damage return
##      floats. SimCanonical.encode REFUSES a fractional number, so a coefficient
##      reaching GameState un-rounded either crashes the encoder or forks the
##      hash. Every returned state is walked to the leaves.
##   4. THE ABSENT-KEY LAW, guarded where it can actually break. test_entity.gd's
##      version is tautological and known to be — it hand-builds a literal
##      without the optional keys and asserts the literal lacks them, and
##      entity.gd has no builder that could ever fail it. WORLD_INIT here is
##      where entities are really CONSTRUCTED, so this is the law's only
##      non-tautological guard in the whole port.


## ── the world every law runs against ────────────────────────────────────
##
## Five bodies, chosen so that between them the 25 events below reach every
## branch worth reaching: a player carrying a satchel and a scroll, a staggered
## brute (WAIT's clearing arm), a braced warden (STRIKE's overcommit arm and
## BRACED/DRAWN's replacement), a wandering pocket-carrier already burning and
## snared (TURN_ADVANCED's tick, _drop_pockets' spill), and a hidden mimic
## (UNMASKED).

const _NO_GRANTS := {"hp": 0, "might": 0, "wits": 0, "speed": 0}


func _tiles(w: int, h: int) -> Array:
	var out: Array = []
	for i in range(w * h):
		out.append(SimGrid.FLOOR)
	return out


func _world_payload() -> Dictionary:
	return {
		"width": 7,
		"height": 7,
		"tiles": _tiles(7, 7),
		"seed": 4242,
		"player": {
			"id": "player", "kind": "player", "pos": {"x": 1, "y": 1},
			"stats": {"hp": 10, "might": 3, "wits": 2, "speed": 3}, "tags": [],
		},
		"opponents": [
			{
				"id": "brute", "kind": "bruiser", "pos": {"x": 3, "y": 1},
				"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 1}, "tags": ["staggered"],
			},
			{
				"id": "warden", "kind": "warden", "pos": {"x": 5, "y": 5},
				"stats": {"hp": 6, "might": 3, "wits": 2, "speed": 2}, "tags": ["braced"],
				"disposition": "guard",
			},
			{
				"id": "walker", "kind": "skirmisher", "pos": {"x": 1, "y": 5},
				"stats": {"hp": 4, "might": 2, "wits": 1, "speed": 3},
				"tags": ["venom-2", "snared-2"],
				"disposition": "wander",
				"route": [{"x": 1, "y": 5}, {"x": 2, "y": 5}],
				"pocket": {"kind": "provision", "grants": _NO_GRANTS.duplicate()},
			},
			{
				"id": "mimic", "kind": "mimic", "pos": {"x": 6, "y": 1},
				"stats": {"hp": 3, "might": 3, "wits": 1, "speed": 2}, "tags": ["hidden"],
				"guise": "relic",
			},
		],
		"items": [
			{"id": "relic-1", "kind": "relic", "pos": {"x": 2, "y": 2},
				"grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0}},
			{"id": "provision-1", "kind": "provision", "pos": {"x": 4, "y": 4},
				"grants": _NO_GRANTS.duplicate()},
		],
		"traps": [{"id": "trap-1", "kind": "spikes", "pos": {"x": 6, "y": 6}, "level": 1}],
		"playerSatchel": {"kinds": ["draught", "smoke"]},
		"playerScroll": {"kind": "unveiling"},
	}


func _world_init() -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 9, _world_payload())


func _born() -> Dictionary:
	return SimApply.apply(SimState.empty(), _world_init())


## A ratified rule, shaped as SimRule.validate returns one. The reducer stores
## it opaquely — RULE_RATIFIED never reads inside it — so this is a shape, not a
## behaviour, and test_rule.gd owns what makes a rule valid.
func _a_rule() -> Dictionary:
	return {
		"id": "rule-1", "when": "WAIT", "require": [], "then": [{"kind": "heal", "n": 1}],
		"provenance": "the wall spoke", "ratifiedAt": 1,
	}


## One live event per event type, keyed by type. Every law below runs the whole
## table, which is what makes this file the only place all 25 reducer cases are
## executed. Draw counts vary on purpose so the counter law has something to
## discriminate.
func _events() -> Dictionary:
	return {
		"WORLD_INIT": _world_init(),
		"WORLD_BIBLE": SimEvents.draft("WORLD_BIBLE", 9, 0,
			{"bible": {"name": "the vale", "line": "cold stone, colder water"}}),
		"WORLD_BODIES": SimEvents.draft("WORLD_BODIES", 9, 0, {"bodies": [{"x": 2, "y": 2}]}),
		"MOVE": SimEvents.draft("MOVE", 9, 0, {"entityId": "walker", "to": {"x": 2, "y": 5}}),
		"MOVE_BLOCKED": SimEvents.draft("MOVE_BLOCKED", 9, 0,
			{"entityId": "player", "to": {"x": 0, "y": 1}}),
		"WAIT": SimEvents.draft("WAIT", 9, 0, {"entityId": "brute"}),
		"DRAWN": SimEvents.draft("DRAWN", 9, 0, {"entityId": "warden"}),
		"BRACED": SimEvents.draft("BRACED", 9, 0, {"entityId": "player"}),
		"ITEM_TAKEN": SimEvents.draft("ITEM_TAKEN", 9, 0, {
			"entityId": "player", "itemId": "relic-1",
			"grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0},
		}),
		"ITEM_REFUSED": SimEvents.draft("ITEM_REFUSED", 9, 0,
			{"entityId": "player", "itemId": "provision-1", "reason": "both hands are full"}),
		"ITEM_USED": SimEvents.draft("ITEM_USED", 9, 0, {
			"entityId": "player", "slot": 0,
			"effect": {"kind": "draught", "healedTo": 10, "ceilingTo": 12},
		}),
		"SCROLL_READ": SimEvents.draft("SCROLL_READ", 9, 0, {
			"entityId": "player",
			"effect": {"kind": "unveiling", "secrets": [{"x": 3, "y": 3}], "traps": ["trap-1"]},
		}),
		"GOLD_MOVED": SimEvents.draft("GOLD_MOVED", 9, 0, {"delta": 5, "reason": "loot"}),
		"RULE_RATIFIED": SimEvents.draft("RULE_RATIFIED", 9, 0, {"rule": _a_rule()}),
		"RULE_FIRED": SimEvents.draft("RULE_FIRED", 9, 0, {
			"ruleId": "rule-1", "actorId": "player",
			"outcomes": [{"kind": "health", "entityId": "brute", "to": 0}],
		}),
		"VIGIL_KEPT": SimEvents.draft("VIGIL_KEPT", 9, 0, {"entityId": "warden"}),
		"WORLD_STIRRED": SimEvents.draft("WORLD_STIRRED", 9, 3, {"opponents": [{
			"id": "risen-1", "kind": "skirmisher", "pos": {"x": 4, "y": 1},
			"stats": {"hp": 4, "might": 2, "wits": 1, "speed": 3}, "tags": [],
		}]}),
		"SHOVE": SimEvents.draft("SHOVE", 9, 0, {
			"shoverId": "player", "targetId": "brute", "to": {"x": 4, "y": 1},
			"slammed": false, "struckId": null,
		}),
		"STRIKE": SimEvents.draft("STRIKE", 9, 2, {
			"attackerId": "player", "targetId": "brute", "hit": true, "damage": 2, "crit": false,
		}),
		"CALLED": SimEvents.draft("CALLED", 9, 4, {"callerId": "warden", "opponents": [{
			"id": "answer-1", "kind": "bruiser", "pos": {"x": 5, "y": 4},
			"stats": {"hp": 7, "might": 4, "wits": 1, "speed": 1}, "tags": [],
		}]}),
		"WORLD_REMEMBERED": SimEvents.draft("WORLD_REMEMBERED", 9, 0,
			{"story": "walked out with nothing"}),
		"UNMASKED": SimEvents.draft("UNMASKED", 9, 0, {"mimicId": "mimic"}),
		"TRAP_SENSED": SimEvents.draft("TRAP_SENSED", 9, 1,
			{"trapId": "trap-1", "method": "sight", "revealed": true}),
		"TRAP_SPRUNG": SimEvents.draft("TRAP_SPRUNG", 9, 1, {
			"trapId": "trap-1", "victimId": "player", "dodged": false,
			"effect": {"kind": "spikes", "damage": 2},
		}),
		"TURN_ADVANCED": SimEvents.draft("TURN_ADVANCED", 9, 0,
			{"turn": 2, "activeEntityId": "brute"}),
	}


## The state each event is applied to: WORLD_INIT replaces the world wholesale
## and so starts from nothing; everything else starts from a born world.
func _before(type: String) -> Dictionary:
	return SimState.empty() if type == "WORLD_INIT" else _born()


# ── LAW 0: the table itself ──────────────────────────────────────────────

func test_every_event_type_the_engine_knows_has_a_representative_here() -> void:
	## Without this, adding a 26th event type would silently escape all four
	## laws below — the table would simply not mention it and every loop would
	## still pass. SCHEMA_VERSIONS is the engine's own list of what exists.
	var covered: Array = _events().keys()
	covered.sort()
	var known: Array = SimEvents.SCHEMA_VERSIONS.keys()
	known.sort()
	assert_eq(covered, known, "one representative event per known type")
	assert_eq(covered.size(), 25, "twenty-five event types")


func test_the_five_types_the_golden_run_actually_witnesses_are_named() -> void:
	## The measured fact this whole file exists for, pinned so it cannot rot
	## into folklore: the fold gate covers these five and no others.
	var witnessed := ["ITEM_TAKEN", "MOVE", "STRIKE", "TURN_ADVANCED", "WORLD_INIT"]
	for type: String in witnessed:
		assert_true(SimEvents.SCHEMA_VERSIONS.has(type), "%s is a real type" % type)
	assert_eq(witnessed.size(), 5, "five of twenty-five; the other twenty rest on these suites")


# ── LAW 1: purity ────────────────────────────────────────────────────────

func test_no_event_type_touches_the_state_it_was_handed() -> void:
	## The replacement for the Object.freeze GDScript took away. Encoding the
	## whole input state before and after reaches every nested entity, item,
	## trap and rule — a shallower check would miss exactly the in-place writes
	## that are easiest to make and hardest to trace.
	for type: String in _events():
		var state: Dictionary = _before(type)
		var was := SimCanonical.encode(state)
		var result: Dictionary = SimApply.apply(state, _events()[type])
		assert_eq(SimCanonical.encode(state), was,
			"%s must not write through its input state" % type)
		assert_false(result.is_empty(), "%s produced a state" % type)


func test_a_returned_state_can_be_mutated_without_reaching_back_into_its_input() -> void:
	## The sharper half of purity: shallow copies mean the returned state and
	## its input can legitimately SHARE unchanged sub-objects, so "the input
	## still encodes the same" only proves the reducer did not write. This
	## proves the caller cannot either — the structures the reducer actually
	## rewrote are fresh, which is what stops one fold corrupting another.
	var state: Dictionary = _born()
	var was := SimCanonical.encode(state)
	var result: Dictionary = SimApply.apply(state, _events()["STRIKE"])
	var brute: Variant = SimEntity.find(result["entities"], "brute")
	((brute as Dictionary)["stats"] as Dictionary)["hp"] = -999
	(result["entities"] as Array).append({"id": "intruder"})
	assert_eq(SimCanonical.encode(state), was,
		"writing through the RESULT must not reach the input state")


# ── LAW 2: shape ─────────────────────────────────────────────────────────

func test_every_event_type_returns_a_state_of_exactly_the_twenty_keys() -> void:
	for type: String in _events():
		var result: Dictionary = SimApply.apply(_before(type), _events()[type])
		var keys: Array = result.keys()
		keys.sort()
		assert_eq(keys, SimState.STATE_KEYS, "%s returns the state's key set" % type)
		# assert_shape's own crash path is what test_state.gd pins; calling it
		# here is what the plan asks every wave from B onward to do.
		SimState.assert_shape(result)


func test_the_five_nullable_state_fields_stay_present_through_every_event() -> void:
	## The mirror of the absent-key law: these are `| null` in the reference, so
	## the key must survive even when the state has nothing to say. A reducer
	## that dropped one instead of nulling it would fork the hash.
	for type: String in _events():
		var result: Dictionary = SimApply.apply(_before(type), _events()[type])
		for key: String in ["activeEntityId", "motif", "bible", "smoke", "alarm"]:
			assert_true(result.has(key), "%s keeps %s present" % [type, key])


# ── LAW 3: no fractional number reaches the state ────────────────────────

func _fractions(value: Variant, path: String, out: Array) -> void:
	match typeof(value):
		TYPE_FLOAT:
			if value != floorf(value):
				out.append("%s = %s" % [path, value])
		TYPE_ARRAY:
			var i := 0
			for v: Variant in value:
				_fractions(v, "%s[%d]" % [path, i], out)
				i += 1
		TYPE_DICTIONARY:
			for k: Variant in value:
				_fractions((value as Dictionary)[k], "%s.%s" % [path, k], out)


func test_no_event_type_leaves_a_fractional_number_anywhere_in_the_state() -> void:
	## SimTables.bounty_stretch returns 1.5/2.5 and mean_damage returns a mean.
	## Both are correct — they are coefficients — but SimCanonical.encode refuses
	## a fractional number, so one reaching GameState un-rounded crashes the
	## encoder or forks the hash. This walks to the leaves rather than trusting
	## that no call site forgot to round.
	for type: String in _events():
		var result: Dictionary = SimApply.apply(_before(type), _events()[type])
		var found: Array = []
		_fractions(result, "state", found)
		assert_eq(found, [], "%s stored a fractional number: %s" % [type, found])


func test_the_fraction_walk_would_actually_catch_one() -> void:
	## The guard above is a loop over a helper; if the helper were blind it
	## would report a clean state forever. This proves it is not.
	var state: Dictionary = _born()
	state["gold"] = 1.5
	var found: Array = []
	_fractions(state, "state", found)
	assert_eq(found.size(), 1, "the walk finds a planted fraction")
	assert_string_contains(found[0], "state.gold")


# ── LAW 4: the absent-key law, guarded where entities are CONSTRUCTED ────

func _null_valued_keys(e: Dictionary) -> Array:
	var out: Array = []
	for k: Variant in e:
		if e[k] == null:
			out.append(k)
	return out


func test_world_init_constructs_entities_with_no_null_valued_key() -> void:
	## THE non-tautological guard. test_entity.gd's version hand-builds a
	## literal and asserts the literal lacks the optional keys, which nothing in
	## entity.gd can fail. This one goes through the real reducer path, so a
	## WORLD_INIT arm that wrote `"route": null` instead of omitting the key
	## fails here and nowhere else in the migration.
	var state: Dictionary = _born()
	for e: Dictionary in (state["entities"] as Array):
		assert_eq(_null_valued_keys(e), [],
			"%s was constructed with a null-valued key" % e["id"])


func test_world_init_leaves_the_optionals_it_was_given_nothing_for_absent() -> void:
	var state: Dictionary = _born()
	var brute: Dictionary = SimEntity.find(state["entities"], "brute")
	# The brute's payload carried none of the nine optionals but `post`, which
	# WORLD_INIT sets for every creature.
	for key: String in ["disposition", "route", "leg", "guise", "scroll", "pocket", "gear", "satchel"]:
		assert_false(brute.has(key), "brute must have NO %s key at all" % key)
	assert_true(brute.has("post"), "every creature is posted where it was born")
	assert_eq(brute["post"], {"x": 3, "y": 1})


func test_world_init_writes_the_optionals_it_was_given() -> void:
	## The other half: absence must mean absence, not "this reducer never
	## writes optionals". Each present field is checked against what it was
	## seeded with, and `leg` is checked because it is DERIVED — the payload
	## never carries it, the route's presence mints it at 0.
	var state: Dictionary = _born()
	var walker: Dictionary = SimEntity.find(state["entities"], "walker")
	assert_eq(walker["disposition"], "wander")
	assert_eq(walker["route"], [{"x": 1, "y": 5}, {"x": 2, "y": 5}])
	assert_eq(walker["leg"], 0, "a wanderer is born on leg 0")
	assert_eq(walker["pocket"], {"kind": "provision", "grants": _NO_GRANTS})
	var mimic: Dictionary = SimEntity.find(state["entities"], "mimic")
	assert_eq(mimic["guise"], "relic")
	var player: Dictionary = SimEntity.find(state["entities"], "player")
	assert_eq(player["satchel"], [{"kind": "draught"}, {"kind": "smoke"}])
	assert_eq(player["scroll"], {"kind": "unveiling"})


func test_world_init_copies_out_of_the_payload_rather_than_aliasing_it() -> void:
	## The event is shared by every fork that descends from it, so a state
	## holding a reference INTO the payload would let one world rewrite
	## another's history. Proven by mutating the built state and re-reading the
	## payload it came from.
	var event := _world_init()
	var state: Dictionary = SimApply.apply(SimState.empty(), event)
	var walker: Dictionary = SimEntity.find(state["entities"], "walker")
	((walker["stats"] as Dictionary))["hp"] = -1
	(walker["tags"] as Array).append("forged")
	((walker["route"] as Array)[0] as Dictionary)["x"] = 99
	var seed_walker: Dictionary = (event["payload"] as Dictionary)["opponents"][2]
	assert_eq((seed_walker["stats"] as Dictionary)["hp"], 4, "payload stats untouched")
	assert_eq(seed_walker["tags"], ["venom-2", "snared-2"], "payload tags untouched")
	assert_eq((seed_walker["route"] as Array)[0], {"x": 1, "y": 5}, "payload route untouched")


func test_gear_is_absent_until_something_is_worn() -> void:
	## SETTLING THE OPEN QUESTION the plan left to whoever wrote gear first,
	## half one. The reference builds gear as `{ ...e.gear, [slot]: ... }` —
	## spreading an undefined gear yields `{}` — so no entity grows a gear key
	## by any path but wearing something.
	var state: Dictionary = _born()
	var player: Dictionary = SimEntity.find(state["entities"], "player")
	assert_false(player.has("gear"), "a player who has worn nothing has NO gear key")


func test_an_unworn_slot_is_an_absent_key_inside_gear_not_a_null_one() -> void:
	## Half two, and the half no fixture could answer: the golden run has one
	## entity with gear and never exercises an empty slot. The reference reads a
	## slot as `e.gear?.[slot]` and only ever assigns the slot being filled, so
	## the four unworn slots are simply never keys.
	var state: Dictionary = SimApply.apply(_born(), _events()["ITEM_TAKEN"])
	var player: Dictionary = SimEntity.find(state["entities"], "player")
	var gear: Dictionary = player["gear"]
	assert_eq(gear.keys(), ["weapon"], "only the filled slot is a key")
	for slot: String in SimTables.SLOTS:
		if slot != "weapon":
			assert_false(gear.has(slot), "unworn slot %s is absent, not null" % slot)
	assert_eq(gear["weapon"], {"kind": "relic", "grants": {"hp": 0, "might": 2, "wits": 0, "speed": 0}})


func test_a_second_take_keeps_the_slots_it_did_not_fill() -> void:
	## The other direction of the same law: filling a second slot must not
	## rebuild gear from nothing and drop the first.
	var worn: Dictionary = SimApply.apply(_born(), _events()["ITEM_TAKEN"])
	var boots := SimEvents.draft("ITEM_TAKEN", 9, 0, {
		"entityId": "player", "itemId": "provision-1",
		"grants": {"hp": 0, "might": 0, "wits": 0, "speed": 2},
	})
	var state: Dictionary = SimApply.apply(worn, boots)
	var gear: Dictionary = (SimEntity.find(state["entities"], "player") as Dictionary)["gear"]
	var keys: Array = gear.keys()
	keys.sort()
	assert_eq(keys, ["boots", "weapon"], "both filled slots survive")


# ── the counter, which apply() alone is allowed to move ──────────────────

func test_the_counter_advances_by_recorded_draws_for_every_event_type() -> void:
	## The reference handles this in ONE place so a new event type cannot forget
	## to account for its own draws. Running all 25 is what proves no reducer
	## arm quietly wrote rngCounter itself.
	for type: String in _events():
		var event: Dictionary = _events()[type]
		var result: Dictionary = SimApply.apply(_before(type), event)
		assert_eq(result["rngCounter"], int(event["rngCounter"]) + int(event["rngDraws"]),
			"%s advances the counter by its draws" % type)


func test_the_three_events_that_change_nothing_return_the_very_same_state() -> void:
	## `return state` in the reference, not a fresh equal object — a blocked
	## move stays free of allocation as well as free of consequence. Only holds
	## when the event drew nothing, since the counter update rebuilds the state.
	var state: Dictionary = _born()
	for type: String in ["MOVE_BLOCKED", "ITEM_REFUSED", "WORLD_REMEMBERED"]:
		var event: Dictionary = _events()[type]
		assert_eq(int(event["rngDraws"]), 0, "%s draws nothing in this fixture" % type)
		assert_same(SimApply.apply(state, event), state, "%s returns its input" % type)


func test_an_unknown_event_type_is_refused_rather_than_folded() -> void:
	## The reference THROWS here: a log from a newer engine is an expected
	## input, and quietly returning the state unchanged would fold it to
	## nonsense. GDScript's assert() unwinds exactly ONE frame instead of
	## propagating — the asserting function returns its type's default and the
	## caller carries on (measured with a probe; see apply.gd's own note),
	## so what is asserted is that the refusal is LOUD.
	var rogue := {
		"type": "SUMMONED_A_GOD", "schemaVersion": 1, "rngCounter": 9, "rngDraws": 0,
		"payload": {},
	}
	SimApply.apply(_born(), rogue)
	# BOTH channels are asserted on purpose. assert() is compiled OUT of a
	# release build; push_error is not. If only the assert were checked, an
	# exported build could fold an unknown event as a silent no-op and this
	# test would still be green — see apply.gd's note at the guard.
	assert_engine_error("unknown event type")
	assert_push_error("unknown event type")


# ── ported from tests/core/apply.test.ts (17 cases, all portable) ────────
##
## None of these need decide() or createWorld() — see test_dispositions.gd
## for the sibling suite where that split actually bites. 17 = 17 ported + 0
## deferred.
##
## Its own fixture: the reference's 3x2 board (this section's own WORLD_INIT
## payload, not _world_payload()'s 7x7) — kept separate so this section
## matches ts-baseline case for case rather than borrowing the law suite's
## larger world. Named `_small_*` to keep the two fixtures visually distinct
## at every call site.

func _small_world_payload() -> Dictionary:
	return {
		"width": 3, "height": 2,
		"tiles": [SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.WALL, SimGrid.FLOOR, SimGrid.FLOOR, SimGrid.FLOOR],
		"seed": 99,
		"items": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
		"opponents": [
			{"id": "thing-1", "kind": "thing", "pos": {"x": 1, "y": 1},
				"stats": {"hp": 5, "might": 4, "wits": 1, "speed": 3}, "tags": []},
		],
	}


## rngDraws 128: what map generation drew before the first event was ever
## recorded, in the reference fixture this ports.
func _small_world_init() -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 128, _small_world_payload())


func _small_started() -> Dictionary:
	return SimApply.apply(SimState.empty(), _small_world_init())


func _small_move_event(rng_draws: int = 0) -> Dictionary:
	return SimEvents.draft("MOVE", 128, rng_draws,
		{"entityId": "player", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}})


func _small_move_blocked_event() -> Dictionary:
	return SimEvents.draft("MOVE_BLOCKED", 128, 0,
		{"entityId": "player", "attempted": {"x": 2, "y": 0}, "reason": "wall"})


# describe('apply WORLD_INIT')

func test_world_init_installs_the_grid() -> void:
	var started: Dictionary = _small_started()
	var grid: Dictionary = started["grid"]
	assert_eq(grid["width"], 3)
	assert_eq(SimGrid.tile_at(grid, 2, 0), SimGrid.WALL)


func test_world_init_seats_the_player_first_then_the_world_inhabitants_and_starts_on_turn_1() -> void:
	## Player first is load-bearing: several readouts and the AI's quarry
	## lookup assume entities[0] is you.
	var started: Dictionary = _small_started()
	var entities: Array = started["entities"]
	assert_eq(entities.size(), 2)
	var first: Dictionary = entities[0]
	var second: Dictionary = entities[1]
	assert_eq(first["id"], "player")
	assert_eq(second["id"], "thing-1")
	assert_eq(first["pos"], {"x": 0, "y": 0})
	assert_eq(started["activeEntityId"], "player")
	assert_eq(started["turn"], 1)


func test_world_init_records_the_seed_and_a_counter_advanced_by_the_draws_generation_made() -> void:
	var started: Dictionary = _small_started()
	assert_eq(started["seed"], 99)
	assert_eq(started["rngCounter"], 128)


func test_world_init_copies_the_player_so_mutating_the_event_payload_cannot_reach_into_state() -> void:
	## Every nested part, not just position: stats and tags are separate
	## structures in the payload too, and aliasing any of them would let a
	## later event rewrite history that has already been folded. The
	## reference mutates its module-level `worldInit` and restores it
	## afterward so sibling cases sharing the const are not corrupted; that
	## restore has nothing to protect here, because `event` below is local to
	## this test alone.
	var event: Dictionary = _small_world_init()
	var started: Dictionary = SimApply.apply(SimState.empty(), event)

	var payload: Dictionary = event["payload"]
	var player_payload: Dictionary = payload["player"]
	var pos_payload: Dictionary = player_payload["pos"]
	var stats_payload: Dictionary = player_payload["stats"]
	pos_payload["x"] = 999
	stats_payload["hp"] = 999
	(player_payload["tags"] as Array).append("injected")

	var seated: Dictionary = (started["entities"] as Array)[0]
	assert_eq((seated["pos"] as Dictionary)["x"], 0)
	assert_eq((seated["stats"] as Dictionary)["hp"], 10)
	assert_eq(seated["tags"], [])


# describe('apply MOVE')

func test_move_moves_the_named_entity_to_the_recorded_destination() -> void:
	var moved: Dictionary = SimApply.apply(_small_started(), _small_move_event())
	var first: Dictionary = (moved["entities"] as Array)[0]
	assert_eq(first["pos"], {"x": 1, "y": 0})


func test_move_leaves_the_previous_state_untouched() -> void:
	var started: Dictionary = _small_started()
	SimApply.apply(started, _small_move_event())
	var first: Dictionary = (started["entities"] as Array)[0]
	assert_eq(first["pos"], {"x": 0, "y": 0})


func test_move_does_not_advance_the_rng_counter_because_a_move_draws_nothing() -> void:
	var moved: Dictionary = SimApply.apply(_small_started(), _small_move_event())
	assert_eq(moved["rngCounter"], 128)


func test_move_advances_the_counter_by_the_events_own_draws_and_by_nothing_else() -> void:
	## v1's rule was "only WORLD_INIT can move the counter"; v2 replaced it
	## with every event declaring its own draws, and apply advancing by
	## precisely that. So this is a test of the NEW rule, not the old one
	## patched into passing.
	var drew: Dictionary = SimApply.apply(_small_started(), _small_move_event(3))
	assert_eq(drew["rngCounter"], 131)


func test_move_leaves_every_entity_alone_when_the_id_matches_nobody() -> void:
	var started: Dictionary = _small_started()
	var ghost_event: Dictionary = SimEvents.draft("MOVE", 128, 0,
		{"entityId": "ghost", "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 0}})
	var nobody: Dictionary = SimApply.apply(started, ghost_event)
	assert_eq(nobody["entities"], started["entities"])
	assert_eq(nobody["rngCounter"], started["rngCounter"])


# describe('apply MOVE_BLOCKED')

func test_move_blocked_changes_nothing_but_is_still_recorded_as_something_that_happened() -> void:
	var started: Dictionary = _small_started()
	var blocked: Dictionary = SimApply.apply(started, _small_move_blocked_event())
	var first: Dictionary = (blocked["entities"] as Array)[0]
	assert_eq(first["pos"], {"x": 0, "y": 0})
	assert_eq(blocked["turn"], started["turn"])


func test_move_blocked_returns_the_very_same_state_object_not_a_copy_of_it() -> void:
	## Identity, not equality: a rewrite that returned state.duplicate() would
	## still pass a value check while quietly making every blocked move
	## allocate.
	var started: Dictionary = _small_started()
	var blocked: Dictionary = SimApply.apply(started, _small_move_blocked_event())
	assert_same(blocked, started)


# describe('apply TURN_ADVANCED')

func test_turn_advanced_takes_the_turn_number_and_active_entity_straight_from_the_payload() -> void:
	var advanced: Dictionary = SimApply.apply(_small_started(),
		SimEvents.draft("TURN_ADVANCED", 128, 0, {"activeEntityId": "player", "turn": 2}))
	assert_eq(advanced["turn"], 2)
	assert_eq(advanced["activeEntityId"], "player")


# describe('apply with an event it cannot reduce')

func test_apply_throws_rather_than_falling_off_the_switch_and_returning_undefined() -> void:
	## The stand-in used to be 'STRIKE' — which then shipped as a real event
	## type in a later increment, quietly turning this into a test that an
	## ordinary event throws. An impossible case must be named something that
	## will stay impossible. This proves the same fact as the law suite's
	## test_an_unknown_event_type_is_refused_rather_than_folded from a second
	## angle (a different type string, asserted against the type name
	## specifically) — ported anyway, because every reference case is
	## accounted for rather than merged away. Hand-built rather than
	## SimEvents.draft()'d: draft() itself refuses an unknown type, and this
	## case exists to prove apply() refuses one too, on an event that reached
	## it some other way.
	var alien := {
		"type": "__NEVER_AN_EVENT__", "schemaVersion": 1, "rngCounter": 0, "rngDraws": 0,
		"payload": {"nonsense": true},
	}
	SimApply.apply(SimState.empty(), alien)
	assert_engine_error("unknown event type __NEVER_AN_EVENT__")
	# The release-build half of the same refusal: assert() is stripped from an
	# exported build, push_error is not.
	assert_push_error("unknown event type __NEVER_AN_EVENT__")


# describe('apply') — determinism

func test_apply_is_deterministic_same_state_and_event_give_an_identical_result() -> void:
	var event: Dictionary = _small_world_init()
	var a: Dictionary = SimApply.apply(SimState.empty(), event)
	var b: Dictionary = SimApply.apply(SimState.empty(), event)
	assert_eq(SimCanonical.encode(a), SimCanonical.encode(b))


# describe('apply WORLD_BODIES, and the recorded cut')

func test_world_init_reads_the_cut_when_the_floor_said_one_and_null_when_it_never_did() -> void:
	assert_null(_small_started()["motif"])
	var cut: Dictionary = SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 2, "height": 1, "tiles": [SimGrid.FLOOR, SimGrid.FLOOR], "seed": 1,
		"motif": "warren", "items": [], "opponents": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 5, "might": 1, "wits": 1, "speed": 1}, "tags": []},
	})
	assert_eq(SimApply.apply(SimState.empty(), cut)["motif"], "warren")


func test_world_bodies_lays_the_dead_into_state_copied_drawing_nothing() -> void:
	var lying: Array = [{"x": 1, "y": 0}, {"x": 2, "y": 1}]
	var haunted: Dictionary = SimEvents.draft("WORLD_BODIES", 128, 0, {"bodies": lying})
	var after: Dictionary = SimApply.apply(_small_started(), haunted)
	assert_eq(after["bodies"], lying)
	# Copied out of the payload — the event is shared by every fork that
	# descends from it.
	assert_false(is_same((after["bodies"] as Array)[0], lying[0]))
	assert_eq(after["rngCounter"], 128)


func test_world_bodies_is_reset_by_the_next_world_init_every_floor_is_born_empty() -> void:
	var haunted: Dictionary = SimEvents.draft("WORLD_BODIES", 128, 0,
		{"bodies": [{"x": 1, "y": 0}]})
	var buried: Dictionary = SimApply.apply(_small_started(), haunted)
	var reborn: Dictionary = SimApply.apply(buried, _small_world_init())
	assert_eq(reborn["bodies"], [])


# ── the carries, and the spill: two holes a reviewer proved by mutation ──
#
# Both of these were written after Task 2.C1's review broke the reducer and
# watched the suite stay green. Deleting WORLD_INIT's `playerGold` carry left
# 268/268 passing AND the golden fold still hashing correctly — the golden run
# never crosses stairs with a purse. Deleting `_drop_pockets` from each of its
# three death sites independently, and reversing the nudge order, likewise
# changed nothing any test could see. The code was right both times; nothing
# guarded it. These are the guards.


## A tiny board built for the spill: a player, and one pocket-carrier already
## down to its last hp, standing where every candidate tile can be named.
func _spill_payload() -> Dictionary:
	return {
		"width": 5, "height": 5, "tiles": _tiles(5, 5), "seed": 7, "items": [],
		"player": {
			"id": "player", "kind": "player", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 2, "speed": 3}, "tags": [],
		},
		"opponents": [{
			"id": "carrier", "kind": "skirmisher", "pos": {"x": 2, "y": 2},
			"stats": {"hp": 1, "might": 2, "wits": 1, "speed": 3}, "tags": [],
			"pocket": {"kind": "provision", "grants": _NO_GRANTS.duplicate()},
		}],
	}


func _spilled(payload: Dictionary) -> Dictionary:
	return SimApply.apply(SimState.empty(), SimEvents.draft("WORLD_INIT", 0, 0, payload))


func test_world_init_carries_the_purse_across_the_stairs() -> void:
	## v15. Absence is an empty purse — every chain written before the economy
	## carried nothing, and that is simply true of them — but a payload that
	## SAYS a number must be believed, or descending robs the player silently.
	var carried: Dictionary = _spill_payload()
	carried["playerGold"] = 7
	assert_eq(_spilled(carried)["gold"], 7, "the purse crosses the stairs")
	assert_eq(_spilled(_spill_payload())["gold"], 0, "an absent purse reads empty")


func test_world_init_carries_the_rest_of_the_earned_progress_too() -> void:
	## The same `??` family as the purse, and the same silent-robbery failure if
	## any one of them is dropped: xp, level, depth and story all ride the
	## descent, and motif is the nullable one that must stay PRESENT.
	var carried: Dictionary = _spill_payload()
	carried["xp"] = 40
	carried["level"] = 3
	carried["depth"] = 4
	carried["story"] = "went down carrying too much"
	carried["motif"] = "warren"
	var state: Dictionary = _spilled(carried)
	assert_eq(state["xp"], 40)
	assert_eq(state["level"], 3)
	assert_eq(state["depth"], 4)
	assert_eq(state["story"], "went down carrying too much")
	assert_eq(state["motif"], "warren")
	var bare: Dictionary = _spilled(_spill_payload())
	assert_eq(bare["xp"], 0)
	assert_eq(bare["level"], 1)
	assert_eq(bare["depth"], 1)
	assert_eq(bare["story"], "")
	assert_null(bare["motif"], "a floor that named no cut says null, and keeps the key")


func _pocket_of(state: Dictionary) -> Variant:
	for i: Dictionary in (state["items"] as Array):
		if i["id"] == "pocket-carrier":
			return i
	return null


func test_a_blow_that_kills_a_carrier_spills_its_pocket_on_the_death_tile() -> void:
	var killing := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "carrier", "hit": true, "damage": 1, "crit": false,
	})
	var after: Dictionary = SimApply.apply(_spilled(_spill_payload()), killing)
	var dropped: Variant = _pocket_of(after)
	assert_not_null(dropped, "STRIKE is a death site: the pocket spills")
	assert_eq((dropped as Dictionary)["kind"], "provision")
	assert_eq((dropped as Dictionary)["pos"], {"x": 2, "y": 2}, "on the tile it died on")


func test_a_slam_that_kills_a_carrier_spills_where_the_shove_left_it() -> void:
	## The second death site. The spill reads the position AFTER the shove
	## moved the body, not the one it was standing on when the shove began.
	var slam := SimEvents.draft("SHOVE", 0, 0, {
		"shoverId": "player", "targetId": "carrier", "to": {"x": 3, "y": 2},
		"slammed": true, "struckId": null,
	})
	var after: Dictionary = SimApply.apply(_spilled(_spill_payload()), slam)
	var dropped: Variant = _pocket_of(after)
	assert_not_null(dropped, "SHOVE is a death site: the pocket spills")
	assert_eq((dropped as Dictionary)["pos"], {"x": 3, "y": 2}, "where the slam left it")


func test_a_rule_that_kills_a_carrier_spills_its_pocket_too() -> void:
	## The third death site, and the one most easily forgotten: a kill a rule
	## made is still a kill, and the pocket is still set down.
	var fired := SimEvents.draft("RULE_FIRED", 0, 0, {
		"ruleId": "rule-1", "actorId": "player",
		"outcomes": [{"kind": "health", "entityId": "carrier", "to": 0}],
	})
	var after: Dictionary = SimApply.apply(_spilled(_spill_payload()), fired)
	assert_not_null(_pocket_of(after), "RULE_FIRED is a death site: the pocket spills")


func test_a_pocket_is_nudged_one_pace_when_something_already_lies_there() -> void:
	## The five candidate tiles are tried in a FIXED order — here, then east,
	## west, south, north — because a spill that picked its tile any other way
	## would replay differently on a different day.
	var occupied: Dictionary = _spill_payload()
	occupied["items"] = [{"id": "in-the-way", "kind": "relic", "pos": {"x": 2, "y": 2},
		"grants": _NO_GRANTS.duplicate()}]
	var killing := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "carrier", "hit": true, "damage": 1, "crit": false,
	})
	var dropped: Variant = _pocket_of(SimApply.apply(_spilled(occupied), killing))
	assert_not_null(dropped, "a taken death tile nudges rather than swallows")
	assert_eq((dropped as Dictionary)["pos"], {"x": 3, "y": 2}, "east is tried before west")


func test_the_floor_swallows_a_pocket_only_when_every_neighbouring_tile_is_taken() -> void:
	## Poverty is honest; a stack of invisible items is not. With all five
	## candidates occupied there is nowhere to set the thing down, and the
	## reducer drops it rather than hiding it under another item.
	var boxed: Dictionary = _spill_payload()
	var blockers: Array = []
	for t: Array in [[2, 2], [3, 2], [1, 2], [2, 3], [2, 1]]:
		blockers.append({"id": "block-%d-%d" % [t[0], t[1]], "kind": "relic",
			"pos": {"x": t[0], "y": t[1]}, "grants": _NO_GRANTS.duplicate()})
	boxed["items"] = blockers
	var killing := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "carrier", "hit": true, "damage": 1, "crit": false,
	})
	var after: Dictionary = SimApply.apply(_spilled(boxed), killing)
	assert_null(_pocket_of(after), "nowhere to set it down, so it is gone")
	assert_eq((after["items"] as Array).size(), 5, "and nothing else moved")


func test_a_body_that_was_already_dead_does_not_spill_a_second_time() -> void:
	## `before` is the world as the blow found it: a creature spills exactly
	## once, on the event that took it from alive to not. Striking a corpse
	## again must not mint a second pocket.
	var killing := SimEvents.draft("STRIKE", 0, 0, {
		"attackerId": "player", "targetId": "carrier", "hit": true, "damage": 1, "crit": false,
	})
	var dead: Dictionary = SimApply.apply(_spilled(_spill_payload()), killing)
	var again: Dictionary = SimApply.apply(dead, killing)
	var pockets := 0
	for i: Dictionary in (again["items"] as Array):
		if i["id"] == "pocket-carrier":
			pockets += 1
	assert_eq(pockets, 1, "one death, one pocket")
