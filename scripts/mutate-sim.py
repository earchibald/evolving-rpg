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
