<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

# AGENTS.md — evolving-rpg

Any agent working here can play, judge and evolve this game without a browser.
This file is the map; the Covenant is the law.

## The model we work to

`src/assay/covenant.ts` — stated invariants, mechanical (M*) and thematic (T*),
each naming its enforcer. Every facility is validated against it: rules by the
assay's trials, names by the register checks, worlds by reachability, replay by
the chain. When you add a facility, add its invariant first. When an invariant
proves wrong, amend it there, visibly.

## Tools (all from repo root, JSON out where noted)

| Command | What it does |
|---|---|
| `npm run play -- --policy all --seeds 12 --json` | Sweep archetypal players over fresh worlds |
| `npm run play -- --world runs/latest.json --policy all` | Play the real world, rules in force |
| `npm run trial -- rule.json` | Assay one rule. Exit 0 sound / 2 refused / 1 malformed |
| `npm run loop -- --seed 7 [--rule r.json]` | Baseline → propose → trial → ratify → replay → deltas. Report to `runs/loops/` |
| `npm run balance` | The ensemble report: per-approach outcomes + lenses #33/#71 |
| `npx vitest run` | The suite. Mutation proofs are the local verification idiom |

The propose step of `loop` needs the dev server (`npm run dev`) for a real
model; `--rule` runs the loop offline.

## Personae (`.claude/agents/`)

- **playtester** (haiku) — plays sweeps, reports numbers and findings against
  the Covenant. Cheap; use freely.
- **rules-warden** (sonnet) — judges a candidate rule on both registers:
  mechanical (via the trial, then past it) and textual/thematic (voice, fit,
  whether it answers anything). Use before any ratification that matters.
- **listener** — reads submitted human runs for FUN: the chain's facts and
  the player's spoken words woven on one clock. The dev server runs it live
  on every run submit; dispatch the persona headless to re-read a
  `runs/witness/listener-*.packet.json` deeper, or across many packets for
  trends. Its reports are evidence for design changes, never changes.

The overseer stays the strongest model in the session: it dispatches these,
reads their reports critically, and owns the verdict. A subagent's report is
evidence, not a decision.

## The feedback loop, canonically

1. `npm run play` — what is true now.
2. `npm run loop` — what a candidate would change.
3. rules-warden — does it make SENSE, both registers.
4. Ratify (Forge, or `ratifyRule` in a script) only what survived 2 and 3.
5. `npm run play` again — did the numbers move the way the rule promised.
6. Everything notable goes in a commit message or `runs/loops/`; the user
   checks polish and direction, not mechanics.

## The feedback factory (the witness & the listener)

The human channel the loop above cannot synthesise. In the browser, `c`
toggles a microphone (the header indicator: dim off, red-glowing on);
speech is kept locally, transcribed locally (SpeechAnalyzer via
`scripts/transcribe.swift`, compiled once by the dev server), and every
game beat is trace-marked — mic on or off — so words, actions and the
silences between correlate on one clock. Ending a run (begin-again /
another world / wipe) submits it to the **listener**, whose report lands
in `runs/feedback/<stamp>.md` (git-tracked) with a one-line verdict in
`runs/feedback/index.jsonl`; raw packets and audio sit in `runs/witness/`
(disposable). Agents: read `runs/feedback/` before proposing design
changes — a spoken complaint that recurs across readings outranks any
single sweep — and dispatch the listener persona over old packets for
trends. Nothing in this path touches the chain; replay stays exact.

## Known shape of the game (updated 2026-07-26, increment 7)

**Fighting pays, decisively.** Kills yield threat-value XP; levels grow the
player and heal to full; floors descend by threat budget
(`24+15d+4(d−2)²`) with Brogue-style overlap; the warden guards every third
floor. **The stairs are watched**: the strongest thing on the floor posts
beside the exit — except on warden floors, where the warden keeps the door
BY ROLE (the old "by construction" claim broke quietly once out-of-depth
rolls out-threatened the boss; measured at depth 9 with the warden fourth-
scariest on its own floor). Deep wardens grow with their floors
(wardenLevel: 1 at depth 3, depth−2 beyond). Pinned on 20 seeds
(tests/balance/sawtooth.test.ts): depth 1 gentle, depth 3 fighter 13 v
runner ~2, depth 5 in [1,10].

**The bestiary acts by verbs** (tables.ts VERBS; the tradition chose them):
bruisers trample (shove + follow, atomic in the blow), skirmishers lunge
(two tiles + strike in one action), stalkers lie visibly coiled and spring
one band harder once (depth 2+), stingers envenom (landed bites burn
VENOM_HARM per round for VENOM_TURNS after — ticked in TURN_ADVANCED's
apply, the creditKills precedent), callers cry once (CALLED v1: two risers
drawn at the floor's first band, ≥ CALL_DISTANCE from the prey; callers
never call callers) and the warden keeps a vigil (leashed to its post,
knits shut when you flee past the leash). Stinger from depth 2, caller
from depth 3 (Archetype.fromDepth — the teaching floor stays teachable).
Verbs are PRICED into threat (×1.1–1.3) — unpriced they collapsed depth-5
survival to 0/20 — and the M6 proportion trial weighs rules against
verbless stand-ins so the scale cannot move with the bestiary.

**Combat reaches — the volley discipline** (increment 8, covenant M7/M8):
every blow, melee or ranged, resolves through the one `resolveStrike` path;
STRIKE v4 carries `mode` ('melee'|'ranged', absent reads melee — the open
door magic modes will walk through). A shot needs the honest line
(`src/core/sight.ts`: integer supercover, walls/secrets/living bodies
block, two-walls-kissing corners block, reach disc dx²+dy² ≤ 30) and the
drawn stance: DRAWN v1 is an event and a visible tag, one stance per body,
held through WAITs, lost to any other act, any damage, any stagger — so
every ranged blow anyone throws is telegraphed one full action ahead. The
**slinger** (verb volley, threat ×1.25, fromDepth 2) draws and looses and
never retreats; the player does the same with the **leaden sling** relic
(trait 'ranged', weapon slot — sword-or-sling is a `,` decision) on the
f key. Adjacency refuses shots: the bump owns range 1. Fork moved to k.
While adding this, a latent `firstStep` bug fell: OOB neighbours keyed by
y*width+x before bounds-checking made a quarry at x=0 read reachable one
step EAST off the map — fixed, the fog's wrap lesson applied to the hunt.

**Balance is baseline-first** (the designer's ruling, 2026-07-28): the
teaching floor's keen edge + guard stand ON the start→exit walk eight
steps in (walkPath, drawless choice; deeper floors keep the detour
economy). The assay hardened: M3 refuses never-fires outright, M6
refuses past MAX_RULE_SWING 6 / MAX_RULE_FLIPS 4 — the bench's two
standing offers both re-assayed as dead letters and were withdrawn.
Pinned curve moved 17/10/9 → 18/16/12 (door/mid/deep); d5 band
re-pinned [1,13] — the wider pipeline feeds the deep, per-floor bite
unchanged (budget inflation rejected: it pays the fighter more XP than
it costs).

**Dual wield and two hands of satchel** (the designer's voiced-run
directives, panel-reviewed 2026-07-28): ranged relics route BY TRAIT to
their own `sling` gear slot beside the blade (slotFor; grants stack into
the one might stat); ITEM_TAKEN v4 records `gearSlot` and `shed` (the
set-down relic lands on the floor, grants intact — the vanish/misname
family from the voiced run is retired; old chains refold legacy).
Depth 1 guarantees the keen edge BY NAME; depth 2 owes a ranged relic.
The satchel holds TWO (q first hand, Q second; ITEM_USED v2 slot;
WORLD_INIT v9 kinds list; duplicates welcome; full hands refuse the
walk-over out loud). Diagonal movement: TABLED by the designer —
touches supercover LOS, BFS hunts, Manhattan verb ranges; design whole
or not at all. Proposals + panel verdict:
docs/superpowers/specs/2026-07-28-dual-wield-proposals.md.

**The pantry holds six** (the 929-second run's directive, math in
docs/design/BALANCE.md): beside the teaching trio stand the ash ward
(drinks ONE landing blow whole — no wound, no venom, no flinch, the
draw held; STRIKE v5 `warded`, resolved at command time, damage
recorded 0), the iron burr (every adjacent hostile takes the staggered
tag — the shove's own machinery — resolved as a recorded id list), and
the hollow bell (the exit and every unfound prize join the fog's SEEN,
read off the chain like the flare). `provisionsAt(depth)` gates the
pantry — floor 1 is the trio exactly, ward/bell from 2, burr from 3 —
with ONE counted draw regardless of pool, so generation's stream never
moved. Invariant, kept on purpose: no provision raises player damage.
Bots treat the new kinds as dead cargo (their wishes name kinds); all
five sawtooth pins held unchanged. Also this pass: sealSecretRoom
refuses merged rooms (boundaryOf tells narrow doors from open edges —
the floor-7 whackadoodle), lenses hold their tongue below their sample
floors, and the panel is fully static (changes speak in the journal,
including the new damage-band line).

**The player has verbs too** (SHOVE v1 / BRACED v1, zero draws): x+dir
shoves an adjacent hostile one pace — open ground displaces, walls and the
door frame slam (SLAM_DAMAGE + stagger), a body behind tangles both;
z braces one round — +braceWall(wits) to be hit, tramples hold, the coiled
spring is absorbed, and a miss against the set guard staggers the
attacker. Staggered things spend their next action as a recorded WAIT
(the only creature wait that reaches the chain — draftFor). Bots use
neither yet, which is why the golden replays bit-identical.

**The satchel carries one thing, used with q**: vital draught (heal whole +
permanent ceiling raise by band), still smoke (hunts chase your stale
position 6/8/10 turns; adjacent creatures are recorded unfooled) or tallow
flare (a recorded burst: the fog derivation marks a FLARE_RADIUS circle
SEEN — shape, never occupants; rewind un-knows it). Walk-over swaps and
leaves the old one lying. One provision per floor, unguarded, off the path
— the armory pays for fighting, the satchel pays for scouting.

**A chosen take is answered either way** (the 08:30 filing, 2026-07-29):
takeOrRefuse backs the `,` key — the take when the engine agrees,
ITEM_REFUSED v1 (`nothing` | `sealed`, apply no-op, no turn, no draws)
when it does not, narrated off the chain. Deliberate key ONLY — walk-over
refusals stay view-explained (both dominance lines name `,` now), bots
never press `,`, so the golden fixture never saw the new event. Walk-over
refusal events: deferred on the record.

**Loot obeys the dominance rule**: walking takes only strict upgrades
(≥ every axis, > in total — tables.dominates); tradeoffs, sidegrades and
downgrades wait for the , key (takeUnderfoot's deliberate flag). The
armory holds one iconic tradeoff (heavy edge: Relic.costs rides negative
in the same Stats) and two named properties read off worn kinds
(RELIC_TRAITS: sure edge staggers crit survivors, steady boots refuse the
trample's shove). Cap the property table hard — every trait is a rule
replay must honor.

**Names come from the namesmith, not a model** (src/canon/namesmith.ts):
world word + silhouette head noun, deterministic per world root, same
register guard, veto-aware (Oracle.refusals persists so determinism cannot
un-reject). With a namer installed, describe intents NEVER reach the
transport; the founding gate holds the smith too, so floor one waits for
its own words. The founding is the only naming-adjacent model call left.
Creature names key the ARCHETYPE (the designer's ruling 2026-07-28:
warden-4 and warden-7 once wore different names, and the 929s epitaph's
"soot herald" taught nothing) — describeQuestion normalizes creature
subjects through tables' archetypeOf, the smith's seed matches, and the
one cache entry per species is what makes the duplicate guard safe.
Standing worlds re-mint their bestiary once under the new keys; relics
and provisions are untouched.

**The world has a bottom** (GESTALT L4): depth 9, said out loud on floor 1.
The heart lies at the far end of the ninth floor behind the last warden;
taking it fills and SEALS the satchel and turns the run around — the way
out is the stair you came down by, and the world stirs every 8 turns while
you carry it (the first stir raises echoes of you from your own bodies).
Reaching the stair with the heart = outcome 'won'. Bible promises pay out
as journal beats: whisper on 2/5/8, kept on the warden's fall at 3/6/9.
Bodies lend their eyes: standing where you fell merges that life's explored
map into yours (knowledge, never stats — BONES.md, decided).

**The living dungeon** (the designer's goal, 2026-07-29 — spec:
docs/superpowers/specs/2026-07-29-living-dungeon-design.md, math in
BALANCE.md "The board breathes"): worlds choose their ground at the door
— the vale 48x32, the **expanse 96x64 (default)**, the waste 128x96 —
with a typed seed (words hash via fnv1a); the wipe passes the SAME door
(the chosen board is the one world left; Escape there wipes nothing),
and the minimap floats translucent over the board's corner (2px/tile,
pointer-events off — below the command bar it lived below the fold).
THE DOOR FILLS (the boring-floor filing, 2026-07-29, BALANCE.md "The
door fills"): the teaching floor's rent pays the FULL stretch and is
spent on kinds ≤ DOOR_PRICE_CAP only (expanse 6 skirmishers, waste 9;
vale bit-untouched; door pin 8/10). Patrols-from-d1 and mixed-kind
full rent both measured 6/10 at the door and are deferred/refused on
the record; stretched floor 2 now reads quieter than floor 1 — the
bounty's territory, its own pass. `sizeStretch` (1/2/3) scales
the GROUND economy (rooms cap, provisions, owed relics, traps, the
camera+minimap exist for it); `bountyStretch` ((S+1)/2) scales the FIGHT
economy — spawn budget AND XP ladder together, measured in after the
full stretch handed depth 3 to the runner (the forbidden domination).
WORLD_INIT walked v9→v14 in one night, one bump per feature, absence
always reading legacy: v10 dispositions (guards return to POST-anchored
leashes, GUARD_LEASH 4; wanderers d2+ walk recorded routes of room
centers, leg advanced by the reducer on ANY waypoint landing, forward
only), v11 the mimic (1 floor in 6 d2+, `hidden` tag + `guise` item kind;
the lie lives on the render side — item paint, item panel row with the
real relic's theater grants, remembered out of sight; every tool reads
it as furniture; the bump UNMASKs (v1 event) and loads the stalker's own
`ambush` spring; always pockets), v12 traps (eight kinds; two recorded
wits chances each — sight then near, once ever, misses silent in the
journal; speed dodges where the kind's law allows; TRAP_SENSED/
TRAP_SPRUNG ride the action, `endsTurn` false; the maw descends by
`descendThrough`, the stairs' ceremony with no rest; hatch risers are
level-1 BODIES — floor-band risers measured as an XP vending machine,
14/20 at a d5 ceiling of 13; snared steps become recorded WAIT strains
or bots deadlock; the alarm lifts the AWARENESS cap floor-wide on a
clock), v13 scrolls (one hand, `r` — the begin-again key proxy is
retired; five knowledge/position/time kinds, no damage by the felt-
overpowered guard; world-minted labels via namesmith `scrollLabel`,
identification derived from SCROLL_READ history — a rewind un-identifies;
stone song only ever ADDS floor; the fog learned blink/unveiling/song
plus two old debts, trample- and lodestone-moved sight), v14 pockets
(1 in 3 born carrying, 70/25/5 provision/scroll/relic drawn at BIRTH —
zero draws at death, any death spills via `dropPockets` beside
`creditKills` at every site; visibility policy reconsidered: what the
floor owns is visible, what a body carries is not). The expanse holds
its own sawtooth pins (door 10/10 gentle, d3 fighter 7 over runner 4,
deep 4/10); the vale's five pins never moved. The UI run: kbd wears ink
(the .6-opacity faint stack is dead), the dungeon set lives on an
always-on bar, the meta set in a `p` palette — help, bar and palette all
render from the ONE KEYMAP. Chests deferred on the record.

**The boards are rooms and corridors** (three sizes, docs/design/MAPS.md): total
connectivity mutation-proofed; creatures hunt by BFS walking distance 8 (a
wall you cannot walk through, they cannot smell through). **Secret
passages** (~1 floor in 3): a room's every doorway paints as wall and
occludes the play-view fog until trodden; creatures and bots were never
fooled — they path by passability. A truly stranded floor gets a hidden way
cut in (the repair rule) rather than a throw.

**Worlds are founded** (GESTALT.md, increments 6–7): one Worldsmith call at
birth writes a WORLD_BIBLE event — anchor, lexicon, warden identity,
promises, register — validated hard (src/canon/bible.ts) before it touches
the log, carried across stairs and rebirth like the rules. Naming (batched,
one call per floor) draws from the lexicon; the gamemaster speaks the tone
and keeps the promises; the haiku judge reads each bible once. Unfounded
worlds improvise exactly as before.

**Talking is top-level play**: `t` opens the gamemaster's own sheet (the
screen behind `m` keeps the designer's pen). Every note on either channel
is stamped with how the player stood — floor, turn, level, health, burden
(`statusOf`/`statusLine` in channels.ts); notes older than the stamp derive
it by refolding their pinned head, memoised. The gamemaster's consult now
actually receives the standing AND the world's bible (the bible ride-along
had been dropped between `where` and the consult context since it was
written — pinned by test).

**Ended runs are set down** (src/canon/chronicler.ts — the model kept
where it earns its seat, the namesmith's mirror image): every ended run
gets a deterministic one-line epitaph engraved INSTANTLY on its own chain
(WORLD_REMEMBERED v1, apply no-op — the one event that exists to be read);
notable ends (first life, new deepest floor, warden kill, depth ≥ 7, every
win — chronicler.notable) also get the Chronicler's fuller telling: a
model reads storyOf's code-built facts and writes 2-4 slab-voiced
sentences, gated by validateRemembrance (register + length + slop
blocklist + must-mention fact tokens + no-repeat openings across the
world's stones). Delivery is the research's shape: the journal announces
first words only; the full text is RECITED where the body lies (the
borrowDeadEyes moment); worlds list marks "a grave, remembered" with the
text on hover. Failure = the epitaph stands; no grave is ever mute.

**Dying provokes the world**: every death fires a proposal read from the
run that killed you; the Forge opens when the offer lands; the assay still
gates it (a live death-proposal was refused for stat-minting, autonomously).
The trial of proportion (Covenant M6) measures every proposal's outcome
swing across six rerolled fights and says it beside the offer. Finding your
own body lends you its eyes and reads you its stone (BONES.md, decided —
knowledge and words, never stats).

The Covenant now spans M1–M6, T1–T3 and L1 (legibility: every system ships
with its human-readable exposure — floor stories in WORLD_INIT, the ledger,
stat tooltips with live derivations). Old saves break freely pre-RC, by the
designer's standing rule.
