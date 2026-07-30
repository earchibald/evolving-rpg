class_name SimLog
extends RefCounted
## Content-addressed append-only log — the twin of src/log/chain.ts.
##
## Sealed events are deep-frozen. One holder mutating shared history was the
## reference engine's hardest lesson, and make_read_only() is Godot's way to
## keep it learned: a chain you can edit in place is not a chain.

var events: Dictionary = {}

## Folded states, memoised by event id.
##
## The reference's FOLDED map is MODULE-LEVEL: one Map shared by every
## EventLog that exists in the process, for the life of the process. Here it
## is an INSTANCE field instead, tied to this SimLog alone — a difference in
## representation, not in soundness. A SimLog already owns its own `events`
## (nothing here is ever asked to fold an id from a log this instance never
## saw), so a memo whose lifetime matches the log's is STRICTLY TIGHTER than
## the reference's: every entry the instance memo could ever hold, the
## process-wide one would also hold, and the reverse is never asked of it.
## Sound for the same reason the reference gives: identity is content plus
## position, so the state at a given id is the same state forever, in every
## log that contains it — apply is pure and events are deep-frozen, so a
## cached state can never drift from a recomputed one.
var _folded: Dictionary = {}

## Matches the reference's FOLD_CACHE_LIMIT exactly (200_000). Cleared
## wholesale at the cap rather than evicted piecewise: correctness never
## depends on an entry being present, so the worst case of clearing is one
## refold from the root per chain. A smarter eviction policy would be a
## behaviour change, not an improvement — this is a port.
const FOLD_CACHE_LIMIT := 200000


## Returns the sealed event. Idempotent on convergent history: appending the
## same content at the same position twice yields the one event both times,
## because the id IS the content and the position.
func append(head: Variant, draft: Dictionary) -> Dictionary:
	var seq := 0
	if head != null:
		assert(events.has(head), "append: unknown head %s" % head)
		seq = (events[head] as Dictionary)["seq"] + 1
	var id := SimHash.hash_event(draft, head, seq)
	if events.has(id):
		return events[id]
	# duplicate(true), not the draft itself: a caller who keeps mutating their
	# draft must not be able to reach into sealed history.
	var event: Dictionary = draft.duplicate(true)
	event["id"] = id
	event["parent"] = head
	event["seq"] = seq
	_deep_freeze(event)
	events[id] = event
	return event


## Root-first, so a fold can reduce straight over it.
func chain(head: Variant) -> Array:
	var out: Array = []
	var seen: Dictionary = {}
	var cursor: Variant = head
	while cursor != null:
		if seen.has(cursor):
			assert(false, "chain: cycle at %s" % cursor)
			return []
		seen[cursor] = true
		if not events.has(cursor):
			assert(false, "chain: missing event %s" % cursor)
			return []
		out.append(events[cursor])
		cursor = (events[cursor] as Dictionary)["parent"]
	out.reverse()
	return out


## Folds the chain ending at `head` down to a single state.
##
## Walks back to the nearest already-folded ancestor (in this instance's own
## memo — see `_folded` above), then applies forward from it, caching every
## intermediate state on the way so the next fold of any prefix, sibling or
## extension of this chain starts warm. Without the memo every keypress would
## refold from the root and an autoplayed run would be quadratic in its own
## length. `fold(null)` is the empty state.
##
## Cycles and a missing event both raise, the same two guards `chain()` puts
## at the same two points of the same kind of walk. Each is paired with an
## explicit return, the house pattern for every guard added from Wave C on
## (see apply.gd's own note on its refusal): assert() unwinds only the frame
## it is in, so the asserting function itself must supply the fallback value
## rather than trust the unwind to produce one a caller can rely on in a
## build where assert() has been compiled out.
func fold(head: Variant) -> Dictionary:
	if head == null:
		return SimState.empty()
	var hit: Variant = _folded.get(head)
	if hit != null:
		return hit

	var pending: Array = []
	var seen: Dictionary = {}
	var cursor: Variant = head
	var state: Dictionary = SimState.empty()
	while cursor != null:
		if seen.has(cursor):
			assert(false, "fold: cycle at %s" % cursor)
			return {}
		seen[cursor] = true
		var cached: Variant = _folded.get(cursor)
		if cached != null:
			state = cached
			break
		if not events.has(cursor):
			assert(false, "fold: missing event %s" % cursor)
			return {}
		var event: Dictionary = events[cursor]
		pending.append(event)
		cursor = event["parent"]

	# Cleared wholesale, not evicted piecewise — see _folded's own docstring.
	if _folded.size() + pending.size() > FOLD_CACHE_LIMIT:
		_folded.clear()
	for i in range(pending.size() - 1, -1, -1):
		var event: Dictionary = pending[i]
		state = SimApply.apply(state, event)
		_folded[event["id"]] = state
	return state


## Recomputes every hash and checks each event's recorded counter against the
## state it is about to be applied to. Returns null when the chain is sound,
## else the first {"seq": int, "eventId": String, "reason": String} that
## fails — the reference's Divergence, as a Dictionary. Never repairs
## anything: a divergence is a fact to report, not to smooth over.
##
## The order below is the reference's own and is not incidental: it decides
## which divergence gets reported first when more than one is true at once —
## hash, then type, then schema version, then sequence, then rng counter.
##
## DOES NOT CHECK STRUCTURAL SOUNDNESS, and cannot as written. The reference
## leans on chain() for that — a cycle or a missing event THROWS there and the
## throw propagates straight out through verifyChain — but GDScript's assert()
## unwinds exactly ONE frame, so chain()'s refusal ends at chain()'s own
## boundary. chain() returns [] and this function then iterates nothing and
## returns null, which reads as "sound". A hole in the log is therefore LOUD
## (chain() pushes an engine error) but not REPORTED (the return value cannot
## carry it).
##
## A caller who needs structural soundness must call chain() itself and watch
## for the refusal. This is the port's one known divergence from the
## reference's verifyChain contract; it is pinned by
## test_verify_chain_cannot_see_a_structurally_broken_log_and_says_so_loudly
## and written up in NIGHTLOG. Widening the return type to carry it is a
## behaviour change and belongs to the designer, not to this function.
func verify_chain(head: Variant) -> Variant:
	var state: Dictionary = SimState.empty()
	var expected_seq := 0

	for event: Dictionary in chain(head):
		# hash_event reads only type/schemaVersion/rngCounter/payload off the
		# draft, and a recorded event carries those same four plus
		# id/parent/seq/rngDraws — so the event goes straight in. A
		# hand-rolled projection here would be a second encoding of "what
		# gets hashed", and forgetting to update it after adding a hashed
		# field would make every honest chain start failing verification.
		var recomputed: String = SimHash.hash_event(event, event["parent"], event["seq"])
		if recomputed != event["id"]:
			return {"seq": event["seq"], "eventId": event["id"],
				"reason": "hash mismatch, recomputed %s" % recomputed}

		# Reject unreducible events BEFORE apply sees them. An alien type
		# hashes perfectly well — hashing proves integrity, never
		# intelligibility.
		if not SimEvents.SCHEMA_VERSIONS.has(event["type"]):
			return {"seq": event["seq"], "eventId": event["id"],
				"reason": "unknown event type %s" % event["type"]}
		var version: int = SimEvents.SCHEMA_VERSIONS[event["type"]]
		if int(event["schemaVersion"]) != version:
			return {"seq": event["seq"], "eventId": event["id"],
				"reason": "%s is schemaVersion %d, this engine implements %d" %
					[event["type"], int(event["schemaVersion"]), version]}

		if int(event["seq"]) != expected_seq:
			return {"seq": event["seq"], "eventId": event["id"],
				"reason": "sequence gap: expected seq %d" % expected_seq}
		expected_seq += 1

		# WORLD_INIT opens a new counter epoch: a fresh floor draws from a
		# fresh seed, addressed from zero, and both the generator and apply
		# already treat it so. Demanding continuity across the stairs
		# refused every saved run that had ever descended — found by a
		# player losing a session to "diverges at seq 120", where seq 120
		# was floor 2 being born.
		if event["type"] != "WORLD_INIT" and int(state["rngCounter"]) != int(event["rngCounter"]):
			return {"seq": event["seq"], "eventId": event["id"],
				"reason": "rng counter recorded as %d but state is at %d" %
					[int(event["rngCounter"]), int(state["rngCounter"])]}

		state = SimApply.apply(state, event)

	return null


static func _deep_freeze(value: Variant) -> void:
	match typeof(value):
		TYPE_DICTIONARY:
			for k: Variant in value:
				_deep_freeze(value[k])
			(value as Dictionary).make_read_only()
		TYPE_ARRAY:
			for v: Variant in value:
				_deep_freeze(v)
			(value as Array).make_read_only()
