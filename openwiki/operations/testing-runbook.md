---
type: Operations
title: Operations & Testing Runbook
description: Technical runbook for developer workflows, CLI tooling, mutation proof testing philosophy, golden replay verification, and server plugin operations.
tags: [operations, runbook, testing, vitest, golden-replay, dev-server]
---

# Operations & Testing Runbook

This runbook outlines operational workflows for developers and AI agents maintaining `evolving-rpg`. It covers local development commands, testing requirements, golden replay verification, and server plugin diagnostics.

---

## Developer Workflows & CLI Commands

All development tasks are defined in `/package.json`:

| Command | Action | Description |
|---|---|---|
| `npm run dev` | `vite` | Starts local Vite dev server on `http://localhost:5173` with Oracle and Chronicle plugins active |
| `npm run build` | `vite build` | Compiles production assets into `/dist` |
| `npm run test` | `vitest run` | Executes all unit, integration, and property test suites once |
| `npm run test:watch` | `vitest` | Runs test runner in interactive watch mode |
| `npm run typecheck` | `tsc --noEmit` | Runs TypeScript typechecker across all project source and test files |
| `npm run golden` | `tsx scripts/generate-golden.ts` | Re-generates the golden replay fixture (`tests/fixtures/golden-run.json`) |
| `npm run play` | `tsx scripts/play.ts` | Runs automated gameplay sessions using policy archetypes |
| `npm run trial` | `tsx scripts/trial.ts` | Executes standalone Rule Assay trials against candidate rules |
| `npm run loop` | `tsx scripts/loop.ts` | Runs complete agentic playtest, assay, and rule-proposal loop |
| `npm run balance` | `tsx scripts/balance.ts` | Runs combat and balance simulation passes across depth levels |

---

## Testing Discipline & Mutation Proof Requirement

`evolving-rpg` enforces a **mutation proof testing requirement**:

> **A test suite is not valid merely because it passes. A test is only valid if breaking the implementation guard causes the test to fail visibly.**

### Core Guidelines

1. **Verify Test Failure**: When writing or updating guards (e.g. in `src/canon/rule.ts` or `src/log/chain.ts`), temporarily comment out the guard and run `npm run test`. Confirm that the corresponding test fails with a clear error message before restoring the guard.
2. **No Network in Tests**: Unit and integration tests must run offline using `stubTransport()` or `brokenTransport()`. No test suite may make actual network or HTTP calls.
3. **Property Invariants**: Core data structures in `core/` and `log/` must carry property tests proving fold determinism, prefix sharing on fork, reset reversibility, and deep freeze immutability.

---

## Golden Replay Verification (`scripts/generate-golden.ts`)

The **Golden Replay** test (`tests/log/golden-replay.test.ts`) is the single most critical regression safety net in the repository.

### How Golden Replay Works

1. `scripts/generate-golden.ts` runs a multi-turn gameplay sequence using seeded RNG and writes the complete event log payload to `tests/fixtures/golden-run.json`.
2. `tests/log/golden-replay.test.ts` loads `golden-run.json`, upcasts all events through `upcastEvent`, and folds the log into a `GameState`.
3. The test asserts that the folded state and RNG counter match recorded expectations byte-for-byte.

```bash
# Execute golden replay verification as part of test suite
npm run test tests/log/golden-replay.test.ts

# Re-generate golden run fixture when schema versions intentionally bump
npm run golden
```

---

## Agentic Playtesting & Critic Evaluation (`scripts/`)

1. **Automated Playtesting (`scripts/play.ts`)**: Runs policy archetypes (`greedy`, `cautious`, `explorer`, `sitter`) through `src/play/session.ts` to stress-test turn loops and state transitions without UI interaction.
2. **Rule Assay Verification (`scripts/trial.ts`)**: Simulates adversarial exploit scenarios (`trial of greed`, `trial of coward`) against candidate R2 rules to verify Covenant compliance before offer generation.
3. **Agentic Closed Loop (`scripts/loop.ts`)**: Integrates playtesting, Critic scorecard generation (`src/critic/critic.ts`), Rulesmith proposal drafting, and Covenant assaying into a single CLI execution loop.
4. **Balance Analysis (`scripts/balance.ts`)**: Simulates combat encounters across depths 1–9 to verify bounded accuracy, HP sawtooth, and leveling curves against `docs/design/BALANCE.md`.

---

## Server Plugin Operations

The local Vite dev server relies on two custom server plugins defined in `/server/`:

### 1. Oracle Plugin (`server/oracle-plugin.ts`)

- **Role**: Proxies `POST /__oracle` requests from the browser to the host `claude` CLI.
- **Diagnostics**: If the Oracle panel in the UI shows `500` or timeout errors, check that the `claude` binary is present on system `PATH` and authenticated (`claude auth status`).

### 2. Chronicle Plugin (`server/chronicle-plugin.ts`)

- **Role**: Handles local persistence of session chronicle logs for offline analysis.
- **Diagnostics**: Listens for chronicle sync payloads on dev server startup.

---

## Cross-Module Links

- Project entrypoint and setup summary are located in [Quickstart Guide](/openwiki/quickstart.md).
- System dependency layers are detailed in [System Architecture Overview](/openwiki/architecture/overview.md).
- Event log hashing and verification logic are specified in [Content-Addressed Event Log](/openwiki/domain/event-log.md).
- Oracle transport configurations are documented in [Oracle & Feedback Channels](/openwiki/integrations/oracle-channels.md).
- Source tree structure is indexed in [Source Map](/openwiki/source-map.md).
