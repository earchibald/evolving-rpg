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

**The world has a bottom** (GESTALT L4): depth 9, said out loud on floor 1.
The heart lies at the far end of the ninth floor behind the last warden;
taking it fills and SEALS the satchel and turns the run around — the way
out is the stair you came down by, and the world stirs every 8 turns while
you carry it (the first stir raises echoes of you from your own bodies).
Reaching the stair with the heart = outcome 'won'. Bible promises pay out
as journal beats: whisper on 2/5/8, kept on the warden's fall at 3/6/9.
Bodies lend their eyes: standing where you fell merges that life's explored
map into yours (knowledge, never stats — BONES.md, decided).

**The boards are rooms and corridors** (48x32, docs/design/MAPS.md): total
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
