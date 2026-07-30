extends GutTest
## Rules live in the log and nowhere else — the intended byte-twin of
## tests/canon/rules-in-log.test.ts (11 `it(...)` blocks). Task 2.C1 hand-off
## B discharges the deferral Task 2.B6 recorded here: apply.gd exists now,
## and with it RULE_RATIFIED/RULE_FIRED folding.
##
## Reconciliation: 11 = 10 ported + 0 deferred + 1 documented as
## architecturally inapplicable rather than faked (below). Every case, by
## describe block, with the reference line and its outcome:
##
## describe('a rule entering play'):
##   :40  "arrives as an event and shows up in the folded state" — PORTED,
##        test_arrives_as_an_event_and_shows_up_in_the_folded_state
##   :50  "consumes no randomness, so ratifying cannot shift a later roll" —
##        PORTED, test_consumes_no_randomness_so_ratifying_cannot_shift_a_later_roll
##   :59  "keeps them in the order they were ratified" — PORTED,
##        test_keeps_them_in_the_order_they_were_ratified
##   :70  "still verifies as a chain" — PORTED (discharged by Task 2.C2's
##        review, which caught that this deferral had been left addressed to a
##        task that had already finished). Was: DEFERRED to Task 2.C2, needs
##        SimLog.verify_chain(), which (per log.gd's own docstring, same line
##        as fold()) "need[s] the reducer and join[s] in Phase 2" — i.e. now
##        that apply.gd exists, but 2.C2 is the task that actually writes it,
##        starting immediately after this one. This hand-off was told not to
##        add verify_chain() to log.gd.
##
## describe('not corrupting what came before'):
##   :78  "does not touch the state it was handed" — PORTED,
##        test_does_not_touch_the_state_it_was_handed
##   :99  "does not let a second apply reach back into the first result" —
##        PORTED, test_does_not_let_a_second_apply_reach_back_into_the_first_result
##   :111 "leaves the shared empty baseline empty" — NOT PORTED, and not
##        blocked on a future task either. See "ON CASE :111" below: its
##        failure mode cannot exist in this port, by a design decision
##        already shipped (state.gd's SimState.empty()), so writing it as a
##        passing assertion would be exactly the tautology-about-a-constant
##        Task 2.C1's brief forbids ("a ported test must be able to fail").
##        Reported rather than faked.
##   :117 "starts a fresh world with no rules, whatever came before it in the
##        log" — PORTED, test_starts_a_fresh_world_with_no_rules_whatever_came_before_it_in_the_log
##
## describe('rules are a property of a world, not of the game'):
##   :127 "gives a fork exactly the rules that existed when it forked" —
##        PORTED, test_gives_a_fork_exactly_the_rules_that_existed_when_it_forked
##   :149 "lets two timelines hold genuinely different rulesets" — PORTED,
##        test_lets_two_timelines_hold_genuinely_different_rulesets
##
## describe('the cap'):
##   :166 "refuses to ratify past the per-world limit" — PORTED after Wave E
##        landed ratify_rule with its cap. Was DEFERRED because the cap is
##        enforced by commands.ts's ratifyRule (commands.ts:1851-1864:
##        `if (state.rules.length >= MAX_RULES) throw ...`), NOT by the
##        reducer — confirmed by reading apply.gd's own RULE_RATIFIED arm,
##        which appends unconditionally and never reads MAX_RULES. So this
##        case needs commands.gd, which does not exist in godot/sim/ yet
##        (Wave E). No task number names it: the master plan
##        (docs/superpowers/plans/2026-07-29-godot-phase-2-sim-port.md:990-994)
##        splits commands.gd into five verb families for Tasks
##        2.E3a-2.E3e (movement/strike, items, hazards, stances, purse) and
##        none of their listed scopes mentions ratifyRule or the Ladder.
##        Whichever task claims commands.gd's remaining top-level functions
##        (ratifyRule, recordBodies) should pick this up.
##
## ON CASE :111 — "leaves the shared empty baseline empty": the reference
## proves that ratifying a rule cannot corrupt `EMPTY_STATE`, a single frozen
## object every TS fold shares (state.ts). apply.gd's own docstring records
## why this port has no such object: "SimState.empty() returns a fresh
## Dictionary instead, which structurally kills the shared-baseline
## corruption." Every call to SimState.empty() is already independent, so
## the only "port" of this case is `assert_eq(SimState.empty()["rules"],
## [])` — true regardless of any bug anywhere in apply.gd, before or after
## any amount of ratifying, because nothing in this suite's chains ever
## reads from or writes through a value SimState.empty() produced. That is
## the exact shape Task 2.C1's brief names and forbids ("no asserting a
## static fact about a constant instead of calling the function the case is
## named for... that exact mistake has already shipped once in this repo and
## caught nothing"). This case's real content — ratifying does not corrupt a
## state something else is holding — is carried, non-tautologically, by
## :78 (test_does_not_touch_the_state_it_was_handed) below, which diffs a
## LIVE folded state before and after apply() rather than a disconnected
## fresh one.
##
## Substitutions, both matching test_refs.gd's own precedent (a hand-built
## structural chain standing in for a reference helper, where the
## substitution reproduces the same SHAPE):
##   - _world_draft() stands in for commands.ts's createWorld(seed, w, h).
##     None of these 11 cases read the map's geometry — only rules, xp,
##     rngCounter — so a small hand-built WORLD_INIT is exact where it
##     matters. (Unlike test_refs.gd's own _build(), which never folds its
##     WORLD_INIT and so could get away with `"tiles": []`, this file DOES
##     fold — via _fold() below — so _world_draft() carries real, correctly
##     sized tiles.)
##   - _ratify_draft(state, rule) stands in for commands.ts's ratifyRule
##     EXCEPT its cap check (commands.ts:1851-1864) — reproducing exactly
##     what that function builds on every path that does not throw: `{type:
##     'RULE_RATIFIED', schemaVersion, rngCounter: state.rngCounter,
##     rngDraws: 0, payload: {rule}}`. Only ":166 the cap" above ever
##     approaches the limit, and that case is the one deferred, so this
##     substitution is exact for all 10 others.
##   - _fold(log, head) stands in for SimLog.fold() (Task 2.C2, see above):
##     it replays log.chain(head) — which already exists; 2.C2 owns only
##     fold()/verify_chain() — through SimApply.apply from SimState.empty(),
##     which is exactly what fold() will do.
## A real SimLog/SimRefs is used throughout (not a plain Array of drafts)
## because two cases (:127, :149) test fork/ref structure directly and the
## other nine gain nothing from a second, divergent way of building a chain.


## The reference's rule(id, over).
func _rule(id: String, over: Dictionary = {}) -> Dictionary:
	var d: Dictionary = {
		"id": id, "when": "WAIT", "require": [{"kind": "noCreatureWithin", "n": 6}],
		"then": [{"kind": "heal", "n": 1}],
		"provenance": {"events": ["seed-event"], "notes": [], "because": "because of %s" % id},
		"ratifiedAt": "2026-07-25T00:00:00.000Z",
	}
	for k: String in over:
		d[k] = over[k]
	var r: Dictionary = SimRule.validate(d)
	if SimRule.is_rejected(r):
		fail_test("_rule() setup was unexpectedly rejected: %s" % r["rejected"])
	return r


func _tiles(w: int, h: int) -> Array:
	var out: Array = []
	for i in range(w * h):
		out.append(SimGrid.FLOOR)
	return out


## Stands in for the reference's createWorld(seed, w, h) — see file header.
func _world_draft(seed: int = 1234) -> Dictionary:
	return SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": 4, "height": 4, "tiles": _tiles(4, 4), "seed": seed, "items": [], "opponents": [],
		"player": {"id": "player", "kind": "you", "pos": {"x": 0, "y": 0},
			"stats": {"hp": 10, "might": 3, "wits": 3, "speed": 4}, "tags": []},
	})


## The reference's world(): { log, head }, a fresh log with one WORLD_INIT root.
func _world() -> Dictionary:
	var log := SimLog.new()
	var root: Dictionary = log.append(null, _world_draft())
	return {"log": log, "head": root["id"]}


## Stands in for the reference's ratifyRule(state, rule) — see file header.
## Does NOT reproduce the cap check; ":166 the cap" is deferred instead.
func _ratify_draft(state: Dictionary, rule: Dictionary) -> Dictionary:
	return SimEvents.draft("RULE_RATIFIED", state["rngCounter"], 0, {"rule": rule})


## Was a hand-rolled fold while SimLog.fold() did not exist; Task 2.C2 shipped
## the real one, so this is now a one-line delegation kept only so the call
## sites below read the same as they did when they were written. The stand-in
## replayed log.chain(head) through SimApply.apply, which is exactly what
## fold() does — plus the memo.
func _fold(log: SimLog, head: Variant) -> Dictionary:
	return log.fold(head)


## Rule ids, in order — the reference's `.rules.map((r) => r.id)`.
func _rule_ids(rules: Array) -> Array:
	var out: Array = []
	for r: Dictionary in rules:
		out.append(r["id"])
	return out


# describe('a rule entering play') -------------------------------------------

func test_arrives_as_an_event_and_shows_up_in_the_folded_state() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var before: Dictionary = _fold(log, w["head"])
	var event: Dictionary = log.append(w["head"], _ratify_draft(before, _rule("rule-1")))

	assert_eq(event["type"], "RULE_RATIFIED")
	var rules: Array = _fold(log, event["id"])["rules"]
	assert_eq(rules.size(), 1)
	assert_eq((rules[0] as Dictionary)["id"], "rule-1")


func test_consumes_no_randomness_so_ratifying_cannot_shift_a_later_roll() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var before: Dictionary = _fold(log, w["head"])
	var event: Dictionary = log.append(w["head"], _ratify_draft(before, _rule("rule-1")))

	assert_eq(event["rngDraws"], 0)
	assert_eq(_fold(log, event["id"])["rngCounter"], before["rngCounter"])


func test_keeps_them_in_the_order_they_were_ratified() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var head: Variant = w["head"]
	for id: String in ["first", "second", "third"]:
		var event: Dictionary = log.append(head, _ratify_draft(_fold(log, head), _rule(id)))
		head = event["id"]
	assert_eq(_rule_ids(_fold(log, head)["rules"]), ["first", "second", "third"])


func test_still_verifies_as_a_chain() -> void:
	## ":70". Deferred to Task 2.C2 when verify_chain() did not exist; discharged
	## here now that it does. Ratifying is an ordinary event and must survive an
	## ordinary audit — hash, type, schema version, sequence and rng counter all
	## accounted for. It also puts a SIXTH event type through verify_chain:
	## test_chain.gd drives WORLD_INIT/MOVE/TURN_ADVANCED and the golden run adds
	## STRIKE/ITEM_TAKEN, so RULE_RATIFIED is audited nowhere but here.
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var head: Variant = w["head"]
	for id: String in ["first", "second"]:
		head = log.append(head, _ratify_draft(_fold(log, head), _rule(id)))["id"]

	assert_null(log.verify_chain(head), "a chain that ratified rules is still sound")

	# And it is not vacuously null: tamper one ratification's payload after it
	# was sealed and the audit names that event.
	var sealed: Dictionary = log.events[head]
	var tampered: Dictionary = sealed.duplicate(true)
	(tampered["payload"] as Dictionary)["rule"] = _rule("smuggled")
	log.events[head] = tampered

	var divergence: Variant = log.verify_chain(head)
	assert_not_null(divergence, "a rewritten rule does not survive the audit")
	assert_eq((divergence as Dictionary)["eventId"], head)
	assert_string_contains((divergence as Dictionary)["reason"], "hash mismatch")


# describe('not corrupting what came before') --------------------------------

func test_does_not_touch_the_state_it_was_handed() -> void:
	## Written the obvious way first, this could not fail: comparing two
	## independent folds proves nothing, since each rebuilds from
	## SimState.empty() and never shares an array to corrupt. The aliasing
	## that can really happen is a caller holding a state across an apply —
	## so drive apply() directly and check the input afterwards, exactly as
	## the reference does.
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var before: Dictionary = _fold(log, w["head"])
	var stored: Dictionary = log.append(w["head"], _ratify_draft(before, _rule("rule-1")))

	var after: Dictionary = SimApply.apply(before, stored)

	assert_eq((before["rules"] as Array).size(), 0)
	assert_eq((after["rules"] as Array).size(), 1)
	assert_false(is_same(after, before))
	assert_false(is_same(after["rules"], before["rules"]))


func test_does_not_let_a_second_apply_reach_back_into_the_first_result() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var s0: Dictionary = _fold(log, w["head"])
	var a: Dictionary = log.append(w["head"], _ratify_draft(s0, _rule("one")))
	var s1: Dictionary = SimApply.apply(s0, a)
	var b: Dictionary = log.append(a["id"], _ratify_draft(s1, _rule("two")))
	var s2: Dictionary = SimApply.apply(s1, b)

	assert_eq(_rule_ids(s1["rules"]), ["one"])
	assert_eq(_rule_ids(s2["rules"]), ["one", "two"])


# ":111 leaves the shared empty baseline empty" — NOT PORTED as a passing
# tautology. See "ON CASE :111" in the file header for the full reasoning;
# its real content is carried by test_does_not_touch_the_state_it_was_handed
# above.


func test_starts_a_fresh_world_with_no_rules_whatever_came_before_it_in_the_log() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var ratified: Dictionary = log.append(w["head"], _ratify_draft(_fold(log, w["head"]), _rule("rule-1")))
	# A second world init on the same log replaces state wholesale.
	var second: Dictionary = log.append(ratified["id"], _world_draft(99))
	assert_eq((_fold(log, second["id"])["rules"] as Array).size(), 0)


# describe('rules are a property of a world, not of the game') --------------

func test_gives_a_fork_exactly_the_rules_that_existed_when_it_forked() -> void:
	## The property the entire increment rests on. If it fails, rules are
	## global and the log was pointless. The fork point must be strictly
	## BEHIND main's head, or this proves nothing — forking at the head makes
	## "the fork point" and "the source head" the same value, and an
	## implementation that ignored the former entirely would still pass.
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var early: Dictionary = log.append(w["head"], _ratify_draft(_fold(log, w["head"]), _rule("shared")))
	var late: Dictionary = log.append(early["id"], _ratify_draft(_fold(log, early["id"]), _rule("main-only")))

	var refs: Dictionary = SimRefs.empty()
	refs = SimRefs.create(refs, "main", late["id"], 0, "opening")
	refs = SimRefs.fork(log, refs, "main", "branch", early["id"], "a second timeline")

	var main_rules: Array = _rule_ids(_fold(log, late["id"])["rules"])
	var branch_rules: Array = _rule_ids(_fold(log, SimRefs.get_ref(refs, "branch")["head"])["rules"])

	assert_eq(main_rules, ["shared", "main-only"])
	assert_eq(branch_rules, ["shared"])


func test_lets_two_timelines_hold_genuinely_different_rulesets() -> void:
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var head: Variant = w["head"]

	var refs: Dictionary = SimRefs.empty()
	refs = SimRefs.create(refs, "main", head, 0, "opening")
	refs = SimRefs.fork(log, refs, "main", "other", head, "divergence")

	var a: Dictionary = log.append(head, _ratify_draft(_fold(log, head), _rule("gentle")))
	var b: Dictionary = log.append(head, _ratify_draft(_fold(log, head),
		_rule("cruel", {"then": [{"kind": "harm", "n": 2}]})))

	assert_eq(_rule_ids(_fold(log, a["id"])["rules"]), ["gentle"])
	assert_eq(_rule_ids(_fold(log, b["id"])["rules"]), ["cruel"])


func test_refuses_to_ratify_past_the_per_world_limit() -> void:
	## ":166". Deferred when this file was written because the cap lives in
	## commands.ts's ratifyRule, NOT in the reducer — apply.gd's RULE_RATIFIED
	## arm appends unconditionally and never reads MAX_RULES. Wave E has since
	## ported ratify_rule with its cap, so the deferral is discharged here.
	##
	## The limit is a property of a WORLD, not of a rule: the same rule is
	## perfectly ratifiable in a fork that has room for it. And the refusal is
	## loud rather than a returned rejection, because by this point the player
	## has already said yes — a full ruleset means whatever offered the choice
	## is broken, not that the answer was no.
	var w: Dictionary = _world()
	var log: SimLog = w["log"]
	var head: Variant = w["head"]
	for i in range(SimRule.MAX_RULES):
		head = log.append(head, _ratify_draft(_fold(log, head), _rule("rule-%d" % i)))["id"]
	assert_eq((_fold(log, head)["rules"] as Array).size(), SimRule.MAX_RULES,
		"the world fills exactly to the limit")

	SimCommands.ratify_rule(_fold(log, head), _rule("one-too-many"))
	# Both channels: assert() is compiled out of a release build, push_error is
	# not, and the reference THROWS here.
	assert_engine_error("limit")
	assert_push_error("limit")
