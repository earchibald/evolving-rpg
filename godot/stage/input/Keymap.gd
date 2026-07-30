class_name Keymap
## The hands — a pure mapping from a key press to a verb descriptor, and
## nothing else. This is deliberately NOT an `_input` handler: `resolve()`
## calls no command, touches no node, and has no side effect of any kind.
## Two calls with the same two arguments always return the same Dictionary.
##
## That purity is not a style preference — it is what Task 3.9, the whole
## phase's exit gate, is built on. The gate replays a documented keystroke
## list with no window and no rendering, feeding each key through
## `resolve()` -> a `SimCommands` call -> `Chronicle.commit()`, then compares
## the resulting chain head. An `_input` handler that calls a command
## directly cannot be driven that way headlessly; a pure function can,
## trivially, from a plain GUT test with no scene tree at all.
##
## ── The descriptor ─────────────────────────────────────────────────────────
## `resolve()` always returns exactly these five keys, per the plan's fixed
## shape:
##   verb   : String  the SimCommands entry point the caller should call, or
##            "" when this key names no command at all (see "unbound keys").
##   dx, dy : int      a movement delta. Meaningful only when verb is
##            "attempt_move" or "shove_at"; 0 for every other verb, including
##            the empty one — a stray direction must never leak out of a
##            non-directional key.
##   arms   : bool     true only for the one key that arms the shove.
##   clears : bool     true for every key that should drop an armed shove.
## The caller (a future TurnManager / player-input node, Task 3.5+) owns the
## `armed` flag itself and folds these two booleans into it; `resolve()`
## never mutates its arguments or any state of its own — there is none.
##
## ── Key strings ────────────────────────────────────────────────────────────
## `key` is expected in the same vocabulary ts-baseline's own handler reads
## off `KeyboardEvent.key`: the arrow keys as "ArrowUp" / "ArrowDown" /
## "ArrowLeft" / "ArrowRight" (src/ui/debug.ts:622-625's `KEYS` table), the
## letters exactly as typed — lower-case "q" and upper-case "Q" are DISTINCT
## keys here, same as the reference — and space as a literal single " ".
## Translating a Godot `InputEventKey` into one of these strings is the
## wiring caller's job, not this file's: that translation needs `Input`/
## `OS` and a live event, which would make this function impure by
## definition.
##
## ── The shove's modal arm ──────────────────────────────────────────────────
## Ported from `src/ui/debug.ts`'s `keydown` handler (read at
## `git show ts-baseline:src/ui/debug.ts`, the block running from the '.'/
## space check down through the trailing `shoveArmed = false;` fallback,
## roughly lines 2640-2700 — not from memory, per the task brief). `x` arms:
## `shoveArmed = true`, and the view says "shove — which way?". EVERY OTHER
## KEY clears it — the reference sets `shoveArmed = false` unconditionally at
## the top of every one of its other branches (hold, use, use-second, read,
## brace, volley, take), and again in the catch-all line that runs when
## nothing else matched at all. Only the 'x' branch skips that assignment.
##
## So here: `arms` is true iff `key == "x"`; `clears` is true for every other
## key, UNCONDITIONALLY — independent of the incoming `armed` value, exactly
## as the reference's assignment is unconditional rather than an `if armed:`
## guard. A direction key pressed while armed does double duty: it both
## spends the arm (clears) AND changes verb from "attempt_move" to
## "shove_at". There is no third "spent" state in this shape because, from
## the caller's side, "spent" and "cleared" are the identical instruction:
## "your stored armed flag is now false." What makes the spend a shove rather
## than a plain step is carried entirely by `verb`, not by an extra flag.
##
## Pressing 'x' again while already armed re-arms (stays true, re-says the
## prompt) rather than toggling off — the reference's 'x' branch always
## assigns `true` unconditionally, never reads the current value first.
##
## ── Why `f`'s two beats are NOT resolved here ──────────────────────────────
## The manual (§2) and the plan both describe `f` as one key, two beats:
## undrawn, it draws (a turn, seen by all — covenant M8's tell); drawn, it
## looses at a computed mark. Debug.ts's own `volley()` (~line 2494) does not
## decide between them either — it just calls `playerVolley()`, and it is
## THAT function (`src/play/session.ts:329-350`) that reads
## `me.tags.includes('drawn')` to choose `drawStance(...)` or
## (`shotTarget(...)` then) `looseShot(...)`. That is exactly the reference's
## own layering: the keyboard layer names the verb; the session/turn layer —
## which alone holds the folded state — decides which half applies right now.
##
## `resolve()` has no `state` parameter, by the plan's own fixed signature.
## It therefore cannot read an entity's tags, and so CANNOT make the
## draw-or-loose decision even if that seemed convenient — this is not a
## preference between two equally workable designs, it is what the given
## signature forces. Contrast the shove: the plan threads `armed` through the
## signature explicitly, which is the plan's own way of saying that piece of
## state belongs on this side of the line. No matching parameter exists for
## "is the sling already drawn", so that state stays on the far side, with
## the caller that can actually see it.
##
## So: `f` always resolves to the single verb "volley" — the name
## `SimTables`/`ai.gd` already use for this discipline (`ai.gd:355`,
## `tables.gd:199`), not invented here — and the caller is responsible for
## reading the acting entity's "drawn" tag off `Chronicle.state()` and
## calling either `SimCommands.draw_stance` or `SimCommands.shot_target` +
## `SimCommands.loose_shot`. Keeping that branch out of this file is the only
## way to keep `resolve()` pure, not merely a tidier way to write it.
##
## ── `q` / `Q` and the satchel slot ──────────────────────────────────────────
## Two distinct verb strings ("use_carried_0", "use_carried_1") rather than
## one "use_carried" verb plus a slot carried in `dx`. The descriptor shape
## the plan fixes has no slot field, and repurposing `dx` — documented above
## as a movement delta — to secretly mean "satchel slot" would make it lie
## about what it holds for the one caller that reads it literally.
##
## ── Unbound keys ───────────────────────────────────────────────────────────
## `c` / `t` / `g` / `m` / `n` / `p` name the witness, the gamemaster, the
## forge, the screen, worlds and the palette — Phase 5 and later work. They
## are not stubbed with a placeholder verb; they fall through to the same
## empty descriptor (`verb == ""`) that any key this file has never heard of
## gets, so a key that does nothing is visibly NOT YET a key rather than
## silently a wrong one. One "no verb" path handles all of them, plus every
## key this game has no name for yet — there is no per-key blocklist to keep
## in sync as Phase 5 and later claim these letters.
##
## `run` (shift + a direction, `src/ui/debug.ts`'s `running()`) is likewise
## out of scope here: it is not a row in the plan's keys table, it drives a
## multi-frame animated walk rather than naming a single command, and its
## start/stop state is exactly the kind of thing Task 3.5's turn shell owns.
##
## ── Reconciliation ─────────────────────────────────────────────────────────
## NON-REFERENCE. `src/ui/debug.ts` has no TypeScript test file of its own —
## `git ls-tree -r ts-baseline --name-only | grep -i debug` finds only
## `debug.ts` and `debug.css`; its keyboard handling has only ever been
## exercised by hand, in a browser. Every case in `test_keymap.gd` is
## therefore written against THIS FILE's own contract (this docstring, and
## the plan's keys table) rather than a ported `it(...)`, standing in for the
## manual QA the reference's verb-wiring got instead of a suite. Where a
## row's behaviour matters, it is checked against what
## `git show ts-baseline:src/ui/debug.ts` actually does — never against this
## file's own tables, which is exactly the constant a test must not validate
## against itself.


## Movement deltas, one entry per key string the reference recognizes for a
## step (`src/ui/debug.ts:622-625`'s `KEYS`), including the DOM arrow-key
## names it maps from. Duplicated per key rather than aliased through a
## second lookup, so the table reads as a flat fact.
const _DIRECTIONS: Dictionary = {
	"ArrowUp": [0, -1], "w": [0, -1],
	"ArrowDown": [0, 1], "s": [0, 1],
	"ArrowLeft": [-1, 0], "a": [-1, 0],
	"ArrowRight": [1, 0], "d": [1, 0],
}

## The fixed, unconditional verbs: every key here names exactly one
## SimCommands entry point no matter what else is true. See the class
## docstring for why `q`/`Q` get distinct verbs instead of a shared one plus
## a slot argument.
const _VERBS: Dictionary = {
	".": "wait", " ": "wait",
	"z": "brace_self",
	"f": "volley",
	"q": "use_carried_0",
	"Q": "use_carried_1",
	",": "take_or_refuse",
	"r": "read_scroll",
}


static func _descriptor(verb: String, dx: int, dy: int, arms: bool, clears: bool) -> Dictionary:
	return {"verb": verb, "dx": dx, "dy": dy, "arms": arms, "clears": clears}


## The one entry point. Pure: reads only its two arguments, returns a fresh
## Dictionary built fresh on every call, touches nothing else — no autoload,
## no node, no static/member state carried between calls.
static func resolve(key: String, armed: bool) -> Dictionary:
	if key == "x":
		# Arms unconditionally — see the modal-arm section above for why a
		# second press while already armed does not toggle it off.
		return _descriptor("", 0, 0, true, false)

	if _DIRECTIONS.has(key):
		var delta: Array = _DIRECTIONS[key]
		var verb: String = "shove_at" if armed else "attempt_move"
		return _descriptor(verb, int(delta[0]), int(delta[1]), false, true)

	if _VERBS.has(key):
		return _descriptor(String(_VERBS[key]), 0, 0, false, true)

	# Everything else — the deliberately unbound c/t/g/m/n/p among them, and
	# any key this file has no name for at all — resolves to nothing, and
	# still clears an armed shove (see the modal-arm section: unconditional,
	# not gated on whether anything was actually armed).
	return _descriptor("", 0, 0, false, true)
