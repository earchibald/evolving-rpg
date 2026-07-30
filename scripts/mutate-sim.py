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
