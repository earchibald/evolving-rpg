class_name SimTables
## THE TABLES — the byte-twin of src/core/tables.ts (1,077 lines).
##
## Every number a designer would tune, in one file, each with its unit and its
## reason. This is where the game's balance lives: threatOf's per-verb
## multipliers are load-bearing — when creature verbs were left unpriced,
## depth-5 survival collapsed from a pinned 1-in-10 band to 0 in 20 trials.
## Ported in full: every export of the reference, not only the ones the four
## named test suites (tables/leveling/size/motifs) exercise directly, because
## later waves (loot, scrolls, traps, pockets, mapgen) need ARMORY, SCROLLS,
## TRAP_KINDS, PROVISIONS and MOTIFS already sitting here.
##
## Two deliberate departures from a literal reading of this task's interface
## sketch, both measured against the fixture and the reference, not guessed:
##
## 1. `bounty_stretch` returns float, not int. tables.json's own rows carry
##    1.5 and 2.5 for it — (stretch+1)/2 is genuinely fractional on an even
##    stretch — and GDScript cannot return a fraction from a function typed
##    `-> int`. See FixtureLoader's own docstring: "tables.json genuinely
##    contains nine fractional numbers... rounding them would hide the
##    integer-division bug class their rows exist to catch."
## 2. `threat_of`'s optional `kind` is a default `""`, not a null sentinel
##    (GDScript can default a String param to "" but not to a typed null).
##    This needs no special-casing inside the function: `archetype_of("")`
##    has no '-' so returns "", `_VERBS` has no "" key, so `verb_of("")` is
##    null exactly like `verb_of("gremlin")` is — an omitted kind and an
##    unmapped kind price identically, which is also the fact the fixture's
##    three-way threatOf dump (priced / unpriced / unmapped) exists to pin.
##
## The ABSENT-KEY LAW applies one level into these tables too, even though it
## is stated for Entity/Blow/GameState: BESTIARY's `fromDepth`, ARMORY's
## `costs`, PROVISIONS/SCROLLS' `fromDepth`, TRAP_KINDS' `maxDepth` are all
## `?`-marked in the reference and are OMITTED keys here on the archetypes
## that lack them — never present with value null. BESTIARY is checked for
## exactly this by the fixture sweep's canonical-encode comparison; the rest
## follow the same law on the strength of that same measurement.


## ── the d20 ─────────────────────────────────────────────────────────────

## Natural roll that always lands, and doubles the damage.
const CRIT := 20

## Wits' job: a keen mind widens the opening. The crit threshold drops one
## step per four points of wits, floored — so crits stay rare for everyone
## and merely less rare for the sharp.
const CRIT_FLOOR_LIMIT := 18

static func crit_floor(wits: int) -> int:
	return maxi(CRIT_FLOOR_LIMIT, CRIT - (maxi(0, wits) / 4))


## Natural roll that always misses, whatever the numbers say.
const WHIFF := 1

## The bounded-accuracy band for the number a d20 must meet. Needed 4 is 85%,
## needed 17 is 20%, and nothing outside that band can exist.
const NEEDED_FLOOR := 4
const NEEDED_CEILING := 17

## The number the attacker's d20 must meet or beat: 10 + speed − might,
## clamped to the band.
static func needed_to_hit(attacker_might: int, target_speed: int) -> int:
	var raw: int = 10 + target_speed - attacker_might
	return clampi(raw, NEEDED_FLOOR, NEEDED_CEILING)


## Chance in twentieths that a blow lands, crit and whiff included: the
## nat-20 always hits and the nat-1 always misses, so the band is [1..19].
static func chance_in_20(needed: int) -> int:
	return clampi(21 - needed, 1, 19)


## ── damage ──────────────────────────────────────────────────────────────

## Damage by might band: roll 1..die, add flat. Not exported in the
## reference either — damageDice's own private lookup table.
const _DAMAGE_BANDS: Array = [
	{"floor": 1, "die": 2, "flat": 0},   # might 1-2:  1d2      (1-2)
	{"floor": 3, "die": 3, "flat": 1},   # might 3-4:  1d3+1    (2-4)
	{"floor": 5, "die": 4, "flat": 2},   # might 5-6:  1d4+2    (3-6)
	{"floor": 7, "die": 6, "flat": 3},   # might 7-8:  1d6+3    (4-9)
	{"floor": 9, "die": 8, "flat": 4},   # might 9+:   1d8+4    (5-12)
]

## Returns a fresh {"die": int, "flat": int} — never the internal band
## Dictionary itself, which also carries a "floor" key the reference's
## DamageDice shape does not have.
static func damage_dice(might: int) -> Dictionary:
	var chosen: Dictionary = _DAMAGE_BANDS[0]
	for band: Dictionary in _DAMAGE_BANDS:
		if might >= band["floor"]:
			chosen = band
	return {"die": chosen["die"], "flat": chosen["flat"]}


static func mean_damage(might: int) -> float:
	var d: Dictionary = damage_dice(might)
	return (float(d["die"]) + 1.0) / 2.0 + float(d["flat"])


## ── experience ──────────────────────────────────────────────────────────

## XP needed to *reach* each level. Level 1 is birth.
const XP_TO_REACH: Array[int] = [0, 0, 16, 40, 72, 112, 160, 224, 304, 400]

## The XP that reaches a level, on this board — the ONE place the ladder
## wears the stretch. Null past the table's end (level < 0 or >= the
## ladder's length reproduces XP_TO_REACH[level] being `undefined` in JS,
## including for a negative index, which is not an error there).
static func xp_to_reach(level: int, stretch: int = 1) -> Variant:
	if level < 0 or level >= XP_TO_REACH.size():
		return null
	var raw: int = XP_TO_REACH[level]
	return roundi(float(raw) * bounty_stretch(stretch))


static func level_for_xp(xp: int, stretch: int = 1) -> int:
	var level: int = 1
	var l: int = XP_TO_REACH.size() - 1
	while l >= 1:
		var threshold: Variant = xp_to_reach(l, stretch)
		if threshold != null and xp >= int(threshold):
			level = l
			break
		l -= 1
	return level


## What one level-up grants, by the level being *reached*. Might and speed
## alternate so neither runs away; wits every third level.
static func growth_at(level: int) -> Dictionary:
	return {
		"hp": 2,
		"might": 1 if level % 2 == 0 else 0,
		"wits": 1 if level % 3 == 0 else 0,
		"speed": 1 if level % 2 == 1 else 0,
	}


## ── the bestiary ────────────────────────────────────────────────────────

## Mechanical archetypes. Growth is per depth-level of the creature, not of
## the floor it appears on. `fromDepth` is OMITTED (not null) on the five
## archetypes with no depth gate — the absent-key law, one level in; see the
## class docstring. Verified byte-for-byte against the fixture's own dump by
## test_the_bestiary_is_the_reference_bestiary.
const BESTIARY: Array = [
	{"kind": "skirmisher", "base": {"hp": 4, "might": 2, "wits": 1, "speed": 3}, "growth": {"hp": 2, "might": 1, "wits": 0, "speed": 1}, "weight": 3},
	{"kind": "bruiser", "base": {"hp": 7, "might": 4, "wits": 1, "speed": 1}, "growth": {"hp": 3, "might": 1, "wits": 0, "speed": 0}, "weight": 2},
	{"kind": "stalker", "base": {"hp": 3, "might": 3, "wits": 2, "speed": 4}, "growth": {"hp": 1, "might": 1, "wits": 1, "speed": 1}, "weight": 2},
	# The stinger: weak blows that keep costing after the fight breaks off.
	{"kind": "stinger", "base": {"hp": 3, "might": 2, "wits": 2, "speed": 3}, "growth": {"hp": 1, "might": 1, "wits": 1, "speed": 1}, "weight": 2, "fromDepth": 2},
	# The caller: frail and loud. It makes the floor fight you.
	{"kind": "caller", "base": {"hp": 3, "might": 1, "wits": 3, "speed": 2}, "growth": {"hp": 2, "might": 0, "wits": 1, "speed": 0}, "weight": 1, "fromDepth": 3},
	# The slinger: the fight starts before you arrive. Never on the teaching floor.
	{"kind": "slinger", "base": {"hp": 3, "might": 2, "wits": 2, "speed": 2}, "growth": {"hp": 1, "might": 1, "wits": 1, "speed": 0}, "weight": 2, "fromDepth": 2},
	{"kind": "warden", "base": {"hp": 16, "might": 5, "wits": 2, "speed": 2}, "growth": {"hp": 6, "might": 1, "wits": 1, "speed": 0}, "weight": 0},
	# The mimic: weight 0 like the warden — never spawns from the random pool.
	{"kind": "mimic", "base": {"hp": 6, "might": 4, "wits": 1, "speed": 2}, "growth": {"hp": 2, "might": 1, "wits": 0, "speed": 0}, "weight": 0},
]


static func archetype(kind: String) -> Variant:
	for a: Dictionary in BESTIARY:
		if a["kind"] == kind:
			return a
	return null


## A creature's stats at a given level of itself. Level 1 is the base.
static func creature_stats(kind: String, level: int) -> Variant:
	var arch: Variant = archetype(kind)
	if arch == null:
		return null
	var a: Dictionary = arch
	var base: Dictionary = a["base"]
	var growth: Dictionary = a["growth"]
	var l: int = maxi(1, level) - 1
	return {
		"hp": base["hp"] + growth["hp"] * l,
		"might": base["might"] + growth["might"] * l,
		"wits": base["wits"] + growth["wits"] * l,
		"speed": base["speed"] + growth["speed"] * l,
	}


## ── the verbs ───────────────────────────────────────────────────────────

## What a kind DOES, beyond hitting back. Not exported in the reference
## either (archetypeOf/verbOf are the public surface onto it).
const _VERBS: Dictionary = {
	"bruiser": "trample",
	"skirmisher": "lunge",
	"stalker": "ambush",
	"warden": "vigil",
	"stinger": "venom",
	"caller": "call",
	"slinger": "volley",
	# The mimic's art is stillness: hidden it does nothing at all.
	"mimic": "feign",
}

## The archetype under a levelled kind: "bruiser-2" is a bruiser. Verbs,
## names and every other fact about a KIND belong to this, never the level
## suffix.
static func archetype_of(kind: String) -> String:
	var dash: int = kind.find("-")
	return kind if dash == -1 else kind.substr(0, dash)


## The verb a kind acts by, or null. "" (threat_of's unset-kind default)
## resolves here too: archetype_of("") == "" and _VERBS has no "" key, so
## verb_of("") is null exactly like an unmapped kind is.
static func verb_of(kind: String) -> Variant:
	var a: String = archetype_of(kind)
	return _VERBS[a] if _VERBS.has(a) else null


## How close (steps of walking) something must come before a coiled stalker springs.
const LURK_RANGE := 3
## The ambush blow lands one damage band harder. Capped at one band on purpose.
const AMBUSH_MIGHT_BONUS := 2
## No ambushes on the teaching floor.
const AMBUSH_FROM_DEPTH := 2
## How long a venomed wound burns, in rounds, and what each round costs.
const VENOM_TURNS := 3
const VENOM_HARM := 1
## How close prey must come before a caller cries out, and how far from the
## prey the answered things rise.
const CALL_RANGE := 6
const CALL_RISERS := 2
const CALL_DISTANCE := 6
## How far a loosed shot reaches, as the sight disc counts.
const SHOT_RANGE := 5


## ── the player's verbs ─────────────────────────────────────────────────

## The brace: braced, you are harder to hit by 2 + wits/2.
static func brace_wall(wits: int) -> int:
	return 2 + (maxi(0, wits) / 2)


## What a body driven into a wall takes.
const SLAM_DAMAGE := 1
## How far a warden will be drawn from its post before it turns back.
const VIGIL_LEASH := 5
## How far a posted guard will be drawn from its post.
const GUARD_LEASH := 4
## The shallowest floor that wanders.
const WANDER_FROM_DEPTH := 2
## The mimic's rarity: 1 floor in this many, from MIMIC_FROM_DEPTH down.
const MIMIC_IN := 6
const MIMIC_FROM_DEPTH := 2

## What a mimic may pretend to be: any kind the floor's own tables could
## honestly have put there.
static func mimic_guises(depth: int) -> Array:
	var out: Array = []
	for p: Dictionary in provisions_at(depth):
		out.append(p["kind"])
	for r: Dictionary in ARMORY:
		out.append(r["kind"])
	return out


## A wanderer's round: how many waypoints, drawn between these bounds.
const ROUTE_STOPS: Array[int] = [2, 4]


## ── threat and the spawn budget ────────────────────────────────────────

## What a verb is worth, as a multiplier on the stat threat. Load-bearing:
## with verbs unpriced, depth-5 brawler survival collapsed from the pinned
## [1,10]/20 to 0/20 in measurement, so the budget must pay for them or
## every deep floor overdraws.
const VERB_THREAT: Dictionary = {
	"trample": 1.1,
	"lunge": 1.25,
	"ambush": 1.25,
	"vigil": 1.0,
	"venom": 1.2,
	"call": 1.3,
	"volley": 1.25,
	# Priced though it never spends floor budget (the mimic roll is
	# separate) because threat is also the XP a kill pays.
	"feign": 1.3,
}

## One number for "how much creature is this": offence (mean damage scaled
## by land rate against the *starting* player) plus defence (hp weighted
## below offence), priced by the kind's verb when one is passed. Also the
## XP a kill pays — spawning and XP must use the same number or the
## risk/reward symmetry breaks. `kind` omitted (default "") prices exactly
## like an unmapped kind: see the class docstring.
static func threat_of(stats: Dictionary, kind: String = "") -> int:
	var land_rate: float = float(chance_in_20(needed_to_hit(stats["might"], 4))) / 20.0
	var offence: float = mean_damage(stats["might"]) * land_rate * 10.0
	var defence: float = float(stats["hp"]) * 0.6 + float(stats["speed"]) * 0.4
	var verb: Variant = verb_of(kind)
	var mult: float = 1.0 if verb == null else VERB_THREAT[verb]
	return roundi((offence + defence) * mult)


## ── board size ──────────────────────────────────────────────────────────

## The one integer the board's size turns: max(1, round(sqrt(area / 1536))).
## 1536 is the vale (48x32); the expanse (96x64) reads 2, the waste
## (128x96) reads 3, and every tiny test board reads 1.
static func size_stretch(width: int, height: int) -> int:
	return maxi(1, roundi(sqrt(float(width * height) / 1536.0)))


## The board chokepoint. Above this an accidental dimension allocates a
## country, not a floor.
const MAX_BOARD_DIM := 256

## The combat economy's gentler knob: (stretch + 1) / 2 — 1 on the vale, 1.5
## on the expanse, 2 on the waste. Genuinely fractional (see class
## docstring for why this returns float, not the int the interface sketch
## suggested).
static func bounty_stretch(stretch: int) -> float:
	return float(maxi(1, stretch) + 1) / 2.0


## The spawn budget a floor may spend on creatures. The teaching floor (d=1)
## is the one exception: it pays the FULL stretch, not the bounty, so the
## door fields more bodies on a bigger board rather than pricier ones.
static func spawn_budget(depth: int, stretch: int = 1) -> int:
	var d: int = maxi(1, depth)
	var deep: int = maxi(0, d - 2)
	var factor: float = float(maxi(1, stretch)) if d == 1 else bounty_stretch(stretch)
	return roundi(float(24 + 15 * d + 4 * deep * deep) * factor)


## The stretched teaching floor spends its full-stretch budget on kinds
## priced at or under this (level-1 threat).
const DOOR_PRICE_CAP := 15

## Out-of-depth overlap: which creature-levels a floor may draw, with
## weights. Mostly your depth, sometimes one shallower, rarely one deeper.
## Not one of the fixture's 23 functions — no dumped rows exist for it.
static func depth_bands(depth: int) -> Array:
	var d: int = maxi(1, depth)
	var bands: Array = [{"level": d, "weight": 6}]
	if d > 1:
		bands.append({"level": d - 1, "weight": 3})
		bands.append({"level": d + 1, "weight": 1})
	return bands


## Every third floor, the stairs are guarded. Not fixture-backed (a boolean,
## not one of the 23 numeric functions).
static func warden_at(depth: int) -> bool:
	return depth >= 3 and depth % 3 == 0


## How grown the warden arrives: level 1 through depth 3, then tracking the
## floor (depth - 2).
static func warden_level(depth: int) -> int:
	var d: int = maxi(1, depth)
	return 1 if d <= 3 else d - 2


## ── depth motifs ────────────────────────────────────────────────────────

## How a depth band shapes its floors. Base cuts only: the deep is depth's
## business, expressed by wrapping one of these, not a fourth name — see
## motif_at. SimRule.MOTIF_NAMES pins the vocabulary token list to this
## Dictionary's own keys (test_pins_the_rule_tokens_to_the_tables).
const MOTIFS: Dictionary = {
	# The teaching floors: exactly the shape the game launched with.
	"door": {"key": "door", "name": "the door", "tilesPerRoom": 110, "roomW": [4, 8], "roomH": [3, 6], "loopPer": 4, "secretIn": 4},
	# Dense, tight, loopy — Brogue's chase topology.
	"warren": {"key": "warren", "name": "the warren", "tilesPerRoom": 90, "roomW": [3, 6], "roomH": [3, 4], "loopPer": 3, "secretIn": 3},
	# Big sparse chambers — the keeper's arena.
	"halls": {"key": "halls", "name": "the halls", "tilesPerRoom": 150, "roomW": [6, 12], "roomH": [4, 7], "loopPer": 6, "secretIn": 3},
}

## The motif a floor is cut to. Bands 1-6 are fixed; the deep (7+) draws
## warren or halls per floor (a counted draw) and keeps more secrets.
## Consumes SimRng directly (already ported) — the one function in this file
## that draws.
static func motif_at(seed: int, counter: int, depth: int) -> Dictionary:
	var d: int = maxi(1, depth)
	if d <= 2:
		return {"motif": MOTIFS["door"], "counterAfter": counter}
	if d <= 4:
		return {"motif": MOTIFS["warren"], "counterAfter": counter}
	if d <= 6:
		return {"motif": MOTIFS["halls"], "counterAfter": counter}
	var base: Dictionary = MOTIFS["warren"] if SimRng.int_between(seed, counter, 0, 1) == 0 else MOTIFS["halls"]
	var deep_motif: Dictionary = {
		"key": base["key"],
		"name": "the deep %s" % (base["name"] as String).substr(4),
		"tilesPerRoom": base["tilesPerRoom"],
		"roomW": base["roomW"],
		"roomH": base["roomH"],
		"loopPer": base["loopPer"],
		"secretIn": 2,
	}
	deep_motif.make_read_only()
	return {"motif": deep_motif, "counterAfter": counter + 1}


## How far sight reaches, by depth. The deep closes in; it never goes fully
## black, because the fog is already the tax.
static func sight_at(depth: int) -> int:
	var d: int = maxi(1, depth)
	if d <= 2:
		return 9
	if d <= 6:
		return 8
	return 7


## ── the armory ──────────────────────────────────────────────────────────

## What a floor may leave lying on the ground, guarded. `costs` is OMITTED
## (not null) on every relic but 'heavy edge' — the absent-key law, one
## level in.
const ARMORY: Array = [
	{"kind": "keen edge", "grants": "might", "base": 2, "per": 3, "weight": 3},
	{"kind": "iron charm", "grants": "hp", "base": 3, "per": 1, "weight": 3},
	{"kind": "fleet boots", "grants": "speed", "base": 1, "per": 3, "weight": 2},
	{"kind": "grey lens", "grants": "wits", "base": 1, "per": 2, "weight": 2},
	# The iconic tradeoff, singular on purpose.
	{"kind": "heavy edge", "grants": "might", "base": 3, "per": 2, "weight": 2, "costs": {"stat": "speed", "amount": 1}},
	# The named properties: one rule-bending trait each.
	{"kind": "sure edge", "grants": "might", "base": 2, "per": 4, "weight": 1},
	{"kind": "steady boots", "grants": "speed", "base": 1, "per": 4, "weight": 1},
	# The distance weapon. Its real grant is the 'ranged' trait (M8).
	{"kind": "leaden sling", "grants": "might", "base": 1, "per": 3, "weight": 2},
]

## The rule a named relic bends, by kind. Read at the moments the rule
## matters — never stored on the entity, so replay derives it identically
## forever.
const RELIC_TRAITS: Dictionary = {
	"sure edge": "stagger-crit",
	"steady boots": "hold-ground",
	"leaden sling": "ranged",
}

## Whether an entity's worn gear carries a trait. `gear` is null (never
## constructed) when the entity wears nothing at all; an unworn SLOT inside
## a present gear Dictionary is an absent key, not a null value one level
## in — see the ABSENT-KEY LAW's note on Entity.gear.
static func wears_trait(gear: Variant, relic_trait: String) -> bool:
	if gear == null:
		return false
	var g: Dictionary = gear
	for slot: String in g:
		var item: Variant = g[slot]
		if item != null and RELIC_TRAITS.get((item as Dictionary)["kind"], null) == relic_trait:
			return true
	return false


## Strict upgrade: at least as good on every axis and better in total. This
## is what walking may take unasked; anything less waits for a decision.
static func dominates(a: Dictionary, b: Dictionary) -> bool:
	return a["hp"] >= b["hp"] and a["might"] >= b["might"] and a["wits"] >= b["wits"] and a["speed"] >= b["speed"] \
		and grant_value(a) > grant_value(b)


## Which slot a relic occupies, by the stat it grants. One slot, one item.
const SLOTS: Array[String] = ["weapon", "sling", "armor", "boots", "trinket"]

static func slot_of(grants: Dictionary) -> String:
	if grants["might"] >= maxi(grants["hp"], maxi(grants["speed"], grants["wits"])):
		return "weapon"
	if grants["hp"] >= maxi(grants["speed"], grants["wits"]):
		return "armor"
	if grants["speed"] >= grants["wits"]:
		return "boots"
	return "trinket"


## Where a relic goes, KNOWING what it is: the trait routes first (a ranged
## relic lives in the sling hand — dual wield), the grants route the rest.
static func slot_for(kind: String, grants: Dictionary) -> String:
	if RELIC_TRAITS.get(kind, null) == "ranged":
		return "sling"
	return slot_of(grants)


## One number for "how much item": what replacement compares.
static func grant_value(grants: Dictionary) -> int:
	return grants["hp"] + grants["might"] + grants["wits"] + grants["speed"]


## The grant a relic gives at a depth. Never zero. A costed relic's price
## rides in the same Stats shape, negative.
static func relic_grant(relic: Dictionary, depth: int) -> Dictionary:
	var d: int = maxi(1, depth)
	var amount: int = relic["base"] + (d - 1) / int(relic["per"])
	var costs: Variant = relic.get("costs", null)
	var result: Dictionary = {}
	for stat: String in ["hp", "might", "wits", "speed"]:
		var worth: int = amount if relic["grants"] == stat else 0
		if costs != null and (costs as Dictionary)["stat"] == stat:
			worth -= (costs as Dictionary)["amount"]
		result[stat] = worth
	return result


## ── the satchel ─────────────────────────────────────────────────────────

## What the satchel may carry: one thing, used once, chosen over and over.
## `fromDepth` is OMITTED (not null, and reads as 1 via provisions_at) on
## the teaching trio.
const PROVISIONS: Array = [
	{"kind": "vital draught", "weight": 3},
	{"kind": "still smoke", "weight": 2},
	# The information tool: break it and light reaches FLARE_RADIUS paces.
	{"kind": "tallow flare", "weight": 2},
	# The ward: the NEXT blow that lands on you is drunk whole, then spent.
	{"kind": "ash ward", "weight": 2, "fromDepth": 2},
	# The burr: cast at your feet, every hostile beside you staggers.
	{"kind": "iron burr", "weight": 2, "fromDepth": 3},
	# The bell: rings once and the way out answers.
	{"kind": "hollow bell", "weight": 1, "fromDepth": 2},
]

## The kinds a floor of this depth may hold — the pantry gate.
static func provisions_at(depth: int) -> Array:
	var out: Array = []
	for p: Dictionary in PROVISIONS:
		var from_depth: int = p.get("fromDepth", 1)
		if from_depth <= depth:
			out.append(p)
	return out


static func provision_of(kind: String) -> Variant:
	for p: Dictionary in PROVISIONS:
		if p["kind"] == kind:
			return p
	return null


## How far the flare's knowledge reaches, in tiles.
const FLARE_RADIUS := 7
## What a relic or a scroll fetches at a counter, in gold.
const LOOT_VALUE := 2
## What a consumable fetches. Strictly less than a relic.
const PROVISION_VALUE := 1

## What a kind is worth in gold (M9). An unknown kind is worth nothing
## rather than throwing.
static func value_of(kind: String) -> int:
	for r: Dictionary in ARMORY:
		if r["kind"] == kind:
			return LOOT_VALUE
	for s: Dictionary in SCROLLS:
		if s["kind"] == kind:
			return LOOT_VALUE
	for p: Dictionary in PROVISIONS:
		if p["kind"] == kind:
			return PROVISION_VALUE
	return 0


## The draught's permanent raise to the health ceiling, by depth band.
static func draught_ceiling(depth: int) -> int:
	var d: int = maxi(1, depth)
	if d <= 3:
		return 2
	if d <= 6:
		return 3
	return 4


## How many turns the smoke holds. Deeper floors buy longer.
static func smoke_turns(depth: int) -> int:
	var d: int = maxi(1, depth)
	if d <= 3:
		return 6
	if d <= 6:
		return 8
	return 10


## When the archetypal players reach for the satchel (play/policies.ts) —
## fixed thresholds, deliberately dumb.
const BOT_QUAFF_BELOW := 0.35
const BOT_SMOKE_WITHIN := 3


## ── pockets ─────────────────────────────────────────────────────────────

## Roughly one creature in this many is born carrying.
const POCKET_IN := 3

## What a pocket holds, by weight: mostly a provision, sometimes a scroll,
## rarely a relic (~70/25/5).
const POCKET_SHARES: Dictionary = {"provision": 14, "scroll": 5, "relic": 1}


## ── scrolls ─────────────────────────────────────────────────────────────

## The scrolls: one carried at a time, read with r, spent by the reading.
const SCROLLS: Array = [
	# Knowledge whole: every secret door and every trap on the floor.
	{"kind": "scroll of unveiling", "weight": 3, "fromDepth": 2},
	# Time: every hostile on the floor spends its next action reeling.
	{"kind": "scroll of the still hour", "weight": 2, "fromDepth": 2},
	# The counter-trap: eats every trap within reach of walking.
	{"kind": "scroll of the trap eater", "weight": 2, "fromDepth": 3},
	# Position: a drawn tile clear of every hostile swallows you.
	{"kind": "scroll of the blink step", "weight": 2, "fromDepth": 3},
	# The walls within reach sing to dust — wall becomes floor.
	{"kind": "scroll of stone song", "weight": 1, "fromDepth": 4},
]

static func scroll_of(kind: String) -> Variant:
	for s: Dictionary in SCROLLS:
		if s["kind"] == kind:
			return s
	return null


## The kinds a floor of this depth may hold.
static func scrolls_at(depth: int) -> Array:
	var out: Array = []
	for s: Dictionary in SCROLLS:
		var from_depth: int = s.get("fromDepth", 1)
		if from_depth <= depth:
			out.append(s)
	return out


## How often a floor lays a scroll: 1 in this, from depth 2.
const SCROLL_IN := 3
## The blink's clearance: steps of walking from every living hostile.
const BLINK_CLEAR := 4
## Stone song's reach, in tiles around the reader.
const SUNDER_RADIUS := 2
## The trap eater's reach, in steps of walking.
const TRAP_EATER_REACH := 3


## ── traps ───────────────────────────────────────────────────────────────

## The trap table. `dodge` is the kind's law: "always" rolls speed, "never"
## is by design, and an int is the player level that first earns the roll.
## `maxDepth` is OMITTED (not null) on every kind but "the maw" — the
## absent-key law, one level in.
const TRAP_KINDS: Array = [
	# Blood, plainly: 1d4 + floor(depth/2), dodgeable outright.
	{"kind": "spike pit", "fromDepth": 2, "weight": 3, "dodge": "always"},
	# The stinger's wound without the stinger — dodgeable at player level 3.
	{"kind": "venom needle", "fromDepth": 2, "weight": 2, "dodge": 3},
	# Tempo: rooted for a few rounds.
	{"kind": "strangling snare", "fromDepth": 2, "weight": 2, "dodge": "always"},
	# Noise: the floor knows you. Undodgeable by design — it already rang.
	{"kind": "alarm bell", "fromDepth": 3, "weight": 2, "dodge": "never"},
	# Bodies: one riser, drawn from the floor's own band.
	{"kind": "hatch", "fromDepth": 3, "weight": 2, "dodge": "never"},
	{"kind": "nest hatch", "fromDepth": 5, "weight": 1, "dodge": "never"},
	# Gravity: the floor gives way. You cannot dodge the floor.
	{"kind": "the maw", "fromDepth": 4, "maxDepth": 8, "weight": 1, "dodge": "never"},
	# Distance: a drawn far tile swallows you.
	{"kind": "lodestone", "fromDepth": 4, "weight": 1, "dodge": "never"},
]

static func trap_of(kind: String) -> Variant:
	for t: Dictionary in TRAP_KINDS:
		if t["kind"] == kind:
			return t
	return null


## The kinds a floor of this depth may hold.
static func trap_kinds_at(depth: int) -> Array:
	var out: Array = []
	for t: Dictionary in TRAP_KINDS:
		var max_depth: Variant = t.get("maxDepth", null)
		if t["fromDepth"] <= depth and (max_depth == null or depth <= int(max_depth)):
			out.append(t)
	return out


## How many traps a floor lays: none on the teaching floor, then a band by
## depth, stretched with the board.
static func trap_count(depth: int, stretch: int = 1) -> int:
	var d: int = maxi(1, depth)
	if d <= 1:
		return 0
	var base: int = 2 if d <= 3 else (3 if d <= 6 else 4)
	return base * maxi(1, stretch)


## A trap's level: what the wits and speed rolls are up against.
static func trap_level_at(depth: int) -> int:
	return mini(3, ceili(float(maxi(1, depth)) / 3.0))


## The three rolls, one shape: d20 + stat >= need + 2*level.
const TRAP_SIGHT_NEED := 14
const TRAP_NEAR_NEED := 11
const TRAP_DODGE_NEED := 12
## How close (steps of walking) "very near" is.
const TRAP_NEAR_RADIUS := 2

## What the kinds do, in numbers.
const SPIKE_DIE := 4
const NEEDLE_VENOM_TURNS := 4
const SNARE_TURNS := 3
const ALARM_TURNS := 12

## How long the bell rings, on the board it rings on — stretched so one body
## still arrives per bell on a bigger board.
static func alarm_turns(stretch: int = 1) -> int:
	return ALARM_TURNS * maxi(1, stretch)

const MAW_DIE := 6
const MAW_FLAT := 2
## Where a hatch's risers stand up: steps of walking from the trap, inside
## this band — never beside you, always a chase.
const HATCH_BAND: Array[int] = [3, 5]


## ── the bottom ──────────────────────────────────────────────────────────

## Nine floors: wardens stand at 3, 6 and 9, so the bottom is the third peak.
const BOTTOM_DEPTH := 9

## The one thing the ninth floor keeps. Named per world; article-free like
## every kind.
const HEART_KIND := "heart"

## How often the seized world stirs, and how far from the carrier a stirred
## thing rises.
const WAVE_EVERY := 8
const WAVE_DISTANCE := 8
