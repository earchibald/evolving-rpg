class_name SimState
## The world's whole shape at a turn boundary — the byte-twin of src/core/state.ts.
##
## A state is a plain Dictionary, exactly the 20 keys in STATE_KEYS and no
## others. GameState is what the fold gate hashes whole, so an extra or a
## missing key is not a bug that shows up as wrong behaviour — it is a
## silently forked chain. Every key here is ALWAYS present; unlike
## SimEntity's nine `?`-marked keys, nothing in GameState itself is optional.
##
## Five of the twenty are `| null` in the reference and stay PRESENT with
## value null rather than disappearing when unset: "activeEntityId", "motif",
## "bible", "smoke", "alarm". That is the mirror image of the absent-key law
## that governs SimEntity — here the key must survive even when the state has
## nothing to say yet, because canonicalJson only drops a key whose value is
## `undefined`, and null is not undefined.


const STATE_KEYS: Array[String] = [
	"activeEntityId", "alarm", "bible", "bodies", "depth", "entities", "gold",
	"grid", "items", "level", "motif", "rngCounter", "rules", "seed", "smoke",
	"story", "traps", "turn", "unveiled", "xp",
]


## What a fold starts from. A WORLD_INIT event replaces it wholesale.
## The reference's EMPTY_STATE is one frozen object every fold in the process
## shares, so that a reducer mutating its accumulator in place would corrupt
## the baseline for every later replay and fail somewhere far from the cause.
## Godot has no structural sharing to lose by copying, so a shared frozen
## Dictionary here would only force every reducer to duplicate it before
## writing anyway — this returns a FRESH Dictionary on every call instead.
## That is a difference in representation only: the key set and every value
## below are identical to EMPTY_STATE, and SimCanonical.encode() of the two
## must match byte for byte (see test_state.gd).
static func empty() -> Dictionary:
	return {
		"grid": SimGrid.make(1, 1, [SimGrid.WALL]),
		"entities": [],
		"items": [],
		"turn": 0,
		"activeEntityId": null,
		"seed": 0,
		"rngCounter": 0,
		"rules": [],
		"xp": 0,
		"level": 1,
		"depth": 1,
		"gold": 0,
		"story": "",
		"motif": null,
		"bodies": [],
		"bible": null,
		"smoke": null,
		"traps": [],
		"alarm": null,
		"unveiled": [],
	}


## Asserts `state` carries exactly STATE_KEYS — nothing missing, nothing
## extra. The whole state is hashed, so a stray key (a stored total living
## beside the folded one — the M9 mistake) or a silently dropped one is not
## caught by any type system at runtime; this is the one place that checks
## the shape instead of trusting it. Loud crash on mismatch, the same choice
## SimGrid.make and SimCanonical.encode make: one debugging session beats a
## quietly forked chain. Checks the key SET only — an entity's own optional
## keys are that reducer's business, not this function's; see apply.gd's
## WORLD_INIT case (Task 2.C1) for the guard that lives where entities are
## actually constructed.
static func assert_shape(state: Dictionary) -> void:
	var keys: Array = state.keys()
	keys.sort()
	assert(keys == STATE_KEYS, "SimState: expected keys %s, got %s" % [STATE_KEYS, keys])
