extends GutTest
## Keymap — the pure key-to-verb mapping that lets Task 3.9's exit gate replay
## a keystroke list headlessly, with no window and no `_input` handler in the
## loop at all.
##
## RECONCILIATION: 0 reference cases, by inspection rather than by omission —
## `git ls-tree -r ts-baseline --name-only | grep -i debug` returns only
## `debug.ts` and `debug.css`; there has never been a `debug.test.ts`, so
## there is nothing to port. Every case below is NON-REFERENCE, written
## against `Keymap.gd`'s own docstring and the plan's keys table, and stands
## in for the manual, in-browser QA that verb wiring got in the reference
## instead of an automated suite.
##
## One test per row of the plan's keys table (arrows/wasd unarmed AND armed,
## `.`/space, `x`, `z`, `f`, `q`/`Q`, `,`, `r`), plus the three scenarios the
## task brief calls out by name: an armed shove spent by a direction, an
## armed shove cleared by an unrelated key, and an unbound key resolving to
## nothing rather than a wrong verb. Every expected Dictionary is spelled by
## hand at the call site — never read back off `Keymap`'s own (private,
## `_`-prefixed) tables — so a test can't validate the mapping against
## itself.


# ── arrows / wasd, unarmed: attempt_move ───────────────────────────────────


func test_arrow_up_unarmed_walks_north() -> void:
	assert_eq(Keymap.resolve("ArrowUp", false),
		{"verb": "attempt_move", "dx": 0, "dy": -1, "arms": false, "clears": true})


func test_arrow_down_unarmed_walks_south() -> void:
	assert_eq(Keymap.resolve("ArrowDown", false),
		{"verb": "attempt_move", "dx": 0, "dy": 1, "arms": false, "clears": true})


func test_arrow_left_unarmed_walks_west() -> void:
	assert_eq(Keymap.resolve("ArrowLeft", false),
		{"verb": "attempt_move", "dx": -1, "dy": 0, "arms": false, "clears": true})


func test_arrow_right_unarmed_walks_east() -> void:
	assert_eq(Keymap.resolve("ArrowRight", false),
		{"verb": "attempt_move", "dx": 1, "dy": 0, "arms": false, "clears": true})


func test_w_unarmed_walks_north_same_as_arrow_up() -> void:
	assert_eq(Keymap.resolve("w", false),
		{"verb": "attempt_move", "dx": 0, "dy": -1, "arms": false, "clears": true})


func test_s_unarmed_walks_south_same_as_arrow_down() -> void:
	assert_eq(Keymap.resolve("s", false),
		{"verb": "attempt_move", "dx": 0, "dy": 1, "arms": false, "clears": true})


func test_a_unarmed_walks_west_same_as_arrow_left() -> void:
	assert_eq(Keymap.resolve("a", false),
		{"verb": "attempt_move", "dx": -1, "dy": 0, "arms": false, "clears": true})


func test_d_unarmed_walks_east_same_as_arrow_right() -> void:
	assert_eq(Keymap.resolve("d", false),
		{"verb": "attempt_move", "dx": 1, "dy": 0, "arms": false, "clears": true})


# ── arrows / wasd, armed: shove_at (the shove's other half) ────────────────


func test_arrow_up_armed_shoves_north() -> void:
	assert_eq(Keymap.resolve("ArrowUp", true),
		{"verb": "shove_at", "dx": 0, "dy": -1, "arms": false, "clears": true})


func test_arrow_down_armed_shoves_south() -> void:
	assert_eq(Keymap.resolve("ArrowDown", true),
		{"verb": "shove_at", "dx": 0, "dy": 1, "arms": false, "clears": true})


func test_arrow_left_armed_shoves_west() -> void:
	assert_eq(Keymap.resolve("ArrowLeft", true),
		{"verb": "shove_at", "dx": -1, "dy": 0, "arms": false, "clears": true})


func test_arrow_right_armed_shoves_east() -> void:
	assert_eq(Keymap.resolve("ArrowRight", true),
		{"verb": "shove_at", "dx": 1, "dy": 0, "arms": false, "clears": true})


func test_w_armed_shoves_north() -> void:
	assert_eq(Keymap.resolve("w", true),
		{"verb": "shove_at", "dx": 0, "dy": -1, "arms": false, "clears": true})


func test_s_armed_shoves_south() -> void:
	assert_eq(Keymap.resolve("s", true),
		{"verb": "shove_at", "dx": 0, "dy": 1, "arms": false, "clears": true})


func test_a_armed_shoves_west() -> void:
	assert_eq(Keymap.resolve("a", true),
		{"verb": "shove_at", "dx": -1, "dy": 0, "arms": false, "clears": true})


func test_d_armed_shoves_east() -> void:
	assert_eq(Keymap.resolve("d", true),
		{"verb": "shove_at", "dx": 1, "dy": 0, "arms": false, "clears": true})


# ── the named scenario: "an armed shove spent by a direction" ──────────────


func test_an_armed_shove_is_spent_by_the_next_direction_key() -> void:
	## The exact sequence a player types: x, then a direction. Two resolve()
	## calls, threading the caller's own armed flag through by hand, the way
	## the eventual caller must.
	var armed_after_x: bool = Keymap.resolve("x", false)["arms"]
	assert_true(armed_after_x, "x arms the shove")

	var spent: Dictionary = Keymap.resolve("ArrowRight", armed_after_x)
	assert_eq(spent, {"verb": "shove_at", "dx": 1, "dy": 0, "arms": false, "clears": true},
		"the very next direction spends the arm into a shove, not a step")


# ── `.` / space: wait ───────────────────────────────────────────────────────


func test_period_holds_still() -> void:
	assert_eq(Keymap.resolve(".", false),
		{"verb": "wait", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_space_holds_still_same_as_period() -> void:
	assert_eq(Keymap.resolve(" ", false),
		{"verb": "wait", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── `x`: arms the shove, calls nothing ──────────────────────────────────────


func test_x_arms_the_shove_and_names_no_command() -> void:
	assert_eq(Keymap.resolve("x", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": true, "clears": false})


func test_x_pressed_again_while_already_armed_stays_armed() -> void:
	## The reference's 'x' branch assigns `shoveArmed = true` unconditionally
	## — it never reads the current value first, so a second x does not
	## toggle the arm back off.
	assert_eq(Keymap.resolve("x", true),
		{"verb": "", "dx": 0, "dy": 0, "arms": true, "clears": false})


# ── `z`: brace ───────────────────────────────────────────────────────────────


func test_z_braces() -> void:
	assert_eq(Keymap.resolve("z", false),
		{"verb": "brace_self", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_z_braces_the_same_way_even_while_armed() -> void:
	## Doubles as the plan's named scenario: "an armed shove cleared by an
	## unrelated key." z is not a direction, so it can't spend the arm into a
	## shove — it just drops it, same as any other unrelated key would.
	assert_eq(Keymap.resolve("z", true),
		{"verb": "brace_self", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── `f`: the volley, one verb for both beats ────────────────────────────────


func test_f_names_the_volley_verb() -> void:
	## Keymap cannot know whether the sling is already drawn — that lives on
	## the entity's tags, in state this function is never given (see the
	## class docstring's "why f's two beats are not resolved here"). Both
	## presses resolve identically; the caller reads Chronicle.state() to
	## choose SimCommands.draw_stance vs. shot_target + loose_shot.
	assert_eq(Keymap.resolve("f", false),
		{"verb": "volley", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_f_still_names_the_volley_verb_while_a_shove_is_armed() -> void:
	assert_eq(Keymap.resolve("f", true),
		{"verb": "volley", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── `q` / `Q`: the satchel's two slots, case matters ────────────────────────


func test_lowercase_q_uses_the_first_satchel_slot() -> void:
	assert_eq(Keymap.resolve("q", false),
		{"verb": "use_carried_0", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_uppercase_q_uses_the_second_satchel_slot() -> void:
	assert_eq(Keymap.resolve("Q", false),
		{"verb": "use_carried_1", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── `,`: take underfoot, deliberately ───────────────────────────────────────


func test_comma_takes_underfoot_deliberately() -> void:
	assert_eq(Keymap.resolve(",", false),
		{"verb": "take_or_refuse", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── `r`: read the carried scroll ────────────────────────────────────────────


func test_r_reads_the_carried_scroll() -> void:
	assert_eq(Keymap.resolve("r", false),
		{"verb": "read_scroll", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── the named scenario: unbound keys resolve to nothing, not a wrong verb ──


func test_the_witness_key_c_is_unbound() -> void:
	assert_eq(Keymap.resolve("c", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_the_gamemaster_key_t_is_unbound() -> void:
	assert_eq(Keymap.resolve("t", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_the_forge_key_g_is_unbound() -> void:
	assert_eq(Keymap.resolve("g", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_the_screen_key_m_is_unbound() -> void:
	assert_eq(Keymap.resolve("m", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_the_worlds_key_n_is_unbound() -> void:
	assert_eq(Keymap.resolve("n", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_the_palette_key_p_is_unbound() -> void:
	assert_eq(Keymap.resolve("p", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_a_key_this_game_has_no_name_for_also_resolves_to_nothing() -> void:
	## The empty descriptor is the general fallback, not a blocklist of just
	## the six Phase-5 letters — proven by trying a key that names nothing
	## at all, past or future.
	assert_eq(Keymap.resolve("Escape", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})
	assert_eq(Keymap.resolve("1", false),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


func test_an_unbound_key_still_clears_an_armed_shove() -> void:
	## The other half of the same named scenario: unbound is not exempt from
	## the modal rule. Armed, then a Phase-5 letter — the arm drops even
	## though the key itself does nothing.
	assert_eq(Keymap.resolve("g", true),
		{"verb": "", "dx": 0, "dy": 0, "arms": false, "clears": true})


# ── cross-cutting invariants ────────────────────────────────────────────────


func test_arms_and_clears_are_mutually_exclusive_across_every_bound_and_unbound_key() -> void:
	## Exactly one of arms/clears is true for every key this file has ever
	## heard of, and every key it hasn't — 'x' is the sole exception that
	## arms, and it alone does not clear. Sampled rather than exhaustive
	## (the domain is every possible string), but wide: every bound key in
	## the plan's table, every named-unbound letter, and a handful of keys
	## with no meaning at all.
	var sample: Array = [
		"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d",
		".", " ", "x", "z", "f", "q", "Q", ",", "r",
		"c", "t", "g", "m", "n", "p", "Escape", "1", "?", "",
	]
	for key: String in sample:
		for armed in [false, true]:
			var result: Dictionary = Keymap.resolve(key, armed)
			assert_ne(result["arms"], result["clears"],
				"key %s (armed=%s) had arms=%s and clears=%s — expected exactly one true" %
					[key, armed, result["arms"], result["clears"]])


func test_only_x_arms_anything() -> void:
	var sample: Array = [
		"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d",
		".", " ", "z", "f", "q", "Q", ",", "r", "c", "t", "g", "m", "n", "p",
	]
	for key: String in sample:
		assert_false(Keymap.resolve(key, false)["arms"], "%s must not arm the shove" % key)


func test_movement_deltas_never_leak_into_a_non_directional_verb() -> void:
	## dx/dy are reserved for attempt_move/shove_at; every other verb — empty
	## included — must report exactly 0, 0.
	var sample: Array = [".", " ", "x", "z", "f", "q", "Q", ",", "r", "c", "unbound-key"]
	for key: String in sample:
		var result: Dictionary = Keymap.resolve(key, false)
		assert_eq(result["dx"], 0, "%s must not carry a movement delta" % key)
		assert_eq(result["dy"], 0, "%s must not carry a movement delta" % key)


func test_the_descriptor_always_has_exactly_these_five_keys() -> void:
	var result: Dictionary = Keymap.resolve("w", false)
	var keys: Array = result.keys()
	keys.sort()
	var expected: Array = ["arms", "clears", "dx", "dy", "verb"]
	expected.sort()
	assert_eq(keys, expected)


func test_resolve_is_a_pure_function_repeated_calls_agree() -> void:
	## The whole point: no hidden state between calls. Calling resolve() for
	## an unrelated key must depend only on the two arguments given, never on
	## how many times 'x' was pressed in between.
	assert_eq(Keymap.resolve("f", false), Keymap.resolve("f", false))
	Keymap.resolve("x", false)
	Keymap.resolve("x", false)
	assert_eq(Keymap.resolve("f", false), {"verb": "volley", "dx": 0, "dy": 0, "arms": false, "clears": true},
		"calling resolve for 'x' twice first must not change what 'f' resolves to next")
