---
type: Workflow
title: Turn Execution Loop & Session Driver
description: Execution specification of the turn-based gameplay loop, session driver, player actions, AI decisions, mortality rewinds, and session storage.
tags: [workflow, turn-loop, session, ai, mortality, persistence]
---

# Turn Execution Loop & Session Driver

The core gameplay loop in `evolving-rpg` is managed by `src/play/session.ts`. It acts as the orchestration driver that translates player input and AI creature decisions into validated game events, rule checks, turn advancements, and state updates.

---

## The Turn Resolution Lifecycle

A turn begins when the player executes an action (movement, attack, picking up an item, or waiting).

```mermaid
sequenceDiagram
    autonumber
    participant UI as Debug UI Panel
    participant Driver as session.ts (step)
    participant AI as core/ai.ts (decide)
    participant Log as log/chain.ts
    participant Rules as canon/interpret.ts

    UI->>Driver: step(position, playerAction)
    Driver->>Log: append player draft event
    Driver->>Rules: fireRules(state, trigger, playerId)
    opt Rules Fired
        Driver->>Log: append RULE_FIRED events
    end
    Driver->>Log: append TURN_ADVANCED event
    
    loop Auto-turn until Player active or Player Dead
        Driver->>AI: decide(state, activeEntityId)
        AI-->>Driver: creatureAction (step/wait/strike)
        Driver->>Log: append creature draft event
        Driver->>Log: append TURN_ADVANCED event
    end
    Driver-->>UI: Return updated position & GameState
```

*Figure 1: Complete execution flow of player action resolution and automated creature turn processing.*

---

## Action Drafting & Execution (`commit` and `step`)

### Action Drafting (`draftFor`)

Actions are turned into draft events via `draftFor`:
- **Step (`step`)**: Invokes `attemptMove(state, entityId, dx, dy)`. If the target cell is occupied by a hostile entity, `attemptMove` automatically converts the move into a `STRIKE` command.
- **Wait (`wait`)**: Returns a `WAIT` event draft.
- **Item Pick Up**: Standing on an item automatically triggers `takeUnderfoot(state, entityId)`, emitting an `ITEM_TAKEN` event that applies item stats grants.

### Event Commit Pipeline (`commit`)

`commit(position, draft, actorId, playerId)` executes a multi-step pipeline:

1. **Append Action**: Appends the primary action `draft` to the log and folds state to inspect the resulting world (`afterAction`).
2. **Evaluate Rules (`firingFor`)**: Maps the draft event and post-action state to a rule firing context (`trigger`, `actorId`, `blow`):
   - **Player Actions (`WAIT`, `MOVE`, `MOVE_BLOCKED`, `ITEM_TAKEN`)**: Emits corresponding triggers for player-initiated non-combat actions.
   - **Combat Attacks (`STRIKE`, `STRUCK`, `KILLED`)**:
     - When the player swings, if the blow kills the target, it emits `KILLED` (and only `KILLED`, avoiding double-firing with `STRIKE`). Otherwise, it emits `STRIKE`.
     - When an enemy swings at the player, it emits `STRUCK`, allowing reactive rules (such as thorns or retaliation) to fire on the player's behalf during enemy turns.
   - **Rule Firing**: Calls `fireRules(afterAction, trigger, actorId, blow)` and appends any emitted `RULE_FIRED` events carrying resolved concrete outcomes (`health`, `stat`, `move`, `said`).
3. **Advance Turn & Pass Round (`TURN_PASSED`)**: If `endsTurn(draft)` is true, appends a `TURN_ADVANCED` event to pass initiative according to speed order (`src/core/turns.ts`). If a full round completed (`after.turn !== before.turn`), evaluates `TURN_PASSED` rules once for the round.

---

## Combat Mechanics & AI Decision Engine

### Melee Combat Resolution (`src/core/commands.ts` & `src/core/tables.ts`)

When an entity steps into an enemy cell, combat resolves deterministically using bounded accuracy dice tables (`src/core/tables.ts`):

1. **Target Roll (`neededToHit`)**:
   $$\text{Needed} = \text{clamp}(10 + \text{Defender.Speed} - \text{Attacker.Might},\, 4,\, 17)$$
2. **d20 Check**:
   - **Crit (`CRIT`)**: Natural 20 (or $\ge$ `critFloor(wits)` down to 18) always hits and doubles damage.
   - **Whiff (`WHIFF`)**: Natural 1 always misses regardless of stat advantage.
   - **Hit**: Roll $\ge \text{Needed}$ lands a blow; damage is drawn from `DamageDice` based on attacker Might band.
3. **Tactical Verbs**: Players can perform non-dice positional stance actions including `shove` (pushes target back 1 tile) and `brace` (defensive stance). Creatures feature specialized verbs (`trample`, `lunge`, `ambush`, `vigil`, `stinger`, `caller`).

HP reduction is applied via `modifyHp` in `src/core/entity.ts`. Defeating enemies grants XP; filling the XP bar triggers a level-up restoring HP. If defender HP drops to 0 or below, the entity transitions to dead (`isAlive = false`). When a run ends (victory or death), the Chronicler (`src/canon/chronicler.ts`) generates a validated story payload recorded into the chain as a `CHRONICLE_WRITTEN` event.

### AI Creature Behaviour (`src/core/ai.ts`)

During `autoTurn`, creature AI decisions are produced by `decide(state, creatureId)`:
1. Locates player entity in `state.entities`.
2. Computes Manhattan distance to player.
3. If distance is 1 step, returns a `step` action toward player (triggering combat strike).
4. If player is within reachability bounds, calculates step along shortest path using BFS grid search (`src/core/reachability.ts`).
5. If player is unreachable or blocked, returns `wait`.

---

## Mortality Mechanics & Death Rewinds

In `evolving-rpg`, player death does not delete the world or end the run.

### Death Rewind Logic (`rewindOnDeath`)

When `player.stats.hp <= 0`:
1. The driver identifies the current dead branch ref.
2. Creates a rewind ref pointing back to the initial `WORLD_INIT` head or last safe world checkpoint.
3. The branch where the player died remains permanently in the event log history.

This design gives forking a tangible gameplay role: previous failed attempts survive in history for player review and Critic metric analysis.

---

## Session Storage & Persistence (`src/play/store.ts`)

Game sessions are saved to browser `LocalStorage` under key `evolving-rpg/session/v1`:

- **`serialise(log, refs, active, savedAt)`**: Collects all unique events reachable across all world refs and sorts them by sequence number `seq`.
- **`deserialise(saved)`**: Reconstructs `EventLog` and `Refs` maps, then runs `verifyChain` on every world ref to ensure historical integrity.
- **Corrupt Save Handling**: If `verifyChain` finds a hash mismatch or sequence divergence, `deserialise` throws an error and refuses to load the corrupted save.

---

## Cross-Module Links

- Overall architecture layers are detailed in [System Architecture Overview](/openwiki/architecture/overview.md).
- R2 rule evaluation during `commit` is specified in [The Ladder & Rule Vocabulary](/openwiki/domain/ladder.md).
- Event log structure and hash verification are documented in [Content-Addressed Event Log](/openwiki/domain/event-log.md).
- Session storage plugins and test execution are detailed in [Operations & Testing Runbook](/openwiki/operations/testing-runbook.md).
