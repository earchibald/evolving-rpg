---
type: Source Map
title: Source Map & File Inventory
description: Directory structure, module layout, and complete file inventory for the evolving-rpg codebase.
tags: [source-map, inventory, directory-structure, file-index]
---

# Source Map & File Inventory

This source map provides a complete directory inventory and file index for the `evolving-rpg` codebase.

---

## Directory Overview

```
/
├── index.html                  # Main DOM entrypoint mounting UI panels
├── MANUAL.md                   # Player manual and test guide
├── package.json                # Dependencies and npm scripts
├── tsconfig.json               # TypeScript compiler configuration
├── vite.config.ts              # Vite bundle and dev server plugin configuration
├── scripts/                    # CLI scripts (play, trial, loop, balance, generate-golden)
├── server/                     # Vite dev server plugins (oracle, chronicle)
├── src/                        # Core TypeScript application logic
│   ├── version.ts              # Engine version constant (0.3.0)
│   ├── assay/                  # Covenant invariants & Rule Assay simulation trials
│   ├── canon/                  # R1 records, R2 rules, Worldsmith, Namesmith, Chronicler
│   ├── channels/               # Designer & Gamemaster note channels
│   ├── core/                   # Pure game engine: grid, entities, combat tables, reducers
│   ├── critic/                 # Game design lenses (Surprise, Interest), Ensemble scorecard
│   ├── log/                    # Event log, SHA-256 hashing, refs, upcasters
│   ├── oracle/                 # Asynchronous LLM client, transports & fallbacks
│   ├── play/                   # Session driver, autoplay policies & store
│   └── ui/                     # Debug UI, words pools, FOV, and CSS styles
└── tests/                      # Vitest test suites and golden fixtures
```

---

## Module File Inventory

### 1. `src/core/` — Pure Game Engine

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `ai.ts` | Creature AI turn decisions | `decide(state, creatureId)` |
| `apply.ts` | Pure event reducer state transitions | `apply(state, event)` |
| `commands.ts` | Validated action generators | `attemptMove`, `wait`, `takeUnderfoot`, `advanceTurn`, `endsTurn`, `outcome` |
| `entity.ts` | Entity types and stat manipulations | `Entity`, `Stats`, `findEntity`, `isAlive`, `modifyHp` |
| `events.ts` | Event schema definitions & schema versions | `SCHEMA_VERSIONS`, `GameEvent`, `DraftEvent`, `EventType` |
| `grid.ts` | Grid geometry and bounds checks | `Grid`, `isOutOfBounds`, `manhattan` |
| `item.ts` | Item definitions and stat grants | `Item`, `findItem` |
| `mapgen.ts` | Procedural map generation with seeded RNG | `generateMap(seed)` |
| `reachability.ts` | BFS grid pathfinding & connectivity | `isReachable`, `shortestPath` |
| `rng.ts` | Seeded pseudo-random number generator | `RNG`, `createRNG` |
| `state.ts` | Game state schema definition | `GameState`, `EMPTY_STATE` |
| `tables.ts` | Centralized combat tables & tuning numbers | `neededToHit`, `critFloor`, `levelForXp`, `creatureStats` |
| `turns.ts` | Entity initiative & turn ordering | `nextActiveEntity` |

### 2. `src/log/` — Event Log & History

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `canonical.ts` | Key-sorted canonical JSON serialization | `canonicalJson(obj)` |
| `chain.ts` | Event chain management, fold, verification | `append`, `chain`, `fold`, `verifyChain` |
| `hash.ts` | SHA-256 event content hashing | `hashEvent(draft, parent, seq)` |
| `refs.ts` | Named world pointers, fork and reset | `fork`, `reset`, `getRef`, `listRefs` |
| `upcast.ts` | Schema migrations across event versions | `upcastEvent(event)` |

### 3. `src/canon/` — Rungs, Worldsmith & Fiction

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `rule.ts` | R2 closed rule schema, bounds & validation | `Rule`, `Trigger`, `Condition`, `Effect`, `validateRule` |
| `interpret.ts` | Rule condition checking & firing engine | `holds`, `fireRules` |
| `bible.ts` | Worldsmith whole-world bible generation | `createBible`, `Bible`, `validateBible` |
| `namesmith.ts` | Programmatic name composition in code | `composeRelicName`, `composeCreatureName` |
| `chronicler.ts` | Ended run story generator on event chain | `storyOf`, `writeChronicle` |
| `rulesmith.ts` | Rule proposal drafting from Critic scorecard | `draftRuleProposal` |

### 4. `src/assay/` — Rule Assay & Covenant Invariants

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `covenant.ts` | Stated mechanical, thematic, legible invariants | `COVENANT`, `Invariant` |
| `ruleAssay.ts` | Adversarial simulation trials (Greed, Coward) | `assayRule`, `RuleAssay` |
| `register.ts` | Structural name and line register guards | `assayName`, `assayLine` |

### 5. `src/critic/` — Game Design Lenses & Scorecard

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `critic.ts` | External run log evaluation report | `evaluateLog`, `Report`, `Reading` |
| `lenses.ts` | Schell game design lens registry | `LENSES` |
| `surprise.ts` | Lens #2 Surprise metric (d20 outcomes) | `surpriseOf` |
| `interest.ts` | Lens #61 Interest curve metric | `interestOf` |
| `memo.ts` | Scorecard memoization by head hash | `memoizedScorecard` |
| `ensemble.ts` | Composite evaluation scorecard pointer | `ensemblePointer` |

### 6. `src/oracle/` — Async Model Bridge

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `oracle.ts` | Oracle class, queue, canon cache, fallbacks | `Oracle`, `fallbackFor` |
| `transports.ts` | Transport implementations | `stubTransport`, `brokenTransport`, `cliTransport` |
| `types.ts` | Oracle query, answer, and call types | `Question`, `Answer`, `Call`, `Transport` |

### 7. `src/play/` — Session Driver & Persistence

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `session.ts` | Session turn driver, commit pipeline, mortality | `commit`, `step`, `autoTurn`, `rewindOnDeath` |
| `autoplay.ts` | Automated playtesting driver | `autoplay` |
| `policies.ts` | Policy archetypes (`greedy`, `cautious`, `explorer`) | `greedy`, `cautious`, `explorer` |
| `store.ts` | LocalStorage session save/restore | `serialise`, `deserialise`, `save`, `load` |

### 8. `src/channels/` & `src/ui/` — Channels & Debug Interface

| File | Primary Responsibility | Key Exports |
|---|---|---|
| `channels.ts` | Designer & Gamemaster notes | `send(oracle, channel, said, where, at, post)` |
| `debug.ts` | Debug UI rendering and interaction loop | `mountDebugUI(container)` |
| `words.ts` | Combat voice line pools by verb and tier | `wordsFor` |
| `fov.ts` | Chain-derived field of view computation | `computeFOV` |
| `debug.css` | Fixed-panel layout CSS styles | Grid and panel layout rules |

### 9. `server/` & `scripts/` — Development & Agentic Scripts

| File | Primary Responsibility |
|---|---|
| `server/oracle-plugin.ts` | Vite middleware endpoint (`POST /__oracle`) executing `claude` CLI |
| `server/chronicle-plugin.ts` | Local chronicle log persistence middleware |
| `scripts/generate-golden.ts` | Script to generate `tests/fixtures/golden-run.json` |
| `scripts/play.ts` | Automated gameplay sessions using policy archetypes |
| `scripts/trial.ts` | Standalone Rule Assay trial driver for candidate rules |
| `scripts/loop.ts` | Complete agentic playtest, assay, and proposal loop |
| `scripts/balance.ts` | Combat and balance simulation across depth levels |

---

## Test Suites Inventory (`/tests/`)

- `tests/canon/`: `interpret.test.ts`, `rule.test.ts`, `rules-in-log.test.ts`
- `tests/channels/`: `channels.test.ts`
- `tests/core/`: `ai.test.ts`, `apply.test.ts`, `commands.test.ts`, `entity.test.ts`, `grid.test.ts`, `mapgen.test.ts`, `reachability.test.ts`, `rng.test.ts`, `turns.test.ts`
- `tests/log/`: `canonical.test.ts`, `chain.test.ts`, `golden-replay.test.ts`, `hash.test.ts`, `hash-vector.test.ts`, `refs.test.ts`, `upcast.test.ts`
- `tests/oracle/`: `oracle.test.ts`
- `tests/play/`: `mortality.test.ts`, `rules-in-play.test.ts`, `session.test.ts`, `store.test.ts`

---

## Cross-Module Links

- System architecture layers are detailed in [System Architecture Overview](/openwiki/architecture/overview.md).
- Quickstart navigation is provided in [Quickstart Guide](/openwiki/quickstart.md).
- Rungs and rule engine are specified in [The Ladder & Rule Vocabulary](/openwiki/domain/ladder.md).
- Event chain and hashing are detailed in [Content-Addressed Event Log](/openwiki/domain/event-log.md).
- Turn execution and session driver are described in [Turn Execution Loop & Session Driver](/openwiki/workflows/turn-loop.md).
- Developer workflows and test suite execution are covered in [Operations & Testing Runbook](/openwiki/operations/testing-runbook.md).
