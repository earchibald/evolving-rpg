class_name SimItem
## A thing lying on the floor — the byte-twin of src/core/item.ts.
##
## Not an entity: it has no hit points, takes no turns, and blocks nothing.
## An item is exactly the Dictionary {"id": String, "kind": String,
## "pos": Pos, "grants": Stats}. "grants" is a full stat block rather than
## `?`-marked fields, so there is never a question of what an absent key
## meant — contrast SimEntity's nine optional keys.

const NOTHING := {"hp": 0, "might": 0, "wits": 0, "speed": 0}


## Applies an item's grants to a stat block, stat-wise, into a freshly built
## Dictionary — "stats" and "grants" are only ever read, never written
## through.
##
## Deliberately NOT clamped at zero. The armory's heavy edge is a tradeoff
## relic: it grants might but costs speed, so its own "grants" carries a
## negative speed (src/core/tables.ts's ARMORY, `costs: {stat: 'speed', ...}`;
## see tests/core/dual-wield.test.ts's `grants: {..., speed: -1}` for a
## concrete instance). Clamping the sum here would silently erase that cost
## and buff every wearer — and since granted stats feed straight into
## recorded combat, that would fork the event chain, not just look nicer.
static func granted(stats: Dictionary, grants: Dictionary) -> Dictionary:
	return {
		"hp": stats["hp"] + grants["hp"],
		"might": stats["might"] + grants["might"],
		"wits": stats["wits"] + grants["wits"],
		"speed": stats["speed"] + grants["speed"],
	}


## The first item lying at (x, y), or null when none does. "First" matters:
## nothing stops two items sharing a tile, and replay must agree with the
## reference's Array.prototype.find on which one wins — the earliest in
## array order, not e.g. the last.
static func at(items: Array, x: int, y: int) -> Variant:
	for item: Dictionary in items:
		var pos: Dictionary = item["pos"]
		if pos["x"] == x and pos["y"] == y:
			return item
	return null
