class_name SimEvents
## The schema table and the draft envelope builder — the byte-twin of
## src/core/events.ts's own runtime exports.
##
## events.ts is 511 lines but almost all of it is TS payload TYPES (one
## interface per event, a DraftEvent union, a GameEvent intersection) that
## erase at compile time and have no GDScript runtime counterpart — a
## payload here is a plain Dictionary, and shaping what belongs in one is
## the reducer's business (apply.gd, Wave C), not this file's. What
## survives to runtime, and what this file ports, is SCHEMA_VERSIONS and
## the draft() builder.


## Per event type. Bump when a type's meaning changes, and write an
## upcaster.
##
## v2 moved randomness accounting onto the envelope: every event now
## carries rngDraws, and apply advances the counter by it uniformly.
## Before this, only WORLD_INIT moved the counter, via a counterAfter field
## buried in its payload — a special case that could not survive any
## second consumer of randomness, and combat is one.
const SCHEMA_VERSIONS := {
	"WORLD_INIT": 15, "WORLD_BIBLE": 1, "WORLD_BODIES": 1, "MOVE": 2,
	"MOVE_BLOCKED": 2, "TURN_ADVANCED": 2, "STRIKE": 5, "WAIT": 1, "DRAWN": 1,
	"ITEM_TAKEN": 5, "ITEM_REFUSED": 1, "ITEM_USED": 2, "SCROLL_READ": 1,
	"GOLD_MOVED": 1, "RULE_RATIFIED": 1, "RULE_FIRED": 1, "VIGIL_KEPT": 1,
	"WORLD_STIRRED": 1, "SHOVE": 1, "BRACED": 1, "CALLED": 1,
	"WORLD_REMEMBERED": 1, "UNMASKED": 1, "TRAP_SENSED": 1, "TRAP_SPRUNG": 1,
}


## An event before it has been hashed and linked into a chain: exactly the
## five keys SimHash.hash_event and SimLog.append expect of it (type,
## schemaVersion, rngCounter, payload are read by the hash; append then
## seals the draft as-is and adds id/parent/seq — see hashing.gd and
## log.gd). schemaVersion is looked up from SCHEMA_VERSIONS rather than
## taken as a parameter, so a draft can never disagree with its own type's
## recorded version — the table is the one place that fact is decided, the
## same way the reference's DraftEvent union ties each type to its payload
## shape at the type level.
##
## rngCounter is the generator's counter BEFORE the command ran; rngDraws
## is how many draws it consumed. apply advances the stored counter by
## exactly rngDraws for every type without exception, so a caller that
## draws nothing still passes 0 rather than omitting the argument.
static func draft(type: String, rng_counter: int, rng_draws: int, payload: Dictionary) -> Dictionary:
	assert(SCHEMA_VERSIONS.has(type), "SimEvents.draft: unknown event type %s" % type)
	return {
		"type": type,
		"schemaVersion": SCHEMA_VERSIONS[type],
		"rngCounter": rng_counter,
		"rngDraws": rng_draws,
		"payload": payload,
	}
