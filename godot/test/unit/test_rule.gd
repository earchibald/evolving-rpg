extends GutTest
## validate, is_rejected, MAX_RULES — the byte-twin of tests/canon/rule.test.ts.
## One test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye.
##
## Three JS-specific JUNK/behaviour cases have no GDScript analog and are not
## ported:
## - `Symbol('x')` and `9007199254740993n` (BigInt): GDScript has neither a
##   Symbol nor an arbitrary-precision integer type. Every other JUNK value
##   already exercises "_is_plain_object returns false for a non-Dictionary
##   Variant" the same way those two would have.
## - "does not let a prototype-polluting payload through": GDScript
##   Dictionaries have no shared, mutable prototype for a `__proto__` key to
##   pollute (there is no `Object.prototype` equivalent), so the vulnerability
##   class this test guards against does not exist on this side of the port.
##   The JUNK entry built the same way (a Dictionary literally keyed
##   `"__proto__"`) is still ported below, as an ordinary "weird key, still
##   just gets rejected for missing `id`" case.

const GOOD := {
	"id": "rule-1",
	"when": "WAIT",
	"require": [{"kind": "noCreatureWithin", "n": 6}],
	"then": [{"kind": "heal", "n": 1}],
	"provenance": {
		"events": ["0a1b2c"],
		"notes": ["2026-07-25T23:09:26.121Z"],
		"because": "waiting did nothing at all, and you said so",
	},
	"ratifiedAt": "2026-07-25T00:00:00.000Z",
}


## A copy of GOOD with one field replaced, so each case starts from something
## valid and differs in exactly the way under test.
func _with_field(key: String, value: Variant) -> Dictionary:
	var d: Dictionary = GOOD.duplicate(true)
	d[key] = value
	return d


## accepting a rule ---------------------------------------------------------

func test_takes_a_well_formed_one() -> void:
	var r: Dictionary = SimRule.validate(GOOD)
	assert_false(SimRule.is_rejected(r))
	assert_eq(r["when"], "WAIT")
	assert_eq(r["then"], [{"kind": "heal", "n": 1}])
	assert_string_contains(r["provenance"]["because"], "waiting")


func test_accepts_every_trigger_in_the_vocabulary() -> void:
	for when: String in ["WAIT", "STRIKE", "MOVE_BLOCKED", "ITEM_TAKEN"]:
		assert_false(SimRule.is_rejected(SimRule.validate(_with_field("when", when))))


func test_accepts_every_condition_and_effect_in_the_vocabulary() -> void:
	for kind: String in ["noCreatureWithin", "creatureWithin", "hpAtMost", "hpAtLeast"]:
		var r: Dictionary = SimRule.validate(_with_field("require", [{"kind": kind, "n": 3}]))
		assert_false(SimRule.is_rejected(r), "%s: %s" % [kind, r.get("rejected", "")])
	for kind: String in ["heal", "harm"]:
		var r: Dictionary = SimRule.validate(_with_field("then", [{"kind": kind, "n": 2}]))
		assert_false(SimRule.is_rejected(r), "%s: %s" % [kind, r.get("rejected", "")])
	var spoken: Dictionary = SimRule.validate(_with_field("then", [{"kind": "speak", "text": "the stone is cold"}]))
	assert_false(SimRule.is_rejected(spoken))


func test_allows_no_conditions_at_all_a_rule_that_always_fires_is_legal() -> void:
	assert_false(SimRule.is_rejected(SimRule.validate(_with_field("require", []))))


## being total ---------------------------------------------------------------
## The property under test is "returns a value", not "returns a rejection". A
## validator that crashes on one input in a thousand is a validator the Forge
## can crash on, and the input is written by a model.

## GDScript stand-ins for the JS JUNK array's scalars, collections and one
## "exotic, definitely not a plain Dictionary" Variant (a Callable stands in
## for JS's function/Map/Set/regex/Date cases, all of which must fail
## _is_plain_object the same way). The last three entries before __proto__
## use _with_field, matching the reference's `{ ...GOOD, require: null }` /
## `{ ...GOOD, then: 'heal' }` / `{ ...GOOD, provenance: 7 }`: each is an
## otherwise-valid rule with exactly one field broken, so validate() reaches
## past id/when and into that field's own shape check rather than stopping at
## "id: expected a name" the way a bare `{"require": null}` would. See the
## three test_junk_* tests below, which pin the specific branch each one
## reaches.
func _junk() -> Array:
	return [
		null, 0, 1, -1, NAN, INF, "", "rule", true, false,
		[], [1, 2, 3], {}, {"when": "WAIT"}, Callable(),
		_with_field("require", null), _with_field("then", "heal"), _with_field("provenance", 7),
		{"__proto__": {"polluted": true}},
	]


func test_returns_rather_than_throws_on_junk() -> void:
	for value: Variant in _junk():
		var r: Variant = SimRule.validate(value)
		assert_true(SimRule.is_rejected(r), "junk value should be rejected, not accepted or crash: %s" % [value])


## The three _with_field junk cases above are built to each reach a SPECIFIC
## deep branch, not merely "some rejection, somehow" — pinned here on the
## exact rejection text, so a future change that reshapes them back into
## something that is rejected earlier (e.g. at "id") cannot pass silently.
func test_junk_require_null_is_refused_by_the_require_shape_check() -> void:
	var r: Dictionary = SimRule.validate(_with_field("require", null))
	assert_true(SimRule.is_rejected(r))
	assert_string_contains(r["rejected"], "require: expected a list")


func test_junk_then_a_string_is_refused_by_the_then_shape_check() -> void:
	var r: Dictionary = SimRule.validate(_with_field("then", "heal"))
	assert_true(SimRule.is_rejected(r))
	assert_string_contains(r["rejected"], "then: expected a list")


func test_junk_provenance_a_number_is_refused_by_the_provenance_shape_check() -> void:
	var r: Dictionary = SimRule.validate(_with_field("provenance", 7))
	assert_true(SimRule.is_rejected(r))
	assert_string_contains(r["rejected"], "provenance: expected an object")


func test_survives_something_deeply_nested_without_blowing_the_stack() -> void:
	var root: Dictionary = {}
	var cursor: Dictionary = root
	for i in range(5000):
		var next: Dictionary = {}
		cursor["next"] = next
		cursor = next
	var r: Dictionary = SimRule.validate(root)
	# root has only a "next" key, never "id" — validate reads named fields
	# directly and never walks into "next", so this is rejected, not thrown.
	assert_true(SimRule.is_rejected(r))


func test_survives_a_cycle() -> void:
	var cyclic: Dictionary = GOOD.duplicate(true)
	cyclic["self"] = cyclic
	var r: Dictionary = SimRule.validate(cyclic)
	# validate only ever reads the named rule fields, so the untouched "self"
	# cycle is simply an extra key that gets dropped like any other.
	assert_false(SimRule.is_rejected(r))


## the bounds, which are what make a generated rule safe ---------------------

func test_refuses_a_number_outside_its_kinds_range_naming_the_field() -> void:
	# heal runs 1-20; distances run further and stat grants stop much sooner.
	# The range is per kind, because one number for all of them was wrong.
	for n: Variant in [0, -1, 21, 9999, 1.5, NAN, INF]:
		var r: Dictionary = SimRule.validate(_with_field("then", [{"kind": "heal", "n": n}]))
		assert_true(SimRule.is_rejected(r))
		if SimRule.is_rejected(r):
			assert_string_contains(r["rejected"], "n must be")


func test_refuses_more_than_four_conditions() -> void:
	var five: Array = []
	for i in range(5):
		five.append({"kind": "hpAtMost", "n": 5})
	var r: Dictionary = SimRule.validate(_with_field("require", five))
	assert_true(SimRule.is_rejected(r))
	if SimRule.is_rejected(r):
		assert_string_contains(r["rejected"], "require")


func test_refuses_more_than_three_effects() -> void:
	var four: Array = []
	for i in range(4):
		four.append({"kind": "heal", "n": 1})
	var r: Dictionary = SimRule.validate(_with_field("then", four))
	assert_true(SimRule.is_rejected(r))
	if SimRule.is_rejected(r):
		assert_string_contains(r["rejected"], "then")


func test_refuses_spoken_text_over_120_characters() -> void:
	var r: Dictionary = SimRule.validate(_with_field("then", [{"kind": "speak", "text": "x".repeat(121)}]))
	assert_true(SimRule.is_rejected(r))
	if SimRule.is_rejected(r):
		assert_string_contains(r["rejected"], "text")


func test_refuses_a_trigger_condition_or_effect_outside_the_vocabulary() -> void:
	assert_true(SimRule.is_rejected(SimRule.validate(_with_field("when", "EXPLODE"))))
	assert_true(SimRule.is_rejected(SimRule.validate(_with_field("require", [{"kind": "isTuesday", "n": 1}]))))
	assert_true(SimRule.is_rejected(SimRule.validate(_with_field("then", [{"kind": "summon", "n": 1}]))))


func test_refuses_a_rule_with_no_stated_reason() -> void:
	# GDScript has no `undefined`, so JS's ['', '   ', undefined, null, 42]
	# collapses to four cases: a missing "because" key reads the same as one
	# explicitly set to null, both via Dictionary.get's default.
	for because: Variant in ["", "   ", null, 42]:
		var r: Dictionary = SimRule.validate(_with_field("provenance", {"events": ["a"], "notes": [], "because": because}))
		assert_true(SimRule.is_rejected(r))
		if SimRule.is_rejected(r):
			assert_string_contains(r["rejected"], "because")


func test_refuses_a_rule_with_no_provenance_at_all() -> void:
	# The Ladder exists to stop rules appearing without reasons. A rule that
	# cites nothing is the exact thing it is guarding against.
	var r: Dictionary = SimRule.validate(_with_field("provenance", {"events": [], "notes": [], "because": "felt right"}))
	assert_true(SimRule.is_rejected(r))
	if SimRule.is_rejected(r):
		var msg: String = r["rejected"]
		assert_true(msg.contains("provenance") or msg.contains("events") or msg.contains("notes"), msg)


func test_keeps_a_rejection_short_even_when_the_offending_value_is_enormous() -> void:
	# The message goes on screen. Untrusted input must not be able to flood it.
	var r: Dictionary = SimRule.validate(_with_field("then", [{"kind": "speak", "text": "y".repeat(50000)}]))
	assert_true(SimRule.is_rejected(r))
	if SimRule.is_rejected(r):
		var msg: String = r["rejected"]
		assert_true(msg.length() <= 200)
		assert_false(msg.contains("y".repeat(200)))


func test_publishes_the_per_world_rule_cap() -> void:
	assert_eq(SimRule.MAX_RULES, 16)


## not handing back the caller's object --------------------------------------
## This project has found shared-mutable-state bugs three separate times. The
## stored rule must not be reachable from whatever the model's response was
## parsed into.

func test_does_not_mutate_what_it_was_given() -> void:
	var input: Dictionary = GOOD.duplicate(true)
	var before: Dictionary = input.duplicate(true)
	SimRule.validate(input)
	assert_eq_deep(input, before)


func test_returns_something_that_shares_no_structure_with_the_input() -> void:
	var input: Dictionary = GOOD.duplicate(true)
	var r: Dictionary = SimRule.validate(input)
	assert_false(SimRule.is_rejected(r))

	assert_not_same(r, input)
	assert_not_same(r["require"], input["require"])
	assert_not_same(r["then"], input["then"])
	assert_not_same(r["provenance"], input["provenance"])
	assert_not_same(r["provenance"]["events"], input["provenance"]["events"])
	assert_not_same(r["require"][0], input["require"][0])

	# And mutating the input afterwards must not reach into the stored rule.
	(input["require"][0] as Dictionary)["n"] = 999
	(input["provenance"]["events"] as Array).append("smuggled")
	assert_eq_deep(r["require"][0], {"kind": "noCreatureWithin", "n": 6})
	assert_eq_deep(r["provenance"]["events"], ["0a1b2c"])


func test_is_frozen_all_the_way_down() -> void:
	var r: Dictionary = SimRule.validate(GOOD)
	assert_false(SimRule.is_rejected(r))
	assert_true(r.is_read_only())
	assert_true((r["require"] as Array).is_read_only())
	assert_true((r["then"] as Array).is_read_only())
	assert_true((r["provenance"] as Dictionary).is_read_only())
	assert_true((r["require"][0] as Dictionary).is_read_only())


## what gets stored is exactly the vocabulary ---------------------------------

func test_drops_extra_keys_rather_than_keeping_or_refusing_them() -> void:
	# Refusing would make the validator brittle against a chatty model.
	# Keeping would let one smuggle arbitrary data into the append-only log,
	# where it is permanent.
	var chatty: Dictionary = GOOD.duplicate(true)
	chatty["confidence"] = 0.92
	chatty["script"] = "<img onerror=alert(1)>"
	chatty["then"] = [{"kind": "heal", "n": 1, "andAlso": "delete everything"}]

	var r: Dictionary = SimRule.validate(chatty)
	assert_false(SimRule.is_rejected(r))

	var keys: Array = r.keys()
	keys.sort()
	assert_eq(keys, ["id", "provenance", "ratifiedAt", "require", "then", "when"])

	var then_keys: Array = (r["then"][0] as Dictionary).keys()
	then_keys.sort()
	assert_eq(then_keys, ["kind", "n"])

	var prov_keys: Array = (r["provenance"] as Dictionary).keys()
	prov_keys.sort()
	assert_eq(prov_keys, ["because", "events", "lenses", "notes"])

	assert_false(SimCanonical.encode(r).contains("onerror"))
