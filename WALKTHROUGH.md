# WALKTHROUGH & TESTING

How to play it, how to test every part of it, and what is still undecided.
Rewritten 2026-07-26 evening (increments 5–7 landed). If something here
doesn't match the game, the game changed — check `NIGHTLOG.md` and `git log`.

---

## 1. Start

```bash
cd ~/Code/evolving-rpg
npm install        # once
npm run dev        # open the printed URL
```

- Needs the `claude` CLI signed in for founding/names/proposals/judging.
- Without it: the game still runs. Worlds play unfounded, names show as plain
  kinds, proposals fail visibly. Nothing blocks.

**First 60 seconds:** wipe to a fresh world (`world…` → `wipe everything`),
watch the Worldsmith found it (~40s — "the world is founded — …"), walk with
arrows/wasd into the dark, fight the first thing that finds you.

---

## 2. Controls — everything has a key

| Key | Does |
|---|---|
| arrows / wasd | move; into a creature = attack; into a wall = free (no turn) |
| `.` / space | hold still (this is a turn) |
| `n` | world… — begin again / another world / wipe |
| `g` | the forge — ask for a rule |
| `m` | the gamemaster's screen (channels + all machinery) |
| `r` | begin this world again, straight away |
| `v` | verify every hash and counter in the chain |
| `f` | fork a timeline · `b` rewind 10 events |
| `?` | the keys sheet (this table, live) |
| PgUp/PgDn | read back through the journal |
| esc | leave a writing box (draft survives); esc again closes the sheet |
| `1` / `2` | in the screen: write to the designer / the gamemaster |

There is no descend button: **stairs are stairs** — step on the green square
and you go down. A cleared floor heals you on the way.

---

## 3. Read the screen

Left: the map (fog of war — see §4) and the journal (one fact per line).
Right, always in view (sticky rail): **you**, the buttons, **what is here**.

| Rail row | Notes |
|---|---|
| hit points / you deal / might·speed·wits | hover any dotted number for its full derivation with today's values |
| wielding / wearing | the world's names for your gear ("whetted blade +2 might") |
| changed values | show before → after (orange → green) for 3 turns |

The **gamemaster's screen** (`m`) holds everything else: the two channels
(designer = out of world, gamemaster = in it), **this world** (the bible —
anchor, lexicon, warden, promises, judge's verdict), lenses, rules, names,
the ask queue, worlds list, the ledger, floorboards, and **through the fog**
(developer omniscience — everything the fog hides from the play view).

---

## 4. The fog, and what lies about it

- Never seen: nothing, not even wall silhouettes.
- Seen, out of sight: geometry and items dimmed; creatures vanish (they move).
- **Secret passages** (~1 floor in 3): one room's every doorway paints as
  wall and blocks sight — until you walk INTO it ("the wall gives way — it
  was never a wall"). Found passages render edged and never fool you again.
- Creatures were never fooled: they path through secrets by construction.
- A floor's story ("under the floorboards") admits "one room keeps itself
  secret" — the fact is public, the door is not.

---

## 5. Core loop (test by playing)

1. **Fight**: walk into things. All numbers from `src/core/tables.ts`;
   hover your stats for the live arithmetic. Crits on 20 (wits widens).
2. **Level**: kills pay threat-value XP; levels grow stats and heal whole.
3. **Relics**: violet squares, guarded, slotted (weapon/armor/boots/trinket).
   Better replaces, with the swap narrated; lesser stays on the floor.
4. **Descend**: step on the exit. Stats, gear, rules and the bible cross.
   **The stairs are watched** — the floor's strongest creature stands there;
   every third floor it is the warden.
5. **Die**: your body stays; a `†` grave world is kept; **the world reads
   your death back and proposes a rule, unasked** — the Forge opens when the
   offer arrives. `r` to rise again (rules and bible survive).
6. **Find your body** (same world, same floor, later run): the journal says
   so. What it confers: deliberately undecided — see §9.

Expected difficulty (20 fixed seeds, brawler): floor 1 ~95%, depth 3 ~65%
fighter vs ~15% runner, depth 5 ≤ 50%. Wildly off that = something broke.

---

## 6. The evolution loop (the point of the game)

1. Die (proposal arrives on its own) — or escape and ask via the forge (`g`).
2. The proposal shows: the rule in English, why (its `because`), citations
   (events / notes / lenses), and the **assay verdict** beside it.
3. **accept** / **edit…** (bounded form, live preview) / **reject**.
4. Play on — the rule fires with its own status lines.

What protects you:

| Guard | Catches |
|---|---|
| validator | anything outside the closed vocabulary |
| greed trial (M2) | stat-minting (caught live, twice) |
| coward trial (M1) | death made impossible while idle |
| **proportion trial (M6)** | bounded-but-heavy rules — "swings hit points by 4.7, flips 2 outcomes — heavier than a relic" shown beside the offer |
| register + citation pruning + duplicate check | off-voice text, invented citations, repeats |

The Worldsmith's bible faces its own gate (`validateBible`): register-assayed
prose, article-free lowercase lexicon, no duplicates — a refused bible means
the world just plays unfounded.

---

## 7. Headless testing (no browser)

```bash
npx vitest run                                # ~620 tests, ~15s
npm run play -- --policy all --seeds 12       # bot sweep
npm run balance                               # + lenses #33/#71 (~90s)
npm run trial -- rule.json                    # assay one rule; exit 0/2/1
npm run loop -- --seed 7 --rule rule.json     # full cycle, offline
```

Quick self-checks:

| Check | Expect |
|---|---|
| `npx vitest run` | all green; band breach = real defect |
| greed refusal | `npm run trial` on a grant-per-wait rule → `refused`, exit 2 |
| bots play | `npm run play -- --policy rusher --seeds 5` → mixed outcomes |

Bots see through secrets (they path by passability) — sweeps measure
mechanics, not the fog.

---

## 8. Agent delegation

- `.claude/agents/playtester.md` (haiku) — sweeps, numbers.
- `.claude/agents/rules-warden.md` (sonnet) — judges rules on both registers.
- `AGENTS.md` = the map. `src/assay/covenant.ts` = the law (M1–M6, T1–T3,
  L1 legibility). Subagent reports are evidence, not verdicts.

---

## 9. OPEN QUESTIONS — need your call

1. **What does finding your body confer?** Messaging exists; the meaning is
   yours to pick. `docs/design/BONES.md` will hold the researched options.
2. **Canon vs bible scoping.** Names are per-kind and global; a second world
   inherits the first's creature names despite its own bible. Scope canon
   per world (cost: renaming per world), or accept kinds as trans-world?
3. **Level-up choices** — deterministic today; could become Forge choices.
4. **Depth-5 corridor.** Lens #33 reads the deep as brawler-only. If a
   runner's line should stay open deep, the knobs are keeper strength or
   loop count — BALANCE.md pass 9.
5. **Dead-air rule** — still ratifiable from `runs/loops/…912Z.md`; death
   proposals now offer similar rest-shaped rules organically.

## 10. Known gaps (not bugs, just not built)

- Depth motifs (GESTALT L3): floors don't yet change shape by depth with
  intent — research + tables in progress.
- The judge's bible verdict is session-memory (re-judges on next founding).
- Model flake retry is manual; a failed founding/proposal just says so.
- R3 (rules → engine code) and a shareable build: unstarted.
- Old saves break freely pre-RC, by standing rule.
