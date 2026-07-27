# MAPS — how the floors are shaped

Research survey + what this game adopted. Written 2026-07-26 alongside the
rooms-and-corridors generator (`src/core/mapgen.ts`). Companion: BALANCE.md
(what lives on the floor), WALKTHROUGH.md (how to play it).

## 1. What we built

| Property | Value | Why |
|---|---|---|
| Board | 48x32 (4x the old area) | room for rooms; fog of war has something to hide |
| Rooms | 3–13 per floor, 4–8 x 3–6 interior | one per ~110 tiles — the "mostly rooms" end of the genre (see §3) |
| Placement | rejection sampling, 1-tile wall margin | NetHack's method (40-attempt cap there, 10x target here) |
| Connection | each room joins its **nearest already-connected** room | spanning tree → whole map connected **by construction** |
| Loops | +1 corridor per 4 rooms | a tree makes every wrong turn a walk back; loops make flight and chase real (Brogue's stated reason) |
| Corridors | 1 wide, L-shaped | Rogue's two-bend convention |
| Exit | farthest walkable tile from start | the journey is the longest the floor affords |
| Tiny boards | one open chamber | trial worlds and test boards use the **same generator** — no fossil kept alive for tests |
| Story | recorded in WORLD_INIT (`"7 rooms, 2 loops · the way out is 41 steps of walking"`) | covenant L1 — the map says what it is; shown under the floorboards |

Guarantees, each mutation-proofed: every floor tile reachable from start
(covenant M5, total — not "60% reachable" like the old scatter maps), border
solid, deterministic per (seed, counter).

## 2. What the genre does (survey)

| Family | How | Used by | We took |
|---|---|---|---|
| 3x3 room grid | 9 cells, ≤1 room each, spanning walk + extra links, 2-bend corridors | Rogue (1980) | L-corridors, extra links past the tree |
| Rejection placement | random rects, reject overlap, cap attempts | NetHack (5–10 rooms; *not* BSP, common myth) | the placement loop |
| BSP split | recursive halving, room per leaf, no overlap possible | tutorial lineage (RogueBasin) | nothing — rejection is simpler and our density is low |
| Separation + MST + loops | scatter, physics-separate, Delaunay, MST, re-add ~15% edges | TinyKeep | nearest-connected spanning + loop re-add (their idea, cruder math) |
| Room accretion | stamp rooms one at a time onto the dungeon at a matching doorway; loops punched where the walk between two sides > 20 | Brogue | the *loops rationale*; accretion itself deferred |
| Cellular automata | random fill ~40%, 4-5 rule, flood-fill cleanup | Brogue blobs/lakes, Cogmind caves | nothing yet — caves are a later biome |
| Drunkard's walk | random agent carves as it walks | teaching demos | nothing |

Density conventions: Rogue ~1 room/213 tiles, NetHack similar with corridors
dominating, Brogue denser with rooms dominating. 48x32 = 1536 tiles → their
ratios give 5–9 rooms; our /110 gives up to 13 small ones — Brogue-flavored.

## 3. Creatures on these maps

- **Awareness = 8 steps of walking** (BFS), not straight-line: a wall you
  cannot walk through is a wall you cannot hunt through. Genre norm is
  FOV/sound-based waking (Angband: 20-tile sight; NetHack: distance+stealth
  rolls). Ours stays deterministic and drawless — replay needs no wake rolls.
  Probabilistic waking is a possible Forge-era rule, noted, not built.
- **The stairs are watched**: the strongest thing on the floor posts beside
  the exit (the warden, on its floors — it out-threatens everything by
  construction). This exists because corridors made every fight avoidable:
  measured, the runner out-survived the fighter 11–9 at depth 3 before the
  keeper, 3–13 after. BALANCE.md pass 9 has the numbers.
- Relic guards stand **on** their prize; the keeper is never a guard.

## 4. Field of view (for the fog of war)

Genre options: Rogue reveals a whole room on entry (rooms are the unit);
recursive shadowcasting sweeps 8 octants and recurses around blockers;
symmetric shadowcasting (Albert Ford) additionally guarantees A-sees-B ⟺
B-sees-A. We use octant shadowcasting in the play UI only — presentation,
derived from state, never evented. Creature awareness stays walk-distance
(§3), so FOV symmetry is not load-bearing.

## 5. Depth motifs (landed — the research)

Primary-source numbers, from shipped code rather than wikis:

| Game | Depth-structural knob | Numbers |
|---|---|---|
| Brogue (BrogueCE src) | room-shape blend, corridor-attach, cavern-fill, secrets, hazard unlock | cave-room weight 2%→48% over d1→26; corridor-attach 90%→10%; whole-level cavern 29%→67%; secret doors 0%→67%; lava unlocks d4, brimstone d17 |
| Rogue 5.4 (rooms.c) | dark rooms | `rnd(10) < level-1`: 0%→100% by L11; maze rooms flat 6.7% |
| Moria (umoria) | dark tiles + unusual rooms | dark (L−1)/25 → 100% by L25; unusual-shape ≈(L−1)/300 |
| Angband (dungeon_profile.txt) | profile pool + per-room min-depth | cavern profile impossible <15; pits L5+, lesser vaults L20+, greater L35+ |
| NetHack (Gazetteer) | wholesale generator per branch | rooms (Doom) vs caverns (Mines) vs mazes (Gehennom) vs hand-built (Sokoban) |
| DCSS (branch-data.h, layout.des) | per-branch layout weights | D:1–8 rooms-only; D:9+ roguey wins ~56%; Orc/Slime all-cave; `spotty` blob connectors |

What we adopted (tables in BALANCE.md pass 10): banded motifs — the door
(1–2, today's shape), the warren (3–4: dense, tight, loopy — Brogue's chase
topology), the halls (5–6: big sparse chambers — the keeper's arena), the
deep (7+: draws a motif per floor). Secrets ramp 25%→50% (Brogue's ramp,
compressed); **sight shrinks 9→8→7 with depth** — Rogue/Moria's darkness
lineage mapped onto our fog. Danger/treasure *feelings* (Angband's other
lever) noted and not built: our floor story + bible promises already carry
the signaling layer.

## 6. Deferred, deliberately

- Doors (open/secret/locked) — placement conventions surveyed (NetHack
  closets, Brogue door sites); no mechanics here yet to hang them on.
- Brogue-style room shapes (cross, blob, circle) and lakes.
- Loop placement by path-length ("punch where the way round exceeds 20") —
  ours are random pairs; Brogue's rule is better and slots in cleanly later.

## Sources

RogueBasin: Grid Based Dungeon Generator · Basic BSP · Cellular Automata ·
Random Walk · FOV using recursive shadowcasting · Roguelike Intelligence.
Brogue: BrogueCE `Rogue.h`/`Architect.c`, anderoonies' accretion write-ups.
TinyKeep: GameDev.net author post. NetHack: `mklev.c` analyses, NetHack Wiki
(Closet, Sleep). Rooms and Mazes (Bob Nystrom). Symmetric Shadowcasting
(Albert Ford).
