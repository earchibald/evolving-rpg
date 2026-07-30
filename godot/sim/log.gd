class_name SimLog
extends RefCounted
## Content-addressed append-only log — the twin of src/log/chain.ts.
##
## Sealed events are deep-frozen. One holder mutating shared history was the
## reference engine's hardest lesson, and make_read_only() is Godot's way to
## keep it learned: a chain you can edit in place is not a chain.
##
## fold() and verify_chain() need the reducer and join in Phase 2.

var events: Dictionary = {}


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
		assert(not seen.has(cursor), "chain: cycle at %s" % cursor)
		seen[cursor] = true
		assert(events.has(cursor), "chain: missing event %s" % cursor)
		out.append(events[cursor])
		cursor = (events[cursor] as Dictionary)["parent"]
	out.reverse()
	return out


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
