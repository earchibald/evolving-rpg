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
	## nonsense. GDScript's assert() logs and continues instead of unwinding,
	## so what is asserted is that the refusal is LOUD.
	var rogue := {
		"type": "SUMMONED_A_GOD", "schemaVersion": 1, "rngCounter": 9, "rngDraws": 0,
		"payload": {},
	}
	SimApply.apply(_born(), rogue)
	assert_engine_error("unknown event type")
