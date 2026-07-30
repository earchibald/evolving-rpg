---
type: Quickstart
title: OpenWiki Quickstart Guide
description: Entrypoint guide and central orientation map for the self-evolving turn-based grid RPG codebase.
tags: [quickstart, overview, entrypoint, architecture]
---

# Evolving RPG — Quickstart Guide

**Evolving RPG** is an experimental turn-based grid RPG built in TypeScript and Vite. It begins near-empty and incrementally grows its own world, fiction, and mechanics through play. Improvised content that proves valuable is promoted through a hierarchy of rungs—from runtime AI generation down to deterministic rules and engine code.

This document serves as the entrypoint for developers and AI agents inspecting or expanding the codebase.

---

## Central Thesis & The Ladder

In `evolving-rpg`, novelty is the only component that costs a language model call. As a playthrough progresses, improvised fiction and mechanics solidify into permanent records and rules, making the game faster, cheaper, and more consistent over time.

Every element of the game resides on a specific rung of **The Ladder**:

| Rung | Name | What It Is | Cost to Use | Authority |
|---|---|---|---|---|
| **R0** | Improvised | Model decides fresh at runtime | 1 call (~1–3s) | Oracle |
| **R1** | Recorded | Improvisation saved into permanent canon | Free, instant | Oracle (Automatic) |
| **R2** | Ruled | Generalized pattern expressed in declarative rule vocabulary | Free, deterministic | Rulesmith (Player Ratifies) |
| **R3** | Systemic | Rule implemented as engine code with unit tests | Free, fast | Claude Code / Developer |

To understand how rungs and rule vocabularies are validated and interpreted, see [The Ladder & Rule Vocabulary](/openwiki/domain/ladder.md), which defines rule conditions and triggers evaluated during gameplay.

---

## Core System Architecture

The codebase strictly separates engine logic, state persistence, rules interpretation, and model integration into pure functional modules:

```
src/
├── core/       # Pure engine: grid, entities, stats, combat tables, sight, seeded RNG, reducers
├── log/        # Content-addressed append-only event log, SHA-256 hashing, refs
├── canon/      # R1 records, R2 rules vocabulary, Worldsmith, Namesmith, Chronicler
├── assay/      # Covenant invariants, Rule Assay trials (Greed, Coward, Function)
├── critic/     # Game design lenses (Surprise, Interest), Ensemble scorecard
├── oracle/     # Async LLM ask() interface, transports, and fallback system
├── play/       # Session driver, turn loop, autoplay policies, mortality rewinds
├── channels/   # Designer & Gamemaster feedback channels
├── witness/    # Voice recording, trace, transcription weaving, Listener analysis
├── ui/         # Debug UI, grid renderer, words pools, FOV, and control panels
└── version.ts  # Current engine version (0.3.0)
```

The system architecture relies on a pure functional reducer flow detailed in [Architecture Overview](/openwiki/architecture/overview.md), which dispatches events into state transitions without side effects.

---

## Key Knowledge Domains & Documentation Map

Explore the domain documentation for specific subsystem guidance:

- **State & History**: Read [Content-Addressed Event Log](/openwiki/domain/event-log.md) to learn how history is structured as a SHA-256 parent-hashed event chain supporting instant world forking, resets, state folding (`fold = reduce(apply, EMPTY_STATE)`), and schema upcasting.
- **Rule Engine & Validation**: Read [The Ladder & Rule Vocabulary](/openwiki/domain/ladder.md) to understand R2 rule types (`Trigger`, `Condition`, `Effect`), safety bounds, the `fireRules` interpreter, and the **Rule Assay & Covenant** validation system (`src/assay/`).
- **Turn Loop & Gameplay**: Read [Turn Execution Loop & Session Driver](/openwiki/workflows/turn-loop.md) for details on `commit`, `step`, entity movement, combat tables (`src/core/tables.ts`), AI decision-making (`decide`), autoplay policies, mortality rewinds, and Chronicler stories.
- **AI & Integrations**: Read [Oracle & Feedback Channels](/openwiki/integrations/oracle-channels.md) to inspect the asynchronous `ask` / `consult` model bridge, Worldsmith/Namesmith composition, transports (`stub`, `cli`, `sdk`, `artifact`), and dev-server CLI proxy (`server/oracle-plugin.ts`).
- **Development & Operations**: Read [Operations & Testing Runbook](/openwiki/operations/testing-runbook.md) for dev server commands, mutation proof testing requirements, golden replay verification (`scripts/generate-golden.ts`), agentic playtesting (`scripts/loop.ts`), and game design Critic lenses (`src/critic/`).
- **Codebase Index**: Read [Source Map](/openwiki/source-map.md) for a comprehensive inventory of source files, server plugins, and test suites.

---

## Quick Developer Workflows

### Prerequisites & Installation

The project uses Node.js, Vite, and Vitest. Dependencies are declared in `/package.json`.

```bash
# Install dependencies
npm install

# Start local dev server (includes Oracle CLI proxy and Chronicle plugin)
npm run dev

# Run unit and property test suites
npm run test

# Run TypeScript typechecker
npm run typecheck

# Re-generate golden replay test fixture
npm run golden

# Run CLI playtester / trial / loop / balance scripts
npm run play
npm run trial
npm run loop
npm run balance
```

---

## Guiding Invariants

1. **Deterministic Mechanics**: State updates occur strictly through `apply(state, event)`. Randomness comes exclusively from a seeded generator (`src/core/rng.ts`).
2. **Non-blocking Model Calls**: Mechanics resolve immediately; narrative prose from the Oracle arrives asynchronously or falls back gracefully without stalling the UI.
3. **Log is the Only Truth**: Canon state is derived by folding events from history (`chain(log, head).reduce(apply, EMPTY_STATE)`). No hidden side-state exists.
4. **Mutation Proof Tests**: Tests must prove they fail when implementation guards are removed, preventing false-positive test suites.

---

## Backlog

The following technical and product areas remain deferred:

- **Artifact Publishing Target**: Inlining assets into a single single-file HTML bundle exposing `window.claude.complete` (Source: `docs/superpowers/specs/2026-07-24-self-evolving-rpg-design.md#modules`).
- **Judged Register LLM Passes**: Qualitative LLM passes for evaluating voice register and thematic alignment beyond deterministic structural checks (Source: `src/assay/covenant.ts`).
- **Living Dungeon Mechanics (In Progress)**: Dynamic board scaling via `sizeStretch`, dispositions (guards/wanderers), and the living-dungeon design (Source: `docs/superpowers/specs/2026-07-29-living-dungeon-design.md`) are partially implemented — further depth-driven mapgen evolution remains on the roadmap.
