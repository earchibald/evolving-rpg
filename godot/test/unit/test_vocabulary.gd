extends GutTest
## The widened vocabulary — the byte-twin of the validate()-only slice of
## tests/canon/vocabulary.test.ts.
##
## The TS file covers two different things under one describe tree: the
## vocabulary's SHAPE (what validate() accepts, refuses and reads back as
## English — owned by rule.ts, and this repo's sim/rule.gd) and its RUNTIME
## MEANING (what a condition reads off a live GameState, and what an effect
## does to one — owned by interpret.ts's `holds`/`fireRules` and
## `applyResolved`, none of which exist in sim/ yet). This file ports only the
## first half: 14 of the TS file's 33 `it(...)` blocks, in the TS file's
## order. The other 19 are named below so the task that ports interpret.gd
## can find them without re-deriving which is which:
##
## Owned by interpret.gd (drives `holds`, under "health as a proportion" and
## "reading the rest of the world"):
##   - "reads a fraction of the ceiling, not an absolute"
##   - "does not divide by a ceiling of zero"
##   - "counts what is still alive"
##   - "measures the way out"
##   - "says the exit is unreachably far on a map without one"
##   - "reads the turn count and the stats, including wits"
##   - "reads whether the blow landed"
##   - "reads the depth of the run"
##   - "reads the floor's cut, and an unrecorded cut as no cut at all"
##   - "knows where you fell"
##
## Owned by interpret.gd (drives `fireRules` / `applyResolved`, under
## "effects that reach past the actor", "rules compose within one pass", and
## the composed case at the end of the world-shape-words block):
##   - "hurts the other party"
##   - "shoves the other party directly away"
##   - "stops a shove at a wall rather than through it"
##   - "fires nothing when a shove has nowhere to go"
##   - "raises and lowers a stat, and never drains one to nothing"
##   - "raises the ceiling without raising current health"
##   - "drops an effect that has nobody to act on"
##   - "lets a second rule see what the first did"
##   - "fires through the interpreter, composed"
##
## Not ported anywhere: the TS file's own `world()`/`being()` GameState
## builders are interpret.gd's concern too (fireRules/holds are what actually
## consumes a GameState); this file needed only the TS `rule()`/`refused()`
## helpers, since every test kept here only ever calls validateRule/readRule.

## Mirrors the TS file's GOOD-shaped base object that `rule()`/`refused()`
## build on, minus the parts (require contents aside) that differ per case.
const BASE := {
	"id": "r", "when": "WAIT", "require": [], "then": [{"kind": "heal", "n": 1}],
	"provenance": {"events": ["e"], "notes": [], "because": "testing"},
	"ratifiedAt": "2026-07-25T00:00:00.000Z",
}


func _merged(over: Dictionary) -> Dictionary:
	var d: Dictionary = BASE.duplicate(true)
	for k: String in over:
		d[k] = over[k]
	return d


## Mirrors the TS `rule()` helper: builds and validates, failing the test
## loudly (rather than asserting something misleading) if setup itself was
## rejected.
func _rule(over: Dictionary = {}) -> Dictionary:
	var r: Dictionary = SimRule.validate(_merged(over))
	if SimRule.is_rejected(r):
		fail_test("_rule() setup was unexpectedly rejected: %s" % r["rejected"])
	return r


## Mirrors the TS `refused()` helper: builds, validates, and returns the
## rejection string — failing the test if the input was unexpectedly accepted.
func _refused(over: Dictionary) -> String:
	var r: Dictionary = SimRule.validate(_merged(over))
	if not SimRule.is_rejected(r):
		fail_test("_refused() setup was unexpectedly accepted")
		return ""
	return r["rejected"]


## the triggers a player expects ---------------------------------------------

func test_covers_being_struck_killing_moving_and_the_turn_passing() -> void:
	var sorted: Array = SimRule.TRIGGERS.duplicate()
	sorted.sort()
	assert_eq(sorted, ["ITEM_TAKEN", "KILLED", "MOVE", "MOVE_BLOCKED", "STRIKE", "STRUCK", "TURN_PASSED", "WAIT"])


func test_accepts_a_rule_on_each_of_them() -> void:
	for when: String in SimRule.TRIGGERS:
		var r: Dictionary = SimRule.validate({
			"id": "r", "when": when, "require": [], "then": [{"kind": "speak", "text": "so it goes"}],
			"provenance": {"events": ["e"], "notes": [], "because": "y"}, "ratifiedAt": "now",
		})
		assert_false(SimRule.is_rejected(r))


## shapes that must stay refused ----------------------------------------------

func test_refuses_a_blow_condition_on_a_trigger_with_no_blow() -> void:
	assert_string_contains(_refused({"when": "WAIT", "require": [{"kind": "blowLanded"}]}), "blow")
	assert_string_contains(_refused({"when": "TURN_PASSED", "require": [{"kind": "blowMissed"}]}), "blow")


func test_allows_a_blow_condition_where_a_blow_exists() -> void:
	assert_false(SimRule.is_rejected(_rule({"when": "STRIKE", "require": [{"kind": "blowLanded"}]})))
	assert_false(SimRule.is_rejected(_rule({"when": "STRUCK", "require": [{"kind": "blowMissed"}]})))


func test_refuses_reaching_for_the_other_when_there_is_no_other() -> void:
	# Otherwise this ratifies cleanly, reads sensibly, and does nothing at all
	# forever — which is worse than being rejected.
	assert_string_contains(_refused({"when": "WAIT", "then": [{"kind": "harmOther", "n": 2}]}), "harmOther")
	assert_string_contains(_refused({"when": "TURN_PASSED", "then": [{"kind": "push", "n": 1}]}), "push")
	_rule({"when": "STRUCK", "then": [{"kind": "harmOther", "n": 2}]})


func test_holds_each_kind_to_its_own_range() -> void:
	# One global 1-9 was wrong once distances ran to 40 and percentages to 99.
	_rule({"then": [{"kind": "heal", "n": 20}]})
	assert_string_contains(_refused({"then": [{"kind": "heal", "n": 21}]}), "1–20")
	_rule({"require": [{"kind": "noCreatureWithin", "n": 40}]})
	assert_string_contains(_refused({"require": [{"kind": "noCreatureWithin", "n": 41}]}), "1–40")
	assert_string_contains(_refused({"then": [{"kind": "grant", "stat": "might", "n": 6}]}), "1–5")
	assert_string_contains(_refused({"then": [{"kind": "push", "n": 4}]}), "1–3")
	assert_string_contains(_refused({"require": [{"kind": "hpBelowPercent", "n": 100}]}), "1–99")
	_rule({"require": [{"kind": "turnAtLeast", "n": 999}]})


func test_refuses_an_unknown_stat() -> void:
	assert_string_contains(_refused({"then": [{"kind": "grant", "stat": "charisma", "n": 2}]}), "stat")
	assert_string_contains(_refused({"require": [{"kind": "statAtLeast", "stat": "luck", "n": 2}]}), "stat")


func test_still_drops_extra_keys_on_the_new_shapes() -> void:
	var r: Dictionary = SimRule.validate({
		"id": "r", "when": "STRIKE", "require": [{"kind": "blowLanded", "sneaky": 1}],
		"then": [{"kind": "grant", "stat": "might", "n": 2, "alsoDelete": "everything"}],
		"provenance": {"events": ["e"], "notes": [], "because": "y"}, "ratifiedAt": "now",
	})
	assert_false(SimRule.is_rejected(r))
	assert_eq((r["require"][0] as Dictionary).keys(), ["kind"])
	var then_keys: Array = (r["then"][0] as Dictionary).keys()
	then_keys.sort()
	assert_eq(then_keys, ["kind", "n", "stat"])
	assert_false(SimCanonical.encode(r).contains("sneaky"))


## the world-shape words (VOCABULARY.md §3) -----------------------------------

func test_holds_the_new_words_to_their_shapes() -> void:
	_rule({"require": [{"kind": "depthAtLeast", "n": 99}]})
	assert_string_contains(_refused({"require": [{"kind": "depthAtLeast", "n": 0}]}), "1–99")
	assert_string_contains(_refused({"require": [{"kind": "depthAtLeast", "n": 100}]}), "1–99")
	_rule({"require": [{"kind": "motifIs", "motif": "door"}]})
	_rule({"require": [{"kind": "motifIs", "motif": "halls"}]})
	assert_string_contains(_refused({"require": [{"kind": "motifIs", "motif": "cave"}]}), "motif")
	assert_string_contains(_refused({"require": [{"kind": "motifIs"}]}), "motif")
	_rule({"require": [{"kind": "bodyHere"}]})


func test_works_under_any_trigger_unlike_the_blow_words() -> void:
	for when: String in SimRule.TRIGGERS:
		var r: Dictionary = SimRule.validate({
			"id": "r", "when": when,
			"require": [{"kind": "bodyHere"}, {"kind": "depthAtLeast", "n": 2}, {"kind": "motifIs", "motif": "warren"}],
			"then": [{"kind": "speak", "text": "so it goes"}],
			"provenance": {"events": ["e"], "notes": [], "because": "y"}, "ratifiedAt": "now",
		})
		assert_false(SimRule.is_rejected(r))


func test_refuses_a_floor_asked_to_be_two_shapes_at_once() -> void:
	# Two different cuts can never both hold: the rule validates, reads
	# plausibly, and does nothing forever — the exact lie the validator
	# exists to prevent (VOCABULARY.md: the unresolvable case has its exit).
	var msg: String = _refused({"require": [{"kind": "motifIs", "motif": "door"}, {"kind": "motifIs", "motif": "warren"}]})
	assert_true((msg.contains("cannot") and msg.contains("both")) or msg.contains("never fire"), msg)
	# The same cut twice is redundant, not contradictory.
	_rule({"require": [{"kind": "motifIs", "motif": "door"}, {"kind": "motifIs", "motif": "door"}]})


func test_drops_extra_keys_on_the_new_shapes() -> void:
	var r: Dictionary = SimRule.validate({
		"id": "r", "when": "MOVE",
		"require": [
			{"kind": "bodyHere", "sneaky": 1},
			{"kind": "motifIs", "motif": "door", "also": 2},
			{"kind": "depthAtLeast", "n": 3, "ride": 3},
		],
		"then": [{"kind": "heal", "n": 1}],
		"provenance": {"events": ["e"], "notes": [], "because": "y"}, "ratifiedAt": "now",
	})
	assert_false(SimRule.is_rejected(r))
	assert_eq((r["require"][0] as Dictionary).keys(), ["kind"])
	var k1: Array = (r["require"][1] as Dictionary).keys()
	k1.sort()
	assert_eq(k1, ["kind", "motif"])
	var k2: Array = (r["require"][2] as Dictionary).keys()
	k2.sort()
	assert_eq(k2, ["kind", "n"])
	assert_false(SimCanonical.encode(r).contains("sneaky"))


## every shape reads as English -----------------------------------------------

func test_renders_each_trigger_condition_and_effect_without_falling_over() -> void:
	var conditions: Array[Dictionary] = [
		{"kind": "hpAtMost", "n": 3}, {"kind": "hpAtLeast", "n": 3},
		{"kind": "hpBelowPercent", "n": 50}, {"kind": "hpAbovePercent", "n": 50},
		{"kind": "creatureWithin", "n": 1}, {"kind": "noCreatureWithin", "n": 6},
		{"kind": "creaturesAtMost", "n": 1}, {"kind": "creaturesAtLeast", "n": 2},
		{"kind": "exitWithin", "n": 4}, {"kind": "exitBeyond", "n": 20},
		{"kind": "turnAtLeast", "n": 30}, {"kind": "statAtLeast", "stat": "wits", "n": 2},
		{"kind": "depthAtLeast", "n": 3}, {"kind": "motifIs", "motif": "warren"},
		{"kind": "bodyHere"},
	]
	for c: Dictionary in conditions:
		var said: String = SimRule.read_rule(_rule({"require": [c]}))
		assert_true(said.begins_with("When "), said)
		assert_true(said.contains(" — "), said)
		assert_true(said.ends_with("."), said)
		assert_false(said.contains("undefined"))
		assert_false(said.contains("[object"))
	for when: String in SimRule.TRIGGERS:
		var said: String = SimRule.read_rule(_rule({"when": when, "then": [{"kind": "speak", "text": "so it goes"}]}))
		assert_true(said.begins_with("When "), said)


func test_says_the_useful_thing_for_the_effects_that_reach_past_you() -> void:
	assert_eq(
		SimRule.read_rule(_rule({"when": "STRUCK", "then": [{"kind": "harmOther", "n": 2}]})),
		"When something strikes you — it loses 2 hit points.")
	assert_eq(
		SimRule.read_rule(_rule({"when": "STRIKE", "then": [{"kind": "push", "n": 1}]})),
		"When you strike something — it is shoved back 1 square.")
	assert_eq(
		SimRule.read_rule(_rule({"when": "KILLED", "then": [{"kind": "grant", "stat": "might", "n": 1}]})),
		"When something dies by your hand — your might rises by 1.")
	assert_eq(
		SimRule.read_rule(_rule({"when": "TURN_PASSED", "require": [{"kind": "hpBelowPercent", "n": 50}], "then": [{"kind": "heal", "n": 1}]})),
		"When a turn goes by, with your health below 50% — you recover 1 hit point.")
