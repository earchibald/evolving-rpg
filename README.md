# evolving-rpg

A grid RPG that evolves through play. You walk, fight, level and descend; the
world names what you touch; and between runs it reads your play back and
**proposes rules** — which are trialled by exploiter bots and ratified only by
you. The game's history is an append-only, content-addressed event log: every
run replays exactly, forks like branches, and keeps its graves.

## Play

```bash
npm install
npm run dev        # then open the printed URL
```

Arrows/wasd to move, walk into things to fight, `.` to hold. Kills pay XP;
levels heal you whole. The green square is the way down — the warden waits at
depth 3. Talk to the **game designer** (out of world) or the **gamemaster**
(in the fiction) in the boxes below the map. When a run ends, open **the
forge…** and ask the world for a rule.

## The machinery

| | |
|---|---|
| `docs/design/BALANCE.md` | the combat math, tables, sawtooth, tuning log |
| `src/assay/covenant.ts` | the invariants every facility is validated against |
| `AGENTS.md` | tools + personae for agents: play, trial, loop |
| `NIGHTLOG.md` | timestamped build diary, newest at the bottom |
| `npm run play -- --policy all --seeds 12` | headless playtest sweep |
| `npm run trial -- rule.json` | exploiters attack a candidate rule |
| `npm run loop -- --seed 7` | baseline → propose → trial → deltas |
| `npx vitest run` | the suite (546); mutation proofs are the idiom |

Requires the `claude` CLI for the model-facing parts (naming, proposals,
judging); the game itself runs fine without it, on quiet fallbacks.
