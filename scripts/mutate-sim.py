#!/usr/bin/env python3
"""Apply one named mutation to a sim file, with a per-target assert count.

Two silent no-op edits in this repo's history taught the assert: a mutation
proof that silently failed to mutate is a proof that proves nothing.

Rows stay in the table after their proof lands, so the next porter can re-run
the whole set and notice if a test has weakened since. A row that has become an
EQUIVALENT REWRITE rather than a bug is marked so in its comment and reported as
a null result — never as a pass.

Usage:  python3 scripts/mutate-sim.py <name>
        python3 scripts/mutate-sim.py <name> restore
        python3 scripts/mutate-sim.py --list

NEVER use "" as the mutant. To delete a line, comment it out instead. An empty
mutant makes the restore path search for "" — which occurs everywhere — so the
count==1 guard trips and the file cannot be restored. Learned the hard way
during Task 2.B2 while trying to delete `"alarm": null,`.
"""
import sys

# name -> (path, original, mutant)
MUTATIONS: dict[str, tuple[str, str, str]] = {
    # --- Phase 1 kernel: all four caught ---
    "rng-constant": (
        "godot/sim/rng.gd",
        "\tt = imul32(t, 0x21F0AAAD)",
        "\tt = imul32(t, 0x21F0AAAE)",
    ),
    "canonical-sort": (
        "godot/sim/canonical.gd",
        "\t\t\tkeys.sort()",
        "\t\t\tkeys.sort_custom(func(x, y): return str(x).to_lower() < str(y).to_lower())",
    ),
    "canonical-escape": (
        "godot/sim/canonical.gd",
        '\t\t\t0x0A: out += "\\\\n"',
        "\t\t\t0x0A: out += String.chr(0x0A)",
    ),
    "hash-position": (
        "godot/sim/hashing.gd",
        '\t\t"seq": seq,',
        '\t\t"seq": 0,',
    ),
    # --- Phase 2 leaves ---
    "grid-bounds": (
        "godot/sim/grid.gd",
        "\treturn x >= 0 and y >= 0 and x < width and y < height",
        "\treturn x >= 0 and y >= 0 and x <= width and y <= height",
    ),
    "entity-is-alive": (
        "godot/sim/entity.gd",
        "\treturn hp > 0",
        "\treturn true",
    ),
    # Clamps the GRANT at zero before it is summed, not the resulting stat
    # (every field in the ported negative-grant test lands >= 0 after the
    # real sum, so clamping the sum itself would be an equivalent rewrite
    # here — this instead reproduces the tempting "a grant shouldn't be
    # negative" defensive fix, which is exactly what would silently erase
    # the heavy edge's speed cost).
    "item-granted-clamp": (
        "godot/sim/item.gd",
        '\t\t"speed": stats["speed"] + grants["speed"],',
        '\t\t"speed": stats["speed"] + maxi(grants["speed"], 0),',
    ),
    # Widens the rule vocabulary's own bound on how many conditions a single
    # rule may carry — a balance decision, not a derived value, so nothing
    # else in the file would catch it drifting.
    "rule-max-conditions": (
        "godot/sim/rule.gd",
        "const MAX_CONDITIONS := 4",
        "const MAX_CONDITIONS := 5",
    ),
    # Drifts the lunge multiplier (the skirmisher's verb) — a balance
    # decision, not a derived value, so nothing else in the file would catch
    # it changing. Load-bearing by design: with verbs unpriced, depth-5
    # survival collapsed from a pinned 1-in-10 band to 0 in 20 trials
    # (tables.ts's own docs). The fixture's threatOf rows exist precisely to
    # catch this — they dump the SAME stats priced and unpriced, so the gap
    # IS the multiplier — so every priced-skirmisher threatOf row in the
    # fixture sweep should mismatch, and with it the bestiary's own
    # "scales every archetype upward" and "prices the warden above
    # everything" comparisons, both of which price skirmisher through
    # threat_of.
    "tables-verb-threat": (
        "godot/sim/tables.gd",
        '"lunge": 1.25,',
        '"lunge": 1.35,',
    ),
    # Drops "alarm" from EMPTY_STATE entirely instead of keeping it present
    # with value null — the exact failure the absent-key law exists to catch.
    # canonicalJson only drops a key whose value is `undefined`; null is not
    # undefined, so a state that OMITS a nullable field forks the encoded
    # bytes on the very first empty state, not just deep in a replay.
    # (Commented out rather than deleted: an empty-string mutant defeats this
    # script's own count==1 safety check on restore, since "" occurs at every
    # offset in a nonempty string.)
    "state-null-becomes-absent": (
        "godot/sim/state.gd",
        '\t\t"alarm": null,\n',
        '\t\t# "alarm": null,\n',
    ),
    # A wrong version number in the schema table — the exact failure this
    # table exists to prevent. WORLD_INIT is the type with the longest
    # upcaster history (v9-v15), so a stale entry here is the most
    # plausible real mistake, not just the easiest string to hit. Caught
    # by test_the_schema_table_covers_every_type_the_golden_run_uses,
    # which checks the table against schemaVersion as actually recorded
    # on every golden-run event, not against a second reading of the
    # reference.
    "events-schema-version": (
        "godot/sim/events.gd",
        '"WORLD_INIT": 15,',
        '"WORLD_INIT": 14,',
    ),
    # Defeats the "already at current version, pass through untouched" guard
    # that every upcaster in the file relies on to stay a no-op on modern
    # data — the exact shape of "make one upcaster fire unconditionally".
    # With the guard never tripping, every event falls through into its
    # type's upcast branch regardless of version. WORLD_INIT and STRIKE
    # happen to reconstruct an equivalent payload even then (their inner
    # guards are themselves version-gated), but MOVE and TURN_ADVANCED have
    # no type-specific branch at all and fall to the terminal
    # "no upcaster from" assert, which is caught here two ways: the identity
    # test's loop hits an unhandled engine error on the first such event, and
    # test_passes_a_current_version_event_through_untouched fails its
    # is_same() check directly.
    "upcast-version-guard": (
        "godot/sim/upcast.gd",
        "\tif version == current:",
        "\tif version == current + 1:",
    ),
    # Drops the "- 1" from fork()'s seq arithmetic, recording the fork point
    # at the length of the chain up to and including it rather than its
    # actual seq (chain()[i] has .seq == i, so the true fork-point seq is
    # length - 1). The reference's own test comment names this exact case:
    # "every other fork test checks only .head, so dropping the - 1 would
    # ship silently" — every fork test but one only checks .head, which this
    # mutation never touches, so only
    # test_records_the_fork_point_sequence_not_the_source_head_sequence
    # catches it.
    "refs-fork-seq": (
        "godot/sim/refs.gd",
        "\tvar seq: int = 0 if at == null else log.chain(at).size() - 1",
        "\tvar seq: int = 0 if at == null else log.chain(at).size()",
    ),
    # Negates hpAtMost's own comparison (<= becomes its strict opposite, >) —
    # inverting one condition kind inside holds(), as the task brief asks for.
    # NOTE for future editors: the tempting alternative mutant here is
    # swapping in hpAtLeast's own operator (<= -> >=) rather than negating,
    # but that produces text BYTE-IDENTICAL to the very next match branch
    # ("hpAtLeast": return a_stats["hp"] >= condition["n"]), which trips this
    # script's own count==1 safety guard on restore (found 2, not 1) — a new
    # variant of the empty-string trap this docstring already warns about.
    # Caught directly by test_interpret.gd's test_reads_hit_points, which
    # exercises hpAtMost at both a passing and a failing boundary, and
    # indirectly by test_never_treats_a_firing_as_a_trigger_for_more_firing,
    # whose self-feeding rule gates on hpAtMost.
    "interpret-hpatmost-comparison": (
        "godot/sim/interpret.gd",
        '\t\t\treturn a_stats["hp"] <= condition["n"]',
        '\t\t\treturn a_stats["hp"] > condition["n"]',
    ),
    # --- Task 2.C1 hand-off A: apply.gd's reducer, guarded by the ported
    # tests/core/apply.test.ts and tests/core/dispositions.test.ts suites ---
    # Drops the "+ 1" from MOVE's waypoint-struck arithmetic, so a wanderer
    # that lands on a stop re-reads the SAME leg instead of advancing to the
    # next one. Real gameplay drift (a wanderer would loiter at its own
    # waypoint forever rather than continuing its round) that neither the
    # golden run nor apply.gd's own law suite catches: the golden run never
    # happens to land a wanderer exactly on a waypoint, and the law suite's
    # _events() table checks the counter and the key set for MOVE, never the
    # resulting `leg`. Caught only by test_dispositions.gd's one ported case,
    # which is the whole reason that case was worth porting out of a suite
    # eleven-twelfths deferred.
    "apply-wander-leg-advance": (
        "godot/sim/apply.gd",
        '\t\t\t\t\t\t\t\tlanded["leg"] = (i + 1) % route.size()',
        '\t\t\t\t\t\t\t\tlanded["leg"] = i % route.size()',
    ),
    # WORLD_INIT stops reading a floor as born empty and hands every new
    # world a phantom corpse instead. Not caught by the law suite: bodies is
    # a plain state-level key, not one of entity.gd's nine optional ones, and
    # nothing in the law section's _events() sweep checks its VALUE after
    # WORLD_INIT (only the key set, via assert_shape). Caught by
    # test_world_bodies_is_reset_by_the_next_world_init_every_floor_is_born_empty,
    # ported from apply.test.ts's own describe('apply WORLD_BODIES, and the
    # recorded cut').
    "apply-world-init-bodies": (
        "godot/sim/apply.gd",
        '\t\t\t\t"bodies": [],',
        '\t\t\t\t"bodies": [{"x": 0, "y": 0}],',
    ),
    # WORLD_INIT stops copying a seed's position and aliases the payload's Pos
    # Dictionary straight into the constructed entity — the exact failure the
    # docstring's copy-not-alias law exists to catch, on the one field none of
    # apply.gd's own LAW suite happens to probe (test_world_init_copies_out_
    # of_the_payload_rather_than_aliasing_it mutates a seeded walker's stats,
    # tags and route, never its pos). Caught by
    # test_world_init_copies_the_player_so_mutating_the_event_payload_cannot_
    # reach_into_state, ported from apply.test.ts's sharpest WORLD_INIT case.
    "apply-world-init-pos-alias": (
        "godot/sim/apply.gd",
        '\t\t\t\t\t"pos": _pos(s["pos"]),',
        '\t\t\t\t\t"pos": s["pos"],',
    ),
    # --- Task 2.C1 hand-off B: leveling and the RULE_FIRED kill-credit path,
    # guarded by test_leveling.gd and test_interpret.gd's adopted RULE_FIRED
    # cases. Neither line below is reachable from the pre-existing four-law
    # suite in test_apply.gd: that suite's _events() fixture never checks a
    # numeric xp value for any event type, RULE_FIRED included. ---
    # Inverts _credit_kills' own gate, so a player's kills pay nothing and a
    # non-player's kills pay the player instead — the opposite of "pays for a
    # kill a rule made, when the player owned the rule's firing" and "pays
    # nothing when creatures kill each other" both at once.
    "apply-credit-kills-player-only": (
        "godot/sim/apply.gd",
        "\tif killer_id != player_id:",
        "\tif killer_id == player_id:",
    ),
    # RULE_FIRED stops crediting the rule's own actorId and credits a name
    # nobody plays instead — so a kill a rule made never pays, no matter who
    # fired it. The golden run never witnesses RULE_FIRED at all (5 of 25
    # types witnessed, and it is not one), so test_pays_for_a_kill_a_rule_
    # made_when_the_player_owned_the_rules_firing is the only guard for this
    # line anywhere in the migration.
    "apply-rule-fired-actor-credit": (
        "godot/sim/apply.gd",
        '\t\t\treturn _credit_kills(state, _drop_pockets(state, resolved), p["actorId"])',
        '\t\t\treturn _credit_kills(state, _drop_pockets(state, resolved), "nobody")',
    ),
    # --- Task 2.C2: SimLog.fold / SimLog.verify_chain ---
    # Drops the WORLD_INIT rng-counter exception outright, demanding
    # continuity across every event including a fresh floor's own opening
    # WORLD_INIT — the exact regression the exception's own comment names:
    # "refused every saved run that had ever descended". The golden run
    # never descends (its one WORLD_INIT is the root, already at counter 0,
    # matching EMPTY_STATE — see the Task 2.C2 report), so this mutation is a
    # confirmed NULL RESULT against golden-run.json specifically; it is
    # caught by test_chain.gd's own two-floor descent fixture instead, which
    # exists for exactly this reason.
    "log-world-init-rng-exception": (
        "godot/sim/log.gd",
        '\t\tif event["type"] != "WORLD_INIT" and int(state["rngCounter"]) != int(event["rngCounter"]):',
        '\t\tif int(state["rngCounter"]) != int(event["rngCounter"]):',
    ),
    # Flips verify_chain's sequence-gap comparison to its own opposite: fires
    # on every event whose seq matches its position (i.e. every honest
    # event) and stays silent on an actual gap. Breaks broadly on purpose —
    # every sound chain this suite folds starts failing at its own seq 0 —
    # which is what proves the check is load-bearing at all, not just for
    # the one hand-forged gap it exists to catch.
    "log-verify-chain-sequence-gap-flip": (
        "godot/sim/log.gd",
        '\t\tif int(event["seq"]) != expected_seq:',
        '\t\tif int(event["seq"]) == expected_seq:',
    ),
    # Walks fold()'s pending list forward instead of backward, applying the
    # event closest to HEAD first and the one closest to the root LAST.
    # Since WORLD_INIT replaces state wholesale regardless of what it is
    # handed, a WORLD_INIT applied last (as it now is, for any chain that
    # fits in one pending batch) simply overwrites everything the other
    # events did — the fold silently loses every event after its own
    # WORLD_INIT rather than crashing.
    "log-fold-apply-order-reversed": (
        "godot/sim/log.gd",
        "\tfor i in range(pending.size() - 1, -1, -1):",
        "\tfor i in range(pending.size()):",
    ),
    # --- Known EQUIVALENT REWRITES, kept as documentation, not as proofs. ---
    # Both produce identical bits: low bits survive two's-complement wrapping,
    # and u32's second line masks unconditionally. Running these should show NO
    # failures; that is the recorded expectation, not a weakened test.
    "rng-naive-imul-EQUIVALENT": (
        "godot/sim/rng.gd",
        "\tvar lo := a * (b & 0xFFFF)\n"
        "\tvar hi := ((a * (b >> 16)) & 0xFFFF) << 16\n"
        "\treturn (lo + hi) & MASK32",
        "\treturn (a * b) & MASK32",
    ),
    "rng-seedmask-EQUIVALENT": (
        "godot/sim/rng.gd",
        "\tvar a := (seed + imul32(counter, GAMMA)) & MASK32",
        "\tvar a := seed + imul32(counter, GAMMA)",
    ),
    # --- Task 2.D2: reachability.gd ---
    # Reorders reachable_from's neighbour loop to key a neighbour by idx and
    # mark it seen BEFORE checking is_passable, instead of after — the exact
    # bug class NIGHTLOG records in ai.ts's firstStep (a different function):
    # an out-of-bounds or walled neighbour reads as reachable because it was
    # keyed before its passability was known. MEASURED (not predicted): 5 of
    # the file's 8 tests fail — test_finds_the_whole_open_grid (9 -> 15),
    # test_does_not_cross_a_full_wall_so_a_sealed_room_stays_sealed (3 -> 11
    # on both its assertions), test_does_not_move_diagonally (1 -> 5, on
    # in-bounds WALL neighbours), test_reaches_every_floor_tile_by_index_not_
    # just_the_right_count (12 -> 20), and test_a_neighbour_off_the_grid_
    # edge_is_never_marked_reachable (1 -> 3, on out-of-bounds neighbours).
    # The other 3 are unreached by this line: floor_count never calls this
    # loop, and the not-standable-start case returns before reaching it.
    "reach-bounds-before-key": (
        "godot/sim/reachability.gd",
        "\t\t\tif not SimGrid.is_passable(grid, nx, ny):\n"
        "\t\t\t\tcontinue\n"
        "\t\t\tvar i := SimGrid.idx(grid, nx, ny)\n"
        "\t\t\tif seen.has(i):\n"
        "\t\t\t\tcontinue\n"
        "\t\t\tseen[i] = true\n"
        "\t\t\tstack.push_back([nx, ny])",
        "\t\t\tvar i := SimGrid.idx(grid, nx, ny)\n"
        "\t\t\tif seen.has(i):\n"
        "\t\t\t\tcontinue\n"
        "\t\t\tseen[i] = true\n"
        "\t\t\tif not SimGrid.is_passable(grid, nx, ny):\n"
        "\t\t\t\tcontinue\n"
        "\t\t\tstack.push_back([nx, ny])",
    ),
    # Drops north ([cx, cy - 1]) from the four-directional neighbour list —
    # the total-connectivity mutation proof Task 2.D2's brief calls for by
    # name. MEASURED: 2 of 8 tests fail — test_finds_the_whole_open_grid
    # (9 -> 6; flooded from the grid's CENTRE, so the top row is only
    # reachable by going north) and
    # test_reaches_every_floor_tile_by_index_not_just_the_right_count
    # (12 -> 8, with tiles 0-3 specifically missing; flooded from an
    # INTERIOR tile for the same reason). The other 6 do NOT catch this
    # mutation, including, surprisingly, the other reachableFrom cases —
    # every one of them starts at the topmost row of its own reachable
    # region (a grid corner, or the top of a walled-off single column), so
    # nothing above the start ever needs a "north" step regardless of
    # whether north exists. This is exactly why this test was rewritten
    # mid-port to start at an interior tile rather than (0,0): the original
    # corner-start version of this same test passed against this mutation
    # and would have been a false negative on the very proof it exists for.
    "reach-drop-a-direction": (
        "godot/sim/reachability.gd",
        "\t\t\t[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],",
        "\t\t\t[cx + 1, cy], [cx - 1, cy], [cx, cy + 1],",
    ),
    # --- Task 2.D3: sight.gd, guarded entirely by the ported
    # tests/core/sight.test.ts suite (test_sight.gd) — this file has no
    # other witness at all: it is not part of GameState, so no fold/golden
    # gate touches it, and Wave E (commands.gd, the only future caller of
    # within_reach/clear_shot) has not landed yet either. ---
    # Neuters the corner rule so two solid tiles kissing at a lattice point
    # no longer stop the shot — the exact case the brief calls out by name.
    # Caught only by test_slips_a_single_corner_but_never_two_walls_kissing,
    # which is the one ported case built to require BOTH flanking cells
    # solid before it demands a block.
    "sight-corner-kissing-passes": (
        "godot/sim/sight.gd",
        "\t\t\tif _solid(grid, x + sx, y) and _solid(grid, x, y + sy):\n\t\t\t\treturn false",
        "\t\t\tif _solid(grid, x + sx, y) and _solid(grid, x, y + sy):\n\t\t\t\tpass  # MUTATED: two walls kissing no longer stop the shot",
    ),
    # Drops the "+ radius" slack from the reach disc, turning the reference's
    # dx²+dy² <= r²+r into a bare dx²+dy² <= r² — an equivalent-looking
    # distance check that is NOT the same inequality, which is exactly the
    # trap the brief warns against porting into. Caught only by
    # test_rounds_the_diagonal_the_way_sight_does (29 <= 30 needs the slack;
    # 29 <= 25 is false), not by the straight-edge case (25 <= 30 and
    # 25 <= 25 agree, so that case alone could not tell the two apart).
    "sight-reach-disc-drops-the-slack": (
        "godot/sim/sight.gd",
        "\treturn dx * dx + dy * dy <= radius * radius + radius",
        "\treturn dx * dx + dy * dy <= radius * radius",
    ),
    # Flips _stands' liveness guard, so a living body is skipped (never
    # blocks) and a corpse is checked instead (always blocks). Breaks both
    # halves of test_is_stopped_by_a_living_body_between_never_by_the_dead_
    # never_by_the_ends at once: the living body between archer and mark
    # stops blocking, and the hp=0 corpse in its place starts blocking.
    "sight-dead-body-blocks": (
        "godot/sim/sight.gd",
        "\t\tif not SimEntity.is_alive(e):",
        "\t\tif SimEntity.is_alive(e):",
    ),
    # --- Task 2.D1: sim/mapgen.gd, guarded by the six-board identity sweep in
    # test_mapgen.gd plus the two draw-accounting cases beside it ---
    # THE MANDATED ONE. A rejected rectangle hands its four draws back instead
    # of spending them, which is the single rule the whole file is organised
    # around: "every counted draw, INCLUDING a rejected one, advances the
    # counter." The rooms it keeps are unchanged for the first rejection and
    # every draw after it lands on a different counter, so the board diverges
    # AND counterAfter diverges — the sweep fails on both halves at once, which
    # is the point: a port that only matched tiles would still be wrong.
    "mapgen-rejected-draw-refunded": (
        "godot/sim/mapgen.gd",
        "\t\tif clashes:\n\t\t\tcontinue",
        "\t\tif clashes:\n\t\t\tc -= 4\n\t\t\tcontinue",
    ),
    # Drops the one-tile wall margin between rooms, so two rooms that merely
    # touch are accepted instead of rejected. Each attempt still costs its four
    # draws, but the target fills after FEWER attempts, so the board, the start,
    # the rooms and counterAfter all move together. Measured: all six boards
    # fail on both halves of the sweep.
    "mapgen-room-margin": (
        "godot/sim/mapgen.gd",
        "\treturn ax - 1 < bx + bw and ax + aw + 1 > bx \\\n"
        "\t\tand ay - 1 < by + bh and ay + ah + 1 > by",
        "\treturn ax < bx + bw and ax + aw > bx \\\n"
        "\t\tand ay < by + bh and ay + ah > by",
    ),
    # Walks the four neighbours south-first instead of east-first. INVISIBLE to
    # the board sweep and to every distance in the file — flood membership and
    # BFS depth are both order-independent — and visible only in which of the
    # equally-short roads walk_path returns. Caught solely by
    # test_the_road_bends_east_before_it_bends_south, which exists because
    # Wave E's createWorld lays the teaching floor's relic ON that road.
    "mapgen-step-order": (
        "godot/sim/mapgen.gd",
        "const _STEPS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1]]",
        "const _STEPS: Array = [[0, 1], [0, -1], [1, 0], [-1, 0]]",
    ),
    # choose_exit's fallback stops spending its second draw, so a floor too
    # cramped to fill any band leaves the stream one draw short of every other
    # floor. Also invisible to the six-board sweep — all six find a band — and
    # caught only by test_choose_exit_spends_exactly_two_draws_on_every_path_out,
    # which is the whole reason that case was written.
    "mapgen-exit-fallback-draw": (
        "godot/sim/mapgen.gd",
        "\tc += 1\n"
        '\treturn {"exit": farthest_from(grid, start), "band": "the long way", "counterAfter": c}',
        "\t#c += 1\n"
        '\treturn {"exit": farthest_from(grid, start), "band": "the long way", "counterAfter": c}',
    ),
    # --- Task 2.E1: turns.gd ---
    # Reverses initiative_order's tie-break from ascending id to descending —
    # the brief's own mandated mutation ("a different tie-break is a
    # different chain"). MEASURED: only
    # test_breaks_speed_ties_by_ascending_id_so_order_never_depends_on_input_
    # order fails, and it fails on BOTH assertions, not one — "backwards"
    # input ([c,b,a], already "sorted" by the broken descending rule) stays
    # ['c','b','a'], and "forwards" input ([a,b,c]) flips to ['c','b','a']
    # too. No other test touches a speed tie: every other fixture in the file
    # uses distinct speeds, so the primary sort key alone decides them and
    # this branch is never reached. See Task 2.E1's report for the full
    # observed failure output.
    "turns-tiebreak-reversed": (
        "godot/sim/turns.gd",
        '\treturn (a["id"] as String) < (b["id"] as String)',
        '\treturn (a["id"] as String) > (b["id"] as String)',
    ),
    # Swaps next_active's wrap arithmetic from the ALIVE order's own length to
    # the raw (unfiltered) roster's length — the exact seam
    # test_a_non_active_roster_member_dying_mid_round_does_not_disturb_the_wrap
    # was written to guard, closing the gap Increment 1's review flagged
    # (no ported TS case ever mixes a living active entity with a dead,
    # non-active one). MEASURED: only that one test fails; every one of the
    # 10 ported cases either never reaches this line (both early-return
    # branches above it) or calls next_active on a roster where every member
    # is alive, so order.size() == entities.size() and the swap is silent.
    "turns-next-active-wrap-uses-raw-roster-length": (
        "godot/sim/turns.gd",
        "\tvar next: int = (at + 1) % order.size()",
        "\tvar next: int = (at + 1) % entities.size()",
    ),
    # --- Task 2.E2: ai.gd, the brain. decide()'s answer becomes a recorded
    # event, so every row below is a different GAME, not a different number.
    # The golden run never witnesses a decision at all (it replays events that
    # were already decided), so these four rows plus test_ai.gd and
    # test_dispositions.gd are the entire witness for this file. ---
    # Raises the awareness wall by one step — the mutation Task 2.E2's brief
    # makes mandatory. MEASURED TWICE, and the first measurement is the
    # interesting one: against the SIXTEEN PORTED REFERENCE CASES ALONE this
    # mutation is a NULL RESULT — 27 scripts, 344 tests, all passing, exit 0.
    # ai.test.ts writes both of its awareness cases as offsets FROM the
    # constant (`you(5 + AWARENESS + 1, 5)` and `you(5 + AWARENESS, 5)`), so
    # raising AWARENESS moves their quarry with it and the wall is never
    # actually located. The brief's "confirm failure" was therefore
    # unsatisfiable as the reference suite stood. test_ai.gd's
    # test_the_awareness_wall_stands_at_exactly_eight_walking_steps was added
    # to close that, spelling the distance in literal tiles; with it present,
    # MEASURED: exactly 1 test fails, on its second assertion ("nine steps
    # away: beyond the wall of awareness"), and nothing else in 344 does.
    "ai-awareness-plus-one": (
        "godot/sim/ai.gd",
        "const AWARENESS := 8",
        "const AWARENESS := 9",
    ),
    # Re-anchors the posted guard's leash to WHEREVER THE CHASE HAS DRAGGED IT
    # instead of to its post — the exact mistake ai.ts's own v10 comment warns
    # against by name ("the leash anchored to the POST, not to wherever the
    # chase has dragged it"). A displaced guard would then hunt anything that
    # walked up to it and never go home, which is the pre-v10 world the
    # disposition was introduced to end. MEASURED: exactly 1 test fails,
    # test_dispositions.gd's
    # test_ignores_prey_beyond_the_leash_of_its_post_even_prey_at_arms_reach_
    # and_walks_home — the guard strikes the adjacent player instead of
    # turning west for its post. That case is one of the six this task adopted
    # out of the eleven Task 2.C1 had to defer, and it is the ONLY witness
    # anywhere for which end of the leash is nailed down.
    #
    # RE-ANCHORED 2026-07-30 (Wave E review, I-1). The row was written against
    # ai.gd's own private `_walk_distance`; commit b385671 ("The second twin
    # goes the way of the first") collapsed that twin into
    # SimMapgen.walk_distance and left this needle behind, so every later sweep
    # aborted here with "expected exactly 1 occurrence ... found 0" instead of
    # measuring the leash. The mutation itself is unchanged — only the text it
    # anchors to. Re-measured after the repoint: still exactly 1 test fails,
    # still the same named test.
    "ai-guard-leash-anchored-to-self": (
        "godot/sim/ai.gd",
        '\t\tvar intruder_near: bool = SimMapgen.walk_distance(grid, post, scent) <= SimTables.GUARD_LEASH',
        '\t\tvar intruder_near: bool = SimMapgen.walk_distance(grid, my_pos, scent) <= SimTables.GUARD_LEASH',
    ),
    # Moves _first_step's bounds check BELOW the key and the goal test, which
    # revives the LATENT HUNT BUG NIGHTLOG records against ai.ts's own
    # firstStep: idx() is plain y*width+x, so one column east of the map is
    # the next row's west door by arithmetic, and a quarry standing at x=0
    # reads as reachable one step EAST off the world. The reference found and
    # fixed this (borderless volley test grids exposed it; walled borders had
    # been hiding it), and Task 2.D2 pinned the same shape in reachability.gd
    # with the sibling row "reach-bounds-before-key".
    # MEASURED: exactly 1 test fails, and it is the one with no counterpart in
    # the reference — test_a_quarry_off_the_east_edge_is_never_smelled_
    # through_the_wrap. ALL SIXTEEN ported ai.test.ts cases are blind to it:
    # every grid in that file is borderless, so the wrap is live in all of
    # them, but no case ever stands the quarry on column 0, which is the only
    # place the wrapped key lands. That is precisely why the guard was added.
    "ai-first-step-key-before-bounds": (
        "godot/sim/ai.gd",
        "\t\t\t\tif x < 0 or y < 0 or x >= width or y >= height:\n"
        "\t\t\t\t\tcontinue\n"
        "\t\t\t\tvar k: int = SimGrid.idx(grid, x, y)\n"
        "\t\t\t\tif seen.has(k):\n"
        "\t\t\t\t\tcontinue\n"
        "\t\t\t\tseen[k] = true\n"
        "\t\t\t\tvar first: Variant = at[2]\n"
        "\t\t\t\tif first == null:\n"
        '\t\t\t\t\tfirst = {"dx": int(d[0]), "dy": int(d[1])}\n'
        "\t\t\t\tif k == goal_key:\n"
        "\t\t\t\t\treturn first",
        "\t\t\t\tvar k: int = SimGrid.idx(grid, x, y)\n"
        "\t\t\t\tif seen.has(k):\n"
        "\t\t\t\t\tcontinue\n"
        "\t\t\t\tseen[k] = true\n"
        "\t\t\t\tvar first: Variant = at[2]\n"
        "\t\t\t\tif first == null:\n"
        '\t\t\t\t\tfirst = {"dx": int(d[0]), "dy": int(d[1])}\n'
        "\t\t\t\tif k == goal_key:\n"
        "\t\t\t\t\treturn first\n"
        "\t\t\t\tif x < 0 or y < 0 or x >= width or y >= height:\n"
        "\t\t\t\t\tcontinue",
    ),
    # Stops a wanderer's round from yielding a blocked waypoint to the next
    # stop, so a body standing on its own goal — or one whose goal another
    # body is parked on — jams on its own doorstep instead of walking on.
    # NOTE for future editors: the tempting mutant here is reversing the
    # round's direction ((leg + 1) -> (leg - 1 + n)), but every route in the
    # ported suite has exactly TWO stops, where those two expressions are
    # arithmetically identical — an EQUIVALENT REWRITE, and a null result
    # dressed as a proof. This mutant removes the fallback instead.
    # MEASURED: exactly 2 tests fail, both adopted from
    # dispositions.test.ts — test_standing_on_its_own_goal_it_heads_for_the_
    # next_stop_rather_than_stalling (the walker waits instead of stepping,
    # because _first_step from a tile to itself is null) and test_a_goal_
    # another_body_is_parked_on_yields_to_the_next_stop (it walks WEST toward
    # the taken stop instead of east to the free one).
    "ai-wander-round-never-yields": (
        "godot/sim/ai.gd",
        "\t\t\tgoal = route[(leg + 1) % route.size()]",
        "\t\t\tpass  # MUTATED: the round never yields, it jams on its own doorstep",
    ),
    # --- Task 2.E3a: sim/commands/movement.gd ---
    # THE CHAIN-FORKING HAZARD Wave D handed this task by name. walk_distance
    # returns a FLOAT (INF means "no walk exists"), so "%s" renders "63.0"
    # where TypeScript's template literal writes "63". The story is a
    # GameState field: it goes through canonical.encode and into the fold
    # hash, so this one character forks every chain built on that floor.
    # MEASURED at 458 tests: 456 pass, exactly 2 fail —
    # test_the_golden_world_is_rebuilt_byte_for_byte (the committed golden
    # WORLD_INIT's story reads "...the long way, 63 steps of walking..."; the
    # mutant writes "63.0", failing both the story comparison and the
    # whole-payload canonical one) and test_the_walking_distance_in_the_
    # story_is_never_rendered_as_a_float (all three depths, including the
    # bottom's separate heart sentence). Every OTHER create_world test passes
    # under the mutant, which is the whole point: the reference's own "is
    # deterministic for a seed" compares create_world against itself, so both
    # sides render "63.0" together and it cannot see this.
    "movement-story-walk-as-float": (
        "godot/sim/commands/movement.gd",
        '\treturn ("%d" % walk) if is_finite(walk) else "?"',
        '\treturn ("%s" % walk) if is_finite(walk) else "?"',
    ),
    # Spends the damage draw on counter + 2 instead of counter + 1, so a
    # strike's two draws stop being consecutive. The counter still advances
    # by STRIKE_DRAWS, so every rngDraws assertion still passes — what breaks
    # is WHICH numbers came out, which is exactly the class of divergence
    # replay verification finds far from its cause.
    # MEASURED TWICE, and the first run is why the row is worth keeping. With
    # only the 56 ported cases present this mutant failed NOTHING — 456 of 456
    # passed. Every damage assertion in the reference suite is a RANGE (2..4
    # on a hit, 4..8 on a crit, <= 4 uncoiled), and "takes hit points away on
    # a hit" compares the reducer against the draft's own damage, so both
    # sides move together. The golden run pins no strike either: it re-hashes
    # recorded events rather than re-deriving them. test_a_strikes_two_draws_
    # are_the_two_CONSECUTIVE_draws_it_declares was added to close that, and
    # RE-MEASURED at 458 tests: 457 pass, exactly 1 fails — that test, with
    # "[3] expected to equal [4]".
    "movement-strike-damage-draw-skips": (
        "godot/sim/commands/movement.gd",
        "\tvar rolled_damage := SimRng.int_between(seed, counter + 1, 1, int(band[\"die\"])) + int(band[\"flat\"])",
        "\tvar rolled_damage := SimRng.int_between(seed, counter + 2, 1, int(band[\"die\"])) + int(band[\"flat\"])",
    ),
    # Drops the teaching floor's relic pull: depth 1's keen edge goes back to
    # lying on whatever far tile the draw put it on, instead of standing on
    # the walked road eight steps in. This is the rule a real player died bare
    # twice for, and until Task 2.E3a it was untested anywhere in sim/.
    # MEASURED at 458 tests: 456 pass, exactly 2 fail — test_lays_the_keen_
    # edge_on_the_path_eight_steps_of_walking_in_on_every_seed (one of the
    # three cases Task 2.D1 deferred here, failing on 6 of its 20 seeds) and
    # test_the_golden_world_is_rebuilt_byte_for_byte (seed 17's edge moves
    # from 39,12 to 16,11, taking its guard with it). Two independent
    # witnesses for one rule, which is what the deferred sweep bought:
    # the golden pins ONE board, the sweep pins twenty.
    "movement-teaching-floor-relic-not-pulled": (
        "godot/sim/commands/movement.gd",
        "\t\t\tguard_posts[0] = {\"x\": int(post[\"x\"]), \"y\": int(post[\"y\"])}",
        "\t\t\tpass  # MUTATED: the teaching floor no longer reaches the player",
    ),
    # Lets the keeper stand on an illusory wall. A keeper standing in what
    # paints as wall gives the secret away and reads as a haunting — and the
    # line is only ever reached on a floor that SEALED, which before this task
    # nothing in the migration produced (Task 2.D1 disclosed seal_secret_room's
    # committing path as UNREACHED, not merely untested).
    # MEASURED TWICE. First run was a NULL RESULT — 0 of 457 failed — and the
    # reason was measured rather than guessed: across depths 1-9 x seeds 1-60
    # on the vale board, 172 of 540 worlds SEAL, but only TWO put a sealed
    # doorway beside the way out (depth 7 and depth 8, both seed 32), and
    # neither seed was driven by any test. So the line was not equivalent, it
    # was UNREACHED. test_the_keeper_never_stands_in_what_paints_as_wall was
    # added on exactly those two worlds — asserting the precondition too, so
    # it cannot go quietly vacuous if generation drifts — and RE-MEASURED at
    # 458 tests: 457 pass, exactly 1 fails, that one.
    "movement-keeper-may-stand-on-a-secret": (
        "godot/sim/commands/movement.gd",
        "\t\tif SimGrid.tile_at(grid, int(p[\"x\"]), int(p[\"y\"])) == SimGrid.SECRET:\n"
        "\t\t\tcontinue",
        "\t\tif false:  # MUTATED: the keeper may stand in what paints as wall\n"
        "\t\t\tcontinue",
    ),
    # --- Task 2.E3d: sim/commands/stances.gd ---
    # THE OFFSET MOVES. Task 2.E3a measured that shifting the strike's damage
    # draw off `counter + 1` failed NOTHING across 456 tests: every damage
    # assertion in the reference is a range, and the golden run re-hashes
    # rather than re-derives. The call spends four draws — more than any other
    # verb in this family — so both of its offsets get a mutant, and neither
    # changes a single number's plausibility: every riser still lands on legal
    # ground at a legal distance, wearing a legal kind, on a chain that still
    # verifies. Only a test that re-DERIVES the draw can see them.
    #
    # Moves riser i's TILE draw from `c` to `c + 1`, so the archetype and the
    # tile stop being consecutive while rngDraws still says 4.
    # MEASURED at 515 tests: 514 pass, exactly 1 fails —
    # test_the_calls_four_draws_come_from_four_CONSECUTIVE_counter_offsets
    # (riser 0's tile moves from 5,11 to 22,12; riser 1's from 11,8 to 20,13).
    # EVERY reference case passes under it, :130's distance check included:
    # both new tiles are still legal ground at a legal distance. This is the
    # 2.E3a blind spot reproduced exactly, in a second family.
    "stances-call-tile-draw-offset": (
        "godot/sim/commands/stances.gd",
        "\t\tvar at: int = SimRng.int_between(seed, c, 0, candidates.size() - 1)",
        "\t\tvar at: int = SimRng.int_between(seed, c + 1, 0, candidates.size() - 1)",
    ),
    # Moves riser i's ARCHETYPE draw from `c` to `c + 1`, collapsing it onto
    # the same counter the tile draw then reads — two draws, one number.
    # MEASURED at 515 tests: 514 pass, exactly 1 fails, the same test: the
    # kinds move from slinger/bruiser to stalker/slinger while both tiles stay
    # exactly where they were. Again every reference case passes — the risers
    # are still bestiary kinds, still not callers, still at a chase's distance.
    "stances-call-archetype-draw-offset": (
        "godot/sim/commands/stances.gd",
        "\t\tvar pick: int = SimRng.int_between(seed, c, 1, arch_total)",
        "\t\tvar pick: int = SimRng.int_between(seed, c + 1, 1, arch_total)",
    ),
    # Lets the sling take the tile the bump owns. Adjacency refusing shots is
    # covenant M7's half that keeps the melee verb from becoming strictly
    # worse than the ranged one at range 1.
    # MEASURED at 515 tests: 513 pass, exactly 2 fail, both REFERENCE cases —
    # test_refuses_the_adjacent_the_bump_owns_range_1 (the mark volunteers the
    # body at range 1) and test_refuses_the_adjacent_the_blocked_and_the_out_
    # of_reach (loose_shot drafts a STRIKE at range 1 instead of refusing).
    "stances-shot-takes-the-adjacent": (
        "godot/sim/commands/stances.gd",
        "\tif absi(int(to[\"x\"]) - int(from[\"x\"])) + absi(int(to[\"y\"]) - int(from[\"y\"])) == 1:\n"
        "\t\treturn false",
        "\tif false:  # MUTATED: the sling steals the bump's tile\n"
        "\t\treturn false",
    ),
    # Makes the way out an ordinary door: a shoved body walks down the stairs
    # instead of hitting the frame. The reference stops a body at the EXIT
    # exactly as a wall does, and nothing derives that from anything else.
    # MEASURED at 515 tests: 514 pass, exactly 1 fails, the REFERENCE case
    # test_treats_the_way_out_as_a_door_frame_not_a_door.
    "stances-shove-through-the-way-out": (
        "godot/sim/commands/stances.gd",
        "\t\tor SimGrid.tile_at(grid, int(behind[\"x\"]), int(behind[\"y\"])) == SimGrid.EXIT:",
        "\t\tor false:  # MUTATED: the stairs are a door, not a frame",
    ),
    # Lets callers answer a call. One voice per floor is a clock; a chain of
    # voices is a fork bomb, and the filter is BY VERB so a levelled
    # "caller-2" cannot slip through the door its parent is barred from.
    # MEASURED TWICE. The first run caught it only INCIDENTALLY: 513 of 514
    # passed and the one failure was the draw-offset pin (a different pool
    # total changes the weighted walk), while new-verbs.test.ts:130's own
    # `expect(o.kind.startsWith('caller')).toBe(false)` — the assertion whose
    # whole job is this rule — stayed GREEN, because one cry is two draws and
    # the caller is one weight in twelve at depth 4. So the reference's guard
    # was passing by luck. test_no_voice_ever_answers_a_voice_over_a_hundred_
    # cries was added on fifty cries at depth 9 (every gate open) and
    # RE-MEASURED at 515 tests: 513 pass, exactly 2 fail — the offset pin and
    # the new sweep, which names six of the fifty counters that raised one.
    "stances-callers-call-callers": (
        "godot/sim/commands/stances.gd",
        "\t\tif int(a[\"weight\"]) > 0 and depth >= from_depth and SimTables.verb_of(a[\"kind\"]) != \"call\":",
        "\t\tif int(a[\"weight\"]) > 0 and depth >= from_depth:  # MUTATED: a voice may answer a voice",
    ),
    # --- Task 2.E3e: sim/commands/purse.gd (no functions of its own — see
    # that file's header; the three rows below guard tables.gd's value_of and
    # apply.gd's GOLD_MOVED/WORLD_INIT arms, the infrastructure test_purse.gd
    # is the ONLY witness for, per the golden-run count in that file's own
    # header: 1 WORLD_INIT with no playerGold key, 0 GOLD_MOVED, of 451
    # events) ---
    # value_of prices a provision at the relic/scroll rate (2) instead of the
    # provision rate (1) — the exact finding the design spec's own mutation
    # pass names (2026-07-30-economy-mining-and-sprites.md §III, Increment A:
    # "pricing provisions as relics fails 1 — that third one passed the whole
    # suite until the proof exposed it, because every other assertion was an
    # inequality against the ceiling rather than the band's shape"). The
    # mutant is the literal 2, not the identifier LOOT_VALUE: that text
    # already occurs twice earlier in this same function (the ARMORY and
    # SCROLLS branches), which trips this script's own count==1 safety guard
    # on restore — the empty-mutant trap's sibling, a collision found live
    # while proving this row rather than predicted.
    # MEASURED: 469 tests, 467 pass, exactly 2 fail —
    # test_pays_less_for_a_thing_you_were_going_to_use_up_than_for_a_thing_you_
    # were_going_to_wear (this task's sharpened, literal-valued case, on its
    # provision loop: expected 1, got 2) AND test_tables.gd's PRE-EXISTING
    # test_every_numeric_table_matches_the_reference, which sweeps value_of
    # against every row of godot/test/fixtures/tables.json and so is ALSO a
    # witness for this exact line — a fact worth recording since it means
    # this mutant is not this task's sole proof of the line, unlike in the
    # TS reference (which had no such fixture sweep). The two remain
    # independently worth keeping: the fixture sweep pins every kind's exact
    # number from a frozen dump, while this test reads SimTables.PROVISIONS/
    # ARMORY/SCROLLS live, so it alone would catch a new kind added to a
    # table without a matching fixture row. test_prices_every_kind_the_
    # dungeon_can_actually_drop (>0) and test_keeps_the_main_dungeon_nominal_
    # pocket_change_never_a_living (<= LOOT_VALUE) both stay green, because a
    # provision priced at 2 is still positive and still at-or-under the
    # ceiling — proof that this task's brief was right to insist those two
    # inequalities cannot stand in for the exact-value case.
    "purse-value-of-provisions-as-relics": (
        "godot/sim/tables.gd",
        "\t\t\treturn PROVISION_VALUE",
        "\t\t\treturn 2",
    ),
    # WORLD_INIT stops reading playerGold from the payload at all, so a
    # descending floor always opens a purse of exactly 0 regardless of what
    # the payload asked to carry — the stairs-carry silently dropped, the
    # exact regression v15's own carry exists to forbid (docs/superpowers/
    # specs/2026-07-30-economy-mining-and-sprites.md §III, Increment A:
    # "WORLD_INIT v14 -> v15 carries playerGold, exactly as v8 taught the
    # satchel to cross the stairs").
    # MEASURED, and the count itself is worth recording: 469 tests, 466 pass,
    # exactly 3 fail, not the 2 this row's own author first predicted —
    # test_apply.gd's PRE-EXISTING test_world_init_carries_the_purse_across_
    # the_stairs (added by Task 2.C1's reviewer, no TS counterpart) is also a
    # witness for this exact line and fails alongside
    # test_carries_what_the_player_had_like_the_satchel_learned_to_at_v9
    # (expected 17, got 0) and
    # test_does_not_let_a_new_floor_forget_money_already_earned_mid_run
    # (expected 9, got 0, on its second assertion; the first, which checks
    # the GOLD_MOVED fold rather than the carry, still passes). The
    # over-confident prediction is left in this comment's history lesson on
    # purpose: this migration's own standing rule is MEASURE, not predict,
    # and this row is why. test_folds_a_floor_that_never_said_to_an_empty_
    # purse is UNCHANGED by this mutant: it already expects 0 for an absent
    # playerGold, which is what the mutant returns unconditionally — the
    # reason that test exists separately from the others, so a broken carry
    # cannot hide behind it.
    "purse-world-init-gold-carry-dropped": (
        "godot/sim/apply.gd",
        "\t\t\t\t\"gold\": _or(p.get(\"playerGold\"), 0),",
        "\t\t\t\t\"gold\": 0,",
    ),
    # GOLD_MOVED stops folding the delta at all — the reducer's one arithmetic
    # step becomes a no-op, so every exchange is recorded but none of them
    # counts. Breaking the fold outright, as distinct from the carry above:
    # the design spec's own three-proof set names this pairing by name
    # ("breaking the stairs carry fails 2 tests, breaking the fold fails 3"),
    # and this row is the one place in the whole file where the prediction
    # and the measurement actually agree on the count — see the row above for
    # the time they did not.
    # MEASURED: 469 tests, 466 pass, exactly 3 fail —
    # test_sums_what_exchange_recorded (both non-zero checkpoints: expected 7
    # after two sales, got 0; expected -43 after the purchase, got 0 — the
    # leading `expect(state.gold).toBe(0)` checkpoint before any GOLD_MOVED
    # is unaffected, since a no-op fold of nothing is still nothing),
    # test_sums_honestly_rather_than_clamping_so_an_unaffordable_spend_is_a_
    # visible_bug (expected -1, got 0), and
    # test_does_not_let_a_new_floor_forget_money_already_earned_mid_run
    # (expected 9 on its OWN first assertion, before the carry is even
    # reached — this mutant and the carry mutant above both fail that test,
    # but for different reasons and on different assertions, which is why
    # both rows earn their own proof rather than sharing one).
    # test_spends_no_randomness_an_exchange_is_arithmetic_not_a_roll is
    # UNCHANGED: it asserts rngCounter, which this line never touches.
    "purse-gold-moved-ignores-delta": (
        "godot/sim/apply.gd",
        "\t\t\tpaid[\"gold\"] = int(state[\"gold\"]) + int(p[\"delta\"])",
        "\t\t\tpaid[\"gold\"] = int(state[\"gold\"])",
    ),
    # --- Task 2.E3b: sim/commands/items.gd ---
    # Disables the dominance guard in take_underfoot's gear ladder: walking
    # would take ANY relic underfoot, tradeoff or sidegrade included, instead
    # of only a strict upgrade. The family hazard named by the brief: "the
    # dominance rule — walking takes only STRICT upgrades; tradeoffs wait for
    # the deliberate key."
    # MEASURED at 513 tests: 508 pass, exactly 5 fail, in two files — wider
    # than first predicted (3, test_loot.gd only), because equipment.test.ts's
    # walk-driven play() also crosses this exact branch. test_loot.gd (3):
    # test_refuses_a_tradeoff_underfoot_the_price_is_nobodys_to_pay_unasked
    # (the heavy edge's speed cost no longer holds it back),
    # test_leaves_a_sidegrade_lying_until_chosen (the sure edge, an equal
    # trade, is no longer left for the , key), and
    # test_a_strict_downgrade_is_still_taken_when_chosen_the_no_better_than_
    # line_was_the_liar (the wax blade downgrade is taken by a bare walk,
    # which the first assertion in that test exists specifically to refuse).
    # test_equipment.gd (2): test_leaves_a_lesser_item_on_the_floor (the
    # weaker keen edge is picked up off the floor instead of staying there,
    # so the item-count and might-total assertions both miss) and
    # test_ignores_an_equal_item_too_a_sidegrade_is_not_worth_the_stoop (the
    # equal-value 'other edge' stops being left behind).
    "items-dominance-rule-bypassed": (
        "godot/sim/commands/items.gd",
        "\tif not deliberate and not SimTables.dominates(grants, worn_grants):",
        "\tif false and not deliberate and not SimTables.dominates(grants, worn_grants):",
    ),
    # Routes a taken relic's gear slot by grant-shape alone (slot_of),
    # skipping the trait-first check (slot_for) that sends a 'ranged' relic
    # to the dedicated 'sling' hand. The family hazard named by the brief:
    # "ranged relics route BY TRAIT to the sling slot (slot_for routes the
    # trait first, slot_of routes the rest by grants)." A leaden sling grants
    # only might, so slot_of alone would route it to 'weapon' — competing
    # with (and, under the dominance rule, losing to) whatever sword is
    # already worn there, instead of taking its own hand beside it.
    # MEASURED at 513 tests: 512 pass, exactly 1 fails —
    # test_walking_takes_the_sling_into_its_own_slot_beside_a_worn_sword_
    # both_stay_might_stacks (test_dual_wield.gd): the sling (might 1) no
    # longer dominates the worn keen edge (might 2) once both are routed to
    # 'weapon', so takeUnderfoot returns null where the test expects a take.
    "items-sling-routed-by-grants-not-trait": (
        "godot/sim/commands/items.gd",
        "\tvar gear_slot: String = SimTables.slot_for(item[\"kind\"], grants)",
        "\tvar gear_slot: String = SimTables.slot_of(grants)",
    ),
    # --- Task 2.E3c: sim/commands/hazards.gd ---
    # Shifts the sight/near sensing roll off its declared counter while
    # leaving TRAP_SENSED's own rngCounter/rngDraws untouched — the exact
    # blind spot this task's brief named by name ("a range assertion cannot
    # see a draw move"). Every PORTED case in test_traps.gd checks the roll's
    # existence, its band, or its ordering against a second roll; none of
    # them recomputes the roll independently via SimRng, so a mutant that
    # reads from counter + 1 while still declaring counter and rngDraws == 1
    # honestly would sail through all sixteen of them.
    # MEASURED at 495 tests: 493 pass, exactly 2 fail —
    # test_the_sense_rolls_needed_and_counter_are_pinned_not_merely_counted
    # and test_the_near_rolls_needed_is_the_near_bases_own_arithmetic, the
    # two non-reference tests added for exactly this reason. Nothing ported
    # from traps.test.ts fails.
    "hazards-sense-roll-offset": (
        "godot/sim/commands/hazards.gd",
        "\tvar roll := SimRng.int_between(int(state[\"seed\"]), counter, 1, 20)",
        "\tvar roll := SimRng.int_between(int(state[\"seed\"]), counter + 1, 1, 20)",
    ),
    # Reads the hatch's own trap level back into its risers' stats — the
    # other hazard this task's brief named by name ("Hatch risers are
    # level-1 bodies, not floor-band"). Reference case :216
    # (test_the_hatch_stands_its_risers_up_inside_the_band...) pins only the
    # riser's POSITION; nothing in the reference suite reads its stats at
    # all, so this rule had no witness of any kind before this task.
    # MEASURED at 495 tests: 494 pass, exactly 1 fails —
    # test_hatch_risers_are_level_1_bodies_never_the_floors_own_band, the
    # one non-reference test written for it. The ported hatch case (:216)
    # does not so much as notice.
    "hazards-hatch-riser-reads-trap-level": (
        "godot/sim/commands/hazards.gd",
        "\t\t\t\"stats\": SimTables.creature_stats(arch[\"kind\"], 1),",
        "\t\t\t\"stats\": SimTables.creature_stats(arch[\"kind\"], int(trap[\"level\"])),",
    ),
    # The spike pit's damage draw, shifted one counter late — the same
    # blind-spot class as the sensing mutation above, on the springing side.
    # rngDraws == 2 (ported case :94) proves two draws happened; it does not
    # prove the second is counter + 1 rather than counter + 2, and every
    # damage assertion in the reference is a range (>= 1, doubled on a
    # dodge-miss) that a shifted-but-still-in-band roll sails through, the
    # identical shape Task 2.E3a measured for resolve_strike before its own
    # pinning test existed.
    # MEASURED at 495 tests: 494 pass, exactly 1 fails —
    # test_the_spike_pits_damage_is_the_consecutive_draw_right_after_its_dodge.
    # Every ported springing case, including :94's own 60-seed sweep over
    # this exact trap kind, passes under the mutant.
    "hazards-spike-pit-damage-draw-skips": (
        "godot/sim/commands/hazards.gd",
        "SimRng.int_between(seed, c, 1, SimTables.SPIKE_DIE)",
        "SimRng.int_between(seed, c + 1, 1, SimTables.SPIKE_DIE)",
    ),
    # --- Wave E fix pass: the EIGHT GAMEPLAY CONSTANTS with no guard ---
    #
    # The Wave E review changed all eight of these and 629 tests stayed green.
    # Every test that named one of them built its fixture FROM the constant and
    # then asserted the branch that reads it, so both goalposts moved together:
    # the exact anti-pattern all five E3 briefs name verbatim and in bold, and
    # the second time this migration has measured it (ai.test.ts's AWARENESS
    # cases were the first, in Task 2.E2).
    #
    # The wave shipped 23 mutation rows and not one of them moved a constant of
    # this class, which is why review caught it and the sweep did not. These
    # eight close that: one row per constant, so the next sweep MEASURES the
    # gameplay numbers instead of trusting a docstring about them. Each was
    # applied and confirmed against a NAMED failing test after the fix.
    #
    # A NOTE ON SCOPE. Every "MEASURED" below is a run of the ONE suite that
    # guards the constant, named with it, except tables-hatch-band, which was
    # measured against the whole suite. The narrow runs are deliberate: the
    # sawtooth suite alone costs ~535s, so eight whole-suite runs is over an
    # hour of wall clock to re-derive a number that only ever needed to be
    # "the named test fails". Two of the eight (MIMIC_IN, POCKET_IN) move
    # generation's draw stream and would ripple into the sawtooth pins by
    # design, so a whole-suite count for them would measure the ripple, not
    # the guard.
    #
    # LURK_RANGE — the coiled stalker's spring. Was guarded only by
    # test_verbs.gd's two cases, which both wrote the quarry's tile as
    # `5 + LURK_RANGE (+ 1)`. Both now spell the tile as a literal (x = 8 is
    # inside the spring, x = 9 is one past), which pins the range from both
    # sides: no other value satisfies both lines.
    # MEASURED against test_verbs.gd: exactly 1 of its 28 fails —
    # test_holds_perfectly_still_while_the_quarry_is_beyond_its_spring.
    "tables-lurk-range-wider": (
        "godot/sim/tables.gd",
        "const LURK_RANGE := 3",
        "const LURK_RANGE := 5",
    ),
    # VIGIL_LEASH — how far a warden is drawn from its post. Was guarded only
    # by `5 + VIGIL_LEASH` and `5 + VIGIL_LEASH + 2`; spelling those as the
    # literals 10 and 12 pins the leash from BELOW only (5 and 7 leave 6 free),
    # so test_verbs.gd's new
    # test_the_vigils_leash_stands_at_exactly_five_steps_of_walking closes the
    # gap at exactly six steps.
    # MEASURED against test_verbs.gd: exactly 1 of its 28 fails — that one,
    # on its second assertion ("six steps from the post is one past the leash
    # — it turns for home").
    "tables-vigil-leash-longer": (
        "godot/sim/tables.gd",
        "const VIGIL_LEASH := 5",
        "const VIGIL_LEASH := 6",
    ),
    # FLARE_RADIUS — how far the flare's knowledge reaches. The reference
    # writes the constant into its own expected payload, so the recorded radius
    # was compared against the number that produced it. test_loot.gd now spells
    # the literal 7.
    # MEASURED against test_loot.gd: exactly 1 of its 14 fails —
    # test_records_where_it_burst_and_how_far.
    "tables-flare-radius-wider": (
        "godot/sim/tables.gd",
        "const FLARE_RADIUS := 7",
        "const FLARE_RADIUS := 9",
    ),
    # BLINK_CLEAR — the blink step's clearance from every living hostile. The
    # reference asserts `|to - foe| >= BLINK_CLEAR`, which re-reads the bound
    # the flood just enforced: a WIDER clearance satisfies it even harder, so
    # the literal alone cannot catch a raise. test_scrolls.gd's new
    # test_the_blinks_clearance_stands_at_exactly_four_steps_of_walking stands
    # two one-tile corridors whose length brackets the bound — an eight-tile
    # corridor must leave the page spent, a nine-tile one must land on x = 9.
    # MEASURED against test_scrolls.gd: exactly 1 of its 12 fails — that one,
    # on the nine-tile corridor (the page goes spent there too at clearance 6).
    "tables-blink-clear-wider": (
        "godot/sim/tables.gd",
        "const BLINK_CLEAR := 4",
        "const BLINK_CLEAR := 6",
    ),
    # TRAP_EATER_REACH — how far the trap eater eats. The reference lays its
    # near trap at `5 + TRAP_EATER_REACH` and its far one nineteen steps off,
    # so any reach from 3 to 18 eats exactly the same one trap. test_scrolls.gd
    # now lays a second trap at FOUR steps — the first tile past the reach —
    # in test_the_trap_eaters_reach_stops_at_three_steps_of_walking.
    # MEASURED against test_scrolls.gd: exactly 1 of its 12 fails — that one:
    # `eaten` comes back with both traps instead of one.
    "tables-trap-eater-reach-longer": (
        "godot/sim/tables.gd",
        "const TRAP_EATER_REACH := 3",
        "const TRAP_EATER_REACH := 5",
    ),
    # HATCH_BAND — where a hatch's risers stand up. The sharpest of the eight:
    # [1, 5] stands a riser DIRECTLY BESIDE the victim, and the reference case
    # named "...never beside you..." went on passing, because it drew the riser
    # FROM the band and then asserted it was IN the band. The bounds are
    # literals now, and test_traps.gd's new
    # test_no_hatch_ever_stands_a_riser_beside_you_over_a_swept_floor sweeps
    # twenty-four seeds so a widened band cannot hide in a single draw.
    # MEASURED against the WHOLE suite: 650 tests, 648 pass, exactly 2 fail —
    # the ported :216 case (a riser 2 steps away against a floor of 3) and the
    # sweep, which reports risers at 1 or 2 steps on eight of its twenty-four
    # seeds (2, 7, 10, 11, 15, 18, 22, 24). Nothing else in the suite moves.
    "tables-hatch-band-reaches-beside-you": (
        "godot/sim/tables.gd",
        "const HATCH_BAND: Array[int] = [3, 5]",
        "const HATCH_BAND: Array[int] = [1, 5]",
    ),
    # MIMIC_IN — the mimic's rarity, 1 floor in this many. Was guarded by a
    # ceiling of `2 * trials / MIMIC_IN`, which comes DOWN to meet a thinner
    # rate. A band cannot be made to work at this sample size and that is
    # measured, not assumed: 1-in-6 over 60 floors predicts 10 with sigma 2.9,
    # this seed range actually draws 14, and 1-in-8 draws 8 — any band holding
    # 14 also holds 8. test_mimics.gd pins the count as the literal 14.
    # MEASURED against test_mimics.gd: exactly 1 of its 6 fails —
    # test_never_on_the_teaching_floor_rarely_at_most_once_past_it_wearing_a_
    # plausible_kind, reporting 8 where 14 was pinned.
    "tables-mimic-in-rarer": (
        "godot/sim/tables.gd",
        "const MIMIC_IN := 6",
        "const MIMIC_IN := 8",
    ),
    # POCKET_IN — roughly one creature in this many is born carrying. Both
    # goalposts were `1/POCKET_IN ± 0.15` and moved down with the rate.
    # test_pockets.gd now spells the band as the literals 0.283 and 0.383: one
    # body in three is 0.333, one in four is 0.250, one in two is 0.500, so the
    # band excludes both neighbours while still clearing the sampling noise
    # (132 bodies over thirty seeds, sigma about 0.04). Measured on the shipped
    # constant: 44 of 132, dead on 0.3333.
    # MEASURED against test_pockets.gd: exactly 1 of its 6 fails —
    # test_about_one_in_three_carries_the_carried_kind_is_always_a_real_kind_
    # the_mimic_always_hoards, at 0.250.
    "tables-pocket-in-rarer": (
        "godot/sim/tables.gd",
        "const POCKET_IN := 3",
        "const POCKET_IN := 4",
    ),
    # --- Task 3.4: godot/stage/input/Keymap.gd ---
    # Keymap has no TS reference to drift from (debug.ts has no test file at
    # all), so these rows are not "did the port keep a signed constant" —
    # they are "does test_keymap.gd actually pin the mapping, or just its own
    # shape". Each mutant is a single row of the private lookup tables or the
    # modal-arm descriptor, restorable independently.
    #
    # ArrowUp's delta — flips north to south for the arrow key only, leaving
    # w's own (separately-keyed) entry untouched.
    # MEASURED against test_keymap.gd: exactly 2 of 42 fail —
    # test_arrow_up_unarmed_walks_north and test_arrow_up_armed_shoves_north.
    # w's north tests, and every other direction, are unaffected.
    "keymap-arrow-up-delta": (
        "godot/stage/input/Keymap.gd",
        '"ArrowUp": [0, -1], "w": [0, -1],',
        '"ArrowUp": [0, 1], "w": [0, -1],',
    ),
    # x's (arms, clears) pair — the modal shove's one load-bearing exception.
    # Setting clears=true alongside arms=true breaks the invariant the whole
    # design rests on: "exactly one of arms/clears is ever true."
    # MEASURED against test_keymap.gd: exactly 3 of 42 fail —
    # test_x_arms_the_shove_and_names_no_command,
    # test_x_pressed_again_while_already_armed_stays_armed, and
    # test_arms_and_clears_are_mutually_exclusive_across_every_bound_and_unbound_key
    # (two failed asserts inside that last one, armed=false and armed=true).
    "keymap-x-clears-too": (
        "godot/stage/input/Keymap.gd",
        'return _descriptor("", 0, 0, true, false)',
        'return _descriptor("", 0, 0, true, true)',
    ),
    # q/Q's satchel slots, swapped — the case-sensitive half of the mapping.
    # MEASURED against test_keymap.gd: exactly 2 of 42 fail —
    # test_lowercase_q_uses_the_first_satchel_slot and
    # test_uppercase_q_uses_the_second_satchel_slot.
    "keymap-satchel-slots-swapped": (
        "godot/stage/input/Keymap.gd",
        '"q": "use_carried_0",\n\t"Q": "use_carried_1",',
        '"q": "use_carried_1",\n\t"Q": "use_carried_0",',
    ),
    # The unbound-key fallback — the empty descriptor that c/t/g/m/n/p (and
    # anything else this file has no name for) is supposed to get instead of
    # a guessed verb. Mutated to guess "wait" instead of naming nothing.
    # MEASURED against test_keymap.gd: exactly 8 of 42 fail — the six named
    # letters (c/t/g/m/n/p), test_a_key_this_game_has_no_name_for_also_
    # resolves_to_nothing (two failed asserts inside it), and
    # test_an_unbound_key_still_clears_an_armed_shove.
    "keymap-unbound-guesses-wait": (
        "godot/stage/input/Keymap.gd",
        "\treturn _descriptor(\"\", 0, 0, false, true)",
        "\treturn _descriptor(\"wait\", 0, 0, false, true)",
    ),
}

if len(sys.argv) > 1 and sys.argv[1] == "--list":
    for key in MUTATIONS:
        print(key)
    raise SystemExit(0)

name = sys.argv[1]
restore = len(sys.argv) > 2 and sys.argv[2] == "restore"
if name not in MUTATIONS:
    raise SystemExit(f"unknown mutation {name!r}; try --list")
path, original, mutant = MUTATIONS[name]
src = open(path).read()
find, put = (mutant, original) if restore else (original, mutant)
count = src.count(find)
assert count == 1, f"{name}: expected exactly 1 occurrence in {path}, found {count}"
open(path, "w").write(src.replace(find, put))
print(f"{'restored' if restore else 'mutated'}: {name} in {path}")
