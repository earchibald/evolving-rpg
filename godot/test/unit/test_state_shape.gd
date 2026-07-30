extends GutTest
## Pins the state-shape ORACLE, before any ported state code exists to compare
## against it. Phase 2's fold gate measures the GDScript state against this dump;
## a dump that has drifted would send a correct port chasing a divergence that
## is not there, so it gets its own guard.
##
## The absent-key law lives here in executable form: canonicalJson DROPS keys
## whose value is undefined, and GDScript has no undefined. A TypeScript field
## that is undefined must be an ABSENT KEY here — never a null, which would
## encode as `null` and fork every chain that folds it.

const STATE_KEYS := [
	"activeEntityId", "alarm", "bible", "bodies", "depth", "entities", "gold",
	"grid", "items", "level", "motif", "rngCounter", "rules", "seed", "smoke",
	"story", "traps", "turn", "unveiled", "xp",
]


func _shape() -> Dictionary:
	return FixtureLoader.load_json("res://test/fixtures/state-shape.json")


func test_the_oracle_agrees_with_the_golden_fixture_it_was_folded_from() -> void:
	var shape := _shape()
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	assert_eq(shape["goldenHead"], golden["head"], "the dump folded the golden chain")
	assert_eq(shape["goldenChainLength"], (golden["events"] as Array).size())


func test_the_state_is_exactly_twenty_named_keys() -> void:
	var shape := _shape()
	assert_eq(shape["emptyStateKeys"], STATE_KEYS, "EMPTY_STATE's key set")
	assert_eq(shape["goldenFinalKeys"], STATE_KEYS, "a fold never adds or drops a state key")


func test_the_nullable_state_fields_are_present_and_null_not_absent() -> void:
	## The mirror image of the absent-key law. These five are `| null` in the
	## TypeScript type, so `null` is their real value and the key must be there.
	var empty: Dictionary = _shape()["emptyState"]
	for key: String in ["activeEntityId", "motif", "bible", "smoke", "alarm"]:
		assert_true(empty.has(key), "%s is present in EMPTY_STATE" % key)
		assert_eq(empty[key], null, "%s is null, not absent" % key)


func test_entity_optionals_are_absent_on_the_entities_that_lack_them() -> void:
	## The discriminating case, and the reason this fixture exists. In the golden
	## run `disposition` sits on 2 of 4 entities and `gear` on 1 of 4. A port that
	## wrote null instead of omitting would still produce four plausible
	## entities — and miss the fold hash with no idea why.
	var entities: Array = (_shape()["goldenFinal"] as Dictionary)["entities"]
	assert_eq(entities.size(), 4, "the golden run ends with four bodies")
	var with_disposition := 0
	var with_gear := 0
	for e: Dictionary in entities:
		if e.has("disposition"):
			with_disposition += 1
			# assert_not_null, never assert_ne(x, null): GUT 9.7.1's comparator
			# cannot diff against null and pushes an engine error, which GUT
			# then counts as a failure. Ported suites hit this constantly.
			assert_not_null(e["disposition"], "a present disposition is never null")
		if e.has("gear"):
			with_gear += 1
			assert_not_null(e["gear"], "a present gear is never null")
	assert_eq(with_disposition, 2, "disposition is absent on the other two")
	assert_eq(with_gear, 1, "gear is absent on the other three")


func test_no_entity_carries_a_null_valued_key() -> void:
	## Stated positively, this is the whole law: within an entity, unset means
	## the key is gone. If this ever fails, the reference changed and the law
	## needs re-reading — not the test loosening.
	for e: Dictionary in (_shape()["goldenFinal"] as Dictionary)["entities"]:
		for key: Variant in e:
			assert_not_null(e[key], "entity %s key '%s' is null" % [e.get("id", "?"), key])


func test_the_state_encodes_to_the_recorded_final_state_hash() -> void:
	## The Phase 2 fold gate in advance, run against the reference's own state
	## rather than a ported one. It proves the recipe — sha256 over the canonical
	## bytes of the WHOLE state — is reproduced correctly in GDScript, so when
	## the real gate fails later, the recipe is already ruled out and the
	## divergence must be in the fold.
	var golden: Dictionary = FixtureLoader.load_json("res://test/fixtures/golden-run.json")
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(SimCanonical.encode(_shape()["goldenFinal"]).to_utf8_buffer())
	assert_eq(ctx.finish().hex_encode(), golden["finalStateHash"],
		"GDScript reproduces the state-hash recipe over the reference's own state")
