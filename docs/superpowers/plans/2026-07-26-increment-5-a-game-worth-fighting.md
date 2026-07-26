# Increment 5: A Game Worth Fighting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Same property-and-mutation format as increments 2–4, for the same measured reasons.

**Goal:** Make fighting core and balance measurable. Combat pays (XP → levels → survival deeper); depth scales (bestiary tables, spawn budgets, overlapping level bands, a mini-boss); the difficulty curve is a rising sawtooth we can *measure* with the harness, not assert.

**Architecture:** All numbers live in `src/core/tables.ts` — one file of data and pure functions, documented in `docs/design/BALANCE.md`. Combat keeps the d20 and the 2-draw protocol but adopts bounded accuracy and criticals. XP and levels are *derived state*: computed in `apply` from kill history, so no new event types, no upcasters for leveling, and replay stays exact. Depth arrives as a WORLD_INIT v5 field with the player carried across floors; descending re-ratifies rules the way `beginAgain` already does.

**Design lineage (the "best practices" the tables descend from):** D&D 5e's bounded accuracy (hit chances stay in a band while hp/damage scale — legible and infinitely extensible); DCSS-style XP thresholds with full-heal level-ups (the sawtooth's "ease" tooth); Brogue's out-of-depth spawn overlap (depth N draws creatures from levels N−1..N+1, so bands blur instead of stair-stepping).

## Global Constraints

Everything from increments 1–4 binds, plus:

- **One table file.** Any tunable number a designer would touch lives in `tables.ts`, exported, with its unit and its reason. A magic number in combat code is a defect.
- **STRIKE keeps exactly 2 draws.** Crits reuse the damage draw (doubled), never add one.
- **Leveling is derived, never evented.** XP and level are functions of the chain; `apply` computes them. If two folds of the same chain disagree about level, that is corruption.
- **The player crosses floors inside WORLD_INIT.** Descending seeds the next world's player from the current entity — stats, xp, level ride in the event, so a floor-2 log replays without floor 1.
- **Balance is tested against fixed seeds.** Deterministic worlds make band assertions exact, not flaky. Bands are wide enough to survive tuning, tight enough to catch a broken table.
- **Target bands (the sawtooth, quantified):** depth 1 brawler survival 55–80% (fighting *viable*); depth 2 with a carried level-1 player harder than depth 1 was (survival drops ≥10 points); leveled player recovers ≥ half the drop. Rusher must not dominate brawler's escape rate at depth 2+ (XP has to matter).

### Task 1: The tables
`src/core/tables.ts` + `docs/design/BALANCE.md`. To-hit (bounded [4..17] needed, nat-20 crit doubles, nat-1 whiffs), damage by might band (die + flat), XP thresholds, per-level growth, bestiary (3 archetypes × depth growth + warden mini-boss), threat value, spawn budget by depth, out-of-depth weights. Properties: every function total over junk; monotonicities (deeper budget ≥ shallower; threat rises with stats; damage mean rises with might). Mutations: unclamp needed; flatten a growth table; break monotonicity.

### Task 2: Combat on the tables
`resolveStrike` uses tables; STRIKE payload gains `crit` (schemaVersion 2 + upcaster + golden regen). UI odds line reads the tables. Surprise lens models crits (realized nat-20 ⇒ p=0.05 < threshold ⇒ lens #2 finally nonzero in real play). Mutations: crit without doubling; third draw; lens ignoring crits.

### Task 3: XP and levels, derived
`GameState` gains `xp`/`level` (player-scoped). `apply` credits kills (STRIKE and RULE_FIRED terminal outcomes) with threat-value XP; crossing a threshold applies growth + full heal (the ease tooth). Narration and vitals show it. Mutations: credit creature kills to player; skip rule-kills; level without heal; heal without level.

### Task 4: Depth, spawning, descent
WORLD_INIT v5: `depth`, player seed carried; mapgen spawns from budget with OOD overlap; `descend()` in session (exit → next floor, rules re-ratified, player carried); warden at depth 3; UI: reaching the exit offers *descend* instead of ending the game. Mutations: budget ignoring depth; descent dropping rules; descent resetting the player.

### Task 5: Measure the sawtooth
`scripts/play.ts --depth`; `scripts/balance.ts` sweeping policy × depth × seeds against the target bands; a vitest band-snapshot on fixed seeds. Tune tables until bands hit; record every tuning move in NIGHTLOG and BALANCE.md. Mutations: bands that cannot fail; sweep reading wrong depth.

### Task 6: The morning package
NIGHTLOG entries throughout; AGENTS.md known-shape updated; assay trial worlds reviewed against new combat (the brute's numbers re-derived from tables); full suite + mutation evidence; browser pass.
