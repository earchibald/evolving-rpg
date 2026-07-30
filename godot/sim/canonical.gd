class_name SimCanonical
## Deterministic JSON: keys sorted, no whitespace, arrays left alone — the byte
## twin of src/log/canonical.ts.
##
## Event identity is a hash of these bytes, so any drift here forks every chain
## ever written. That is why the encoder refuses what it cannot render
## identically to the reference rather than guessing: a loud crash costs one
## debugging session, a quiet disagreement costs the whole replay guarantee.


static func encode(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			# JS renders integral doubles bare ("2", never "2.0"). Every number
			# in this game's payloads is an integer, so an integral float here is
			# a JSON-parse artifact and folding it to int form is the faithful
			# reading. A FRACTIONAL float has no agreed cross-language rendering
			# — refuse loudly rather than fork chains quietly.
			var fv := value as float
			assert(fv == floorf(fv) and absf(fv) <= 9007199254740992.0,
				"SimCanonical: non-integral number %s" % fv)
			return str(int(fv))
		TYPE_STRING, TYPE_STRING_NAME:
			return _encode_string(str(value))
		TYPE_ARRAY:
			var parts := PackedStringArray()
			for v: Variant in value:
				parts.append(encode(v))
			return "[%s]" % ",".join(parts)
		TYPE_DICTIONARY:
			var keys: Array = (value as Dictionary).keys()
			for k: Variant in keys:
				assert(k is String or k is StringName,
					"SimCanonical: non-string key %s" % [k])
			# Code-point order — the same total order as JS Array.sort() over
			# strings. "Z" (90) sorts before "a" (97); a case-insensitive sort
			# would disagree and every object with mixed-case keys would fork.
			keys.sort()
			var pairs := PackedStringArray()
			for k: Variant in keys:
				pairs.append("%s:%s" % [_encode_string(str(k)), encode(value[k])])
			return "{%s}" % ",".join(pairs)
	assert(false, "SimCanonical: unsupported type %d" % typeof(value))
	return ""


## Written by hand rather than delegated to JSON.stringify, because the escaping
## is part of the hashed bytes: this game's chains were signed by JavaScript's
## JSON.stringify, and matching it is a hard requirement, not a preference.
## JS escapes exactly the two mandatory characters, the five short forms, and
## everything below 0x20 as \u00xx — and nothing else. Notably it does NOT
## escape forward slash or non-ASCII, both of which some encoders do.
static func _encode_string(s: String) -> String:
	var out := "\""
	for i: int in s.length():
		var c := s.unicode_at(i)
		match c:
			0x22: out += "\\\""      # quote
			0x5C: out += "\\\\"      # backslash
			0x08: out += "\\b"
			0x09: out += "\\t"
			0x0A: out += "\\n"
			0x0C: out += "\\f"
			0x0D: out += "\\r"
			_:
				if c < 0x20:
					out += "\\u%04x" % c
				else:
					out += String.chr(c)
	return out + "\""
