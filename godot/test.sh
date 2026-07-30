#!/usr/bin/env bash
# Headless test entry — the only way tests are run in this repo.
#
# Standard Godot, never Xogot: Xogot has no headless mode, so every gate in the
# migration (GUT suites, fixture parity, autoplay, golden generation, CI) runs
# here. Xogot is an editing surface, not the automation backbone.
#
# Default: `godot` on PATH (4.7.1.stable at plan time); CI overrides $GODOT.
set -euo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")"
# Refresh the .godot cache so class_name registrations are visible to the run.
# Failure here is not fatal — a cold cache still imports during the run itself.
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
exec "$GODOT" --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://test -ginclude_subdirs -gexit "$@"
