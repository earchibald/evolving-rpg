# WALKTHROUGH & TESTING

How to play it, how to test every part of it, and what is still undecided.
Written 2026-07-26. If something here doesn't match the game, the game changed
— check `NIGHTLOG.md` and `git log`.

---

## 1. Start

```bash
cd ~/Code/evolving-rpg
npm install        # once
npm run dev        # open the printed URL
```

- Needs the `claude` CLI signed in for names/proposals/judging.
- Without it: the game still runs. Names show as plain kinds ("skirmisher"),
  proposals fail visibly. Nothing blocks.

**First 60 seconds:** wipe to a fresh world (`worlds…` → `wipe everything`),
walk with arrows/wasd, walk into a creature to fight, kill it, watch xp go up.

---

## 2. Controls

| Input | Does |
|---|---|
| arrows / wasd | move; into a creature = attack; into a wall = free (no turn) |
| `.` | hold still (this is a turn) |
| green square | the way out. Stand on it, then press **descend** |

Buttons under the map:

| Button | Does |
|---|---|
| verify chain | re-checks every hash and counter in the log |
| fork here | new timeline from this exact moment |
| back 10 | rewind 10 events (old events stay in the log) |
| worlds… | new world / wipe everything (modal, wipe is red) |
| the forge… | ask for a rule, ratify/edit/reject (see §5) |
| run again | restart this world, keep its rules |
| descend | next floor down. Only lights up when you stand on the exit |

---

## 3. Read the screen

| Panel | What it shows |
|---|---|
| **you** | run status, hp `7 / 12`, `level 2 · 20/40 xp`, damage range, distance to exit, position, turn, world, depth |
| **what is here** | every creature + the floor's relic(s), with your hit % and damage vs theirs |
| top-right line | what the model is thinking about right now (or "not thinking about anything") |
| status under map | what just happened, one line per fact. Crits say "— clean through" |
| **game designer** box | message to me/the system about the game. Recorded, feeds the Rulesmith |
| **gamemaster** box | in-character question to the world. Model answers in fiction |
| **what the lenses see** | Critic scorecard. #2 Surprise, #61 Interest per-run; #33/#71 show `∴` → run `npm run balance` |
| **rules this world plays under** | ratified rules, in English, with reasons |
| **what the world calls things** | names the model gave + a `no` button to reject any |
| **the world is thinking** | model call queue: asking / answered / failed, with cost |
| **worlds** | timelines. Click to switch. `†` = a grave (a death, kept) |
| **under the floorboards** | seed, rng counter, events in chain, events in log |

---

## 4. Core loop (test by playing)

1. **Fight**: walk into things. Hit chance and damage come from
   `src/core/tables.ts`. Nat 20 = double damage. Nat 1 = always miss.
2. **Level**: kills pay xp = the victim's threat value. At a threshold: stats
   grow, **full heal**, status line announces it.
3. **Relics**: gold square, always guarded. Floor 1 always has the keen edge
   (+might). Depth 2+ has two relics from: keen edge, iron charm (+max hp),
   fleet boots (+speed), grey lens (+wits).
4. **Descend**: stand on the exit, press descend. You keep stats/xp/level/rules.
   **If the floor was fully cleared, you descend healed.**
5. **Depth**: each floor spawns from a threat budget. Level-2+ creatures mix in
   from depth 2. The **warden** (boss) guards depths 3, 6, 9.
6. **Die**: your body stays on the map (ringed, gold). A `†` grave world is
   created. Press **run again** to restart — rules survive death.

Expected difficulty (20 fixed seeds, brawler bot): floor 1 ~85-95% survival,
depth 5 ~15-25%. If your experience is wildly off that, something broke.

---

## 5. The evolution loop (the point of the game)

1. Play a run to death or escape.
2. Open **the forge…** → **ask the world for a rule** (~40-90s, ~$0.25).
   Spinner + elapsed seconds show in the dialog.
3. A proposal appears **in English** with: why (its `because`), what it cites
   (events / your notes / lens findings), and the **assay verdict**.
4. Buttons: **accept** (writes it into the log) / **edit…** (bounded form,
   live preview) / **reject** (writes nothing).
5. Play again — the rule fires with its own status lines.

What protects you:

| Guard | Refuses |
|---|---|
| validator | anything outside the closed vocabulary or its number ranges |
| assay: greed trial | stat-minting (e.g. "+1 wits per wait" — the real case) |
| assay: coward trial | rules that make death impossible while idle |
| assay: register | shouting, exclamation marks, off-voice text |
| citation pruning | invented event ids, note timestamps, lens numbers |
| duplicate check | a rule the world already has |

A refused proposal shows as a failed ask with the reason. Nothing refused ever
enters the log.

---

## 6. Headless testing (no browser)

All from repo root. All deterministic — same seeds, same results.

```bash
npx vitest run                                # 566 tests, ~10s
npm run play -- --policy all --seeds 12       # bot sweep, table out
npm run play -- --policy brawler --seeds 20 --floors 3
npm run balance                               # + lenses #33/#71
npm run trial -- rule.json                    # assay one rule; exit 0/2/1
npm run loop -- --seed 7 --rule rule.json     # full cycle, offline
npm run loop -- --seed 7                      # full cycle, live model
```

Quick self-checks:

| Check | Command | Expect |
|---|---|---|
| suite green | `npx vitest run` | 566 passed |
| balance holds | `npx vitest run tests/balance` | 5 passed (band breach = real defect) |
| assay works | `echo '{"when":"WAIT","require":[],"then":[{"kind":"grant","stat":"wits","n":1}],"provenance":{"events":["e"],"notes":[],"because":"x"}}' > /tmp/r.json && npm run trial -- /tmp/r.json` | `refused`, exit 2 |
| bots play | `npm run play -- --policy rusher --seeds 5` | mixed escaped/dead, ~1s |

Bot policies: `rusher` (runs for exit), `brawler` (kills everything),
`coward`, `shuffler`, `bumper`, `sitter` (degenerate — used by the assay).

---

## 7. Agent delegation

- `.claude/agents/playtester.md` (haiku) — runs sweeps, reports numbers.
- `.claude/agents/rules-warden.md` (sonnet) — judges a candidate rule on
  mechanics AND voice; can call the haiku judge:
  `POST /__oracle {"intent":"judge","context":{"text":…,"mechanics":…}}`
  → `sound | off-register | off-fit` (~$0.04).
- Both personae carry "do not" lists grown from their real confabulations.
  **Their reports are evidence, not verdicts.**
- `AGENTS.md` = the map. `src/assay/covenant.ts` = the law.

---

## 8. Files that matter

| File | What |
|---|---|
| `NIGHTLOG.md` | timestamped build diary |
| `docs/design/BALANCE.md` | all combat/level/spawn math + 8-pass tuning log |
| `src/core/tables.ts` | every tunable number, one file |
| `src/assay/covenant.ts` | stated invariants (M1-M5 mechanical, T1-T3 thematic) |
| `tests/balance/sawtooth.test.ts` | difficulty pinned on fixed seeds |
| `runs/loops/*.md` | every proposal cycle, incl. the ratify-worthy one |
| `runs/archive/` | auto-backup of any session a wipe would destroy |

---

## 9. OPEN QUESTIONS — need your call

1. **Ratify the dead-air rule?** Best proposal so far, assay-sound, in
   `runs/loops/2026-07-26T09-07-28-912Z.md`: *lose 1 hp per turn once the
   floor is clear, far from exit, turn 10+, above half health.* Ratify from
   the Forge if you agree.
2. **Does the dungeon have a bottom?** Right now depth rises forever. A
   victory floor (fetch-the-thing-and-out, roguelike classic) is unbuilt.
3. **Level-up choices?** Currently deterministic (might/speed alternate).
   Could become Forge-proposed choices instead.
4. **Depth-3 tie.** Fighter and runner currently tie at depth 3 (8v8 on the
   pinned seeds); fighter wins at depth 5 (5v3). If you want the fighter ahead
   at 3, the honest knobs are the XP curve or creature growth rows —
   BALANCE.md "Open question" section.

## 10. Known gaps (not bugs, just not built)

- Canon consistency judge ("hoarfrost hound from the treeline" class) — the
  haiku judge exists but isn't auto-run over new names.
- Forge doesn't display the haiku judge's opinion yet.
- Old saves from before last night fail verification on load → clean restart
  with a visible message. Expected, not a bug.
- Two leftover names may appear in canon from pre-wipe kinds. Harmless.
- R3 (rules → engine code) and the shareable artifact build: unstarted.
- Model flake: ~half of live proposals fail (bad nesting / 502). Handled
  cleanly, raw reply shown, but retry is manual.
