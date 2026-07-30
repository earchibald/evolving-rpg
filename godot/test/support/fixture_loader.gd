class_name FixtureLoader
## Loads a JSON fixture and folds JSON-parser float artifacts back to int.
##
## Every number in this game's CHAINS AND STATE is an integer. Godot's JSON
## parser hands back floats for bare numbers, and a float that reaches
## SimCanonical either renders as "2.0" where the reference wrote "2" — forking
## the chain — or trips the encoder's refusal. This is the one place that
## artifact is corrected, so nothing downstream has to remember it. In a chain
## or state fixture a genuinely fractional number is a corruption worth crashing
## on, not smoothing over.
##
## TABLE fixtures are the documented exception, and they are not a loophole:
## the game's balance COEFFICIENTS really are fractional — VERB_THREAT prices
## verbs at 1.1 to 1.3, and bountyStretch((S+1)/2) returns 1.5 and 2.5. Those
## numbers are the data, not an artifact, and rounding them would hide exactly
## the integer-division bug class their fixture rows exist to catch. So the
## strictness is chosen at the call site by which loader you reach for, and the
## choice is legible there rather than hidden in a boolean:
##
##   load_json(path)        chain/state fixtures — fractional numbers REFUSED
##   load_table_json(path)  table fixtures       — fractional coefficients KEPT
##
## Both fold integral floats to int either way, so an integer stays an integer.
## Nothing fractional ever reaches SimCanonical, because the state stores the
## RESULTS of these coefficients (integers), never the coefficients themselves.


## Chain and state fixtures. A fractional number here is corruption — crash.
static func load_json(path: String) -> Variant:
	return normalize(_read(path))


## Table fixtures, whose fractional coefficients are genuine data.
static func load_table_json(path: String) -> Variant:
	return normalize(_read(path), true)


static func _read(path: String) -> Variant:
	var f := FileAccess.open(path, FileAccess.READ)
	assert(f != null, "missing fixture: " + path)
	return JSON.parse_string(f.get_as_text())


static func normalize(value: Variant, allow_fractional: bool = false) -> Variant:
	match typeof(value):
		TYPE_FLOAT:
			var fv := value as float
			if fv != floorf(fv):
				assert(allow_fractional, "non-integral number in fixture: %s" % fv)
				return fv
			return int(fv)
		TYPE_ARRAY:
			var arr: Array = []
			for v: Variant in value:
				arr.append(normalize(v, allow_fractional))
			return arr
		TYPE_DICTIONARY:
			var out: Dictionary = {}
			for k: Variant in value:
				out[k] = normalize(value[k], allow_fractional)
			return out
		_:
			return value
