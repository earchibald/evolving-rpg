# Increment 2: A Loop Worth Playing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a walkable grid into a game you can die in — with an exit worth reaching, things that can kill you, an item worth the risk, a death that rewinds instead of ending, a world that names what you touch, and two channels for talking back.

**Architecture:** Extends increment 1 without loosening any of its guarantees. Combat consumes randomness, so the event envelope gains a draw count and `apply` advances the counter by it — a real schema migration with upcasters and a regenerated golden fixture. The Oracle arrives as one interface with swappable transports and an observable call queue; nothing ever blocks a turn on it. Player-to-agent channels write to a JSONL sidecar rather than the event log, because they are about the game rather than in it.

**Tech Stack:** Unchanged — TypeScript strict, Vite, Vitest, `@noble/hashes`. Adds a small dev-server endpoint that shells out to the `claude` CLI.

## How this plan differs from increment 1's, and why

Increment 1 produced 19 defects. Nearly all were in the plan rather than the implementations, and the dominant category was **tests that cannot fail**. The prescribed test code was itself the largest single source of them: a hash test suite that passed with two hashed fields deleted, a `verifyChain` branch never once exercised, a fork-ancestry test satisfied by a different guard than the one under test.

Writing those assertions more carefully is not the remedy. So:

- **This plan states properties and required mutations. It does not write your tests.** Each task says what must be true and which mutations must be shown to fail. You choose the assertions.
- **Every guard ships with mutation evidence.** Break it, watch a test fail, revert, report all three. A guard nothing fails without is not a guard.
- **Six tasks, not twelve.** Each still ends playable, and each updates the view enough to play what it added.

If a property in this plan is wrong, contradicts another, or cannot be tested as stated — say so and stop. That happened nineteen times last increment and reporting it was right every time.

## Global Constraints

Everything from increment 1 still binds. Re-read that plan's Global Constraints section; the following are the additions and the one change.

- **CHANGED — the RNG counter protocol.** An event's `rngCounter` is still the counter *before* it ran. It now also carries `rngDraws`: how many draws the command consumed. `apply` advances the stored counter by exactly that. Previously only `WORLD_INIT` moved the counter, via a `counterAfter` field in its payload; that special case is removed in favour of the uniform envelope field. This is a breaking schema change — bump every event type's `schemaVersion`, write upcasters, regenerate the golden fixture behind its guard.
- **No turn is consumed by an action that did not happen.** A blocked move is recorded and costs nothing. This was a real bug found by playing, not by testing: it handed a free hit to anything standing next to you.
- **Nothing blocks a turn on the Oracle.** Mechanics resolve instantly; prose arrives late or never. A failed, slow or absent Oracle degrades the game, never stops it.
- **The Oracle's queue is observable.** In-flight and pending calls are readable state the UI renders. The model's work is visible, not magical.
- **Player-to-agent messages never enter the event log.** They are about the game, not events within it. They go to a JSONL sidecar, keyed by world ref and the head hash the player was standing on.
- **GM replies are advisory this increment.** They are prose, recorded, and do not mutate game state or commit canon. Integrating them is the next increment's work.
- Four stats only: `hp`, `might`, `wits`, `speed`. `wits` may remain unused this increment rather than being given a contrived job.
- Anything shared by reference across snapshots must be immutable.
- `core/` and `log/` remain the never-regress modules.
- No test may touch the network. The Oracle's `stub` transport exists so this stays true.

---

### Task 1: The draw protocol, and the turn that should not have been spent

**Why first:** combat cannot be written until an event can say how much randomness it consumed, and this is the migration that proves the schema-change machinery works.

**Files:** `src/core/events.ts`, `src/core/apply.ts`, `src/core/commands.ts`, `src/log/chain.ts`, `src/log/upcast.ts` (new), `scripts/generate-golden.ts`, `tests/fixtures/golden-run.json`, plus the tests you write.

**Properties that must hold:**

1. Every event carries `rngDraws: number`. `apply` sets the next state's counter to `event.rngCounter + event.rngDraws`, for every event type without exception.
2. `WORLD_INIT` no longer carries `counterAfter` in its payload. Map generation's draw count is recorded as `rngDraws` on the envelope like everything else.
3. A blocked move consumes no turn. `MOVE_BLOCKED` is still recorded — bumping a wall is real signal about whether a map reads legibly — but no `TURN_ADVANCED` follows it, and the actor may act again.
4. `verifyChain`'s counter check remains exact and now means something: with several draw counts in play it can no longer be satisfied by every event repeating one value.
5. Every event type's `schemaVersion` is bumped. An upcaster in `src/log/upcast.ts` converts a v1 event to the current shape, and a v1 log still verifies and folds after upcasting.
6. The golden fixture is regenerated deliberately, via the guard, and its regeneration is recorded in the commit message as an intended behaviour change.

**Required mutation proofs:**

- Make `apply` ignore `rngDraws` (advance by zero). A test must fail.
- Restore the `TURN_ADVANCED` that used to follow a blocked move. A test must fail.
- Break the upcaster so a v1 event passes through unchanged. A test must fail.

**Report:** the old and new fixture hashes, side by side, and why the change was intended.

---

### Task 2: Things that live here

**Files:** `src/core/entity.ts`, `src/core/commands.ts`, `src/core/apply.ts`, `src/core/events.ts`, `src/core/ai.ts` (new), `src/ui/debug.ts`, plus tests.

**Properties:**

1. A world is created with opponents placed on reachable floor, away from the player's start. Placement is seeded and recorded, never recomputed at fold time.
2. Moving into a living occupant strikes it instead of moving. Bump-to-attack; no separate attack key.
3. A strike consumes exactly two draws: one to hit, one for damage. To-hit and damage both derive from `might`; `speed` acts as evasion. Keep the arithmetic legible enough that a player can reason about whether a fight is worth taking — that legibility is the point, not the specific numbers.
4. Opponent turns are decided by `src/core/ai.ts`: strike if adjacent, otherwise step toward the player when within a stated awareness range, otherwise wait. Fully deterministic — **no draws** — with ties broken the same way every run.
5. Reaching zero HP is recorded as a death. The player's death does not yet do anything beyond being recorded; Task 4 gives it consequence.
6. The debug view shows every entity, their HP, and what just happened, well enough to fight something.

**Required mutation proofs:**

- Make the AI's tie-break depend on entity array order. A test must fail.
- Make a strike consume one draw instead of two. A test must fail.
- Let a strike land on a dead entity. A test must fail.

**Watch for:** a strike must not also move the attacker. If the golden fixture goes red, stop — a linear walking run should be untouched by combat existing.

---

### Task 3: A reason to cross the room

**Files:** `src/core/mapgen.ts`, `src/core/commands.ts`, `src/core/apply.ts`, `src/core/events.ts`, `src/ui/debug.ts`, plus tests.

**Properties:**

1. Every world has exactly one exit tile, placed on floor reachable from the start and as far from it as the flood fill allows. Reaching it ends the run as a win, recorded as an event.
2. Every world has one item, placed reachable, and positioned so that taking it is a genuine detour rather than on the direct path — near an opponent is ideal. Stepping onto it takes it.
3. The item changes a fight measurably. One effect, permanent for the run.
4. Every encounter therefore offers fight, avoid, or grab-and-run, with visibly different payoffs. This is Schell's triangularity and it is the reason the item exists — not decoration.
5. Reaching the exit and dying are both terminal states the view renders distinctly, and neither leaves the game accepting input as though nothing happened.

**Required mutation proofs:**

- Place the exit unreachable. A test must fail.
- Make the item's effect a no-op. A test must fail.

---

### Task 4: Death that history keeps

**Files:** `src/log/refs.ts`, `src/core/commands.ts`, `src/core/events.ts`, `src/ui/debug.ts`, plus tests.

**Properties:**

1. When the player dies, the branch they died on is preserved under a new ref, automatically named and distinguishable at a glance from living worlds.
2. The living world's ref then rewinds to the world's start. The log loses nothing — this is `reset`, which increment 1 already proved is non-destructive and undoable.
3. The rewind costs something: whatever the player was carrying stays with the corpse on the dead branch, not with the rewound world.
4. The dead branch remains selectable and playable-past — you can go and look at where you died, and the state folds correctly there.
5. Rewinding and then repeating the exact moves you made before must not throw. Increment 1's idempotent `append` makes convergent history legal; this is the case that proves it matters.
6. The view lists dead branches alongside living worlds, marked as such.

**Required mutation proofs:**

- Delete the dead branch's ref instead of keeping it. A test must fail.
- Carry the item through the rewind. A test must fail.

**This is the task that answers "how does this fork".** If, on playing it, forking still feels like a devtool rather than a mechanic, say so — that is a design finding worth more than a passing suite.

---

### Task 5: The world names what you touch

**Files:** `src/oracle/` (new — interface, intents, queue, transports), `src/canon/` (new), `server/oracle-endpoint.ts` (new), `vite.config.ts`, `src/ui/debug.ts`, plus tests.

**Properties:**

1. One interface, `ask(intent, context)`, with intents as named roles rather than separate systems. This increment needs only naming.
2. Three transports behind that interface: `stub` (deterministic, offline, used by every test), `cli` (a dev-server endpoint shelling out to the `claude` CLI on PATH — the development default, needing no API key), and a seam where `artifact` and `sdk` will fit. No test may reach the network.
3. **The queue is observable state.** Calls in flight and calls pending are readable, and the view renders both continuously — intent, subject, and how long each has been waiting.
4. A turn never blocks on a call. The mechanical result lands immediately; a name arrives later, or never.
5. Every intent has a deterministic fallback. Network gone, CLI missing, call timed out — the game continues, degraded, and says so rather than hanging.
6. First contact with a creature or an item asks for a name and one line. **Thereafter the world is silent about it.** Names are permanent once spoken.
7. The cache and the canon store are the same store. Promoting an improvisation to canon is naming a cache entry, not copying it somewhere else.
8. Canon survives a reload — `localStorage` was confirmed to persist in a Code-published artifact, and this is where that starts paying off.

**Required mutation proofs:**

- Make a call block the turn. A test must fail.
- Remove a fallback so a failed call throws. A test must fail.
- Let a second call fire for something already named. A test must fail.

**Measured cost, which shapes this task.** A `claude -p` probe returned in ~2.3 s and cost $0.15 for a sixteen-token reply — the price is startup, not the answer, because each invocation is a fresh session re-caching ~14k tokens of CLI system prompt. Two consequences:

- **Batch first-contact namings.** One call naming several newly-seen things beats one call each. The queue makes this visible, which is half of why it exists.
- **Cost must scale with novelty, not with playtime.** A thing is named once, ever, and cached forever. If a second call ever fires for something already named, that is the bug the third mutation proof above is there to catch — and it is now a bug with a dollar figure attached.

Use `--output-format json` and read `is_error` rather than parsing prose for failure. The envelope also carries `duration_api_ms` and `total_cost_usd`; surface both in the queue so the cost of the world thinking is visible rather than discovered later on a bill.

**Judgment call worth reporting:** if serialising the whole canon store to `localStorage` on every commit turns out to be too slow to do synchronously, say so rather than working around it silently.

---

### Task 6: Two ways to talk back

**Files:** `src/channels/` (new), `server/notes-endpoint.ts` (new), `src/ui/debug.ts`, plus tests.

**Properties:**

1. Two distinct channels, never merged and never confused in the UI:
   - **GAME DESIGNER** — the player as themselves, out here, commenting on the game as an artifact. This is the fitness signal the Critic will eventually read.
   - **GAMEMASTER** — the player as their character, in there, asking the GM about the world. This is player-initiated improvisation, and the path by which a player chooses what the world invents.
2. Each message and its reply is appended to a JSONL sidecar — one object per line, never rewritten — recording the channel, the message, the reply, the world ref, and the head hash the player was standing on when they wrote it.
3. **Neither channel writes to the event log.** They are about the game and around it, not events within it. Keying them to a head hash is what lets them be correlated later without polluting causal history.
4. GM replies are advisory: prose, recorded, no state change, no canon committed. Integration is the next increment's work and must not be smuggled in here.
5. Both channels use the Oracle's queue, so their calls are visible alongside the world's own — you can see the GM thinking.
6. A designer note is answerable without a model call being required. Recording it must work even with every transport dead.

**Required mutation proofs:**

- Route a GM reply into the event log. A test must fail.
- Let a designer note be silently dropped when the Oracle is unavailable. A test must fail.

---

## Increment 2 done when

- You can die, and go back and look at where you died.
- Reaching the exit feels like something, because getting there was not free.
- At least one fight was worth avoiding and you knew it in advance.
- Things you touch have names you did not choose, and they keep them.
- You can see what the world is currently thinking about.
- You can tell me the game is wrong without leaving it, and tell the GM you are searching the wall without leaving the fiction.
- `npx vitest run` green, `npx tsc --noEmit` clean, and every guard above has mutation evidence behind it.

## What is deliberately not here

The Critic, the Forge, promotion machinery, rule authoring, more than one item, room segmentation, and the designed interface. All of them should be written from what this increment's play reveals, rather than guessed at now.
