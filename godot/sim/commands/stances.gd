class_name SimStances
## The stance family — the byte-twin of src/core/commands.ts's shove, brace,
## call, draw and volley verbs. Reached through `SimCommands`, never directly:
## the facade is the one surface the stage and autoplay see.
##
## src/core/commands.ts is 1,907 lines, split into five files by verb family.
## This one ships:
##   shoveAt          :1095  the player's push — displace, slam, or tangle
##   braceSelf        :1138  the guard set against the coming round
##   armedForDistance :1151  who may fight at range at all      (private)
##   shotEligible     :1161  covenant M7's line, asked once      (private)
##   drawStance       :1177  the draw — half of every shot, all of its warning
##   shotTarget       :1197  the mark, chosen the same way forever
##   looseShot        :1220  the loose, through THE one blow path
##   callOut          :1356  the cry, and the floor answering it
##   wait             :1421  holding position
##
## ── Reconciliation: every function between :1095 and :1429 ────────────────
## The reference's stance neighbourhood also holds three functions this task
## does NOT own, each named here so no reader has to wonder whether it was
## dropped:
##   vigilKept   :1250  -> Task 2.E3a, shipped in commands/movement.gd
##   stirWorld   :1276  -> the heart's WORLD_STIRRED producer. It is not in any
##                        2.E3a-e family (the plan's table hands it to none of
##                        the five) and it is NOT in this file's verb list, so
##                        it is DEFERRED, unowned, and reported as such. Its
##                        reducer arm already exists in sim/apply.gd.
##   lungeStrike :1049  -> Task 2.E3a, shipped in commands/movement.gd
## 9 of the 12 functions in :1049-:1429 are ported here; 2 were 2.E3a's; 1 is
## deferred unowned. 9 + 2 + 1 = 12.
##
## **EVERY function here returns a DRAFT, never state.** The caller appends it
## through the log. That is what keeps authority in the chain and lets the
## stage be a projection rather than a second source of truth.
##
## ── The family's four laws, and where each is enforced ────────────────────
## 1. `SHOVE` and `BRACED` spend ZERO draws. Both are deterministic by design —
##    a tool you position with cannot be a tool that gambles — so the draw
##    count is a literal 0 at both draft sites, never a constant that could
##    drift.
## 2. A staggered thing spends its next action as a recorded `WAIT`: the only
##    creature wait that reaches the chain. `wait` below drafts it; the gate
##    that decides *whether* to draft it lives in the reference's
##    `draftFor` (src/play/session.ts), which is Phase 3's.
## 3. `DRAWN` is one stance per body — held through `WAIT`s, lost to any other
##    act, any damage, any stagger. Command-side that is `draw_stance`'s
##    already-drawn refusal and `loose_shot`'s undrawn refusal; reducer-side it
##    is `SimApply._unstanced` / `_stanced` / `_staggered`, already shipped.
## 4. Every blow made here goes through 2.E3a's `SimMovement.resolve_strike`.
##    There is not a melee path and a ranged path; there is one path with a
##    mode. `loose_shot` adds `mode: "ranged"` and NOTHING else — no second
##    dice, no second ward check, no movement rider.
##
## ── The draw arithmetic, spelled out because a range cannot see it ────────
## Two functions here spend randomness, and the counter offset each draw comes
## from is part of the recorded chain just as much as the result is:
##
##   loose_shot   counter + 0  the d20 roll        } both inside resolve_strike,
##                counter + 1  the damage die      } declared as rngDraws = 2
##
##   call_out     counter + 0  riser 0's archetype (weighted pick)
##                counter + 1  riser 0's tile      (index into candidates)
##                counter + 2  riser 1's archetype
##                counter + 3  riser 1's tile
##                declared as rngDraws = c - state.rngCounter, so a call that
##                runs out of ground mid-loop declares the SHORT count — and
##                the archetype draw it already spent still counts, because a
##                rejected draw advances the counter like any other.
##
## Task 2.E3a MEASURED that moving a draw off its offset failed nothing across
## 456 tests: every damage assertion in the reference is a range, and the
## golden run re-hashes rather than re-derives. RE-MEASURED here, on the call:
## `mutate-sim.py stances-call-tile-draw-offset` moves riser 0's tile from
## (5,11) to (22,12) and EVERY reference case still passes, the distance check
## included. So the offsets are pinned by re-deriving each draw from SimRng on
## the test's side of the fence —
##   test_new_verbs.gd
##     test_the_calls_four_draws_come_from_four_CONSECUTIVE_counter_offsets
##   test_volley_commands.gd
##     test_the_shots_two_draws_are_the_two_CONSECUTIVE_draws_it_declares
## — and scripts/mutate-sim.py carries two offset-moving mutants under
## `# --- Task 2.E3d ---` so the next porter can re-run them.
##
## ── The five suites this family answers to ────────────────────────────────
##   tests/core/player-verbs.test.ts   (14) -> test_player_verbs.gd
##   tests/core/new-verbs.test.ts      (11) -> test_new_verbs.gd
##   tests/core/volley-stance.test.ts  (12) -> test_volley_stance.gd
##   tests/core/volley-commands.test.ts(12) -> test_volley_commands.gd
##   tests/core/volley-mind.test.ts     (5) -> test_volley_mind.gd
## 54 reference cases = 53 PORTED + 1 DEFERRED (player-verbs.test.ts:146,
## which asserts session.ts's `draftFor` wait gate — Phase 3's, not this
## layer's). Each file's own header carries the case-by-case arithmetic.


## The reference's `wait` is a verb of this family (commands.ts:1421) rather
## than of movement's: it exists here because the stagger is what makes a
## creature's wait a fact on the chain at all.


# ── the shove ─────────────────────────────────────────────────────────────

## The player's shove: drive an adjacent hostile one tile along the push.
##
## Deterministic on purpose — no roll, no draws. A tool you position with
## cannot be a tool that gambles (Into the Breach's rule, adopted whole).
## Open ground displaces; a wall or the door frame slams (SLAM_DAMAGE and a
## stagger — the wall is the argument); another body means collision — both
## reel, nobody moves. Null when there is nothing hostile to shove that way:
## a mispress, not a turn.
##
## `to` and `struckId` are `| null` in the reference, NOT optional, so they are
## PRESENT with value null — the absent-key law's other half. SimApply reads
## both with `p["to"]` / `p["struckId"]` and would fault on an absent key.
##
## `dx`/`dy` are typed `int` where `attempt_move`'s are Variant, and that
## difference is the reference's, not a slip: the walk has an explicit
## `Number.isInteger` guard to port (commands.ts:722), the shove has none. A
## half-step reaching here reads no tile in either language — TypeScript looks
## at x + 0.5 and finds nobody, GDScript truncates to the shover's own tile and
## skips it by id — so both refuse, and the typed parameter costs no fidelity.
static func shove_at(state: Dictionary, entity_id: String, dx: int, dy: int) -> Variant:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	if found == null:
		return null
	var mover: Dictionary = found
	var my_pos: Dictionary = mover["pos"]
	var at := {"x": int(my_pos["x"]) + dx, "y": int(my_pos["y"]) + dy}

	var target: Variant = null
	for e: Dictionary in entities:
		if e["id"] == entity_id or not SimEntity.is_alive(e):
			continue
		var p: Dictionary = e["pos"]
		if int(p["x"]) == int(at["x"]) and int(p["y"]) == int(at["y"]):
			target = e
			break
	if target == null:
		return null
	var them: Dictionary = target
	if not SimMovement.is_hostile(mover, them):
		return null
	# A hidden mimic reads as furniture to every tool: you cannot shove what
	# you believe is an item — walking onto it is the only thing that asks.
	if (them["tags"] as Array).has("hidden"):
		return null

	var their_pos: Dictionary = them["pos"]
	var behind := {"x": int(their_pos["x"]) + dx, "y": int(their_pos["y"]) + dy}
	var grid: Dictionary = state["grid"]

	var to_tile: Variant = null
	var slammed := false
	var struck_id: Variant = null

	# The world's edge and the way out stop a body the way a wall does.
	if not SimGrid.in_bounds(grid, int(behind["x"]), int(behind["y"])) \
		or not SimGrid.is_passable(grid, int(behind["x"]), int(behind["y"])) \
		or SimGrid.tile_at(grid, int(behind["x"]), int(behind["y"])) == SimGrid.EXIT:
		slammed = true
	else:
		var in_the_way: Variant = null
		for e: Dictionary in entities:
			if e["id"] == them["id"] or not SimEntity.is_alive(e):
				continue
			var p: Dictionary = e["pos"]
			if int(p["x"]) == int(behind["x"]) and int(p["y"]) == int(behind["y"]):
				in_the_way = e
				break
		if in_the_way != null:
			struck_id = (in_the_way as Dictionary)["id"]
		else:
			to_tile = behind

	return SimEvents.draft("SHOVE", int(state["rngCounter"]), 0, {
		"shoverId": entity_id,
		"targetId": them["id"],
		"to": to_tile,
		"slammed": slammed,
		"struckId": struck_id,
	})


# ── the brace ─────────────────────────────────────────────────────────────

## The player set against the coming round. Costs the turn; the stance lasts
## until their next action of any kind.
##
## Unconditional by design — there is no state a body cannot brace from, so
## this never returns null and never asks the world a question. The zero is a
## literal: a brace spends no dice.
static func brace_self(state: Dictionary, entity_id: String) -> Dictionary:
	return SimEvents.draft("BRACED", int(state["rngCounter"]), 0, {"entityId": entity_id})


# ── the volley: draw, mark, loose ─────────────────────────────────────────

## Whether this entity can fight at distance at all: a creature by its verb,
## the player by what they wear. One question, both answers — the volley is
## one discipline whoever holds it.
static func _armed_for_distance(entity: Dictionary) -> bool:
	if entity["kind"] == "you":
		return SimTables.wears_trait(entity.get("gear"), "ranged")
	return SimTables.verb_of(entity["kind"]) == "volley"


## Whether a shot from `archer` could fly at `target` right now: hostile,
## alive, past arm's reach (the bump owns range 1), inside the reach disc, and
## the honest line clear — covenant M7, asked once, answered for commands and
## minds alike.
static func _shot_eligible(state: Dictionary, archer: Dictionary, target: Dictionary) -> bool:
	if not SimEntity.is_alive(target) or not SimMovement.is_hostile(archer, target):
		return false
	# A hidden mimic is an item to every eye that aims: the mark must never
	# volunteer it, or the sling key itself becomes the mimic detector.
	if (target["tags"] as Array).has("hidden"):
		return false
	var from: Dictionary = archer["pos"]
	var to: Dictionary = target["pos"]
	# ADJACENCY REFUSES SHOTS. The bump owns range 1 — a stone at arm's length
	# is a punch with extra steps, and letting the sling take that tile would
	# make the melee verb strictly worse for no decision gained.
	if absi(int(to["x"]) - int(from["x"])) + absi(int(to["y"]) - int(from["y"])) == 1:
		return false
	if not SimSight.within_reach(from, to, SimTables.SHOT_RANGE):
		return false
	return SimSight.clear_shot(state["grid"], state["entities"], from, to)


## The draw: half of every shot, and all of its warning — covenant M8. Costs
## the turn, like the brace it displaces; the shot it promises flies only if
## the stance survives to the next action. Null for hands that cannot throw
## and for a stance already held: mispresses, not turns.
static func draw_stance(state: Dictionary, entity_id: String) -> Variant:
	var found: Variant = SimEntity.find(state["entities"], entity_id)
	if found == null:
		return null
	var archer: Dictionary = found
	if not SimEntity.is_alive(archer):
		return null
	if not _armed_for_distance(archer):
		return null
	if (archer["tags"] as Array).has("drawn"):
		return null
	return SimEvents.draft("DRAWN", int(state["rngCounter"]), 0, {"entityId": entity_id})


## The mark: nearest hostile the shot could reach, nearest by the disc's own
## SQUARED distance, ties to birth order — deterministic, so the UI can say
## which and replay can never disagree.
##
## The comparison is strictly `<`, which is what makes the tie go to whoever
## the entity list holds first; `<=` would silently hand it to the last, and
## a mark chosen the other way is a different recorded event, not a different
## preference. Returns the entity Dictionary, or null when nothing in the
## world can be shot from here.
static func shot_target(state: Dictionary, entity_id: String) -> Variant:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	if found == null:
		return null
	var archer: Dictionary = found
	var my_pos: Dictionary = archer["pos"]
	var best: Variant = null
	var best_away := INF
	for e: Dictionary in entities:
		if e["id"] == entity_id or not _shot_eligible(state, archer, e):
			continue
		var p: Dictionary = e["pos"]
		var dx: int = int(p["x"]) - int(my_pos["x"])
		var dy: int = int(p["y"]) - int(my_pos["y"])
		var away: float = float(dx * dx + dy * dy)
		if away < best_away:
			best_away = away
			best = e
	return best


## The loose: the drawn stance spent as a blow at distance. The same dice as
## every strike — the guard's raised bar included — at the same two draws,
## with no movement ever riding along: a stone moves nothing but blood. Null
## when the stance is not held or the line refuses; the caller decides whether
## that refusal costs a turn (it does not — a shot that cannot fly was never
## loosed).
##
## THE ONE BLOW PATH: this delegates to `SimMovement.resolve_strike`, which is
## the same function the bump and the lunge call. The roll is drawn at the
## counter this draft declares and the damage at counter + 1, exactly as for a
## melee blow — `mode` is the ONLY thing that differs between a punch and a
## stone, and it changes the reducer's stagger arm, never the dice.
static func loose_shot(state: Dictionary, entity_id: String, target_id: String) -> Variant:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	var marked: Variant = SimEntity.find(entities, target_id)
	if found == null or marked == null:
		return null
	var archer: Dictionary = found
	var target: Dictionary = marked
	if not (archer["tags"] as Array).has("drawn"):
		return null
	if not _armed_for_distance(archer):
		return null
	if not _shot_eligible(state, archer, target):
		return null

	var counter: int = int(state["rngCounter"])
	var payload: Dictionary = {
		"attackerId": entity_id,
		"targetId": target_id,
		"mode": "ranged",
	}
	# `true` reproduces the reference's spread order — `{ mode, ...outcome }`
	# lets the outcome win any collision. There is none today; the flag is what
	# keeps that true if resolve_strike ever grows a field named `mode`.
	payload.merge(SimMovement.resolve_strike(int(state["seed"]), counter, archer, target), true)
	return SimEvents.draft("STRIKE", counter, SimMovement.STRIKE_DRAWS, payload)


# ── the call ──────────────────────────────────────────────────────────────

## The call answered: a caller crying out, and the floor sending bodies.
##
## Everything is drawn and recorded here — kinds at the floor's shallowest
## band, tiles at least CALL_DISTANCE of straight ground from the prey — so
## replay wakes the same things in the same places forever. Callers never call
## callers: one voice per floor is a clock, a chain of voices is a fork bomb.
## Null when the floor has nowhere to answer from.
##
## ── the draw protocol, per riser i ────────────────────────────────────────
##   counter + 2i      the archetype, one weighted pick over `answering`
##   counter + 2i + 1  the tile, one index into `candidates`
## `candidates` is rebuilt for every riser because a riser already placed
## occupies its tile (`_stood` reads `risen` as well as `entities`), so the
## second draw's RANGE depends on the first riser's answer. That is why the
## offsets matter and a plausible-band assertion cannot see them move: shift
## the tile draw by one and every riser still lands on legal ground at a legal
## distance — a different tile, on a chain that still verifies.
##
## The `break` when the ground runs out happens AFTER that riser's archetype
## draw was spent, so `rngDraws` can be odd. A rejected draw advances the
## counter like any other.
static func call_out(state: Dictionary, entity_id: String, prey_id: String = "player") -> Variant:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	var quarry: Variant = SimEntity.find(entities, prey_id)
	if found == null or quarry == null:
		return null
	var prey: Dictionary = quarry
	var prey_pos: Dictionary = prey["pos"]

	var risen: Array = []
	var start: int = int(state["rngCounter"])
	var c: int = start
	var seed: int = int(state["seed"])
	var depth: int = int(state["depth"])
	var grid: Dictionary = state["grid"]

	# Weight 0 never spawns; the depth gate is the teaching floor's; and a
	# caller is filtered out BY VERB rather than by kind, so a levelled
	# "caller-2" cannot slip through the door its parent is barred from.
	var answering: Array = []
	var arch_total := 0
	for a: Dictionary in SimTables.BESTIARY:
		var from_depth: int = int(a["fromDepth"]) if a.has("fromDepth") else 1
		if int(a["weight"]) > 0 and depth >= from_depth and SimTables.verb_of(a["kind"]) != "call":
			answering.append(a)
			arch_total += int(a["weight"])

	for i in range(SimTables.CALL_RISERS):
		var pick: int = SimRng.int_between(seed, c, 1, arch_total)
		c += 1
		var arch: Dictionary = answering[0]
		for a: Dictionary in answering:
			pick -= int(a["weight"])
			if pick <= 0:
				arch = a
				break

		var candidates: Array = []
		for y in range(int(grid["height"])):
			for x in range(int(grid["width"])):
				if not SimGrid.is_passable(grid, x, y):
					continue
				if SimGrid.tile_at(grid, x, y) == SimGrid.EXIT:
					continue
				if absi(x - int(prey_pos["x"])) + absi(y - int(prey_pos["y"])) < SimTables.CALL_DISTANCE:
					continue
				if _stood(entities, risen, x, y):
					continue
				candidates.append({"x": x, "y": y})
		if candidates.is_empty():
			break
		var at: int = SimRng.int_between(seed, c, 0, candidates.size() - 1)
		c += 1
		var tile: Dictionary = candidates[at]
		risen.append({
			"id": "called-%d-%d" % [int(state["turn"]), i],
			"kind": arch["kind"],
			"pos": {"x": int(tile["x"]), "y": int(tile["y"])},
			# Answered at the floor's first band: the call buys bodies, not elites.
			"stats": SimTables.creature_stats(arch["kind"], 1),
			"tags": [],
		})

	if risen.is_empty():
		return null
	return SimEvents.draft("CALLED", start, c - start, {
		"callerId": entity_id,
		"opponents": risen,
	})


## Whether a living body — already in the world, or already raised by this
## same cry — stands on (x, y). The reference's `stood` closure, lifted out.
static func _stood(entities: Array, risen: Array, x: int, y: int) -> bool:
	for e: Dictionary in entities:
		if not SimEntity.is_alive(e):
			continue
		var p: Dictionary = e["pos"]
		if int(p["x"]) == x and int(p["y"]) == y:
			return true
	for r: Dictionary in risen:
		var p: Dictionary = r["pos"]
		if int(p["x"]) == x and int(p["y"]) == y:
			return true
	return false


# ── holding position ──────────────────────────────────────────────────────

## Holding position.
##
## Without this, time passes only when you move — so a player could never let
## something come to them and had to walk into its reach instead. Found by
## playing: blocked moves correctly cost no turn, which left no way at all to
## spend one deliberately.
##
## For a CREATURE this is the stagger's event and nothing else: the reference's
## `draftFor` (src/play/session.ts:157) drafts a wait only for a body tagged
## `staggered`, because the reel spends itself on the skipped action and only
## an event can clear the tag. An ordinary creature wait is silence, not
## history. That gate is Phase 3's; this drafts what it asks for.
static func wait(state: Dictionary, entity_id: String) -> Dictionary:
	return SimEvents.draft("WAIT", int(state["rngCounter"]), 0, {"entityId": entity_id})
