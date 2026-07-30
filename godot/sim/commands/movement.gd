class_name SimMovement
## The movement family — the byte-twin of src/core/commands.ts's world,
## walking, blow and descent verbs. Reached through `SimCommands`, never
## directly: the facade is the one surface the stage and autoplay see.
##
## src/core/commands.ts is 1,907 lines and is being split into five files by
## verb family. This one ships:
##   createWorld  :213   generation, whole
##   attemptMove  :718   the walk, the bump, the snare's strain
##   endsTurn     :851   what a turn costs
##   resolveStrike :80   THE one blow path — melee and ranged alike
##   lungeStrike  :1049  the skirmisher's two tiles and a blow in one motion
##   vigilKept    :1250  the warden knitting its fight shut
##   advanceTurn  :1898  whose turn it is
##   outcome      :1834  how the run stands, and the descent ceremony's
##   heartHeld    :1818  three writers (recordBodies, foundWorld, ratifyRule)
##
## **EVERY function here returns a DRAFT, never state.** The caller appends it
## through the log. That is what keeps authority in the chain and lets the
## stage be a projection rather than a second source of truth.
##
## `resolve_strike` is public because it is the ONE blow path: Tasks 2.E3b-e
## call it for every blow they draft, melee and ranged alike. There is not a
## melee path and a ranged path; there is one path with a mode.


## The player as a floor receives them (the reference's CarriedPlayer): stats,
## ceiling and progress carried whole from the floor above. A Dictionary with
## keys stats/maxHp/xp/level and the three optional carries gear/satchel/
## scroll — absent, never null, per THE ABSENT-KEY LAW.
const STARTING_STATS := {"hp": 10, "might": 3, "wits": 3, "speed": 4}

## Far enough that nothing is already on top of you when the world opens.
const OPPONENT_MIN_DISTANCE := 8

## A strike always consumes two draws — the roll, then the damage — whether or
## not it lands. Spending the same count either way keeps the counter's
## progress independent of the outcome, so a replay lands on identical draws
## without needing to know what happened.
const STRIKE_DRAWS := 2

## The reference's fixed neighbour order, shared by the keeper's tile and the
## lunge's crossing: east, west, south, north. A replayed lunge crosses the
## same tile every time because this order never varies.
const _NEIGHBOURS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]


## Whether one creature will attack another: the world against you, never
## against itself. The old rule — different kinds fight — was written when
## every creature was a 'thing'; a mixed bestiary under it would brawl among
## itself on the way to the player, and a dungeon that clears its own floors
## is a hallway.
static func is_hostile(a: Dictionary, b: Dictionary) -> bool:
	return (a["kind"] == "you") != (b["kind"] == "you")


## What `attacker` needs on a d20 to land a blow on `target`.
##
## Public because a number you decide on has to be a number you can see. The
## stat block says `might 3`; it does not say "you hit on 10+ and deal 1 to 3",
## and the second is the one a player actually weighs.
static func to_hit(attacker: Dictionary, target: Dictionary) -> int:
	return SimTables.needed_to_hit(
		int((attacker["stats"] as Dictionary)["might"]),
		int((target["stats"] as Dictionary)["speed"]))


## The chance, out of 20, that the blow lands.
static func hit_chance(attacker: Dictionary, target: Dictionary) -> int:
	return SimTables.chance_in_20(to_hit(attacker, target))


## Whether this attacker is a coiled ambusher whose spring is still loaded.
## The tag is written by generation (stalkers born at depth 2+) or by the
## unmasking (the mimic's first-strike, v11), spent by the reducer on the
## first landed blow — so the gate is the tag, one source of truth, and no
## strike-time depth check can disagree with the floor.
static func _spring_loaded(attacker: Dictionary) -> bool:
	var verb: Variant = SimTables.verb_of(attacker["kind"])
	return (verb == "ambush" or verb == "feign") and (attacker["tags"] as Array).has("ambush")


## THE ONE BLOW PATH. Every blow in the game resolves here — the bump, the
## lunge, the volley — because there is not a melee path and a ranged path,
## there is one path with a mode. Returns the payload fields the STRIKE draft
## spreads: roll, needed, hit, crit, damage, and `warded` only when the ward
## fired.
##
## Legible on purpose: you need `10 + their speed - your might` or better on a
## d20, and deal 1 to your might. A player can hold that in their head and
## decide whether a fight is worth taking, which is what makes avoiding one a
## decision rather than a coin toss.
static func resolve_strike(
	seed: int,
	counter: int,
	attacker: Dictionary,
	target: Dictionary,
) -> Dictionary:
	var attacker_stats: Dictionary = attacker["stats"]
	var target_stats: Dictionary = target["stats"]
	var target_tags: Array = target["tags"]

	var roll := SimRng.int_between(seed, counter, 1, 20)
	# The set guard raises the bar: harder to hit by 2 + wits/2 — wits is the
	# stat that reads the incoming blow. Baked into `needed` so the recorded
	# event and every tooltip say the truth the roll actually faced.
	var needed := to_hit(attacker, target)
	if target_tags.has("braced"):
		needed += SimTables.brace_wall(int(target_stats["wits"]))

	# The naturals outrank the arithmetic: the crit band always lands and
	# doubles, a 1 always misses. Wits widens the band — the one mechanical job
	# wits has, so a rule granting it grants something real.
	var crit := roll >= SimTables.crit_floor(int(attacker_stats["wits"]))
	var hit := crit or (roll != SimTables.WHIFF and roll >= needed)

	# Drawn either way, so the draw count never depends on the outcome. The
	# crit doubles this same draw rather than taking another.
	#
	# The ambush blow rolls one damage band harder (might + 2 is the band
	# step): the coiled spring, released. To-hit is untouched — stillness
	# sharpens the blow, not the aim — and the bonus caps at one band because
	# a first strike that can kill from full health is a no-warning spike, and
	# the tradition deleted those. A braced guard breaks the spring: the bonus
	# is absorbed, the coil still spends itself.
	var sprung := _spring_loaded(attacker) and not target_tags.has("braced")
	var might: int = int(attacker_stats["might"]) + (SimTables.AMBUSH_MIGHT_BONUS if sprung else 0)
	var band: Dictionary = SimTables.damage_dice(might)
	var rolled_damage := SimRng.int_between(seed, counter + 1, 1, int(band["die"])) + int(band["flat"])
	var landing := 0
	if hit:
		landing = rolled_damage * 2 if crit else rolled_damage

	# The worn ward drinks a landing blow whole. Resolved HERE so the chain
	# records what happened (damage 0, warded said), and the draws are spent
	# either way — the ward changes the wound, never the stream. ABSENT when it
	# did not fire, so every caller's payload spread reads legacy-clean.
	if landing > 0 and target_tags.has("warded"):
		return {"roll": roll, "needed": needed, "hit": hit, "crit": crit, "damage": 0, "warded": true}
	return {"roll": roll, "needed": needed, "hit": hit, "crit": crit, "damage": landing}


# ── generation ────────────────────────────────────────────────────────────

## The cheapest thing still spawnable, at one level below the floor. INF when
## nothing is — the reference's `Math.min()` of an empty list, which ends the
## spending loop rather than dividing by nothing.
static func _cheapest(spawnable: Array, depth: int) -> float:
	var lowest := INF
	for a: Dictionary in spawnable:
		var stats: Variant = SimTables.creature_stats(a["kind"], maxi(1, depth - 1))
		if stats == null:
			continue
		lowest = minf(lowest, float(SimTables.threat_of(stats, a["kind"])))
	return lowest


## Chooses this floor's population from the bestiary, spending the depth's
## threat budget. Every choice is a counted draw, so generation stays inside
## the draw protocol.
##
## Two-stage pick per creature: a depth band (mostly here, sometimes one up,
## rarely one down — the Brogue blur), then an archetype by weight. Spending
## stops when the budget cannot afford the cheapest thing left, so a floor is
## always as full as its budget allows. The warden joins on its floors without
## consuming budget: a boss is the floor's *feature*, not part of its rent.
##
## Returns {"chosen": Array of {kind, level, stats}, "counterAfter": int}.
static func _choose_spawns(seed: int, counter: int, depth: int, stretch: int = 1) -> Dictionary:
	var chosen: Array = []
	var spawnable: Array = []
	for a: Dictionary in SimTables.BESTIARY:
		if int(a["weight"]) > 0 and depth >= int(a.get("fromDepth", 1)):
			spawnable.append(a)

	# The stretched teaching floor spends its (full-stretch) budget on the
	# cheap kinds only: numbers, not menace. The designer read three bodies on
	# four vales of ground as boring — correctly — and the same rent spent on
	# mixed kinds measured 6/10 at the door (below the gentle pin): the cliff
	# was composition, not count. The vale's door keeps its variety and its
	# exact stream; the stretched door meets the heavier kinds one floor down.
	if depth == 1 and stretch >= 2:
		var cheap: Array = []
		for a: Dictionary in spawnable:
			var stats: Variant = SimTables.creature_stats(a["kind"], 1)
			if stats != null and SimTables.threat_of(stats, a["kind"]) <= SimTables.DOOR_PRICE_CAP:
				cheap.append(a)
		if not cheap.is_empty():
			spawnable = cheap

	var budget := SimTables.spawn_budget(depth, stretch)
	var c := counter

	# A boss floor is a peak, not a double peak: the warden pays half its own
	# threat out of the floor's budget, so its minions thin out around it and
	# the fight is about the warden rather than the crowd it stands in.
	if SimTables.warden_at(depth):
		var boss: Variant = SimTables.creature_stats("warden", SimTables.warden_level(depth))
		budget -= floori(float(SimTables.threat_of(boss, "warden")) / 2.0)

	var rounds := 32 * maxi(1, stretch)
	for guard in range(rounds):
		if float(budget) < _cheapest(spawnable, depth):
			break

		var bands: Array = SimTables.depth_bands(depth)
		var band_total := 0
		for b: Dictionary in bands:
			band_total += int(b["weight"])
		var roll := SimRng.int_between(seed, c, 1, band_total)
		c += 1
		var level: int = int((bands[0] as Dictionary)["level"])
		for band: Dictionary in bands:
			roll -= int(band["weight"])
			if roll <= 0:
				level = int(band["level"])
				break

		var arch_total := 0
		for a: Dictionary in spawnable:
			arch_total += int(a["weight"])
		var pick := SimRng.int_between(seed, c, 1, arch_total)
		c += 1
		var arch: Dictionary = spawnable[0]
		for a: Dictionary in spawnable:
			pick -= int(a["weight"])
			if pick <= 0:
				arch = a
				break

		var stats: Dictionary = SimTables.creature_stats(arch["kind"], level)
		var price := SimTables.threat_of(stats, arch["kind"])
		if price > budget:
			continue # rolled above our means; roll again
		budget -= price
		chosen.append({
			"kind": arch["kind"] if level == 1 else "%s-%d" % [arch["kind"], level],
			"level": level,
			"stats": stats,
		})

	if SimTables.warden_at(depth):
		var level := SimTables.warden_level(depth)
		chosen.append({
			"kind": "warden" if level == 1 else "warden-%d" % level,
			"level": level,
			"stats": SimTables.creature_stats("warden", level),
		})

	return {"chosen": chosen, "counterAfter": c}


## One weighted pick from a pool of {kind, weight} rows, one counted draw.
## Returns {"chosen": Dictionary, "counterAfter": int}.
static func _weighted(seed: int, counter: int, pool: Array) -> Dictionary:
	var sum := 0
	for p: Dictionary in pool:
		sum += int(p["weight"])
	var r := SimRng.int_between(seed, counter, 1, sum)
	var picked: Dictionary = pool[0]
	for p: Dictionary in pool:
		r -= int(p["weight"])
		if r <= 0:
			picked = p
			break
	return {"chosen": picked, "counterAfter": counter + 1}


## What a born-carrying creature holds (v14): mostly a provision, sometimes a
## scroll (where the shelf has opened), rarely a relic at the depth's own
## grant. Drawn at GENERATION so the death drop is derived arithmetic — zero
## draws at kill time, any death.
##
## Returns {"pocket": {kind, grants}, "counterAfter": int}.
static func _draw_pocket(seed: int, counter: int, depth: int) -> Dictionary:
	var c := counter
	var shelf: Array = SimTables.scrolls_at(depth)
	var shares: Array = []
	var provision_weight: int = int(SimTables.POCKET_SHARES["provision"])
	if shelf.is_empty():
		provision_weight += int(SimTables.POCKET_SHARES["scroll"])
	shares.append({"what": "provision", "weight": provision_weight})
	if not shelf.is_empty():
		shares.append({"what": "scroll", "weight": int(SimTables.POCKET_SHARES["scroll"])})
	shares.append({"what": "relic", "weight": int(SimTables.POCKET_SHARES["relic"])})

	var total := 0
	for s: Dictionary in shares:
		total += int(s["weight"])
	var roll := SimRng.int_between(seed, c, 1, total)
	c += 1
	var what := "provision"
	for s: Dictionary in shares:
		roll -= int(s["weight"])
		if roll <= 0:
			what = s["what"]
			break

	var nothing := {"hp": 0, "might": 0, "wits": 0, "speed": 0}
	if what == "provision":
		var drawn: Dictionary = _weighted(seed, c, SimTables.provisions_at(depth))
		return {
			"pocket": {"kind": (drawn["chosen"] as Dictionary)["kind"], "grants": nothing},
			"counterAfter": int(drawn["counterAfter"]),
		}
	if what == "scroll":
		var drawn: Dictionary = _weighted(seed, c, shelf)
		return {
			"pocket": {"kind": (drawn["chosen"] as Dictionary)["kind"], "grants": nothing},
			"counterAfter": int(drawn["counterAfter"]),
		}
	var drawn_relic: Dictionary = _weighted(seed, c, SimTables.ARMORY)
	var relic: Dictionary = drawn_relic["chosen"]
	return {
		"pocket": {"kind": relic["kind"], "grants": SimTables.relic_grant(relic, depth)},
		"counterAfter": int(drawn_relic["counterAfter"]),
	}


static func _same(a: Dictionary, b: Dictionary) -> bool:
	return int(a["x"]) == int(b["x"]) and int(a["y"]) == int(b["y"])


static func _join(parts: Array, sep: String) -> String:
	var out := ""
	for i in range(parts.size()):
		if i > 0:
			out += sep
		out += str(parts[i])
	return out


## The walking distance as the reference's template literal renders it.
##
## **THE CHAIN-FORKING HAZARD, handed to this task by name.** `walk` is a
## FLOAT — deliberately, because `SimMapgen.walk_distance` returns INF for "no
## walk exists" and the reference branches on `Number.isFinite(walk)` to print
## "?" instead of a number (commands.ts:619). Every finite answer is an
## integral float, and in Godot `str(12.0)` is "12.0" where TypeScript writes
## "12" (and `str(INF)` is "inf" where TypeScript writes "Infinity").
##
## So `str()` and `%s` are BOTH wrong here. `%d` is what renders the reference's
## bytes, and the is_finite() branch mirrors the reference's own isFinite test.
## The story is a GameState field: it goes through SimCanonical.encode and into
## the fold hash, so a single "12.0" where the reference wrote "12" changes the
## story, changes the state, changes the hash, and forks every chain built on
## that floor — while passing every test that does not compare the story byte
## for byte. test_commands.gd rebuilds the committed golden world for exactly
## this reason.
static func _steps(walk: float) -> String:
	return ("%d" % walk) if is_finite(walk) else "?"


static func create_world(
	seed: int,
	width: int,
	height: int,
	player_id: String = "player",
	depth: int = 1,
	carried: Variant = null,
) -> Dictionary:
	# The board chokepoint: one loud gate, here, where every world is born (the
	# maze-solver discipline). Above the cap a mistyped dimension allocates a
	# country; better to refuse than to try to render one.
	#
	# The reference THROWS. GDScript's assert() unwinds exactly one frame and
	# hands the caller this function's default `{}` — and the explicit return
	# produces the SAME `{}` in a release build where the assert does not
	# exist, so debug and release refuse alike. push_error rides alongside
	# because it survives the strip: an exported build that quietly allocated
	# a country would be the loudest bug from the quietest place.
	if width > SimTables.MAX_BOARD_DIM or height > SimTables.MAX_BOARD_DIM:
		var msg := "create_world: %dx%d exceeds the %d board cap" % [
			width, height, SimTables.MAX_BOARD_DIM,
		]
		push_error(msg)
		assert(false, msg)
		return {}

	# How far this board stretches past the vale (48x32): 1 there and on every
	# test board, 2 on the expanse, 3 on the waste. Scales the rent, the pantry
	# and the armory below — and nothing else, so a stretch-1 world is
	# bit-identical to the game before boards could breathe.
	var stretch := SimTables.size_stretch(width, height)
	# The depth cuts the floor to a motif — the door, the warren, the halls, or
	# the deep's per-floor draw. Drawn first, so the whole floor is shaped by it.
	var cut: Dictionary = SimTables.motif_at(seed, 0, depth)
	var motif: Dictionary = cut["motif"]
	var generated: Dictionary = SimMapgen.generate_map(
		seed, int(cut["counterAfter"]), width, height, motif)
	var start: Dictionary = generated["start"]

	# The way out sits at the far end of the map, so a run has a direction and
	# the journey is the longest one this world affords rather than an accident.
	#
	# Except at the bottom. The ninth floor turns around: the HEART lies at the
	# far end (behind the last warden), and the way out is the stair you came
	# down by — the tile you are standing on when the floor is born. Seize the
	# heart and carry it back: the ending is the reversal, not the touch.
	#
	# Where the way out lies is DRAWN, from a band of the floor's own reach.
	var bottom: bool = depth >= SimTables.BOTTOM_DEPTH
	var far: Dictionary = SimMapgen.farthest_from(generated["grid"], start)
	var chosen_exit: Dictionary = SimMapgen.choose_exit(
		seed, int(generated["counterAfter"]), generated["grid"], start)
	var exit: Dictionary = start if bottom else chosen_exit["exit"]
	var opened: Dictionary = SimMapgen.with_exit(generated["grid"], exit)

	# Sometimes a room keeps itself secret — every doorway an illusory wall.
	# Then the designer's repair rule, defence in depth: a floor that somehow
	# arrives with truly stranded rooms gets a hidden way cut in rather than
	# being thrown away. At the bottom, the far anchor protects the heart's
	# room from sealing (exit === start there, so both ends stay open anyway).
	var secret: Dictionary = SimMapgen.seal_secret_room(
		seed, int(chosen_exit["counterAfter"]), opened, generated["rooms"],
		start, far if bottom else exit, int(motif["secretIn"]))
	var repaired: Dictionary = SimMapgen.repair_with_secret(secret["grid"], start)
	var grid: Dictionary = repaired["grid"]

	var walk: float = SimMapgen.walk_distance(grid, start, far if bottom else exit)

	var population: Dictionary = _choose_spawns(seed, int(secret["counterAfter"]), depth, stretch)
	var chosen: Array = population["chosen"]

	# The floor's prizes, drawn from the armory by weight — counted draws like
	# every other choice generation makes. One relic on the first floor; two
	# from depth 2, drawn without replacement so a floor never doubles up. The
	# stretch owes more prizes: a longer journey earns another guarded detour
	# per size step, never stacking. The teaching floor holds ONE whatever the
	# acreage: the lesson is the keen edge on the walked path, not a scavenger
	# hunt.
	var relic_count: int = (2 + (stretch - 1)) if depth >= 2 else 1
	# Depth 1 guarantees the keen edge BY NAME — the fighter's curve keys on it,
	# and finding it by granted stat was one armory reorder away from handing
	# the teaching floor a sling instead.
	var pool: Array = []
	if depth == 1:
		for r: Dictionary in SimTables.ARMORY:
			if r["kind"] == "keen edge":
				pool.append(r)
				break
	else:
		pool = (SimTables.ARMORY as Array).duplicate()
	var relics: Array = []
	var c: int = int(population["counterAfter"])
	for i in range(relic_count):
		if pool.is_empty():
			break
		var drawn: Dictionary = _weighted(seed, c, pool)
		c = int(drawn["counterAfter"])
		var picked: Dictionary = drawn["chosen"]
		relics.append(picked)
		pool.remove_at(pool.find(picked))

	# Depth 2 owes a ranged relic: the slinger debuts here, and the floor that
	# first volleys AT you is the floor that puts the volley in your hand. The
	# draws stand as drawn — a drawless adjustment, like every placement
	# decision — and only the second prize gives way.
	if depth == 2:
		var has_ranged := false
		for r: Dictionary in relics:
			if SimTables.RELIC_TRAITS.get(r["kind"], "") == "ranged":
				has_ranged = true
				break
		if not has_ranged:
			for r: Dictionary in SimTables.ARMORY:
				if SimTables.RELIC_TRAITS.get(r["kind"], "") == "ranged":
					relics[relics.size() - 1] = r
					break

	# The floor's provisions, drawn by weight like everything else and laid at
	# the last drawn points — far from the door, unguarded on purpose. The
	# armory pays for fighting; the satchel pays for scouting: a guarded
	# consumable would just be another relic, and an on-path one is not a
	# detour, it is a toll both already collected. One per size step,
	# duplicates welcome.
	var pantry: Array = SimTables.provisions_at(depth)
	var provisions: Array = []
	for i in range(stretch):
		var drawn: Dictionary = _weighted(seed, c, pantry)
		c = int(drawn["counterAfter"])
		provisions.append({"kind": (drawn["chosen"] as Dictionary)["kind"]})

	var spawned: Dictionary = SimMapgen.pick_spawn_points(
		seed, c, grid, start, chosen.size() + provisions.size(), OPPONENT_MIN_DISTANCE)
	var points: Array = spawned["points"]

	# Placed on creatures' tiles: a prize is guarded, so taking it means going
	# through something. An item you can pick up for free is not a choice.
	var guard_posts: Array = []
	for i in range(relics.size()):
		guard_posts.append(points[i] if i < points.size() else exit)

	# The teaching floor reaches the player: depth 1's one relic — the fighter's
	# whole early curve — and its guard stand ON the walked path, eight steps
	# in, so simply walking the floor meets the fight early and the prize on the
	# way. Measured need: a real player crossed 273 turns of this floor with the
	# keen edge lying unclaimed on a far drawn point, and died bare, twice.
	# Chosen, not drawn; deeper floors keep the detour economy untouched.
	if depth == 1 and guard_posts.size() > 0:
		var road: Array = SimMapgen.walk_path(grid, start, exit)
		var at: int = mini(OPPONENT_MIN_DISTANCE, road.size() - 2)
		if at > 0 and at < road.size():
			var post: Dictionary = road[at]
			guard_posts[0] = {"x": int(post["x"]), "y": int(post["y"])}

	# The stairs are watched. Rooms and corridors made every fight avoidable —
	# measured: the runner out-survived the fighter 11 to 9 at depth 3, the
	# exact domination the Covenant forbids — so the way out costs something:
	# the strongest thing on the floor stands beside it. Chosen before guard
	# duty is handed out, so the keeper is never a relic guard even on a floor
	# with more prizes than creatures. Deterministic and drawless.
	var keeper := -1
	var keeper_threat := -1
	for i in range(chosen.size()):
		var ch: Dictionary = chosen[i]
		var t := SimTables.threat_of(ch["stats"], ch["kind"])
		if t >= keeper_threat:
			keeper_threat = t
			keeper = i
	# On a warden floor the warden keeps the door BY ROLE, not by arithmetic.
	# The old claim — "it out-threatens everything by construction" — broke
	# quietly the first time an out-of-depth roll landed: a depth-9 floor was
	# measured with its warden fourth-scariest, and the stairs going to a
	# skirmisher. The post is the warden's identity; the strongest-thing rule
	# remains for every unbossed floor.
	if SimTables.warden_at(depth):
		for i in range(chosen.size()):
			if ((chosen[i] as Dictionary)["kind"] as String).begins_with("warden"):
				keeper = i
				break

	# Guards: the first creatures that are not the keeper, one per relic. A
	# floor too poor in creatures leaves its later prizes lying unguarded —
	# poverty is honest, an unwatched stair is not.
	var guard_of: Dictionary = {}
	for i in range(chosen.size()):
		if guard_of.size() >= relics.size():
			break
		if i != keeper:
			guard_of[i] = guard_of.size()

	# The post is the first standable tile beside the exit that is not a guard
	# post; everyone unassigned takes the remaining drawn points in order.
	var watched: Dictionary = far if bottom else exit
	var keeper_tile: Variant = null
	for step: Array in _NEIGHBOURS:
		var p := {"x": int(watched["x"]) + int(step[0]), "y": int(watched["y"]) + int(step[1])}
		if not SimGrid.is_passable(grid, int(p["x"]), int(p["y"])):
			continue
		# Never on an illusory wall: a keeper standing in what paints as wall
		# gives the secret away, and reads as a haunting.
		if SimGrid.tile_at(grid, int(p["x"]), int(p["y"])) == SimGrid.SECRET:
			continue
		if _same(p, start):
			continue
		var on_guard_post := false
		for g in range(guard_of.size()):
			if g < guard_posts.size() and _same(guard_posts[g], p):
				on_guard_post = true
				break
		if on_guard_post:
			continue
		keeper_tile = p
		break

	var free_points: Array = []
	for i in range(points.size()):
		if i < relics.size() or i >= points.size() - provisions.size():
			continue
		var p: Dictionary = points[i]
		if keeper_tile != null and _same(p, keeper_tile):
			continue
		free_points.append(p)
	var next_free := 0

	# The dispositions (v10, the living-dungeon pass). By role, drawless: the
	# keeper and every relic guard OWN their posts now — they hunt only inside
	# the leash and walk home when it empties, instead of freezing wherever a
	# chase went cold. Free spawns past the teaching floor draw their temper: a
	# third walk rounds of the floor (routes of drawn room centres — the patrol
	# that makes a big board feel inhabited), a sixth post themselves where they
	# stand, the rest keep the old stillness.
	#
	# Patrols on the stretched teaching floor were measured and DEFERRED: at the
	# door they cost the pinned bot four escapes in ten all by themselves.
	var centers: Array = []
	for r: Dictionary in (generated["rooms"] as Array):
		centers.append({
			"x": int(r["x"]) + floori(float(r["w"]) / 2.0),
			"y": int(r["y"]) + floori(float(r["h"]) / 2.0),
		})
	# THE ABSENT-KEY LAW: an untempered creature carries NO disposition key, so
	# `null` here means "write nothing", never "write null".
	var temper: Array = []
	for i in range(chosen.size()):
		temper.append(null)
	var after: int = int(spawned["counterAfter"])
	for i in range(chosen.size()):
		if guard_of.has(i) or i == keeper:
			temper[i] = {"disposition": "guard"}
			continue
		if depth < SimTables.WANDER_FROM_DEPTH or centers.size() < 2:
			continue
		var drawn := SimRng.int_between(seed, after, 1, 6)
		after += 1
		if drawn <= 2:
			var stops := SimRng.int_between(
				seed, after, int(SimTables.ROUTE_STOPS[0]), int(SimTables.ROUTE_STOPS[1]))
			after += 1
			var route: Array = []
			for s in range(stops):
				var at := SimRng.int_between(seed, after, 0, centers.size() - 1)
				after += 1
				route.append({
					"x": int((centers[at] as Dictionary)["x"]),
					"y": int((centers[at] as Dictionary)["y"]),
				})
			temper[i] = {"disposition": "wander", "route": route}
		elif drawn == 3:
			temper[i] = {"disposition": "guard"}
	var walking := 0
	for t: Variant in temper:
		if t != null and (t as Dictionary)["disposition"] == "wander":
			walking += 1

	# The pockets (v14): roughly one creature in POCKET_IN is born carrying.
	var pockets: Array = []
	for i in range(chosen.size()):
		var carrying := SimRng.int_between(seed, after, 1, SimTables.POCKET_IN)
		after += 1
		if carrying == 1:
			var drawn: Dictionary = _draw_pocket(seed, after, depth)
			after = int(drawn["counterAfter"])
			pockets.append(drawn["pocket"])
		else:
			pockets.append(null)

	# The mimic roll (v11): 1 floor in MIMIC_IN, from depth 2 down, holds at
	# most one — an item that was never an item, wearing a kind the floor's own
	# tables could honestly have put there. Its tile is drawn from the same
	# field as every spawn; a few tries skip collisions with real prizes, posts
	# and the door rather than forcing them, and a floor too crowded to hide a
	# lie simply goes without.
	var mimic_seed: Variant = null
	if depth >= SimTables.MIMIC_FROM_DEPTH:
		var roll := SimRng.int_between(seed, after, 1, SimTables.MIMIC_IN)
		after += 1
		if roll == 1:
			var guises: Array = SimTables.mimic_guises(depth)
			var which := SimRng.int_between(seed, after, 0, guises.size() - 1)
			after += 1
			var spots: Dictionary = SimMapgen.pick_spawn_points(
				seed, after, grid, start, 4, OPPONENT_MIN_DISTANCE)
			after = int(spots["counterAfter"])
			var tile: Variant = null
			for p: Dictionary in (spots["points"] as Array):
				var taken := false
				for q: Dictionary in points:
					if _same(q, p):
						taken = true
						break
				if not taken and keeper_tile != null and _same(p, keeper_tile):
					taken = true
				if not taken and (_same(p, exit) or _same(p, far)):
					taken = true
				if not taken:
					tile = p
					break
			if tile != null:
				var level: int = maxi(1, depth - 1)
				# A lie always hoards: the mimic carries something worth the
				# teeth, every time — beating the trick pays like a small vault.
				var hoard: Dictionary = _draw_pocket(seed, after, depth)
				after = int(hoard["counterAfter"])
				mimic_seed = {
					"id": "mimic-1",
					"kind": "mimic" if level == 1 else "mimic-%d" % level,
					"pos": {"x": int((tile as Dictionary)["x"]), "y": int((tile as Dictionary)["y"])},
					"stats": SimTables.creature_stats("mimic", level),
					"tags": ["hidden"],
					"guise": guises[which],
					"pocket": hoard["pocket"],
				}

	# The traps (v12): laid after every inhabitant and prize, so nothing shares
	# a tile with a lie or a treasure. Count by depth and stretch (none on the
	# teaching floor); kinds by weighted draw from the depth's table; tiles from
	# the same drawn field as every spawn. A floor too crowded lays fewer.
	var trap_seeds: Array = []
	var traps_wanted := SimTables.trap_count(depth, stretch)
	if traps_wanted > 0:
		var laying: Array = SimTables.trap_kinds_at(depth)
		var spots: Dictionary = SimMapgen.pick_spawn_points(
			seed, after, grid, start, traps_wanted + 4, OPPONENT_MIN_DISTANCE)
		after = int(spots["counterAfter"])
		var level := SimTables.trap_level_at(depth)
		for p: Dictionary in (spots["points"] as Array):
			if trap_seeds.size() >= traps_wanted:
				break
			var claimed := false
			for q: Dictionary in points:
				if _same(q, p):
					claimed = true
					break
			if not claimed and keeper_tile != null and _same(p, keeper_tile):
				claimed = true
			if not claimed and (_same(p, exit) or _same(p, far)):
				claimed = true
			if not claimed and mimic_seed != null and _same(p, (mimic_seed as Dictionary)["pos"]):
				claimed = true
			if not claimed:
				for t: Dictionary in trap_seeds:
					if _same(t["pos"], p):
						claimed = true
						break
			if claimed:
				continue
			var drawn: Dictionary = _weighted(seed, after, laying)
			after = int(drawn["counterAfter"])
			trap_seeds.append({
				"id": "trap-%d" % (trap_seeds.size() + 1),
				"kind": (drawn["chosen"] as Dictionary)["kind"],
				"pos": {"x": int(p["x"]), "y": int(p["y"])},
				"level": level,
			})

	# A scroll on the floor (v13): 1 floor in SCROLL_IN from depth 2, laid on a
	# drawn free tile, visible like every floor item — what the floor owns is
	# visible; the scroll's secret is its KIND, not its place.
	var scroll_laid: Variant = null
	if depth >= 2 and not SimTables.scrolls_at(depth).is_empty():
		var roll := SimRng.int_between(seed, after, 1, SimTables.SCROLL_IN)
		after += 1
		if roll == 1:
			var shelf: Array = SimTables.scrolls_at(depth)
			var drawn: Dictionary = _weighted(seed, after, shelf)
			after = int(drawn["counterAfter"])
			var spots: Dictionary = SimMapgen.pick_spawn_points(
				seed, after, grid, start, 4, OPPONENT_MIN_DISTANCE)
			after = int(spots["counterAfter"])
			var tile: Variant = null
			for p: Dictionary in (spots["points"] as Array):
				var held := false
				for q: Dictionary in points:
					if _same(q, p):
						held = true
						break
				if not held and keeper_tile != null and _same(p, keeper_tile):
					held = true
				if not held and (_same(p, exit) or _same(p, far)):
					held = true
				if not held and mimic_seed != null and _same(p, (mimic_seed as Dictionary)["pos"]):
					held = true
				if not held:
					for t: Dictionary in trap_seeds:
						if _same(t["pos"], p):
							held = true
							break
				if not held:
					tile = p
					break
			if tile != null:
				scroll_laid = {
					"id": "scroll-1",
					"kind": (drawn["chosen"] as Dictionary)["kind"],
					"pos": {"x": int((tile as Dictionary)["x"]), "y": int((tile as Dictionary)["y"])},
					"grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0},
				}

	# The floor's whole account, recorded where facts live — covenant L1: the
	# shape, the journey, the rent and what it bought, who watches the door,
	# what lies guarded. This is the generation reasoning chain, in the event,
	# so the ledger can read it back for any floor of any run forever.
	var spent := 0
	var kind_names: Array = []
	for ch: Dictionary in chosen:
		spent += SimTables.threat_of(ch["stats"], ch["kind"])
		kind_names.append(ch["kind"])
	var watcher := "nobody"
	if keeper >= 0 and keeper_tile != null:
		watcher = (chosen[keeper] as Dictionary)["kind"]
	var coiled := 0
	if depth >= SimTables.AMBUSH_FROM_DEPTH:
		for ch: Dictionary in chosen:
			if SimTables.verb_of(ch["kind"]) == "ambush":
				coiled += 1
	var relic_names: Array = []
	for r: Dictionary in relics:
		relic_names.append(r["kind"])
	var provision_names: Array = []
	for p: Dictionary in provisions:
		provision_names.append(p["kind"])

	var story := "%s · %s" % [motif["name"], generated["story"]]
	if bottom:
		story += " · the bottom — the heart lies %s steps of walking away, and the way out is the stair you came down by" % _steps(walk)
	else:
		story += " · the way out is %s, %s steps of walking" % [chosen_exit["band"], _steps(walk)]
	story += " · a budget of %d paid %d for %d: %s" % [
		SimTables.spawn_budget(depth, stretch), spent, chosen.size(), _join(kind_names, ", "),
	]
	story += " · %s watches %s" % [watcher, "the heart" if bottom else "the stairs"]
	story += " · %s lies guarded" % ("nothing" if relic_names.is_empty() else _join(relic_names, " and "))
	story += " · %s lie%s where the path does not go" % [
		_join(provision_names, " and "), "s" if provisions.size() == 1 else "",
	]
	if coiled > 0:
		story += " · %d of them lie%s coiled, waiting" % [coiled, "s" if coiled == 1 else ""]
	if walking > 0:
		story += " · %d of them walk%s rounds of the floor" % [walking, "s" if walking == 1 else ""]
	# Said like the secret room is said: that a lie exists, never where.
	if mimic_seed != null:
		story += " · one thing here is not what it seems"
	if bool(secret["sealed"]):
		story += " · one room keeps itself secret"
	if int(repaired["punched"]) > 0:
		story += " · %d hidden way(s) cut where no way was" % int(repaired["punched"])
	if depth == 1:
		story += " · the world runs %d floors deep, and something beats at the bottom" % SimTables.BOTTOM_DEPTH

	# ── the payload, under THE ABSENT-KEY LAW ────────────────────────────
	# Every `...(x === undefined ? {} : { k: x })` in the reference is an
	# ABSENT key here, never a null one.
	var items: Array = []
	for i in range(relics.size()):
		var post: Dictionary = guard_posts[i]
		items.append({
			"id": "relic-%d" % (i + 1),
			"kind": (relics[i] as Dictionary)["kind"],
			"pos": {"x": int(post["x"]), "y": int(post["y"])},
			"grants": SimTables.relic_grant(relics[i], depth),
		})
	for i in range(provisions.size()):
		var at: int = points.size() - provisions.size() + i
		var tile: Dictionary = points[at] if at >= 0 and at < points.size() else exit
		items.append({
			"id": "provision-%d" % (i + 1),
			"kind": (provisions[i] as Dictionary)["kind"],
			"pos": {"x": int(tile["x"]), "y": int(tile["y"])},
			"grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0},
		})
	# The bottom keeps its heart at the far end, watched by the last warden.
	# Grants nothing worn — what it grants is the ending.
	if bottom:
		items.append({
			"id": "heart-1",
			"kind": SimTables.HEART_KIND,
			"pos": {"x": int(far["x"]), "y": int(far["y"])},
			"grants": {"hp": 0, "might": 0, "wits": 0, "speed": 0},
		})
	if scroll_laid != null:
		items.append(scroll_laid)

	var opponents: Array = []
	for i in range(chosen.size()):
		var ch: Dictionary = chosen[i]
		var post: Dictionary
		if guard_of.has(i):
			post = guard_posts[int(guard_of[i])]
		elif i == keeper and keeper_tile != null:
			post = keeper_tile
		elif next_free < free_points.size():
			post = free_points[next_free]
			next_free += 1
		else:
			next_free += 1
			post = exit
		var foe: Dictionary = {
			"id": "foe-%d" % (i + 1),
			"kind": ch["kind"],
			"pos": {"x": int(post["x"]), "y": int(post["y"])},
			"stats": (ch["stats"] as Dictionary).duplicate(),
			# Stalkers below the teaching floor are born coiled: the spring is a
			# recorded fact of generation, spent by the first landed blow. Depth
			# 1 stays springless — the 19-in-20 gentle pin holds about one death
			# of slack, and an opening band-jump would spend it.
			"tags": _birth_tags(ch["kind"], depth),
		}
		if temper[i] != null:
			for key: String in (temper[i] as Dictionary):
				foe[key] = (temper[i] as Dictionary)[key]
		if pockets[i] != null:
			foe["pocket"] = pockets[i]
		opponents.append(foe)
	if mimic_seed != null:
		opponents.append(mimic_seed)

	var payload: Dictionary = {
		"width": width,
		"height": height,
		"tiles": (grid["tiles"] as Array).duplicate(),
		"seed": seed,
		"story": story,
		# The cut, as a token beside the story's prose — same fact, one for
		# rules to read and one for players.
		"motif": motif["key"],
		"depth": depth,
		"xp": 0 if carried == null else int((carried as Dictionary).get("xp", 0)),
		"level": 1 if carried == null else int((carried as Dictionary).get("level", 1)),
		"items": items,
		"player": {
			"id": player_id,
			"kind": "you",
			"pos": {"x": int(start["x"]), "y": int(start["y"])},
			"stats": STARTING_STATS.duplicate() if carried == null \
				else ((carried as Dictionary)["stats"] as Dictionary).duplicate(),
			"tags": [],
		},
		"opponents": opponents,
	}
	if carried != null:
		var who: Dictionary = carried
		payload["playerMaxHp"] = int(who["maxHp"])
		if who.has("gear"):
			payload["playerGear"] = who["gear"]
		if who.has("satchel"):
			payload["playerSatchel"] = {
				"kinds": ((who["satchel"] as Dictionary)["kinds"] as Array).duplicate(),
			}
		if who.has("scroll"):
			payload["playerScroll"] = {"kind": (who["scroll"] as Dictionary)["kind"]}
	if not trap_seeds.is_empty():
		payload["traps"] = trap_seeds

	return SimEvents.draft("WORLD_INIT", 0, after, payload)


## Born loaded: the coil's one spring, the caller's one voice. Tags are the
## single source of truth for spent-or-not.
static func _birth_tags(kind: String, depth: int) -> Array:
	var verb: Variant = SimTables.verb_of(kind)
	if verb == "ambush" and depth >= SimTables.AMBUSH_FROM_DEPTH:
		return ["ambush"]
	if verb == "call":
		return ["call"]
	return []


# ── the walk, and the bump that is an attack ──────────────────────────────

## Whether a value is a whole number, the way `Number.isInteger` means it: a
## float 1.0 IS an integer, 0.5 is not, and neither INF nor NAN is.
static func _is_whole(v: Variant) -> bool:
	if v is int:
		return true
	if v is float:
		return is_finite(v) and float(v) == floorf(float(v))
	return false


## `dx`/`dy` are Variant rather than int ON PURPOSE. The reference takes
## `number`, which admits 0.5, and the guard below is what refuses it — typed
## `int` parameters would silently truncate 0.5 to 0 at the call boundary and
## port the guard into nothing. Every real caller passes ints.
static func attempt_move(state: Dictionary, entity_id: String, dx: Variant, dy: Variant) -> Dictionary:
	# Integers as well as magnitude: (0.5, 0.5) sums to exactly 1, so a
	# magnitude-only guard would land the player between tiles — and from a
	# fractional position every later move reads as blocked, because a
	# non-integer array index resolves to nothing.
	if not _is_whole(dx) or not _is_whole(dy) or absi(int(dx)) + absi(int(dy)) != 1:
		var msg := "attempt_move: expected a single orthogonal step, got (%s, %s)" % [dx, dy]
		push_error(msg)
		assert(false, msg)
		return {}
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	if found == null:
		var msg := "attempt_move: no entity %s" % entity_id
		push_error(msg)
		assert(false, msg)
		return {}
	var mover: Dictionary = found
	var step_x := int(dx)
	var step_y := int(dy)

	var grid: Dictionary = state["grid"]
	var from: Dictionary = mover["pos"]
	var to := {"x": int(from["x"]) + step_x, "y": int(from["y"]) + step_y}
	var counter: int = int(state["rngCounter"])

	if not SimGrid.in_bounds(grid, int(to["x"]), int(to["y"])):
		return SimEvents.draft("MOVE_BLOCKED", counter, 0, {
			"entityId": entity_id, "attempted": to, "reason": "out-of-bounds",
		})
	if not SimGrid.is_passable(grid, int(to["x"]), int(to["y"])):
		return SimEvents.draft("MOVE_BLOCKED", counter, 0, {
			"entityId": entity_id, "attempted": to, "reason": "wall",
		})

	var occupant: Variant = null
	for o: Dictionary in entities:
		if o["id"] != entity_id and SimEntity.is_alive(o) and _same(o["pos"], to):
			occupant = o
			break

	if occupant != null:
		var them: Dictionary = occupant
		# Bump to attack — no separate key. Walking into something hostile is
		# the attack, which keeps the whole game on four inputs.
		if not is_hostile(mover, them):
			return SimEvents.draft("MOVE_BLOCKED", counter, 0, {
				"entityId": entity_id, "attempted": to, "reason": "occupied",
			})

		# The reach for a prize that was never a prize: a hidden mimic is not
		# struck, it is UNMASKED — the walk was toward an item, and the intent
		# to stoop is what springs the lie. The move is spent; the creature
		# phase that follows is where the first strike lands, one band harder.
		if (them["tags"] as Array).has("hidden"):
			return SimEvents.draft("UNMASKED", counter, 0, {"mimicId": them["id"]})

		var outcome_of: Dictionary = resolve_strike(int(state["seed"]), counter, mover, them)

		# The trample: a bruiser's landed blow shoves the target one tile along
		# the line of the attack and the bruiser lumbers into the gap — atomic
		# in this one event, so there is no in-between turn to kite through.
		# Every landed blow shoves; a sometimes-shove is dice noise that takes
		# two encounters to read instead of one. No shove when the tile behind
		# is denied (wall, body in the way, the world's edge), when the blow
		# kills (the dead are not driven anywhere), and never onto the way out —
		# an exit you can be knocked through is an escape you did not choose.
		var payload: Dictionary = {
			"attackerId": entity_id, "targetId": them["id"], "mode": "melee",
		}
		payload.merge(outcome_of)
		if _spring_loaded(mover) and bool(outcome_of["hit"]):
			payload["ambush"] = true
		# A braced target holds their ground: the trample lands as a plain blow.
		# Steady boots hold it always — the named relic's one rule.
		var their_stats: Dictionary = them["stats"]
		if SimTables.verb_of(mover["kind"]) == "trample" and bool(outcome_of["hit"]) \
			and int(their_stats["hp"]) > int(outcome_of["damage"]) \
			and not (them["tags"] as Array).has("braced") \
			and not SimTables.wears_trait(them.get("gear"), "hold-ground"):
			var behind := {"x": int(them["pos"]["x"]) + step_x, "y": int(them["pos"]["y"]) + step_y}
			var denied := not SimGrid.in_bounds(grid, int(behind["x"]), int(behind["y"])) \
				or not SimGrid.is_passable(grid, int(behind["x"]), int(behind["y"])) \
				or SimGrid.tile_at(grid, int(behind["x"]), int(behind["y"])) == SimGrid.EXIT
			if not denied:
				for e: Dictionary in entities:
					if SimEntity.is_alive(e) and e["id"] != them["id"] and _same(e["pos"], behind):
						denied = true
						break
			if not denied:
				payload["targetTo"] = behind
				payload["attackerTo"] = {"x": int(them["pos"]["x"]), "y": int(them["pos"]["y"])}

		return SimEvents.draft("STRIKE", counter, STRIKE_DRAWS, payload)

	# The snare holds: a held body's step becomes the strain against it — a
	# recorded WAIT that spends the action honestly. Refusing for free here
	# would hand a bot a retry loop that never lets time pass and the snare
	# never slacken; and a player who knows they are held (the panel says so) is
	# choosing to strain, which is a turn. Blows, tools and stances still work:
	# what the snare takes is only the leaving.
	for t: String in (mover["tags"] as Array):
		if t.begins_with("snared-"):
			return SimEvents.draft("WAIT", counter, 0, {"entityId": entity_id})

	return SimEvents.draft("MOVE", counter, 0, {
		"entityId": entity_id,
		"from": {"x": int(from["x"]), "y": int(from["y"])},
		"to": to,
	})


## Whether an action ends the actor's turn.
##
## A refused action costs nothing: walking into a wall is a mispress, not a
## decision, and charging a turn for it hands a free hit to whatever is standing
## next to you. The rule lives here rather than in the view because the view is
## a throwaway harness and this is a rule of the game.
##
## ITEM_TAKEN rides along with the move that reached it, so it must not spend a
## second turn of its own — and the trap events ride the action that earned them
## the same way: the step was the turn, the trap is what the step cost (or
## taught). A REFUSED take is even lighter: the stoop that takes nothing costs
## nothing, exactly like the one that takes.
static func ends_turn(draft: Dictionary) -> bool:
	var type: String = str(draft.get("type", ""))
	return type != "MOVE_BLOCKED" and type != "ITEM_TAKEN" and type != "ITEM_REFUSED" \
		and type != "TRAP_SENSED" and type != "TRAP_SPRUNG"


## The skirmisher's lunge: two tiles of ground and the blow in one motion.
##
## The intermediate tile is chosen in the fixed neighbour order (east, west,
## south, north), so a replayed lunge crosses the same tile every time. Null
## when the geometry does not hold — a mispress, not a turn.
static func lunge_strike(state: Dictionary, entity_id: String, target_id: String) -> Variant:
	var entities: Array = state["entities"]
	var found: Variant = SimEntity.find(entities, entity_id)
	var quarry: Variant = SimEntity.find(entities, target_id)
	if found == null or quarry == null or not SimEntity.is_alive(quarry):
		return null
	var mover: Dictionary = found
	var target: Dictionary = quarry
	if not is_hostile(mover, target):
		return null

	var my_pos: Dictionary = mover["pos"]
	var their_pos: Dictionary = target["pos"]
	var away := absi(int(their_pos["x"]) - int(my_pos["x"])) \
		+ absi(int(their_pos["y"]) - int(my_pos["y"]))
	if away != 2:
		return null

	var grid: Dictionary = state["grid"]
	var via: Variant = null
	for step: Array in _NEIGHBOURS:
		var mid := {"x": int(my_pos["x"]) + int(step[0]), "y": int(my_pos["y"]) + int(step[1])}
		var closes := absi(int(their_pos["x"]) - int(mid["x"])) \
			+ absi(int(their_pos["y"]) - int(mid["y"])) == 1
		if not closes:
			continue
		if not SimGrid.in_bounds(grid, int(mid["x"]), int(mid["y"])):
			continue
		if not SimGrid.is_passable(grid, int(mid["x"]), int(mid["y"])):
			continue
		var blocked := false
		for e: Dictionary in entities:
			if SimEntity.is_alive(e) and e["id"] != entity_id and _same(e["pos"], mid):
				blocked = true
				break
		if blocked:
			continue
		via = mid
		break
	if via == null:
		return null

	var counter: int = int(state["rngCounter"])
	var payload: Dictionary = {
		"attackerId": entity_id, "targetId": target_id, "mode": "melee",
	}
	payload.merge(resolve_strike(int(state["seed"]), counter, mover, target))
	payload["attackerTo"] = via
	return SimEvents.draft("STRIKE", counter, STRIKE_DRAWS, payload)


## The warden knitting its fight shut. Once per disengagement by construction —
## after this the wound is gone, and the condition cannot hold again until
## someone comes back and reopens it. This is what closes the poke-and-retreat
## hole the leash itself opens: attrition against the stairs' keeper costs the
## whole fight each time, not a tenth of one.
static func vigil_kept(state: Dictionary, entity_id: String) -> Dictionary:
	return SimEvents.draft("VIGIL_KEPT", int(state["rngCounter"]), 0, {"entityId": entity_id})


static func advance_turn(state: Dictionary) -> Dictionary:
	var next: Dictionary = SimTurns.next_active(state["entities"], state["activeEntityId"])
	var turn: int = int(state["turn"])
	return SimEvents.draft("TURN_ADVANCED", int(state["rngCounter"]), 0, {
		"activeEntityId": next["activeEntityId"],
		"turn": turn + 1 if bool(next["wrapped"]) else turn,
	})


# ── the descent ceremony ──────────────────────────────────────────────────

## Whether the world's ending rides in this player's hands — either of them.
static func heart_held(state: Dictionary, player_id: String = "player") -> bool:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null:
		return false
	var carried: Variant = (found as Dictionary).get("satchel")
	if carried == null:
		return false
	for c: Dictionary in (carried as Array):
		if c["kind"] == SimTables.HEART_KIND:
			return true
	return false


## How the run stands: 'playing' | 'escaped' | 'dead' | 'won'.
##
## Derived rather than stored, and no event records it. Standing on the exit is
## escaping and no hit points is dying — both already true in the state, and a
## second recording of a fact is a second thing that can disagree with the
## first. The same reason canon is folded rather than kept.
##
## The bottom floor turns the exit around: its stair is the one you came down by
## (you are BORN standing on it), so standing there means nothing until the
## heart is in your hands — and then it means everything.
static func outcome(state: Dictionary, player_id: String = "player") -> String:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null or not SimEntity.is_alive(found):
		return "dead"
	var pos: Dictionary = (found as Dictionary)["pos"]
	if SimGrid.tile_at(state["grid"], int(pos["x"]), int(pos["y"])) != SimGrid.EXIT:
		return "playing"
	if int(state["depth"]) >= SimTables.BOTTOM_DEPTH:
		return "won" if heart_held(state, player_id) else "playing"
	return "escaped"


## Puts a rule into play.
##
## The cap is enforced here rather than at validation because it is a property
## of a *world*, not of a rule: the same rule may be perfectly ratifiable in a
## fork that has room for it. Refusing rather than returning a rejection is
## deliberate — by this point the player has already said yes, so a full ruleset
## is a bug in whatever offered the choice, not a routine outcome. (The
## reference throws; see create_world's note on the assert/push_error pair.)
static func ratify_rule(state: Dictionary, rule: Dictionary) -> Dictionary:
	if (state["rules"] as Array).size() >= SimRule.MAX_RULES:
		var msg := "ratify: this world already holds the limit of %d rules" % SimRule.MAX_RULES
		push_error(msg)
		assert(false, msg)
		return {}
	# Rules never consume randomness. See the interpreter for why that is a
	# load-bearing guarantee rather than an accident.
	return SimEvents.draft("RULE_RATIFIED", int(state["rngCounter"]), 0, {"rule": rule})


## Writes where this world's dead lie on the floor a run is entering. Appended
## by the rebirth and descent ceremonies (identity, then the dead, then law),
## never by generation — the bodies are the graveyard's fact, not the floor's.
## Draws nothing: the dead are where they fell, not where dice put them.
static func record_bodies(state: Dictionary, bodies: Array) -> Dictionary:
	var laid: Array = []
	for b: Dictionary in bodies:
		laid.append({"x": int(b["x"]), "y": int(b["y"])})
	return SimEvents.draft("WORLD_BODIES", int(state["rngCounter"]), 0, {"bodies": laid})


## Writes the world's identity into its history. The caller has already
## validated the bible — by this point a malformed one is a bug in whoever
## offered it, same contract as ratify_rule. Draws nothing: identity is chosen,
## not rolled.
static func found_world(state: Dictionary, bible: Dictionary) -> Dictionary:
	return SimEvents.draft("WORLD_BIBLE", int(state["rngCounter"]), 0, {"bible": bible})
