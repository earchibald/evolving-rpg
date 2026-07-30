class_name SimHash
## Identity is content plus position: the same event at a different point in the
## chain is a different event — the twin of src/log/hash.ts.
##
## Reads only type/schemaVersion/rngCounter/payload off the draft. A recorded
## event also carries id/parent/seq/rngDraws, and those are deliberately ignored
## so that re-hashing a chain read off disk reproduces the ids it already has.
## That property is the whole Phase 1 gate.


static func hash_event(draft: Dictionary, parent: Variant, seq: int) -> String:
	var material := SimCanonical.encode({
		"type": draft["type"],
		"schemaVersion": draft["schemaVersion"],
		"rngCounter": draft["rngCounter"],
		"payload": draft["payload"],
		"parent": parent,
		"seq": seq,
	})
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(material.to_utf8_buffer())
	return ctx.finish().hex_encode()
