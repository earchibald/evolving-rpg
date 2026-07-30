class_name SimCommands
## The command layer's ONE surface — the byte-twin of src/core/commands.ts.
##
## The reference is a single 1,907-line module. Here it is split by verb family
## under `sim/commands/`, and this file re-exports each family's entry points so
## that callers (the stage, autoplay, the session) see exactly what they saw
## before: one import, one namespace, one place to look up a verb.
##
##   sim/commands/movement.gd   Task 2.E3a   world, walk, blow, descent
##   sim/commands/items.gd      Task 2.E3b   take, use, satchel, scrolls, gear
##   sim/commands/hazards.gd    Task 2.E3c   traps, secrets, mimics, pockets
##   sim/commands/stances.gd    Task 2.E3d   shove, brace, call, draw, volley
##   sim/commands/purse.gd      Task 2.E3e   the economy verbs
##
## **EVERY function here returns a DRAFT, never state.** The caller appends it
## through the log. That is what keeps authority in the chain and lets the stage
## be a projection rather than a second source of truth.
##
## The delegations are deliberately mechanical — one line each, no logic — so
## that this file is a table of contents rather than a second implementation
## that could drift from the first. Families are separated by a header and
## APPENDED in task order, never interleaved: five worktrees merge into this
## file, and a mechanical append merges cleanly where a mid-file edit does not.


# ── Task 2.E3a: sim/commands/movement.gd ──────────────────────────────────

## Far enough that nothing is already on top of you when the world opens.
const OPPONENT_MIN_DISTANCE := SimMovement.OPPONENT_MIN_DISTANCE

## A strike always consumes two draws — the roll, then the damage — whether or
## not it lands.
const STRIKE_DRAWS := SimMovement.STRIKE_DRAWS


static func is_hostile(a: Dictionary, b: Dictionary) -> bool:
	return SimMovement.is_hostile(a, b)


static func to_hit(attacker: Dictionary, target: Dictionary) -> int:
	return SimMovement.to_hit(attacker, target)


static func hit_chance(attacker: Dictionary, target: Dictionary) -> int:
	return SimMovement.hit_chance(attacker, target)


## THE ONE BLOW PATH — melee and ranged alike. Tasks 2.E3b-e draft every blow
## through this; there is not a melee path and a ranged path, there is one path
## with a mode.
static func resolve_strike(
	seed: int,
	counter: int,
	attacker: Dictionary,
	target: Dictionary,
) -> Dictionary:
	return SimMovement.resolve_strike(seed, counter, attacker, target)


static func create_world(
	seed: int,
	width: int,
	height: int,
	player_id: String = "player",
	depth: int = 1,
	carried: Variant = null,
) -> Dictionary:
	return SimMovement.create_world(seed, width, height, player_id, depth, carried)


static func attempt_move(state: Dictionary, entity_id: String, dx: Variant, dy: Variant) -> Dictionary:
	return SimMovement.attempt_move(state, entity_id, dx, dy)


static func ends_turn(draft: Dictionary) -> bool:
	return SimMovement.ends_turn(draft)


static func lunge_strike(state: Dictionary, entity_id: String, target_id: String) -> Variant:
	return SimMovement.lunge_strike(state, entity_id, target_id)


static func vigil_kept(state: Dictionary, entity_id: String) -> Dictionary:
	return SimMovement.vigil_kept(state, entity_id)


static func advance_turn(state: Dictionary) -> Dictionary:
	return SimMovement.advance_turn(state)


static func heart_held(state: Dictionary, player_id: String = "player") -> bool:
	return SimMovement.heart_held(state, player_id)


static func outcome(state: Dictionary, player_id: String = "player") -> String:
	return SimMovement.outcome(state, player_id)


static func ratify_rule(state: Dictionary, rule: Dictionary) -> Dictionary:
	return SimMovement.ratify_rule(state, rule)


static func record_bodies(state: Dictionary, bodies: Array) -> Dictionary:
	return SimMovement.record_bodies(state, bodies)


static func found_world(state: Dictionary, bible: Dictionary) -> Dictionary:
	return SimMovement.found_world(state, bible)


# ── Task 2.E3d: sim/commands/stances.gd ───────────────────────────────────

static func shove_at(state: Dictionary, entity_id: String, dx: int, dy: int) -> Variant:
	return SimStances.shove_at(state, entity_id, dx, dy)


static func brace_self(state: Dictionary, entity_id: String) -> Dictionary:
	return SimStances.brace_self(state, entity_id)


static func draw_stance(state: Dictionary, entity_id: String) -> Variant:
	return SimStances.draw_stance(state, entity_id)


static func shot_target(state: Dictionary, entity_id: String) -> Variant:
	return SimStances.shot_target(state, entity_id)


static func loose_shot(state: Dictionary, entity_id: String, target_id: String) -> Variant:
	return SimStances.loose_shot(state, entity_id, target_id)


static func call_out(state: Dictionary, entity_id: String, prey_id: String = "player") -> Variant:
	return SimStances.call_out(state, entity_id, prey_id)


static func wait(state: Dictionary, entity_id: String) -> Dictionary:
	return SimStances.wait(state, entity_id)
