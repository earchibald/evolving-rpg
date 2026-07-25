# Increment 3: The Ladder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make run N+1 differ from run N because of what happened in run N. A run ends, the Rulesmith reads what actually occurred — events, designer notes, gamemaster exchanges — and proposes exactly one rule with its provenance. You ratify, edit or veto. Ratified rules become events in the log and change how the game plays.

**Architecture:** R2 rules are data in a small total vocabulary, stored as `RULE_RATIFIED` events in the same append-only log as everything else. This is the whole event-sourced substrate finally paying for itself: rules are versioned, forkable, and replayable for free, and a fork inherits exactly the rules that existed at the fork point. Rules fire in the command layer and emit `RULE_FIRED` events, so `apply` still only records and replay stays exact. Effects consume no randomness, so a new rule can never desynchronise the draw protocol.

**Tech Stack:** Unchanged — TypeScript strict, Vite, Vitest, `@noble/hashes`.

## How this plan is written

Same as increment 2, for the same measured reason. Increment 1's prescribed test code was the single largest source of its 19 defects — tests that could not fail. **This plan states properties and required mutation proofs. It does not write your tests.** You choose the assertions; you must show each guard failing when broken.

If a property here is wrong, contradicts another, or cannot be tested as stated — say so and stop.

## What this increment is not

- **Not the Critic.** No lens registry, no metrics, no scorecard. The spec puts the Critic first; we are deliberately reordering because the Forge changes play and the Critic only measures it, and the spec's own stated principle is to reach a play signal fastest.
- **Not R3.** Nothing generates code. Promotion to code happens in a Claude Code session, never at runtime.
- **Not the canon consistency guard.** The "hoarfrost hound from the treeline, inside a dungeon" complaint is real and logged, and it is a naming problem, not a rules problem. Next increment.
- **No fog of war, and therefore no `reveal` effect.** A `revealCreatures` effect was designed and then cut: nothing in this game is hidden, so revealing is a no-op. Building it would have produced a rule the player could ratify that did visibly nothing. If hidden information ever arrives, the effect arrives with it.

## Global Constraints

Everything from increments 1 and 2 still binds. Additions:

- **Rules are data, never code.** A rule is a validated object in a closed vocabulary. Nothing generated is ever `eval`'d, compiled, or otherwise executed as code. This is the guard on letting a model author rules at all.
- **The vocabulary is total and bounded.** Every trigger, condition and effect is a member of a closed union. Numbers are clamped to 1–9, `require` to at most 3 entries, `then` to at most 2, `speak` text to 120 characters, and a world to 16 rules. A rule outside any bound is refused at validation and never stored. A generated rule must not be able to crash or hang the engine.
- **R2 effects are drawless.** No effect consumes randomness. `RULE_FIRED` always carries `rngDraws: 0`. Randomness in rules would mean a ratified rule could shift every subsequent draw, and the draw protocol is the thing that makes replay exact.
- **Rules live in the log.** A rule enters play as a `RULE_RATIFIED` event and nowhere else. It is therefore forkable, replayable, and scoped to a world. There is no separate rules store, no localStorage rules key, no global ruleset.
- **Rule firing is recorded, not recomputed.** Rules resolve in the command layer and emit `RULE_FIRED`. `apply` records the effect; it never re-evaluates conditions. Folding a log must never consult the rule interpreter — otherwise old history would silently re-interpret itself under rules ratified later.
- **The player's veto is absolute and cheap.** Reject is always available, always one click, and never asks for a reason.
- **The Rulesmith never blocks play.** It is an Oracle call like any other: it may be slow, fail, or be absent, and the game continues. There is no modal "waiting for proposal" state.
- **A proposal is never canon.** Proposals use the non-caching `consult()` path. Asking twice may give two different rules; that is what a conversation is. Only ratification is permanent.
- **A note records who wrote it.** `Note` gains `author: 'player' | 'agent'`. Notes written by an automated or test path are marked `agent` and are excluded from the Rulesmith's input by default. Without this the Rulesmith reads its own test fixtures back as the designer's intent — which is not hypothetical: `runs/notes.jsonl` currently contains five notes, of which at least two were written by an agent during testing and are indistinguishable from the player's.
- `core/` and `log/` remain the never-regress modules.
- No test may touch the network.

---

### Task 1: The vocabulary, and the validator that makes it safe

**Why first:** everything downstream stores, interprets or generates these objects. If the validator is not total, every later task inherits a hole.

**Files:** `src/canon/rule.ts` (new), plus the tests you write.

**The vocabulary.** Grounded in what play actually produced, not in what a rules engine usually has:

```ts
export type Trigger = 'WAIT' | 'STRIKE' | 'MOVE_BLOCKED' | 'ITEM_TAKEN';

export type Condition =
  | { kind: 'noCreatureWithin'; n: number }
  | { kind: 'creatureWithin'; n: number }
  | { kind: 'hpAtMost'; n: number }
  | { kind: 'hpAtLeast'; n: number };

export type Effect =
  | { kind: 'heal'; n: number }
  | { kind: 'harm'; n: number }
  | { kind: 'speak'; text: string };

export interface Provenance {
  /** Event ids from the run that motivated this. */
  events: string[];
  /** `at` timestamps of the notes cited. Timestamps rather than ids because
   *  notes are a sidecar and have no ids. */
  notes: string[];
  /** One sentence, in the Rulesmith's own words, on why this rule. */
  because: string;
}

export interface Rule {
  id: string;
  when: Trigger;
  require: Condition[];
  then: Effect[];
  provenance: Provenance;
  ratifiedAt: string;
}
```

`WAIT` and `MOVE_BLOCKED` are in the vocabulary because both are currently inert — waiting does nothing, and bumping a wall does nothing but scold you. They are the two triggers with the most obvious room to grow.

**Properties that must hold:**

1. `validateRule(unknown): Rule | { rejected: string }` is **total**. For every possible input — `null`, `undefined`, a string, an array, a deeply nested object, an object with extra keys, a valid rule with one field corrupted — it returns a value. It never throws.
2. Every bound is enforced: `n` outside 1–9, more than 3 conditions, more than 2 effects, `speak` text over 120 characters, an unknown `kind`, an unknown `when`, a missing `provenance.because` — each is rejected with a message naming the field.
3. A rejection message never contains the offending value verbatim if that value is longer than 120 characters. A model-authored rule is untrusted input and its contents must not be able to flood the UI.
4. `validateRule` is pure: it does not mutate its input, and the `Rule` it returns is a fresh frozen object, not an alias of the input. (This project has found shared-mutable-state bugs three separate times; this is the same class.)
5. Extra keys on an otherwise-valid rule are **dropped**, not preserved and not rejected. The stored rule contains exactly the vocabulary's fields — otherwise a model can smuggle arbitrary data into the log.

**Required mutation proofs.** For each, break it, show a named test failing, revert, report all three:

- Remove the upper clamp on `n`. A test must fail.
- Remove the `require.length` cap. A test must fail.
- Return the input object instead of a fresh copy. A test must fail.
- Preserve extra keys instead of dropping them. A test must fail.
- Make `validateRule` throw on `null` instead of rejecting. A test must fail.

**Done when:** `validateRule` is total over a table of at least 20 malformed inputs, and all five mutations are shown to be caught.

---

### Task 2: Rules in the log

**Why here:** a rule that is not in the log is not forkable, and forkability is the reason the log exists.

**Files:** `src/core/events.ts`, `src/core/state.ts`, `src/core/apply.ts`, `src/log/upcast.ts`, `scripts/generate-golden.ts`, `tests/fixtures/golden-run.json`, plus tests.

**Properties that must hold:**

1. A new event type `RULE_RATIFIED` with payload `{ rule: Rule }`, `rngDraws: 0`.
2. `GameState` gains `readonly rules: readonly Rule[]`. `EMPTY_STATE` has an empty frozen array, shared like `NO_ENTITIES` and `NO_ITEMS`.
3. `reduce` on `RULE_RATIFIED` appends the rule. It appends to a **new** array; the previous state's array is unchanged. Verify by holding a reference to the old state and checking it after.
4. `WORLD_INIT` resets `rules` to empty, like everything else it replaces wholesale.
5. A fork inherits exactly the rules ratified at or before the fork point, and a rule ratified after a fork exists in that world and not in its sibling. This is the property the whole design rests on — test it directly with two divergent worlds.
6. `apply` still advances the counter uniformly: `rngCounter + rngDraws`, no special case for the new type.
7. The `default:` arm of `reduce` still fails to compile if a type is unhandled (`const unhandled: never = event`).
8. Golden fixture regenerated behind its guard; a pre-increment-3 log still verifies and folds.

**Required mutation proofs:**

- Make `reduce` push onto the existing array instead of building a new one. A test must fail.
- Make `WORLD_INIT` preserve rules instead of clearing them. A test must fail.
- Make fork copy all rules regardless of fork point. A test must fail.

**Done when:** two worlds forked from a common ancestor demonstrably hold different rulesets, and all three mutations are caught.

---

### Task 3: The interpreter

**Why here:** the rule must actually do something before anyone is asked to ratify one.

**Files:** `src/canon/interpret.ts` (new), `src/core/events.ts`, `src/core/apply.ts`, plus tests.

**Properties that must hold:**

1. `fireRules(state, trigger, actorId): DraftEvent[]` returns zero or more `RULE_FIRED` drafts. Payload: `{ ruleId, effects: Effect[], actorId }`. Always `rngDraws: 0`.
2. Conditions are evaluated against the state **at the moment of firing**, and every condition in `require` must hold (AND, never OR — an OR would need precedence rules and there is no evidence yet that anything needs it).
3. Effects are clamped at application: `heal` never exceeds the entity's starting hp, `harm` never takes hp below 0. An entity killed by `harm` is dead by the same path as one killed by a strike — there is exactly one way to die.
4. **Rules fire in ratification order, and a rule fires at most once per trigger.** A rule cannot re-trigger itself: `RULE_FIRED` is never itself a trigger. Verify with a rule whose effect would satisfy its own condition.
5. `reduce` on `RULE_FIRED` applies the recorded effects and evaluates **no** conditions. Folding a log must produce identical state whether or not any rule currently in `state.rules` would still match.
6. With no rules, `fireRules` returns `[]` and no event is written. A world with no rules produces a byte-identical log to one from before this increment.

**Required mutation proofs:**

- Make `reduce` re-evaluate conditions instead of applying recorded effects. A test must fail — construct a log where a later-ratified rule would change how an earlier event folds.
- Remove the `heal` clamp. A test must fail.
- Let `RULE_FIRED` act as a trigger. A test must fail (infinite loop guard — use a timeout).
- Change AND to OR in condition evaluation. A test must fail.

**Done when:** a hand-built rule (`WAIT` + `noCreatureWithin 6` → `heal 1`) demonstrably changes a folded state, replay is exact, and all four mutations are caught.

---

### Task 4: Rules in play

**Why here:** closes the mechanical half of the loop — you can now feel a rule.

**Files:** `src/play/session.ts`, `src/ui/debug.ts`, plus tests.

**Properties that must hold:**

1. Every player action that produces a turn also fires its trigger: `playerWait` → `WAIT`, `playerStep` into a creature → `STRIKE`, into a wall → `MOVE_BLOCKED`, onto an item → `ITEM_TAKEN`.
2. `MOVE_BLOCKED` still consumes no turn. A rule firing on it must not smuggle a turn back in. This was a real bug once; it does not get to return through a side door.
3. `RULE_FIRED` events narrate. `speak` renders as the world's voice, visually distinct from your own actions. `heal`/`harm` render as what changed and by how much — not as a rule id.
4. Rules currently in force are visible in the UI without opening anything.
5. Creature turns do not fire player-triggered rules. A rule on `WAIT` fires when *you* wait, not when a creature does — unless `actorId` says otherwise. Be explicit about this in the rule's rendering so a player is never surprised by whose rule fired.

**Required mutation proofs:**

- Make `MOVE_BLOCKED` consume a turn when a rule fires on it. A test must fail.
- Fire player rules on creature turns. A test must fail.

**Done when:** you can play a world with a hand-inserted heal-on-wait rule, feel the difference, see the line in the status, and see the rule listed. Both mutations caught.

---

### Task 5: Notes that survive, and know who wrote them

**Why here:** the Rulesmith's input. Currently notes exist only in memory and in a server-side JSONL the browser never reads back.

**Files:** `src/channels/channels.ts`, `src/play/store.ts`, `src/ui/debug.ts`, `server/chronicle-plugin.ts`, plus tests.

**Properties that must hold:**

1. `Note` gains `author: 'player' | 'agent'`. `send(...)` takes it explicitly — there is no default, because a default is how the distinction erodes.
2. Notes persist to localStorage under their own key and survive reload. They are **not** in the event log; they remain a sidecar, keyed by world and head as they already are.
3. `notesFor(world)` returns the notes belonging to one world, in the order written.
4. Wiping clears notes along with everything else. "Wipe everything" that leaves notes behind is the same bug that once let a poisoned name survive a wipe.
5. Existing notes in `runs/notes.jsonl` have no `author`. Reading a note without one yields `'agent'` — the conservative reading, since an unmarked note cannot be shown to be the player's.
6. A note is still recorded when the transport is dead and when the sidecar POST fails. Unchanged from increment 2, and still the most important property here: the one thing that cannot be regenerated is the player's own signal.

**Required mutation proofs:**

- Default a missing `author` to `'player'`. A test must fail.
- Skip notes in the wipe. A test must fail.

**Done when:** notes survive a reload, are scoped per world, are wiped by wipe, and both mutations are caught.

---

### Task 6: The Rulesmith

**Why here:** everything it needs now exists.

**Files:** `src/canon/rulesmith.ts` (new), `src/oracle/types.ts`, `server/oracle-plugin.ts`, plus tests.

**Properties that must hold:**

1. New Oracle intent `'propose'`, using `consult()` — never cached, never written to canon.
2. `proposeRule(oracle, run)` receives: the run's events (folded to a readable summary, not raw JSON), the **player-authored** notes for that world, the gamemaster exchanges with their replies, and the rules already in force. It returns a validated `Rule` or a rejection.
3. **Whatever comes back goes through `validateRule` before it is shown, not just before it is stored.** A malformed proposal is reported as a failed call in the queue, not rendered as a rule.
4. The proposal cites provenance: at least one event id or note it is responding to, and a `because` in its own words. A proposal with empty provenance is rejected — a rule with no reason is exactly what the Ladder exists to prevent.
5. It never proposes a rule that duplicates one already in force (same `when` and same `then`).
6. It never blocks. A slow, failed or absent Rulesmith leaves the game fully playable and shows as a failed call in the visible queue.
7. Agent-authored notes are excluded from its input unless explicitly asked for.

**Required mutation proofs:**

- Skip validation on the returned rule. A test must fail — feed a transport that returns a rule with `n: 9999`.
- Allow empty provenance. A test must fail.
- Include agent notes in the input. A test must fail.

**Done when:** a stub transport returning a well-formed proposal yields a validated `Rule` with provenance; a stub returning garbage yields a rejection and a failed queue entry; all three mutations are caught.

---

### Task 7: The Forge

**Why last:** it is the surface for everything above, and it is where the player's veto lives.

**Files:** `index.html`, `src/ui/debug.ts`, `src/ui/debug.css`, plus tests for any extracted pure logic.

**Properties that must hold:**

1. A run ending — death or escape — offers a proposal. It does not force one: the game remains playable and the offer can be ignored indefinitely.
2. The proposal is shown as **readable English, not JSON.** "When you wait with nothing within 6 squares, you recover 1 hit point." A player ratifying a rule they cannot read is not ratifying anything.
3. Its provenance is shown alongside it: which events, which of your notes, and the Rulesmith's stated reason.
4. Three actions: **accept**, **edit**, **reject**. Accept writes `RULE_RATIFIED`. Reject writes nothing and discards. Edit opens the rule's fields constrained to the vocabulary — every field a bounded control, never a free-text box that has to be re-validated.
5. Rules in force are listed with their provenance, in ratification order.
6. **The layout does not move.** Every constraint from the two preceding commits applies: fixed heights, `scrollbar-gutter: stable`, no element whose text length can change the width of a neighbour. Verify the same way — measure panel positions with the Forge empty, with a pending proposal, and with 16 rules in force, and show them identical.
7. The Forge is reachable without a run ending, so rules in force can be read mid-run.

**Required mutation proofs:**

- Make reject write the rule anyway. A test must fail.
- Let edit produce a rule that skips validation. A test must fail.

**Done when:** you can die, read a proposal in English with its reasons, reject it, die again, accept one, and watch the next run play differently — and the page has not moved a pixel through any of it.

---

## Self-review

**Spec coverage.** Increment 3 as specced was the Critic; this is the spec's increment 4 (Forge) brought forward, at the player's direction and consistent with the spec's own ordering principle. The spec says the effect vocabulary is "defined in increment 7, once increments 1–5 have shown which effects real play actually needs" — that reference is stale from the original dependency-ordered plan and cannot survive the reorder, since a Forge without a vocabulary has nothing to ratify. The vocabulary is therefore defined here, cut to what play has actually shown (which is why `reveal` is absent).

**Not covered, deliberately:** the canon consistency guard, the lens registry, R3 promotion, the artifact build target.

**Type consistency.** `Rule`, `Trigger`, `Condition`, `Effect`, `Provenance` are defined once in Task 1 and referenced unchanged in Tasks 2, 3, 6 and 7. `validateRule` has one signature throughout. `fireRules` and `proposeRule` each appear in exactly one task's Interfaces and are consumed by name in later ones.

**Open risk.** The vocabulary may be too small to produce an interesting rule. That is the intended failure mode: it is cheap to widen once play shows what is missing, and expensive to narrow once a model has learned to reach for something. If the first three proposals are all dull, that is data about the vocabulary, not about the Ladder.
