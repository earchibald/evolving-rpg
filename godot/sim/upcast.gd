class_name SimUpcast
## Reads an event off disk at whatever schema version it was recorded, and
## returns a current-version draft — the byte-twin of src/log/upcast.ts.
##
## ABSENCE READS LEGACY. Every default supplied below is written only when the
## old payload's key is absent (or explicitly null, mirroring `??`) — never
## overwriting a value the old event actually had, and never inventing an
## occupied slot the old shape had no way to say. Where the reference's own
## comment is "nothing to rewrite" (v6→v7 motif, v7→v8 playerSatchel), so is
## this file's, and nothing here touches the payload for that step.
##
## GDScript's assert() logs an engine error and CONTINUES past it rather than
## unwinding like a TS throw — proven by grid.gd's own ported tests, which
## call SimGrid.make() and then keep executing to check assert_engine_error()
## afterward. Left alone, that would let one bad input trip two or three
## asserts in this file's long chain of checks, and GUT fails a test on ANY
## engine error it was not explicitly told to expect (see the Global
## Constraints' assert_ne(x, null) note) — so every check below that mirrors a
## reference `throw` is paired with an explicit `return` right after it, to
## stand in for the unwind GDScript does not do on its own.


static func upcast_event(raw: Variant) -> Dictionary:
	if typeof(raw) != TYPE_DICTIONARY:
		assert(false, "upcast_event: not an object")
		return {}
	var event: Dictionary = raw

	var type_val: Variant = event.get("type")
	if not (type_val is String):
		assert(false, "upcast_event: missing type")
		return {}
	var type: String = type_val

	var version_val: Variant = event.get("schemaVersion")
	if not (version_val is int or version_val is float):
		assert(false, "upcast_event: %s has no schemaVersion" % type)
		return {}
	var version: int = int(version_val)

	var payload_val: Variant = event.get("payload")
	if typeof(payload_val) != TYPE_DICTIONARY:
		assert(false, "upcast_event: %s has no payload" % type)
		return {}
	var payload: Dictionary = payload_val

	var rng_counter_val: Variant = event.get("rngCounter")
	if not (rng_counter_val is int or rng_counter_val is float):
		assert(false, "upcast_event: %s has no rngCounter" % type)
		return {}
	var rng_counter: int = int(rng_counter_val)

	if not SimEvents.SCHEMA_VERSIONS.has(type):
		assert(false, "upcast_event: unknown event type %s" % type)
		return {}
	var current: int = SimEvents.SCHEMA_VERSIONS[type]

	if version > current:
		assert(false,
			("upcast_event: %s is schemaVersion %d, newer than this engine's %d — " +
				"a log from the future cannot be downcast") % [type, version, current])
		return {}
	if version == current:
		return event

	var draws_val: Variant = event.get("rngDraws")
	var draws: int = int(draws_val) if (draws_val is int or draws_val is float) else 0

	# WORLD_INIT has changed nine times, so it walks the ladder a step at a
	# time rather than jumping. The next migration means adding a block to
	# _upcast_world_init, not rewriting these.
	if type == "WORLD_INIT":
		return _upcast_world_init(payload, version, current, rng_counter, draws)

	if type == "ITEM_TAKEN":
		# v1 → v2: same shape, different meaning — items stack in v1 and equip
		# into slots in v2. The shape passes through; the version records that
		# a v1 log's folded stats may differ under this engine, which is the
		# honest limit of a semantic migration.
		#
		# v2 → v3: takes may ride in the satchel (payload.satchel). An old
		# take never did; absence already says so. Nothing to rewrite.
		return SimEvents.draft("ITEM_TAKEN", rng_counter, draws, payload)

	if type == "STRIKE":
		# v1 → v2: blows learned to be critical. Nothing recorded before
		# crits existed was one, and saying `false` outright is the honest
		# migration — reinterpreting an old natural 20 as a crit would change
		# history's damage.
		#
		# v2 → v3: blows learned the verbs — a lunge's crossing, a trample's
		# shove, the ambush spring (all optional payload fields). Nothing to
		# rewrite: an old blow moved nobody, and absence already says so.
		var strike_payload: Dictionary = payload.duplicate()
		_default_if_absent(strike_payload, "crit", false)
		return SimEvents.draft("STRIKE", rng_counter, draws, strike_payload)

	if version != 1:
		assert(false, "upcast_event: no upcaster from %s v%s" % [type, version])
		return {}

	# Cast-free pass-through: the payload came off disk as a Dictionary, and
	# narrowing it per type here would duplicate the validation a future
	# verify_chain already does properly. Upcasting produces a candidate;
	# verify_chain decides whether it is an event.
	return SimEvents.draft(type, rng_counter, 0, payload)


## Upcasts a whole recorded chain and rebuilds it.
##
## Upcasting changes an event's content, and identity is a hash of content
## *plus position* — so the ids necessarily change, and the chain is rebuilt
## by re-appending rather than patched in place. Events must arrive root-first,
## which is the order SimLog.chain() produces and the order the golden
## fixture stores.
static func upcast_chain(raw_events: Array) -> Dictionary:
	var log := SimLog.new()
	var head: Variant = null
	for raw: Variant in raw_events:
		var appended: Dictionary = log.append(head, upcast_event(raw))
		head = appended["id"]
	return {"log": log, "head": head}


## v1 → v9, one version's worth of change per block, in order.
static func _upcast_world_init(raw_payload: Dictionary, version: int, current: int,
		rng_counter: int, rng_draws_in: int) -> Dictionary:
	var payload: Dictionary = raw_payload.duplicate()
	var rng_draws: int = rng_draws_in

	if version <= 1:
		# v1 → v2: randomness accounting moved from the payload to the envelope.
		var counter_after: Variant = payload.get("counterAfter")
		if not (counter_after is int or counter_after is float):
			assert(false, "upcast_event: WORLD_INIT v1 has no counterAfter to derive draws from")
			return {}
		rng_draws = int(counter_after) - rng_counter
		payload.erase("counterAfter")

	if version <= 2:
		# v2 → v3: a world arrives with its inhabitants. Worlds written before
		# that had none, and an empty list says so honestly — inventing
		# occupants for an old log would be fabricating history, not
		# migrating it.
		_default_if_absent(payload, "opponents", [])

	if version <= 3:
		# v3 → v4: worlds carry what is lying in them. Older ones carried
		# nothing, and an empty list says exactly that.
		_default_if_absent(payload, "items", [])

	if version <= 4:
		# v4 → v5: worlds learned how deep they lie. Everything recorded
		# before depth existed was the first floor, which is simply true.
		_default_if_absent(payload, "depth", 1)

	if version <= 5:
		# v5 → v6: worlds carry their generation story. Old worlds were
		# scatter maps and never said so; an honest migration states that
		# rather than inventing an account after the fact.
		_default_if_absent(payload, "story", "scattered walls (before rooms)")

	# v6 → v7: worlds record the cut they were shaped to (payload.motif).
	# Older floors never said, and stay unsaid — absence folds to null and
	# `motifIs` reads it as false, rather than a migration inventing a shape
	# for floors cut before motifs existed. Nothing to rewrite.

	# v7 → v8: the satchel crosses the stairs (payload.playerSatchel), and
	# floors are born holding one provision. Old floors had neither; empty
	# hands and a bare floor are what absence already says. Nothing to
	# rewrite.

	if version <= 8:
		# v8 → v9: the satchel grew a second slot, so the carry became an
		# ordered list. A v8 world carried at most one kind; the list of one
		# says exactly that.
		var carried: Variant = payload.get("playerSatchel")
		if carried is Dictionary and (carried as Dictionary).get("kind") is String:
			payload["playerSatchel"] = {"kinds": [(carried as Dictionary)["kind"]]}

	return SimEvents.draft("WORLD_INIT", rng_counter, rng_draws, payload)


## Mirrors `??`: supplies `value` only when `key` is ABSENT or explicitly
## null on `payload` — never overwrites a real value the old event already
## had. Mutates `payload` in place, the same way the reference mutates its
## own once-copied `payload` local.
static func _default_if_absent(payload: Dictionary, key: String, value: Variant) -> void:
	if not payload.has(key) or payload[key] == null:
		payload[key] = value
