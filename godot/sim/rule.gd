class_name SimRule
## The R2 rule vocabulary, and the validator that makes it safe to let a model
## write one — the byte-twin of src/canon/rule.ts.
##
## A rule is *data*, never code: nothing here is ever evaluated or executed,
## so the worst a malicious or confused proposal can do is be rejected. That
## is the entire safety argument for the Ladder, and it lives or dies on this
## file — which is why `validate` is TOTAL (never asserts, never crashes, for
## any Variant whatsoever) and its rejection strings are ported
## character-for-character: they are shown to the player by the Forge, and
## the reference's own tests assert on them.
##
## GDScript has no discriminated unions, so a Condition / Effect / Rule is a
## plain Dictionary mirroring the TS object shape key-for-key — never a class.
## Rules ride the event chain (RULE_RATIFIED) and fold into GameState, so key
## names are hashed: renaming one forks every chain that ratified a rule.
##
## Frozen all the way down, matching the reference's Object.freeze at every
## level. Godot already freezes a literal `const` Array/Dictionary (and its
## nested literals) on its own, so the vocabulary constants below need no
## explicit make_read_only() — only `validate`'s freshly-built OUTPUT does,
## since make_read_only() is shallow: each nested Dictionary/Array must be
## frozen individually, not just the outermost one.

const TRIGGERS: Array[String] = [
	"WAIT",          # you held still
	"MOVE",          # you took a step
	"MOVE_BLOCKED",  # you walked into something solid
	"STRIKE",        # you struck something
	"STRUCK",        # something struck you
	"KILLED",        # something died by your hand
	"ITEM_TAKEN",    # you picked something up
	"TURN_PASSED",   # a full round went by
]

## The four stats, plus the health ceiling, since raising a maximum is a
## different thing from healing to it.
const STATS: Array[String] = ["might", "speed", "wits", "maxHp"]

## The cuts a floor can be shaped to (tables.ts MOTIFS — a TS test in
## tests/core/motifs.test.ts pins the two lists together; that module is not
## yet ported). Base cuts only: the deep is depth's business, said by
## composition (`motifIs warren` + `depthAtLeast 7`), not by a fourth name.
const MOTIF_NAMES: Array[String] = ["door", "warren", "halls"]

const CONDITION_KINDS: Array[String] = [
	"hpAtMost", "hpAtLeast", "hpBelowPercent", "hpAbovePercent",
	"creatureWithin", "noCreatureWithin", "creaturesAtMost", "creaturesAtLeast",
	"exitWithin", "exitBeyond", "turnAtLeast", "depthAtLeast", "statAtLeast",
	"motifIs", "bodyHere",
	"blowLanded", "blowMissed",
]

const EFFECT_KINDS: Array[String] = [
	"heal", "harm", "harmOther", "grant", "drain", "push", "speak",
]

## Conditions that test the blow that triggered the rule rather than the
## world. They carry no number, and only mean anything under STRIKE or STRUCK.
const BLOW_CONDITIONS: Array[String] = ["blowLanded", "blowMissed"]

## Kinds that name a stat as well as a number.
const STAT_KINDS: Array[String] = ["statAtLeast", "grant", "drain"]

## Kinds that name a floor's cut, and nothing else.
const MOTIF_KINDS: Array[String] = ["motifIs"]

## Bounds, per kind rather than one number for everything. A single global
## 1-9 was wrong once the vocabulary grew: a distance on a 24x16 grid runs to
## 38, a percentage to 99, a turn count into the hundreds, while a permanent
## stat grant of 9 would be absurd. Copied verbatim from rule.ts's RANGES —
## every entry is a balance decision with history behind it, not re-derived.
const RANGES := {
	"heal": [1, 20], "harm": [1, 20], "harmOther": [1, 20],
	"grant": [1, 5], "drain": [1, 5],
	"push": [1, 3],
	"hpAtMost": [1, 99], "hpAtLeast": [1, 99],
	"hpBelowPercent": [1, 99], "hpAbovePercent": [1, 99],
	"creatureWithin": [1, 40], "noCreatureWithin": [1, 40],
	"exitWithin": [1, 40], "exitBeyond": [1, 40],
	"creaturesAtMost": [0, 20], "creaturesAtLeast": [0, 20],
	"turnAtLeast": [1, 999],
	"depthAtLeast": [1, 99],
	"statAtLeast": [1, 20],
}

const MAX_CONDITIONS := 4
const MAX_EFFECTS := 3
const MAX_TEXT := 120
const MAX_BECAUSE := 240
const MAX_RULES := 16

## Rejection messages go on screen, and what they describe is untrusted.
const MAX_QUOTE := 40

const TRIGGER_TEXT := {
	"WAIT": "you hold still",
	"MOVE": "you take a step",
	"MOVE_BLOCKED": "you walk into something solid",
	"STRIKE": "you strike something",
	"STRUCK": "something strikes you",
	"KILLED": "something dies by your hand",
	"ITEM_TAKEN": "you pick something up",
	"TURN_PASSED": "a turn goes by",
}

const STAT_TEXT := {
	"might": "might", "speed": "speed", "wits": "wits", "maxHp": "your health ceiling",
}

const MOTIF_TEXT := {
	"door": "the door", "warren": "the warren", "halls": "the halls",
}


## The range a kind's `n` must fall in, or null for kinds that take none.
## Exported so the Forge's editor can build controls that cannot produce an
## invalid rule in the first place, rather than ones that get rejected after.
## The returned Array is the constant's own (already read-only) storage, not
## a copy — RANGES is frozen, so there is nothing for a caller to corrupt.
static func range_of(kind: String) -> Variant:
	return RANGES[kind] if RANGES.has(kind) else null


static func takes_stat(kind: String) -> bool:
	return STAT_KINDS.has(kind)


static func takes_motif(kind: String) -> bool:
	return MOTIF_KINDS.has(kind)


static func takes_number(kind: String) -> bool:
	return RANGES.has(kind)


## Which triggers a kind is usable with, or null for "any". Mirrors the two
## coherence checks in validate() (_blow_conditions_fit, _other_effects_fit),
## so the editor can grey out what would be refused instead of letting you
## build it and then be told no.
static func needs_triggers(kind: String) -> Variant:
	if BLOW_CONDITIONS.has(kind):
		return ["STRIKE", "STRUCK"]
	if kind == "harmOther" or kind == "push":
		return ["STRIKE", "STRUCK", "KILLED"]
	return null


static func is_rejected(r: Dictionary) -> bool:
	return r.has("rejected")


static func _reject(message: String) -> Dictionary:
	var r: Dictionary = {"rejected": message.substr(0, 200)}
	r.make_read_only()
	return r


## Stringifies an untrusted value for embedding in a rejection message,
## truncated so a giant offending value cannot flood the screen it is shown
## on. `str()` alone diverges from the reference's `String(value)` on exactly
## the values a JS `String()` needed special-casing for (null, NaN, the
## infinities) — GDScript's own str() renders those as "<null>" / "nan" /
## "inf", so they are special-cased here to keep the on-screen wording the
## same family as the reference's.
static func _show(value: Variant) -> String:
	var s: String
	match typeof(value):
		TYPE_NIL:
			s = "null"
		TYPE_STRING, TYPE_STRING_NAME:
			s = String(value)
		TYPE_BOOL:
			s = "true" if value else "false"
		TYPE_FLOAT:
			var f: float = value
			if is_nan(f):
				s = "NaN"
			elif f == INF:
				s = "Infinity"
			elif f == -INF:
				s = "-Infinity"
			else:
				s = str(f)
		_:
			s = str(value)
	if s.length() > MAX_QUOTE:
		s = s.substr(0, MAX_QUOTE) + "…"
	return s


## A GDScript Dictionary IS the plain-object case (unlike JS, where an Array
## is also `typeof === 'object'` and isPlainObject must explicitly exclude
## it, and where an exotic object needs a prototype check to exclude it) —
## every other Variant type, including Array, is already a distinct type tag.
static func _is_plain_object(v: Variant) -> bool:
	return typeof(v) == TYPE_DICTIONARY


## Whole number inside this kind's own range. Rules out NaN and infinities,
## which is the point: `heal Infinity` is a rule that ends the game. Accepts
## an integral FLOAT the same way the reference's Number.isInteger does (JS
## has no separate int/float, so `20` and `20.0` are the same value there);
## _int_value folds an accepted integral float to a genuine int before it is
## stored, since GDScript — unlike JS — can tell the two apart, and every
## number folded into state must be an int.
static func _in_range(kind: String, v: Variant) -> bool:
	if not RANGES.has(kind):
		return false
	var range: Array = RANGES[kind]
	var n: float
	match typeof(v):
		TYPE_INT:
			n = v
		TYPE_FLOAT:
			if not is_finite(v) or v != floor(v):
				return false
			n = v
		_:
			return false
	return n >= range[0] and n <= range[1]


static func _int_value(v: Variant) -> int:
	return int(v)


static func _range_text(kind: String) -> String:
	if not RANGES.has(kind):
		return "a whole number"
	var range: Array = RANGES[kind]
	return "a whole number %d–%d" % [range[0], range[1]]


static func _one_of(allowed: Array, v: Variant) -> bool:
	return typeof(v) == TYPE_STRING and allowed.has(v)


## An Array of strings, or null if `v` is not an Array or holds anything but
## strings. May alias `v` itself (the reference's stringsOnly does too — the
## defensive copy happens later, at the point the result is frozen).
static func _strings_only(v: Variant) -> Variant:
	if typeof(v) != TYPE_ARRAY:
		return null
	var arr: Array = v
	for x: Variant in arr:
		if typeof(x) != TYPE_STRING:
			return null
	return arr


static func _is_positive_integer(v: Variant) -> bool:
	match typeof(v):
		TYPE_INT:
			return v > 0
		TYPE_FLOAT:
			return is_finite(v) and v == floor(v) and v > 0
		_:
			return false


static func _validate_condition(raw: Variant) -> Dictionary:
	if not _is_plain_object(raw):
		return _reject("require: expected an object, got %s" % _show(raw))
	var d: Dictionary = raw

	var kind: Variant = d.get("kind")
	if not _one_of(CONDITION_KINDS, kind):
		return _reject('require: unknown condition "%s"' % _show(kind))
	var kind_s: String = kind

	if _one_of(BLOW_CONDITIONS, kind_s) or kind_s == "bodyHere":
		var c: Dictionary = {"kind": kind_s}
		c.make_read_only()
		return c

	if kind_s == "motifIs":
		var motif: Variant = d.get("motif")
		if not _one_of(MOTIF_NAMES, motif):
			return _reject('require: unknown motif "%s" — the cuts are %s' % [_show(motif), ", ".join(MOTIF_NAMES)])
		var c: Dictionary = {"kind": kind_s, "motif": motif}
		c.make_read_only()
		return c

	if kind_s == "statAtLeast":
		var stat: Variant = d.get("stat")
		if not _one_of(STATS, stat):
			return _reject('require: unknown stat "%s"' % _show(stat))
		if not _in_range(kind_s, d.get("n")):
			return _reject("require: n must be %s, got %s" % [_range_text(kind_s), _show(d.get("n"))])
		var c: Dictionary = {"kind": kind_s, "stat": stat, "n": _int_value(d.get("n"))}
		c.make_read_only()
		return c

	if not _in_range(kind_s, d.get("n")):
		return _reject("require: n must be %s, got %s" % [_range_text(kind_s), _show(d.get("n"))])
	var c: Dictionary = {"kind": kind_s, "n": _int_value(d.get("n"))}
	c.make_read_only()
	return c


static func _validate_effect(raw: Variant) -> Dictionary:
	if not _is_plain_object(raw):
		return _reject("then: expected an object, got %s" % _show(raw))
	var d: Dictionary = raw

	var kind: Variant = d.get("kind")
	if not _one_of(EFFECT_KINDS, kind):
		return _reject('then: unknown effect "%s"' % _show(kind))
	var kind_s: String = kind

	if kind_s == "speak":
		var text: Variant = d.get("text")
		if typeof(text) != TYPE_STRING or (text as String).strip_edges() == "":
			return _reject("then: speak needs text, got %s" % _show(text))
		var text_s: String = text
		if text_s.length() > MAX_TEXT:
			return _reject("then: speak text is %d characters, the limit is %d" % [text_s.length(), MAX_TEXT])
		var e: Dictionary = {"kind": kind_s, "text": text_s}
		e.make_read_only()
		return e

	if kind_s == "grant" or kind_s == "drain":
		var stat: Variant = d.get("stat")
		if not _one_of(STATS, stat):
			return _reject('then: unknown stat "%s"' % _show(stat))
		if not _in_range(kind_s, d.get("n")):
			return _reject("then: n must be %s, got %s" % [_range_text(kind_s), _show(d.get("n"))])
		var e: Dictionary = {"kind": kind_s, "stat": stat, "n": _int_value(d.get("n"))}
		e.make_read_only()
		return e

	if not _in_range(kind_s, d.get("n")):
		return _reject("then: n must be %s, got %s" % [_range_text(kind_s), _show(d.get("n"))])
	var e: Dictionary = {"kind": kind_s, "n": _int_value(d.get("n"))}
	e.make_read_only()
	return e


static func _validate_provenance(raw: Variant) -> Dictionary:
	if not _is_plain_object(raw):
		return _reject("provenance: expected an object, got %s" % _show(raw))
	var d: Dictionary = raw

	var events: Variant = _strings_only(d.get("events"))
	var notes: Variant = _strings_only(d.get("notes"))

	var raw_lenses: Variant = d.get("lenses")
	if raw_lenses == null:
		raw_lenses = []
	var lenses: Variant = null
	if typeof(raw_lenses) == TYPE_ARRAY:
		var filtered: Array = []
		for x: Variant in (raw_lenses as Array):
			if _is_positive_integer(x):
				filtered.append(_int_value(x))
		lenses = filtered

	# Check order matches the reference exactly (lenses, then events, then
	# notes) even though no known input makes more than one of these fire at
	# once — a rejection is chosen by this precedence, not merely present.
	if lenses == null:
		return _reject("provenance: lenses must be a list of lens numbers, got %s" % _show(raw_lenses))
	if events == null:
		return _reject("provenance: events must be a list of ids, got %s" % _show(d.get("events")))
	if notes == null:
		return _reject("provenance: notes must be a list of timestamps, got %s" % _show(d.get("notes")))

	var because: Variant = d.get("because")
	if typeof(because) != TYPE_STRING or (because as String).strip_edges() == "":
		return _reject("provenance: because must say why this rule exists, got %s" % _show(because))

	# A rule that cites nothing is precisely what the Ladder exists to prevent.
	if (events as Array).is_empty() and (notes as Array).is_empty():
		return _reject("provenance: a rule must cite at least one event or note it is answering")

	# Duplicated before freezing: _strings_only may have handed back the
	# caller's own array (see its docstring), and this validator must not
	# freeze — or otherwise reach into — what it was given.
	var events_frozen: Array = (events as Array).duplicate()
	events_frozen.make_read_only()
	var notes_frozen: Array = (notes as Array).duplicate()
	notes_frozen.make_read_only()
	var lenses_frozen: Array = (lenses as Array).duplicate()
	lenses_frozen.make_read_only()

	var provenance: Dictionary = {
		"events": events_frozen,
		"notes": notes_frozen,
		"lenses": lenses_frozen,
		"because": (because as String).substr(0, MAX_BECAUSE),
	}
	provenance.make_read_only()
	return provenance


## Conditions about the blow only mean anything when a blow is what happened.
static func _blow_conditions_fit(when: String, require: Array) -> Variant:
	var offending: String = ""
	for c: Dictionary in require:
		if _one_of(BLOW_CONDITIONS, c["kind"]):
			offending = c["kind"]
			break
	if offending == "":
		return null
	if when == "STRIKE" or when == "STRUCK":
		return null
	return 'require: "%s" needs a blow — use it with STRIKE or STRUCK, not %s' % [offending, when]


## A floor has one cut. Two different `motifIs` conditions validate cleanly,
## read plausibly, and can never both hold — a rule that looks ratifiable and
## then silently does nothing forever, which is the lie the validator exists
## to prevent (VOCABULARY.md: the unresolvable case gets its legal exit).
static func _motifs_fit(require: Array) -> Variant:
	var cuts: Array = []
	for c: Dictionary in require:
		if c["kind"] == "motifIs" and not cuts.has(c["motif"]):
			cuts.append(c["motif"])
	if cuts.size() <= 1:
		return null
	return 'require: the floor cannot be both "%s" and "%s" — a rule that can never fire is not a rule' % [cuts[0], cuts[1]]


## Effects reaching for "the other party" need there to be one.
static func _other_effects_fit(when: String, then: Array) -> Variant:
	var needs_other: Variant = null
	for e: Dictionary in then:
		if e["kind"] == "harmOther" or e["kind"] == "push":
			needs_other = e["kind"]
			break
	if needs_other == null:
		return null
	if when == "STRIKE" or when == "STRUCK" or when == "KILLED":
		return null
	return 'then: "%s" needs something else in the exchange — use it with STRIKE, STRUCK or KILLED, not %s' % [needs_other, when]


## Total over every possible input: returns a Rule Dictionary or a
## `{"rejected": String}` Dictionary, never asserts, for anything whatsoever
## — including a cyclic Dictionary, a Dictionary nested 5000 deep, or a
## Variant type (Callable, Object, ...) with no rule-shaped meaning at all.
##
## The result shares no structure with the input: every level is rebuilt
## field by field rather than aliased, and then frozen — the caller's
## Dictionary may still be getting mutated by whatever produced it (a model
## response someone else holds a reference to), and a rule is about to be
## folded into an append-only log.
static func validate(raw: Variant) -> Dictionary:
	if not _is_plain_object(raw):
		return _reject("expected a rule object, got %s" % _show(raw))
	var d: Dictionary = raw

	var id: Variant = d.get("id")
	if typeof(id) != TYPE_STRING or (id as String).strip_edges() == "":
		return _reject("id: expected a name, got %s" % _show(id))

	var when_raw: Variant = d.get("when")
	if not _one_of(TRIGGERS, when_raw):
		return _reject('when: "%s" is not a trigger — expected one of %s' % [_show(when_raw), ", ".join(TRIGGERS)])
	var when: String = when_raw

	var raw_require: Variant = d.get("require")
	if typeof(raw_require) != TYPE_ARRAY:
		return _reject("require: expected a list, got %s" % _show(raw_require))
	var raw_require_arr: Array = raw_require
	if raw_require_arr.size() > MAX_CONDITIONS:
		return _reject("require: %d conditions, the limit is %d" % [raw_require_arr.size(), MAX_CONDITIONS])

	var raw_then: Variant = d.get("then")
	if typeof(raw_then) != TYPE_ARRAY:
		return _reject("then: expected a list, got %s" % _show(raw_then))
	var raw_then_arr: Array = raw_then
	if raw_then_arr.is_empty():
		return _reject("then: a rule that does nothing is not a rule")
	if raw_then_arr.size() > MAX_EFFECTS:
		return _reject("then: %d effects, the limit is %d" % [raw_then_arr.size(), MAX_EFFECTS])

	var require: Array = []
	for c: Variant in raw_require_arr:
		var checked: Dictionary = _validate_condition(c)
		if is_rejected(checked):
			return checked
		require.append(checked)

	var then: Array = []
	for e: Variant in raw_then_arr:
		var checked: Dictionary = _validate_effect(e)
		if is_rejected(checked):
			return checked
		then.append(checked)

	# A rule that can never fire, or can never do what it says, is worse than
	# a malformed one: it looks ratifiable and then silently does nothing.
	var blow_problem: Variant = _blow_conditions_fit(when, require)
	if blow_problem != null:
		return _reject(blow_problem)
	var motif_problem: Variant = _motifs_fit(require)
	if motif_problem != null:
		return _reject(motif_problem)
	var other_problem: Variant = _other_effects_fit(when, then)
	if other_problem != null:
		return _reject(other_problem)

	var provenance: Dictionary = _validate_provenance(d.get("provenance"))
	if is_rejected(provenance):
		return provenance

	var ratified_at: Variant = d.get("ratifiedAt")
	if typeof(ratified_at) != TYPE_STRING or (ratified_at as String).strip_edges() == "":
		return _reject("ratifiedAt: expected a timestamp, got %s" % _show(ratified_at))

	require.make_read_only()
	then.make_read_only()
	var rule: Dictionary = {
		"id": id,
		"when": when,
		"require": require,
		"then": then,
		"provenance": provenance,
		"ratifiedAt": ratified_at,
	}
	rule.make_read_only()
	return rule


static func _plural(n: int, one: String) -> String:
	return "%d %s%s" % [n, one, "" if n == 1 else "s"]


static func _read_condition(c: Dictionary) -> String:
	var kind: String = c["kind"]
	match kind:
		"hpAtMost": return "your hit points at %d or below" % c["n"]
		"hpAtLeast": return "your hit points at %d or above" % c["n"]
		"hpBelowPercent": return "your health below %d%%" % c["n"]
		"hpAbovePercent": return "your health above %d%%" % c["n"]
		"creatureWithin": return "something living within %s" % _plural(c["n"], "square")
		"noCreatureWithin": return "nothing living within %s" % _plural(c["n"], "square")
		"creaturesAtMost": return "%s or fewer still alive" % _plural(c["n"], "creature")
		"creaturesAtLeast": return "%s or more still alive" % _plural(c["n"], "creature")
		"exitWithin": return "the way out within %s" % _plural(c["n"], "square")
		"exitBeyond": return "the way out more than %s off" % _plural(c["n"], "square")
		"turnAtLeast": return "turn %d or later" % c["n"]
		"depthAtLeast":
			var n: int = c["n"]
			var floor_words: String = ("%d floor" % n) if n == 1 else ("%d floors" % n)
			return "the run %s deep or deeper" % floor_words
		"statAtLeast": return "your %s at %d or above" % [STAT_TEXT[c["stat"]], c["n"]]
		"motifIs": return "the floor cut as %s" % MOTIF_TEXT[c["motif"]]
		"bodyHere": return "your own body lying where you stand"
		"blowLanded": return "the blow landing"
		"blowMissed": return "the blow missing"
		_:
			assert(false, "read_rule: unreadable condition %s" % [c])
			return ""


static func _read_effect(e: Dictionary) -> String:
	var kind: String = e["kind"]
	match kind:
		"heal": return "you recover %s" % _plural(e["n"], "hit point")
		"harm": return "you lose %s" % _plural(e["n"], "hit point")
		"harmOther": return "it loses %s" % _plural(e["n"], "hit point")
		"grant": return "your %s rises by %d" % [STAT_TEXT[e["stat"]], e["n"]]
		"drain": return "your %s falls by %d" % [STAT_TEXT[e["stat"]], e["n"]]
		"push": return "it is shoved back %s" % _plural(e["n"], "square")
		"speak": return "the world says: “%s”" % e["text"]
		_:
			assert(false, "read_rule: unreadable effect %s" % [e])
			return ""


## What a rule says, in English. The Forge shows this and not the Dictionary:
## a player ratifying a rule they cannot read is not ratifying anything.
## Expects an already-validated Rule — `rule` must have come from validate().
static func read_rule(rule: Dictionary) -> String:
	var conditions: Array[String] = []
	for c: Dictionary in (rule["require"] as Array):
		conditions.append(_read_condition(c))

	var effects: Array[String] = []
	for e: Dictionary in (rule["then"] as Array):
		effects.append(_read_effect(e))

	var when_text: String = TRIGGER_TEXT[rule["when"]]
	var clause: String = when_text if conditions.is_empty() else "%s, with %s" % [when_text, " and ".join(conditions)]
	return "When %s — %s." % [clause, ", and ".join(effects)]
