extends GutTest
## The slinger's mind — the byte-twin of tests/core/volley-mind.test.ts. One
## test per TS `it(...)`, in the TS file's order, so the two suites can be
## diffed by eye.
##
## The slinger's ladder: club when reached, draw when it sees you, loose when
## drawn, hunt when the line refuses. Never a step backward.
##
## ── Reconciliation ────────────────────────────────────────────────────────
## The reference file holds 5 cases in one describe block.
## 5 = 5 PORTED + 0 DEFERRED. Line numbers are tests/core/volley-mind.test.ts
## at ts-baseline.
##
## describe('the slinger's mind') — 5
##   :39  clubs what stands beside it — the sling wants ground the bump owns
##   :47  draws when it sees you in reach, and looses once drawn
##   :60  hunts when a wall breaks the line — and the hunt is a step, never a
##        retreat
##   :75  walks a smoked floor's stale trail rather than drawing on what it
##        cannot see
##   :85  spends a stagger reeling like everything else
##
## ── What this file is the only witness for ────────────────────────────────
## test_ai.gd's header records that `decide()` has ten branches and that
## ai.test.ts drives only the plain hunt, leaving EIGHT with no witness
## anywhere in the migration — and the golden run never calls `decide()` at
## all, so no chain fixture reaches them either. This file discharges the
## VOLLEY branch (ai.gd:355-360, both arms: undrawn draws, drawn shoots) and
## the SMOKE branch's interaction with it (ai.gd:247-254, :342 — a fooled
## hunter may not draw on what it has lost). Task 2.E3d's other two —
## `call` and `feign` — are witnessed in test_new_verbs.gd and
## test_player_verbs.gd respectively.


const _SEED := 5

var _seq := 0


## The reference's world(seeds, rows?): seeds[0] is the player, the rest are
## opponents. `rows` paints the floor with '#' for wall; absent means an open
## 8x1 corridor.
func _world(seeds: Array, rows: Array = []) -> Dictionary:
	var width: int = str(rows[0]).length() if not rows.is_empty() else 8
	var height: int = rows.size() if not rows.is_empty() else 1
	var tiles: Array = []
	if rows.is_empty():
		for i in range(width * height):
			tiles.append(SimGrid.FLOOR)
	else:
		for row: String in rows:
			for i in range(row.length()):
				tiles.append(SimGrid.WALL if row[i] == "#" else SimGrid.FLOOR)

	var player: Dictionary = seeds[0]
	var opponents: Array = []
	for i in range(1, seeds.size()):
		var o: Dictionary = seeds[i]
		opponents.append({
			"id": o["id"], "kind": o["kind"], "pos": {"x": int(o["x"]), "y": int(o["y"])},
			"stats": {"hp": int(o["hp"]) if o.has("hp") else 3, "might": 2, "wits": 2, "speed": 2},
			"tags": o["tags"] if o.has("tags") else [],
		})

	_seq += 1
	var event: Dictionary = SimEvents.draft("WORLD_INIT", 0, 0, {
		"width": width, "height": height, "tiles": tiles, "seed": _SEED, "items": [],
		"player": {
			"id": player["id"], "kind": player["kind"],
			"pos": {"x": int(player["x"]), "y": int(player["y"])},
			"stats": {
				"hp": int(player["hp"]) if player.has("hp") else 10,
				"might": 3, "wits": 3, "speed": 4,
			},
			"tags": player["tags"] if player.has("tags") else [],
		},
		"opponents": opponents,
	})
	event["id"] = "w%d" % _seq
	event["parent"] = null
	event["seq"] = 0
	return SimApply.apply(SimState.empty(), event)


func test_clubs_what_stands_beside_it_the_sling_wants_ground_the_bump_owns() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 1, "y": 0},
	])
	assert_eq(SimAi.decide(s, "foe-1"), {"kind": "strike", "targetId": "player"})


func test_draws_when_it_sees_you_in_reach_and_looses_once_drawn() -> void:
	var cold: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 3, "y": 0},
	])
	assert_eq(SimAi.decide(cold, "foe-1"), {"kind": "draw"})
	var held: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 3, "y": 0, "tags": ["drawn"]},
	])
	assert_eq(SimAi.decide(held, "foe-1"), {"kind": "shoot", "targetId": "player"})


func test_hunts_when_a_wall_breaks_the_line_and_the_hunt_is_a_step_never_a_retreat() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 1},
		{"id": "foe-1", "kind": "slinger", "x": 4, "y": 1},
	], [
		"........",
		"..#.....",
		"........",
	])
	var act: Dictionary = SimAi.decide(s, "foe-1")
	assert_eq(act["kind"], "step")
	# Toward, not away: the step closes distance around the wall.
	assert_ne(act, {"kind": "step", "dx": 1, "dy": 0})


func test_walks_a_smoked_floors_stale_trail_rather_than_drawing_on_what_it_cannot_see() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 4, "y": 0},
	])
	var fooled: Dictionary = s.duplicate()
	fooled["smoke"] = {"until": int(s["turn"]) + 5, "at": {"x": 7, "y": 0}, "unfooled": []}
	assert_eq(SimAi.decide(fooled, "foe-1")["kind"], "step",
		"a fooled hunter chases where you were, and does not draw on it")


func test_spends_a_stagger_reeling_like_everything_else() -> void:
	var s: Dictionary = _world([
		{"id": "player", "kind": "you", "x": 0, "y": 0},
		{"id": "foe-1", "kind": "slinger", "x": 3, "y": 0, "tags": ["staggered"]},
	])
	assert_eq(SimAi.decide(s, "foe-1"), {"kind": "wait"})
