class_name FixtureLoader
## Loads a JSON fixture and folds JSON-parser float artifacts back to int.
##
## Every number in this game's chains is an integer. Godot's JSON parser hands
## back floats for bare numbers, and a float that reaches SimCanonical either
## renders as "2.0" where the reference wrote "2" — forking the chain — or trips
## the encoder's refusal. This is the one place that artifact is corrected, so
## nothing downstream has to remember it. A genuinely fractional number in a
## fixture is a corruption worth crashing on, not smoothing over.


static func load_json(path: String) -> Variant:
	var f := FileAccess.open(path, FileAccess.READ)
	assert(f != null, "missing fixture: " + path)
	return normalize(JSON.parse_string(f.get_as_text()))


static func normalize(value: Variant) -> Variant:
	match typeof(value):
		TYPE_FLOAT:
			var fv := value as float
			assert(fv == floorf(fv), "non-integral number in fixture: %s" % fv)
			return int(fv)
		TYPE_ARRAY:
			var arr: Array = []
			for v: Variant in value:
				arr.append(normalize(v))
			return arr
		TYPE_DICTIONARY:
			var out: Dictionary = {}
			for k: Variant in value:
				out[k] = normalize(value[k])
			return out
		_:
			return value
