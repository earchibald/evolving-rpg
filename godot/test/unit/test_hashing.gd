extends GutTest
## Identity is content PLUS position: the same draft at a different point in the
## chain is a different event. Both halves are pinned below.

const DRAFT := {"type": "WAIT", "schemaVersion": 1, "rngCounter": 3, "payload": {"entityId": "p1"}}


func test_pinned_reference_hashes() -> void:
	assert_eq(SimHash.hash_event(DRAFT, null, 0),
		"4d6a00dcb9dca40a6b390de584de90f0328c5443d028811081ebd8866a1b1da9")
	assert_eq(SimHash.hash_event(DRAFT, "abc123", 4),
		"54a8660bbcbd5ad4cfa2af8f5a249e0d450b67a87f584ec6ff19e9690823a4e7")


func test_matches_reference_fixtures() -> void:
	var cases: Array = FixtureLoader.load_json("res://test/fixtures/hashes.json")
	assert_eq(cases.size(), 3, "the exported hash cases")
	for c: Dictionary in cases:
		assert_eq(SimHash.hash_event(c["draft"], c["parent"], c["seq"]), c["id"])


func test_position_is_part_of_identity() -> void:
	var at_root := SimHash.hash_event(DRAFT, null, 0)
	var at_four := SimHash.hash_event(DRAFT, "abc123", 4)
	assert_ne(at_root, at_four, "same content, different position, different id")
	var same_seq_other_parent := SimHash.hash_event(DRAFT, "def456", 4)
	assert_ne(at_four, same_seq_other_parent, "the parent is material too")


func test_extra_draft_keys_are_ignored() -> void:
	## A fixture event carries id/parent/seq/rngDraws of its own. hash_event must
	## read only type/schemaVersion/rngCounter/payload, or re-hashing a recorded
	## chain would never reproduce it — which is exactly what the gate does.
	var fat := DRAFT.duplicate(true)
	fat["id"] = "whatever"
	fat["parent"] = "not-this"
	fat["seq"] = 99
	fat["rngDraws"] = 12
	assert_eq(SimHash.hash_event(fat, null, 0), SimHash.hash_event(DRAFT, null, 0))


func test_is_lowercase_hex_of_the_right_length() -> void:
	var id := SimHash.hash_event(DRAFT, null, 0)
	assert_eq(id.length(), 64, "sha-256 is 64 hex characters")
	assert_eq(id, id.to_lower(), "hex is lowercase")
