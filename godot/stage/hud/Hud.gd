class_name Hud
extends CanvasLayer
## What the run looks like from inside it — the stage's twin of the web UI's
## status column.
##
## ── Everything here is DERIVED, and that is the whole design ─────────────
## `xp`, `level` and `gold` are folded from history and never stored (covenant
## M9). A HUD that kept a running total — added the gold as it saw GOLD_MOVED go
## by, incremented the level when it saw a kill — would be a second source of
## truth, and it would drift the first time an event arrived twice, out of
## order, or during a rewind. So this reads every number out of the state it is
## handed and computes nothing.
##
## `read(state)` is the whole contract: hand it a fold, it says what it says. It
## keeps no counters between calls, which is what makes it correct under a
## rewind for free.
##
## ── The Oracle's voice is not here yet ───────────────────────────────────
## The chronicle's authored lines come from `canon/` and the Oracle bridge,
## which is Phase 5. This phase shows the plain fallback text — the event's own
## type and the plain facts — rather than a stub that formats like prose and
## reads like nothing. A message log that looks finished and is not is worse
## than one that visibly is not.

## The panel's own reading of the world. A plain Dictionary rather than a pile
## of setters, so a test can assert what the HUD BELIEVES without touching a
## single node — the panel's own labels are a rendering of this, and this is
## what is worth testing.
var shown: Dictionary = {}

## The last few lines of the chronicle, newest last. Bounded: a run is thousands
## of events long and a message log that grows without limit is a memory leak
## with a scrollbar.
const LOG_LINES := 8
var lines: Array = []


func _ready() -> void:
	if Chronicle.event_appended.is_connected(_on_event):
		return
	Chronicle.event_appended.connect(_on_event)
	Chronicle.world_replaced.connect(_on_world)


func _on_world(state: Dictionary) -> void:
	lines = []
	read(state)


func _on_event(event: Dictionary, state: Dictionary) -> void:
	note(event)
	read(state)


## Read the world. Every field comes out of the fold; nothing is remembered
## between calls.
func read(state: Dictionary, player_id: String = "player") -> Dictionary:
	var found: Variant = SimEntity.find(state["entities"], player_id)
	if found == null:
		# A dead or absent player is a real state — the run is over and the
		# panel still has to say something. Not an error, and not a crash.
		shown = {
			"alive": false,
			"depth": state["depth"], "turn": state["turn"],
			"xp": state["xp"], "level": state["level"], "gold": state["gold"],
			"satchel": [], "scroll": null,
		}
		return shown

	var me: Dictionary = found
	var stats: Dictionary = me["stats"]
	var carried: Array = []
	# ABSENT when empty, never null — the absent-key law, and the reason this
	# reads with has() rather than a null check.
	if me.has("satchel"):
		for slot: Dictionary in (me["satchel"] as Array):
			carried.append(slot["kind"])

	shown = {
		"alive": true,
		"hp": stats["hp"], "maxHp": me["maxHp"],
		"might": stats["might"], "wits": stats["wits"], "speed": stats["speed"],
		# Derived, all three. See the class docstring.
		"xp": state["xp"], "level": state["level"], "gold": state["gold"],
		"depth": state["depth"], "turn": state["turn"],
		"satchel": carried,
		"scroll": (me["scroll"] as Dictionary)["kind"] if me.has("scroll") else null,
		"tags": (me["tags"] as Array).duplicate(),
	}
	return shown


## One line of chronicle, in the plain voice. Phase 5 replaces this with the
## authored one; until then it says the true thing plainly rather than
## pretending to a register it does not have yet.
func note(event: Dictionary) -> void:
	var said := plain(event)
	if said == "":
		return
	lines.append(said)
	while lines.size() > LOG_LINES:
		lines.pop_front()


## The fallback voice. Deliberately flat: these are facts, not prose, and
## dressing them up here would make the Oracle's absence harder to notice.
static func plain(event: Dictionary) -> String:
	var p: Dictionary = event.get("payload", {})
	match String(event["type"]):
		"WORLD_INIT":
			return "a floor opens"
		"MOVE":
			return ""                       # a step is not worth a line
		"MOVE_BLOCKED":
			return "blocked"
		"WAIT":
			return "you hold still"
		"STRIKE":
			if not bool(p.get("hit", false)):
				return "a blow misses"
			return "a blow lands for %d" % int(p.get("damage", 0))
		"ITEM_TAKEN":
			return "taken"
		"ITEM_REFUSED":
			return String(p.get("reason", "refused"))
		"ITEM_USED":
			return "used"
		"SCROLL_READ":
			return "the page is spent"
		"GOLD_MOVED":
			return "%+d gold" % int(p.get("delta", 0))
		"TRAP_SPRUNG":
			return "a trap springs"
		"TRAP_SENSED":
			return "something is wrong with this floor" if bool(p.get("revealed", false)) else ""
		"SHOVE":
			return "shoved"
		"BRACED":
			return "you set yourself"
		"DRAWN":
			return "you draw"
		"CALLED":
			return "a cry goes up"
		"UNMASKED":
			return "it was never furniture"
		"WORLD_STIRRED":
			return "the floor answers back"
		"VIGIL_KEPT":
			return "it knits itself shut"
		"RULE_RATIFIED":
			return "a new law stands"
		"RULE_FIRED":
			return "the law speaks"
		"TURN_ADVANCED":
			return ""                       # the clock is not news
	return ""
