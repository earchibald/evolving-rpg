# The Living Dungeon — bigger boards, dispositions, mimics, traps, pockets, scrolls, and a legible surface

*2026-07-29, from the designer's goal. Companion math lands in BALANCE.md
("The board breathes"); MAPS.md gains the size table; MANUAL.md gains the
player words. Everything here obeys the Covenant: command-time resolution,
counted draws, apply as arithmetic, absence-reads-legacy.*

## Why bigger, in the designer's own frame

> "The current level size is fine for the simplistic mechanics we currently
> have, but to really have the new elements be both rare enough to be
> differentiated and interesting, and have enough ROOM to happen, we need
> to be bigger."

So the board is not growing to hold more of the same — it is growing to
hold *rarity*. The math below deliberately keeps encounter pressure per
journey roughly flat while the ground quadruples: the new elements (a
patrol crossing a distant hall, a trap sensed at the edge of sight, one
item on the floor that is not an item) get room to be met one at a time.

## 1. Three board sizes, chosen at the door

| name | size | area | stretch S | note |
|---|---|---|---|---|
| **the vale** | 48×32 | 1,536 | 1 | today's board; stays fully pinned |
| **the expanse** | 96×64 | 6,144 | 2 | **the new default** — 4× area |
| **the waste** | 128×96 | 12,288 | 3 | 8× area |

`sizeStretch(width, height) = max(1, round(sqrt(width·height / 1536)))` —
one integer knob derived from dimensions already recorded in WORLD_INIT,
so **board size needs no schema change** and every tiny test board reads
stretch 1 (unchanged). A world keeps its size across descents: `descend`
reads dims off the current grid instead of UI constants.

**The options sheet.** "another world" opens a `<dialog class="sheet">`
(house style, `.world-option` rows): three size choices with plain-words
descriptions, an optional seed field (blank draws one), begin. First boot
and wipe use the default silently. The generator's room-count cap scales
with area (16·S², absolute cap 64) so motif density per tile — the feel
of a warren, the breath of the halls — is preserved at any size.

**Camera.** The play view renders a window (up to 48×32) centered on the
player, clamped to the board — the DOM cell count never grows with the
world. A fog-respecting minimap (canvas, a few px per tile) keeps the
journey legible: seen shape, the player, the way out once known.

## 2. The budget math (why S, not S²)

Meetings along a journey ≈ density × sensing width × path length.
Path length scales with linear dimension (≈S); flat-density monsters
would scale count with area (S²), making meetings ≈ S× today's — a
blender. Holding meetings flat instead requires **count ∝ S**:

- **Spawn budget:** `spawnBudget(depth) × S`. The expanse fields ~2× the
  creatures of the vale spread over 4× ground — locally *sparser*, which
  is the breathing room, with wanderers (below) supplying the liveliness.
- **XP stretch:** kills per cleared floor scale ≈S, so `XP_TO_REACH`
  thresholds scale ×S (`levelForXp(xp, S)`) — levels-per-floor stays the
  tuned curve at every size. Derived from grid dims in apply; no event.
- **Provisions:** S per floor (1 / 2 / 3), each drawn from the depth's
  pantry with its own counted draw, all off-path and unguarded.
- **Relics:** depth 1 keeps exactly one keen edge ON the walked path (the
  teaching invariant is size-independent); depth 2+ owes `2 + (S−1)`
  (2 / 3 / 4), drawn without replacement, each guarded.
- **Wardens:** one keeper, whatever the acreage — a boss is a peak, not
  a percentage.

## 3. Dispositions — guards and wanderers

Recorded per creature at generation (WORLD_INIT v10, optional fields;
absence reads exactly today's behavior: stand, hunt within AWARENESS 8,
freeze where you lost the scent).

- **Guards** (`disposition: 'guard'`): relic guards, plus a drawn share
  of free spawns. A guard hunts inside `GUARD_LEASH` (4, walk distance
  from post) and **walks home** when the leash empties — the vigil's
  homeward half, generalized, without the warden's mend-and-knit. Rooms
  stay owned; guards stop drifting off their prizes mid-chase.
- **Wanderers** (`disposition: 'wander'`, from depth 2): carry a `route`
  of 2–4 drawn room centers (recorded in the seed — counted draws), and
  walk it in a cycle: head to `route[leg]`, and on arrival the reducer
  advances `leg` (derived, silent, replay-exact — the venom precedent).
  The hunt interrupts the walk exactly as it interrupts standing; losing
  the scent resumes the round. Patrol pathing reuses the hunt's BFS with
  the cap widened to the board (a waypoint is farther than prey).
- The warden's vigil is untouched; the keeper never wanders.

Depth 1 keeps everything still but guards' homing — the teaching floor
teaches the bump before it teaches the patrol.

## 4. Mimics — the item that bites first

*Very rare on purpose: 1 floor in 6, depth 2+, at most one.* A `mimic`
is an entity born with tag `hidden` and a `guise` — a plausible item kind
drawn from the floor's tables. The play view renders it as that item,
family colors and all; it takes no actions while hidden (`verb: 'feign'`);
it is placed on room floor, off the walked path, min distance from start.

Walking onto it — the reach for a prize — resolves to **UNMASKED v1**
(the move is spent; you got close enough to touch it). The reducer strips
`hidden` and writes the `ambush` tag: the mimic's first blow this same
round rolls one damage band harder through the stalker's existing sprung
machinery. "The mimic gets first strike" costs zero new combat code.

Honest tells, kept deliberately: creatures path around it (bodies are
bodies), and the `,` key does nothing on it (there is no item). Priced
into threat ×1.3; never in `chooseSpawns`' random pool (weight 0 — the
mimic roll is its own draw).

## 5. Traps — detection, dodge, a researched multitude

Placed at generation (WORLD_INIT v10 `traps`), depth 2+ — never on the
teaching floor, never on the walked path's first steps, never under
items or spawns. Count ≈ `trapsBase(depth) × S` (2/3/4 by band × S),
about one per thousand tiles at default — Brogue's order of rarity.

One doctrine from our own shelf pushes back here: agent-adventures (the
sibling survey, appendix) ruled *"hidden = chore; visible = puzzle"* and
shipped no detection rolls at all. The designer asked for detection rolls
explicitly, so they stay — but the sibling lesson tunes them: the two
chances compound high enough that **most traps are found things** (a
visible puzzle you route around), the rare miss is the story, and a
revealed trap earns the pre-commit courtesy their engine taught — the
status line says plainly when the next step is onto a known trap.

**Detection is two recorded chances, each rolled once ever per trap:**

1. **Sight** — the first time the trap is inside the engine's own sight
   disc (`sightAt(depth)`, `clearShot` honest line): roll `d20 + wits ≥
   10 + 2·trapLevel` → the trap is revealed (marked on the map).
2. **Very near** — first time within 2 steps of walking, if still
   unseen: `d20 + wits ≥ 8 + 2·trapLevel` — closer is easier.

`trapLevel = min(3, ceil(depth/3))`. At depth 4 (trapLevel 2, wits 4-5)
the two chances compound to ≈83% — most traps are a *found* thing, and
the ones that are not are a story. Rolls ride **TRAP_SENSED v1** events
drafted right after the player's action (and after the world's turns, so
a trample-shove into new sight still checks). Stepping onto a trap —
revealed or not — resolves **TRAP_SPRUNG v1** on the move, dodge and
effect included, drawn and recorded whole.

**Dodge:** `d20 + speed ≥ 12 + 2·trapLevel`, only where the kind allows:

| trap | effect (recorded resolved) | dodge | from |
|---|---|---|---|
| spike pit | `1d4 + floor(depth/2)` damage | yes | 2 |
| venom needle | the stinger's venom, 4 rounds | **from level 3** | 2 |
| strangling snare | rooted 3 rounds (`snared-N`; moves refuse, blows still swing) | yes | 2 |
| alarm bell | the floor knows you: hunts ignore the awareness cap for 12 rounds | no — by design | 3 |
| hatch | one riser, drawn from the floor's band, rises 3–4 steps away (never adjacent — the spawn's first strike is avoidable by moving) | no | 3 |
| nest hatch | two–three risers, same law | no | 5 |
| the maw | the floor gives way: `1d6 + 2` fall damage and you land on the floor below — no stair rest, satchel kept | no — you cannot dodge the floor | 4, never on 9 |
| lodestone | drawn far tile swallows you — elsewhere, instantly | no | 4 |

Snare's refusal is a new `reason: 'snared'` on MOVE_BLOCKED — a new
value in an existing field, no bump (the magic-modes doctrine). Venom,
stagger, CALLED-shaped risers, and the descent ceremony are all existing
machinery wearing new clothes; the maw calls a forced descend (same seed
derivation as the stairs — the world below is the world below, however
you arrive). Creatures do not spring traps this pass (deferred, noted).

## 6. Monster pockets — and the visibility policy, reconsidered

Roughly **one creature in three** is born carrying (drawn at generation,
recorded in its seed): mostly a provision, sometimes a scroll, rarely a
relic (70/25/5 by weight, depth-gated like every table). On death — any
death: blow, slam, rule — the reducer sets the pocket down where the
body fell (derived, silent, the creditKills precedent), nudged one tile
by fixed order if an item already lies there.

**The policy change:** the always-visible rule now reads *"what the
floor owns is visible; what a body carries is not."* Floor items stay
lit exactly as today. Pocket loot is invisible until it drops — the
first hidden information the item layer has ever had, and the reason
fighting a wanderer that found you in a corridor can pay. Chests are
**deferred**: this pass already adds two hidden-information channels
(pockets, mimics); a third container teaches nothing new yet — and when
chests come, mimics are already built to wear them.

## 7. Scrolls — one slot, a magic, world-minted labels

A new carry class beside gear and satchel: **you hold at most one
scroll.** Walk-over takes it when the hand is empty; `,` swaps; **r**
reads it (freed below). Found on floors (about one in three, depth 2+)
and in pockets. Reading resolves **SCROLL_READ v1** at command time —
effect drawn, recorded whole — and spends it.

Unread scrolls wear a world-minted label — "a scroll marked ULM-KETH" —
composed deterministically from the world root (the namesmith's little
sibling; no model, no draw). The first read of a kind identifies it for
that world forever: *derived from the chain* (any SCROLL_READ of the
kind behind you), never stored. Five kinds, none of them damage — the
designer already felt overpowered, so scrolls buy knowledge, position
and time:

| scroll | does | from |
|---|---|---|
| unveiling | every secret door and every trap on the floor, revealed | 2 |
| the still hour | every hostile on the floor spends its next action reeling | 2 |
| the trap eater | eats every trap within 3 steps of walking — gone | 3 |
| the blink step | a drawn tile at least 4 steps of walking from every hostile swallows you | 3 |
| stone song | the walls within 2 tiles sing to dust — wall becomes floor (border, exits and secrets excepted) | 4 |

Stone song is the one that touches the grid; it only ever *adds* floor,
so reachability invariants cannot break. Blink and unveiling teach the
fog two new absorb branches (blink also fixes a found defect: the fog
never read STRIKE movement, so a trampled player's sight lagged a tile).

## 8. The UI run — bright, organized, always-on

Found root cause of the dimness: `--faint` text (#5b6472) compounded by
`button kbd { opacity: .6; color: inherit }` lands key badges at ≈#3c434e
on #14161a — far below WCAG. The fix is a contrast pass, not a redesign:
hints rise to `--soft`, `--soft` itself brightens, kbd badges drop the
opacity trick and wear `--ink` on raised ground; every command legend
targets AA (4.5:1).

**Organization:**
- **A dungeon command bar, always visible** under the board: move/strike
  · hold `.` · take `,` · satchel `q Q` · read `r` · shove `x` · brace
  `z` · volley `f` — the running-the-dungeon set, never hidden behind `?`.
- **A command palette on `p`** for everything meta: talk, world, forge,
  screen, verify, fork, back 10, witness, wipe — rendered from KEYMAP
  (still the single source of truth), filterable, Enter runs. The old
  single keys keep working; the palette is the discovery surface, and
  the sidebar slims to world…/palette/keys.
- The global `r` = begin-again proxy is **removed** (a one-key run reset
  was a footgun; begin-again lives in the world sheet) — which is what
  frees `r` to read scrolls.

## 9. Schema and events, in one place

- **WORLD_INIT v10** (one bump for the whole brood; all optional,
  absence reads legacy): opponents gain `disposition?`, `route?`,
  `guise?`, `pocket?`; payload gains `traps?`.
- **ITEM_TAKEN v5**: `scroll?: { swappedOut: string | null }`.
- **New events** (v1): `TRAP_SENSED`, `TRAP_SPRUNG`, `UNMASKED`,
  `SCROLL_READ`. TRAP_* ride the action that caused them (no turn);
  UNMASKED and SCROLL_READ spend the turn.
- **No-bump extensions:** MOVE_BLOCKED `reason: 'snared'`; state grows
  `traps`, `alarm`; Entity grows `scroll?`, `leg?`, `disposition?`,
  `route?`, `guise?`, `pocket?`.
- Golden regenerates once (gated), sawtooth re-pins: the vale keeps its
  five pins re-measured, the expanse gains its own (traps, wanderers and
  pockets all move outcomes from depth 2 down).

## 10. What this pass does NOT do (recorded refusals)

- Chests (deferred with reasons, §6). Creature-sprung traps (§5).
- Diagonal movement stays TABLED (standing instruction).
- No damage-dealing scrolls or provisions (the felt-overpowered guard).
- No minimap interactivity — it is a map, not a control.
- Identification never needs a model call; labels are arithmetic.

## Sources

The research library: docs/research/2026-07-25-marinara-engine (the
two-channel public/private data pattern → pockets and guises; "the
engine commits, the narration follows" → every reveal is an event);
MAPS.md §2/§5 primary-source survey (Brogue trap rarity and secret
ramps, Rogue/Moria darkness, NetHack closets); BALANCE.md passes 9–10;
the sibling-crawler survey (appendix below, added the same night); the
roguelike tradition on scroll identification (NetHack labels, Brogue's
knowledge-not-power scroll school) — adapted, never transliterated.

## Appendix — the designer's own crawlers, surveyed (2026-07-29)

Four sibling repos are real games; the survey (headless, full citations
in the session record) fed this design directly. Non-games checked and
dismissed so nobody re-opens them: tin-star, Chimera, rein, greenfield,
autogame-creator (empty), orrery, dwarf-fortress (vendored upstream).

**agent-adventures** — a deterministic, event-sourced, LLM-played
roguelike; the closest kin this design has anywhere.
- *Freeze the math at telegraph time, resolve from frozen values*
  (engine/combat.py) — their independent arrival at our command-time
  resolution law; the strongest corroboration in the survey.
- *Dispositions as priority-ordered pure functions, first answer wins*
  (guardian → ambush → … → patrol → idle): the guardian engages within
  a radius **of its anchor, not of itself**, and walks home — our guard
  leash, validated to the detail. Patrol never engages by itself; a
  higher-priority read takes over — our hunt-interrupts rule.
- *Ambush-until-adjacent with the hiding on the render side, dispatch a
  pure function of state* — exactly the mimic's guise architecture.
- *"Hidden = chore; visible = puzzle"* on traps — honored as the tuning
  target for detection (§5), not as a veto of the designer's ask; their
  pre-commit warning on stepping toward a known trap is adopted.
- Per-species drop rates 0.10–0.40 bracket our one-in-three pockets;
  their loot draws at death time where ours resolve at birth — ours is
  the stronger replay shape, theirs the precedent for the rates.
- *Never target lowest HP; band everything; fixed one-tick wind-ups* —
  kept on the shelf for the day we need them.

**maze-solver** — 42 releases, one dungeon element per release, under
"honest instruments that never point the way."
- Content as a *pure hash of (seed, id)* — never stored, never rolled;
  content derivation exit-independent and mutually disjoint. Kin to our
  drawless placement decisions.
- Guardians as an *optional toll stripped from the solution path* — the
  ancestor of our off-path provision law.
- Economy coefficients *calibrated by a replay audit harness* over seed
  sweeps — the sawtooth/ensemble pattern, independently invented; their
  3×→1× toll finding is the worked example of why we re-pin.
- Board dims clamped at one chokepoint (5..200) — adopted in
  createWorld.
- A discovery surface (bootstrap manifest) that drifted from the real
  verb table until documented — the reason our palette and help both
  render FROM the one KEYMAP rather than beside it.

**hide-and-seek** — traps that cost tempo (turns) rather than blood, and
the compass: a found, single-use *information* consumable whose effect
is a pure function of two positions — the bell and flare's cousin, and
precedent for the scroll school chosen here.

**ml-maze/swarm3d** — five trap kinds with distinct *shapes* of harm
(slow, teleport, reset, displace, block) and per-archetype trap
resistance as personality; placement validation that only ever checks
solvability. Their taxonomy widened our trap table; resistance-as-
character is shelved for a future pass.
