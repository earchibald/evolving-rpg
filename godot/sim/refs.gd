class_name SimRefs
## Named, movable heads into an event log — the byte-twin of src/log/refs.ts.
##
## A Ref is a plain Dictionary: {"name": String, "head": Variant (String or
## null), "engineVersion": String, "createdAtSeq": int, "note": String}. Refs
## is {"byName": Dictionary[String, Ref]}.
##
## Every function here is non-destructive: it returns a NEW Refs value,
## copying the byName Dictionary shallowly and sharing every Ref it did not
## touch — the reference states this contract as `readonly` fields plus a
## fresh `Map` per write. GDScript Dictionaries have no readonly typing to
## lean on, so the contract is kept here by discipline (duplicate() before
## writing, never mutate a Ref already stored) rather than by the language.


## Bumped by hand when engine behaviour changes; stamped onto every ref so a
## replay can be labelled faithful (same version) or reinterpreted (newer).
## The byte-twin of src/version.ts's sole export, ENGINE_VERSION — a
## one-constant file with nothing else in it, folded in here rather than
## ported as its own sim/version.gd.
const ENGINE_VERSION := "0.1.0"


static func empty() -> Dictionary:
	return {"byName": {}}


static func create(refs: Dictionary, name: String, head: Variant, created_at_seq: int, note: String) -> Dictionary:
	var by_name: Dictionary = refs["byName"]
	assert(not by_name.has(name), "create: ref %s already exists" % name)
	var next: Dictionary = by_name.duplicate()
	next[name] = {
		"name": name,
		"head": head,
		"engineVersion": ENGINE_VERSION,
		"createdAtSeq": created_at_seq,
		"note": note,
	}
	return {"byName": next}


static func get_ref(refs: Dictionary, name: String) -> Dictionary:
	var by_name: Dictionary = refs["byName"]
	assert(by_name.has(name), "get_ref: unknown ref %s" % name)
	return by_name[name]


static func set_head(refs: Dictionary, name: String, head: Variant) -> Dictionary:
	var ref: Dictionary = get_ref(refs, name)
	var by_name: Dictionary = (refs["byName"] as Dictionary).duplicate()
	var next_ref: Dictionary = ref.duplicate()
	next_ref["head"] = head
	by_name[name] = next_ref
	return {"byName": by_name}


## True when `candidate` lies on the chain ending at `head`, head included.
static func is_ancestor(log: SimLog, head: Variant, candidate: String) -> bool:
	if head == null:
		return false
	for e: Dictionary in log.chain(head):
		if e["id"] == candidate:
			return true
	return false


## A fork is a new name pointing at a hash that already exists. Nothing is
## copied — both worlds share every event up to the fork point.
static func fork(log: SimLog, refs: Dictionary, from_name: String, new_name: String, at_hash: Variant, note: String) -> Dictionary:
	var source: Dictionary = get_ref(refs, from_name)
	var by_name: Dictionary = refs["byName"]
	assert(not by_name.has(new_name), "fork: ref %s already exists" % new_name)

	var at: Variant = at_hash if at_hash != null else source["head"]
	assert(at == null or is_ancestor(log, source["head"], at),
		"fork: %s is not on the chain of %s" % [at, from_name])

	var seq: int = 0 if at == null else log.chain(at).size() - 1
	return create(refs, new_name, at, seq, note)


## Moves a ref backwards along its own chain. Non-destructive: the abandoned
## events stay in the log, so the reset can itself be undone.
static func reset(log: SimLog, refs: Dictionary, name: String, to_hash: Variant) -> Dictionary:
	var ref: Dictionary = get_ref(refs, name)
	assert(to_hash == null or is_ancestor(log, ref["head"], to_hash),
		"reset: %s is not on the chain of %s" % [to_hash, name])
	return set_head(refs, name, to_hash)


static func list_refs(refs: Dictionary) -> Array:
	var values: Array = (refs["byName"] as Dictionary).values()
	values.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["name"] < b["name"])
	return values
