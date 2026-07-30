# Economy, mining and sprites — the spec, reviewed and corrected

Source: `new-designs-spec.md` (repo root, 2026-07-29), an agent-authored
proposal. This document is that proposal **checked against the code and the
Covenant**, corrected where it was wrong, and staged into increments that can
each be measured. The original is kept unedited as the input artifact; where the
two disagree, this one is the design.

The proposal's *direction* is good and mostly novel for this game: a
push-your-luck side loop with a real cost, paid for in a currency the main
dungeon does not mint. Most of its *specifics* do not survive contact with the
architecture. Both halves are recorded below, because a review that only says
"approved" teaches nothing.

## I. What the proposal got wrong

Eight findings. Each is a fact about the code, checked, not an opinion.

### 1. Gold as "UI state" violates M4 outright

> "Implement Gold as a purely numerical UI state variable"

Refused. Covenant M4: *replay is exact; nothing added to the game may re-decide
recorded history or consume unrecorded randomness.* Every fact in this game is
folded out of the chain by `apply()` — `GameState` is `readonly` throughout and
`EMPTY_STATE` is frozen precisely so no reducer can be sloppy. A purse living in
view state would be invisible to replay, absent from forks, lost on rewind, and
unreadable by the bots, the assay, the critic and the listener.

The purse is a **derived fact**, like `xp` and `level` already are. It folds out
of a recorded exchange event. This is not a style preference; a gold number that
replay cannot reproduce breaks the one invariant the whole repo is built on.

### 2. Four of the eight named source files do not exist

The proposal addresses `core/volley-stance.ts`, `core/dual-wield.ts`,
`core/satchel.ts` and `core/traps.ts`. None exist. Those are **test** filenames
(`tests/core/volley-stance.test.ts`, etc.). The real homes:

| Proposal says | Actually lives in |
|---|---|
| `core/volley-stance.ts` | `src/core/commands.ts` (verbs), `src/core/apply.ts` (stance clearing) |
| `core/dual-wield.ts` | `src/core/commands.ts` (`slotFor`), `src/core/item.ts` |
| `core/satchel.ts` | `src/core/commands.ts`, `WORLD_INIT.playerSatchel` |
| `core/traps.ts` | `src/core/commands.ts` (`springTrap`), `src/core/tables.ts` (`trapOf`) |

The engine is four large files by design — `commands.ts` is 1907 lines, `apply.ts`
836, `tables.ts` 1046 — not one file per feature. Any agent implementing this
must read those four before touching anything.

### 3. There is no "trap trigger listener", and no event-listener layer at all

> "Modify the trap trigger listener to accept non-player entities"

There is no listener. Traps resolve inside `springTrap` in `commands.ts`, which
returns a `TRAP_SPRUNG` draft; `apply.ts` folds it. The *mechanic* proposed
(forced movement springs traps, so a shoved creature eats its own floor) is good
and cheap — `SHOVE` already exists and already knows about walls and bodies. But
it is a change to `shove` in `commands.ts`, not to a listener, and it needs
`TRAP_SPRUNG`'s `victimId` to stop assuming the player.

### 4. There is no combat dodge to build "Momentum" on

> "if a player switches from a defensive stance to an offensive stance
> immediately following a successful dodge"

Combat has no dodge. It has bounded accuracy (hit or miss), crit bands, and
`braceWall(wits)`. The only `dodge` in the codebase is trap-specific
(`trapOf(kind).dodge`, a speed roll in `springTrap`). "Stance" in this game means
the **`DRAWN` ranged telegraph** (Covenant M8) — not offence versus defence.

What the proposal is reaching for already half-exists: `z` braces, and *a miss
against the set guard staggers the attacker*. So "Momentum" should read: **a
brace that was actually tested — a hostile swung and missed you while braced —
buys a marked next blow.** That is the same idea, expressible in this game's
vocabulary, and it rewards the defensive verb the bots never press.

### 5. Encumbrance would overwrite a deliberate, playtested design

> "Instead of hard inventory limits, implement immediate combat consequences"

The two-slot satchel with a spoken refusal is not an oversight — it came out of a
voiced run, was panel-reviewed on 2026-07-28, and the refusal line was written
because the silent version misled the designer
(`docs/superpowers/specs/2026-07-28-dual-wield-proposals.md`). Replacing it with
soft encumbrance is a **redesign of a shipped decision**, which AGENTS.md step 7
puts squarely with the designer.

Deferred, on the record, with the reason. If it is wanted, it wants its own
measured pass, not a line in an omnibus spec.

### 6. The Critic cannot spawn monsters without becoming part of history

> "Boring play spawns negative modifiers … Map the Critic's evaluation outputs
> directly to mapgen or entity-spawning event listeners."

The Critic (`src/critic/`) reads finished runs. It is memoised by chain head
(`critic/memo.ts`) and it is explicitly *evidence, never changes* — the same rule
the listener persona operates under. Putting it in the causal path of play means
its verdict becomes history: it would have to be a recorded event with resolved
outcomes, deterministic per chain, and folded like everything else. That is
doable, and it is a genuinely good idea — a dungeon that gets bored of you is a
real mechanic — but it is a **new facility with a new invariant**, not a wiring
change. It goes last, after the economy it would meddle with exists.

### 7. `1d4`, `1d3`, `$X$` — not this game's idiom, and the LaTeX leaked

This engine has no dice notation. Randomness is **counted draws** off a seeded
counter RNG; every draw is recorded, rejected draws still count, and
`rngCounter` is hashed into every event. Bands and weights live in `tables.ts`
with lineage comments. `$X$` is unrendered LaTeX from whatever wrote the
proposal.

Converted below: `1d4` → a named `SEISMIC_SPREAD` band drawn once; `1d3` →
`ECHO_RISERS`, drawn once; `$X$` → `COUGH_TURNS`.

### 8. The sprite sheet cannot be used as specified — and cannot ship at all

Three independent problems, in order of severity.

**It is watermarked.** The file is literally
`watermarked_img_10516595601443928641.png`. A watermarked asset is a preview, not
a licence. Shipping it in the product is not a technical question and I am not
going to route around it — the unwatermarked, licensed original has to come from
wherever this preview came from.

**It is not a sprite sheet.** It is a 2816×1536, 6.3 MB *presentation image* of
sprite art: a title banner reading "RPG DUNGEON SPRITE COLLECTION", per-group
captions ("ADVENTURER", "SLIME", "IRON ORE") baked into the raster, decorative
"16" text down both margins, a checkerboard backdrop, irregular gaps between
cells, and sprites drawn at wildly different scales (the dragon is several times
the slime). The proposal's `SPRITE_SIZE = 16` with
`ctx.drawImage(sheet, sx, sy, 16, 16, …)` would slice a **sub-pixel fragment of a
single pixel-art pixel** — the real cells are roughly 128 px and not on any
regular pitch. No `[sx, sy]` dictionary can be written against this file.

**There is no canvas board to convert.** The instruction "replace `fillRect`
calls with `ctx.drawImage()`" assumes a canvas renderer. The board is a **CSS
Grid of DOM `.cell` divs** (`src/ui/debug.css`: `.grid { display: grid }`); the
*only* `fillRect` in the repo is the 2-pixel-per-tile minimap at
`src/ui/debug.ts:722`. Following the instruction literally would sprite the
minimap and leave the game untouched.

What the art *does* prove is intent: the sheet contains a Mining Wall,
Suspicious Wall, iron/gold/diamond ore, three pickaxes, a shovel, gold coins, a
shopkeeper, a crafting table, an anvil and three scrolls. It was clearly drawn
for this spec, and it reads as a good visual target. Section IV is refused **as
written**, not as an ambition; the real path is in §IV below.

> **Addendum (2026-07-29, the Godot-migration pass):** the designer clarifies
> the sheet was generated at their own direction with Gemini's image model
> (Nano Banana). The licensing finding is therefore withdrawn — there is no
> third-party licence to secure. The format findings stand unchanged: it is a
> presentation image, not an atlas; nothing is sliced from it, and clean
> per-entity regeneration via §V's formula is the path.

## II. What the proposal got right

Worth stating plainly, because the corrections above are longer than the praise
and that is not the ratio of the idea's worth.

- **A second loop with its own currency** is the strongest idea here. The main
  dungeon pays in XP and relics; nothing it drops is fungible. A gated,
  optional, dangerous place that pays in *money* gives the player a decision the
  game currently cannot pose: leave with the wealth, or go one block deeper.
- **Durability as the clock.** A pickaxe with `usesLeft` makes the greed
  self-limiting without a timer and without a hard wall — the loop ends when the
  tool does. This is a much better fit than a turn limit.
- **Undetectable traps, deliberately.** The game's existing doctrine is
  "hidden = chore, visible = puzzle", which is why trap spotting was *loosened*
  to 22–32% missed. Mining traps invert it on purpose: you cannot scout a rock,
  so the only defence is stopping early. That is exactly the tension a
  push-your-luck loop needs, and it does not contradict the doctrine — it
  contrasts with it, in a place the player chose to enter.
- **The Deep Echo** is the best single mechanic in the document. A consequence
  that lands in the *suspended* level, so the punishment arrives when you think
  you have got away with it, is precisely this game's sense of humour. It also
  fits the architecture better than the proposal knows: the suspended floor is
  already going to be chain-derived, so injecting risers into it is an event, not
  a snapshot edit.
- **Gold as a sink for the main dungeon**, via a merchant, closes the loop
  instead of just adding a number.

## III. Corrected implementation, staged

Five increments, dependency-ordered. Each is separately shippable and separately
measurable. Numbers marked *(provisional)* are first guesses that must be
replaced by measured values in `docs/design/BALANCE.md` before they ship —
per AGENTS.md step 6, anything touching tables or generation gets numbers on
both sides.

### Increment A — the purse (foundation, no new play yet)

The economy's spine, with nothing to spend it on. Deliberately small so the
invariant is settled before anything leans on it.

- `valueOf(kind)` in `tables.ts` — **not** a field on `Item`. The proposal asked
  for `baseValue` on the interface and this document's first draft agreed; both
  were wrong, and implementation is what showed it. Two iron ores are worth the
  same, so a per-instance price is a second fact that can disagree with the
  first — the exact hazard `item.ts` and `state.ts` keep warning about, and the
  reason `xp` is folded out of kill history instead of evented. Deriving it from
  the kind also keeps a kind's worth as one legible number in the one legible
  file, which is what L1 wants, and costs nothing: a required field would have
  had to be threaded through every construction site and 17 test files to say
  something the table already knows.
- `GameState.gold: number`, folded — never view state (finding 1).
- `GOLD_MOVED` v1, payload `{ delta, reason }`. `apply` sums; the balance is
  derived, never recorded, so the log and the purse cannot disagree. `reason` is
  a closed union (`'sale' | 'purchase' | 'trove'`) because L1 wants the ledger to
  say *why* money moved, not just that it did.
- `WORLD_INIT` v14 → v15 carries `playerGold`, exactly as v8 taught the satchel
  to cross the stairs. Absence folds to 0, which is what every existing chain
  honestly says.
- Covenant gains **M9** *before* the code, per AGENTS.md.

Base loot values *(provisional)*: relics and scrolls 2 G, provisions 1 G, per the
proposal's 1–2 G band — nominal on purpose, so the main dungeon stays an XP
economy and the mine stays the only road to real money. Unknown kinds price at 0
rather than throwing: a chain may carry a kind a later engine renamed, and a
purse is not the place to die.

**Landed 2026-07-30.** `tests/core/purse.test.ts`, 13 tests. Covenant M9 first,
then `valueOf`/`LOOT_VALUE`/`PROVISION_VALUE` in `tables.ts`, `GameState.gold`,
`GOLD_MOVED` v1, and `WORLD_INIT` v15 carrying `playerGold`. Three mutation
proofs: breaking the stairs carry fails 2 tests, breaking the fold fails 3, and
pricing provisions as relics fails 1 — that third one passed the whole suite
until the proof exposed it, because every other assertion was an inequality
against the ceiling rather than the band's shape. Golden fixture regenerated:
the draw stream was proven untouched first (451 events both sides, zero payload
or counter differences, one `schemaVersion` bump), which is what licensed
skipping the seed probe the regen ceremony otherwise demands.

### Increment B — the mine (the state stack)

- `SuspiciousWall`: a new tile or tagged wall, drawn into `mapgen.ts` at
  `SUSPICIOUS_WALL_CHANCE` *(provisional 5% per room)* — one counted draw per
  room, so the generation stream moves exactly once and predictably.
- **Descend / return.** The proposal's "push the current state to a stack" is
  right in spirit and wrong in mechanism: you cannot push a snapshot, because
  state is derived. The floor you left is already reproducible from the chain —
  what has to be recorded is the *fact* that you left it and where you stood.
  `MINE_ENTERED` v1 carries the departure `pos` and the generated mine;
  `MINE_LEFT` v1 restores. `GameState` grows a `suspended` field holding the
  floor's identity and the standing position, folded like `smoke` and `alarm`.
- Mineable blocks: rock 70 / iron 20 / gold 9 / diamond 1 *(provisional,
  straight from the proposal — must be measured against M2 before shipping)*.
- `MINED` v1: block, yield, tool wear, and any sprung trap, all resolved in the
  event. One draw for the block's trap check, one for the yield.
- M5 applies: **the way out of the mine must be reachable**, same guarantee and
  same test shape as `mapgen`'s.

### Increment C — the shop, the tools, the crafting table

- Shop hardcoded at the mine entry, per the proposal.
- Wooden pickaxe 50 G, `usesLeft` 15 *(provisional)*; iron pickaxe 40 uses and
  cracks base rock in one action instead of two.
- `usesLeft` is folded from `MINED` history, not stored — the same reasoning that
  makes `xp` derived. A tool's remaining life is a function of how much you have
  mined with it.
- Recipe: wooden pickaxe + 3 iron ore → iron pickaxe. `CRAFTED` v1.

### Increment D — mining traps

Immediate: toxic gas (flat percentage damage + `COUGH_TURNS` accuracy debuff),
seismic shift (`SEISMIC_SPREAD` adjacent blocks destroyed, wealth destroyed with
them), brittle rock (halves `usesLeft`).

Delayed: **the Deep Echo** — `ECHO_RISERS` hostiles injected into the suspended
floor at the departure position, recorded as an event at mine-time so replay
never re-rolls it, and felt on `MINE_LEFT`. Flavour line as proposed; it is in
register.

`TRAP_SPRUNG` needs its `victimId` generalised here anyway, which is the same
change finding 3 wants for shoving creatures into floor traps — so B/D and the
shove synergy share one edit.

### Increment E — the deferred and the refused

- **Scroll belt**: conflicts with shipped scrolls (`WORLD_INIT` v13,
  `SCROLL_READ`, one hand, `r`, and an explicit *no damage* guard). A 5-slot
  rotating belt with a `cast` key is a redesign of a system that shipped eight
  days ago, and the proposal's fireball scroll walks straight through the
  no-damage guard. **Designer's call**, with the conflict named.
- **Encumbrance**: deferred, finding 5.
- **Diegetic critic**: deferred to last, finding 6 — it needs an invariant of its
  own and it should not meddle with an economy that does not exist yet.
- **Momentum**: reinterpreted as the brace-tested marked blow, finding 4. Cheap,
  and it pays the one verb bots never press. Ready when the designer wants it.

## IV. Sprites — the real path

Section IV of the proposal is refused as written (finding 8). What would actually
work, in order:

1. **Licensing first.** Obtain the unwatermarked, licensed art. Nothing below
   matters until this exists; the current file cannot ship in any form.
2. **Per-entity assets, not a presentation image.** Either one PNG per entity at
   a true 16×16 or 32×32, or a machine-built atlas emitted with a JSON manifest
   (`{ kind: [sx, sy, w, h] }`). The manifest must be *generated alongside* the
   atlas, never hand-measured off a picture — hand-measured coordinates are how
   the proposal ended up specifying a 16-pixel slice of a 128-pixel sprite.
   The labels, title banner, margin numbers and checkerboard must not be in the
   shipped raster.
3. **Then choose a renderer, and price it.** Two honest options:
   - **DOM sprites** — `background-image` + `background-position` on the existing
     `.cell`. Keeps all 3435 lines of `debug.ts` and the whole fog, camera,
     minimap and panel apparatus working. Cheap, reversible, and the fastest way
     to see the art in the game.
   - **Canvas board** — a real rewrite of the play view, and with it the fog
     compositing, the camera window, the click targets and the accessibility
     story. Buys per-tile animation and effects the DOM cannot do well.

   The proposal assumed the second was already built. It is not. **DOM sprites
   first** is the recommendation: it is a day, not a fortnight, and it answers
   the only question that matters at this stage — does the art make this game
   better to look at.
4. **`SPRITE_SIZE` is a render constant, not an engine one.** It belongs beside
   the view, not in `tables.ts`; no engine number may depend on how big a
   picture is.

## V. Sprite generation methodology

Section V of the proposal needs no correction — it is a methodology document, it
is internally consistent, and it is worth keeping. It is preserved as written
(style definition, the prompting formula, background-removal and nearest-neighbour
grid-snapping) at `docs/design/SPRITES.md`, with two additions the review forces:

- The output of that pipeline is **per-entity files plus a generated manifest**,
  per §IV.2 — not a captioned collection image.
- Generated art carries its provenance and licence in
  `docs/design/SPRITES.md`, because finding 8 is exactly what happens when an
  asset arrives with neither.

## VI. Covenant amendment

Added before the code, per AGENTS.md ("when you add a facility, add its invariant
first"):

> **M9** — *The purse is a fact of the chain.* Gold exists only as recorded
> exchange folded by `apply` — never as view state — and every source of wealth
> states its ceiling, so money cannot be minted by repetition.
> Enforced by: `apply`'s `GOLD_MOVED` fold; `GameState.gold`; `valueOf` in
> `tables.ts`; and M2's trial of greed, which now has a currency to exploit.

M2 already forbids unbounded growth by repetition; M9 exists because a *currency*
is the first thing in this game that is fungible, and fungible wealth is the
classic vector for exactly what M2 forbids. The mine is a repeatable action that
mints value, so its ceiling is not optional.
