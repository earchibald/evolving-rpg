#!/usr/bin/env bash
# Headless test entry — the only way tests are run in this repo.
#
# Standard Godot, never Xogot: Xogot has no headless mode, so every gate in the
# migration (GUT suites, fixture parity, autoplay, golden generation, CI) runs
# here. Xogot is an editing surface, not the automation backbone.
#
# Default: `godot` on PATH (4.7.1.stable at plan time); CI overrides $GODOT.
#
# THE SCRIPT-COUNT GUARD, and why it exists: GUT sets a non-zero exit code for
# a FAILING test, but a test file that fails to PARSE is not a failing test —
# it is silently skipped, and the run exits 0. A typo'd identifier could
# therefore retire a whole suite while CI stayed green, which for a migration
# whose entire claim is "the ported tests pass" would be a silent lie. So we
# count `test_*.gd` on disk and refuse any run that executed fewer.
set -euo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")"

# Refresh the .godot cache so class_name registrations are visible to the run.
# Failure here is not fatal — a cold cache still imports during the run itself.
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true

OUT="$(mktemp -t gut-run)"
trap 'rm -f "$OUT"' EXIT

set +e
"$GODOT" --headless --path . -s addons/gut/gut_cmdln.gd \
	-gdir=res://test -ginclude_subdirs -gexit "$@" 2>&1 | tee "$OUT"
RC="${PIPESTATUS[0]}"
set -e

# Only enforce the guard on a full run; a caller narrowing the run with
# -gselect/-gtest/-gunit_test_name deliberately executes a subset.
if [[ "$*" != *-gselect* && "$*" != *-gtest* && "$*" != *-gunit_test_name* ]]; then
	EXPECTED="$(find test -name 'test_*.gd' -type f | wc -l | tr -d '[:space:]')"
	RAN="$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$OUT" | awk '/^Scripts[[:space:]]+[0-9]+/ {print $2; exit}')"
	if [[ -z "$RAN" ]]; then
		echo "test.sh: FAILED — GUT printed no script total; the run did not complete." >&2
		exit 1
	fi
	if [[ "$RAN" -ne "$EXPECTED" ]]; then
		echo "test.sh: FAILED — GUT ran $RAN script(s) but $EXPECTED test_*.gd exist on disk." >&2
		echo "test.sh: a skipped script is almost always a parse error. Grep the output for 'Parse Error'." >&2
		exit 1
	fi
fi

exit "$RC"
