# Increment 4: The Critic (two lenses) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the game instead of asserting things about it. Two of Schell's lenses, computed off the chronicle, deterministic and free — and fed back to the Rulesmith, so proposals answer evidence rather than vibes.

**Architecture:** A pure function from an event chain to a report. No model calls in the computed tier: it runs every session, costs nothing, and must be identical for identical history. The report becomes a panel you can read and a section of what the Rulesmith is shown.

**Tech Stack:** Unchanged — TypeScript strict, Vite, Vitest.

## How this plan is written

As increments 2 and 3. **It states properties and required mutation proofs; it does not write your tests.** That format exists because increment 1's prescribed assertions were its single largest defect source, and because across increments 2–3 mutation testing caught six of my own tests that could not have failed.

If a property here is wrong, contradicts another, or cannot be tested as stated — say so and stop.

## Scope: two lenses, not four

The spec names four computed lenses. Two are measurable today and two are not, and building all four would ship two real metrics beside two that quietly return zero.

| Lens | This increment | Why |
|---|---|---|
| **#2 The Lens of Surprise** | **built** | Every `STRIKE` records `roll` and `needed`, so the probability of what happened is known exactly rather than modelled. |
| **#61 The Lens of the Interest Curve** | **built** | Tension per turn replays from any chain — threat proximity and health fraction are both in the fold. |
| #33 The Lens of Triangularity | deferred | Needs distinct viable approaches observed *across forks*. There is one grave. |
| #71 The Lens of Freedom | deferred | Needs options whose outcome distributions differ measurably, which needs many runs. Also the spec's known gaming risk; not worth building against three data points. |

Both deferred lenses stay in the registry, marked unimplemented, so the scorecard shows what is not being measured. A missing lens that nobody can see is indistinguishable from a lens that passed.

## A finding this is built on

**Surprise is currently unreachable by construction, and the Critic must say so plainly.**

`needed = 10 + target.speed - attacker.might`. For an outcome's probability to fall under 0.15 you need `needed > 17` or `needed < 4` — a gap of seven or more between attacker might and target speed. Every to-hit target in the recorded chronicle is 8 or 10, giving rarest-outcome probabilities of 0.35 and 0.45.

So this lens will read 0.00 the day it ships. **That is the correct answer, not a bug**, and an implementation that produced anything else would be wrong. It is also exactly the kind of thing the Critic exists to say out loud.

## Global Constraints

Everything from increments 1–3 still binds. Additions:

- **The computed tier makes no model calls.** It runs on every render if asked to; it must be cheap, deterministic, and identical for identical history. Anything needing a model belongs to the judged tier, which is not this increment.
- **A metric reports its own confidence.** Every figure carries how much history it was computed from. "0.00 surprise across 14 blows" and "0.00 across 4,000" are different claims and must not render the same.
- **A lens that is not implemented says so.** It appears in the scorecard marked unmeasured. Silence and a pass look identical, and only one of them is honest.
- **No book text in the repository.** The registry holds lens numbers, titles, and *our own* statement of what we measure — enough to cite a real lens rather than a vibe. Schell's text stays in Schell's book; `docs/` records the source path for a human to consult. This is a deliberate call, not an oversight.
- **The Critic never blocks a turn and never writes to the event log.** It is a reading of history, not a part of it. Nothing it computes may change what folds.
- `core/` and `log/` remain the never-regress modules.

---

### Task 1: The lens registry

**Why first:** every metric cites an entry here, and the scorecard renders from it.

**Files:** `src/critic/lenses.ts` (new), plus tests.

**Properties that must hold:**

1. `LENSES` is a frozen list of `{ id: number; title: string; measures: string; state: 'computed' | 'deferred' }`.
2. It contains at minimum #2, #33, #61, #71 with their real titles — "The Lens of Surprise", "The Lens of Triangularity", "The Lens of the Interest Curve", "The Lens of Freedom".
3. `measures` is our sentence about what this codebase computes, not Schell's text. No passage from the book appears in the repository.
4. `lensById(n)` returns the entry or undefined, and never throws.
5. Exactly the lenses marked `computed` have metrics implemented in later tasks. A test asserts the registry and the implemented set agree — so adding a metric without registering it, or registering one without building it, fails.

**Required mutation proofs:**

- Mark a deferred lens as `computed` without implementing it. A test must fail.
- Change a lens id so it no longer matches its metric. A test must fail.

**Done when:** the registry lists four lenses, two computed, and the agreement test catches both mutations.

---

### Task 2: Lens #2, Surprise

**Why here:** the simplest honest metric, and the one whose expected answer is already known.

**Files:** `src/critic/surprise.ts` (new), plus tests.

**Properties that must hold:**

1. `surpriseOf(events)` returns `{ rate: number; surprising: number; modelled: number }` — the rate, the count under threshold, and how many events had a modelled probability at all.
2. Two event kinds carry exact probabilities and both are counted:
   - a `STRIKE`'s hit or miss, where `P(hit) = clamp((21 - needed) / 20, 0, 1)`;
   - a `STRIKE`'s damage roll, uniform over `1..might`, so a specific value has probability `1 / might`. Derive `might` from the recorded damage range, not from current state — the attacker's might at the time is what governed the roll.
3. `SURPRISE_THRESHOLD = 0.15`, exported, and the rate counts realised outcomes whose probability fell strictly below it.
4. An empty chain, and a chain with no strikes, give `rate: 0` with `modelled: 0` — and the caller can tell that apart from a genuine zero, because `modelled` says so.
5. It is total: a malformed or truncated payload is skipped rather than throwing. This reads history that may have been written by an older engine.
6. **On the current combat maths the rate is 0.00 and this is correct.** A test builds strikes at `needed` 8 and 10 and asserts zero; another builds `needed` 18 and asserts the outcome registers as surprising. Both matter — the second is what proves the metric is not simply hard-coded to zero.

**Required mutation proofs:**

- Change the threshold to 0.5. A test must fail.
- Count only hits, ignoring improbable misses. A test must fail.
- Drop the damage-roll term. A test must fail.
- Return 0 unconditionally. A test must fail — this is the mutation the "zero is correct" property invites, and it must not survive.

**Done when:** a chain of ordinary blows reads 0.00 with a stated denominator, a lopsided fight reads above zero, and all four mutations are caught.

---

### Task 3: Lens #61, the Interest Curve

**Why here:** the metric with actual shape to it, and the one most likely to say something uncomfortable.

**Files:** `src/critic/interest.ts` (new), plus tests.

**Properties that must hold:**

1. `interestOf(log, head)` replays the chain and returns `{ curve: number[]; mean: number; spread: number; peakAt: number; flattest: number; turns: number }` — one tension figure per turn, plus the shape features.
2. Tension is stated explicitly in the code and documented as a heuristic: how hurt you are, and how close the nearest living thing is. Both come from the fold; nothing is guessed.
3. Tension is in `0..1` for every turn, whatever the state — an empty map, a dead player, a world with no creatures.
4. `peakAt` is the turn of maximum tension as a *fraction* of the run, so a finale reads near 1 and an early spike reads near 0. Schell's shape wants rising interest with a peak late; a run peaking at 0.1 is a run that was most interesting before you understood it.
5. `flattest` is the longest run of turns whose tension does not change — dead time, in turns.
6. A run of one turn, and a run of none, return a defined report rather than dividing by zero.
7. Deterministic: the same chain gives the same curve, always.

**Required mutation proofs:**

- Let tension exceed 1 by removing a clamp. A test must fail.
- Report `peakAt` as an absolute turn rather than a fraction. A test must fail.
- Ignore threat proximity, leaving only health. A test must fail.

**Done when:** a hand-built chain with a known shape produces the expected peak and flat stretch, and all three mutations are caught.

---

### Task 4: The Critic

**Why here:** one reading, from one call, over one chain.

**Files:** `src/critic/critic.ts` (new), plus tests.

**Properties that must hold:**

1. `readTheGame(log, head)` returns `{ readings: Reading[]; turns: number; events: number }` where a `Reading` is `{ lens: number; title: string; figure: string; verdict: string; confidence: string }`.
2. Every registry entry produces a reading. Deferred lenses produce one that says what is not being measured and why — not a zero.
3. `figure` is the number as text; `verdict` is a sentence a person can act on. "0.00 across 14 blows — nothing that happened was unlikely; the dice never surprise you" beats "surprise: 0.00".
4. `confidence` states the denominator in plain words, and says outright when there is too little history to conclude anything.
5. Pure and total: no model calls, no writes, no throwing on a short or malformed chain.
6. Two different chains with the same shape give the same readings — it reads history, not identity.

**Required mutation proofs:**

- Omit deferred lenses from the readings. A test must fail.
- Report a confident verdict on a chain with almost no history. A test must fail.

**Done when:** the recorded chronicle produces four readings, two with figures and two saying what is unmeasured, and both mutations are caught.

---

### Task 5: The scorecard

**Why here:** a measurement nobody reads changes nothing.

**Files:** `index.html`, `src/ui/debug.ts`, `src/ui/debug.css`.

**Properties that must hold:**

1. The readings appear in "the rest of it", at a fixed height that scrolls inside itself — every layout constraint from the two no-movement commits applies, and is verified the same way: measure panel tops with the scorecard empty, full, and mid-update, and show them identical.
2. A deferred lens is visibly distinct from a passing one.
3. It updates when the world does, and costs nothing when nothing changed — recomputing a four-hundred-event chain on every keypress is a real cost, so it is computed once per render at most and skipped when the head has not moved.
4. Every reading names its lens number and title, so a claim can be traced to a real lens.

**Required mutation proofs:**

- Recompute on every call rather than when the head moves. A test must fail (assert the compute count for repeated renders at one head).
- Render deferred and computed lenses identically. A test must fail.

**Done when:** the scorecard reads on screen, nothing moves, and both mutations are caught.

---

### Task 6: The Rulesmith reads the Critic

**Why last:** this is the point of the increment. A measurement that only a human reads is a report; one the world reads is a gradient.

**Files:** `src/canon/rulesmith.ts`, `server/oracle-plugin.ts`, plus tests.

**Properties that must hold:**

1. `RunSummary` gains `measured: string[]` — the Critic's verdicts, in the same plain sentences the scorecard shows.
2. The prompt presents them as findings to answer, and says plainly that a lens reading zero is a thing the world may address.
3. A proposal may cite a lens: `provenance` gains an optional `lenses: number[]`, pruned to ids that actually appear in the reading, exactly as event ids and note timestamps already are. An invented lens number is stripped.
4. `readRule` and the Forge show a cited lens, so a player ratifying a rule can see what evidence produced it.
5. The Critic failing or returning nothing must not stop a proposal. The existing "never blocks" guarantee holds.

**Required mutation proofs:**

- Trust a cited lens number without checking it against the reading. A test must fail.
- Drop `measured` from what crosses to the model. A test must fail.

**Done when:** a stub transport returning a rule citing lens #2 produces a validated rule carrying that citation; one citing lens #999 has it stripped; and both mutations are caught.

---

## Self-review

**Spec coverage.** This is the spec's computed Critic tier, halved deliberately and with the reason recorded. The judged tier (#63 Beauty, #65 The Story Machine, #81 Character Transformation) is untouched and remains increment 5's work, along with the artifact build target.

**Not covered, deliberately:** the two deferred lenses, the judged tier, the canon consistency guard, R3 promotion.

**Type consistency.** `Reading` is defined in Task 4 and consumed in Tasks 5 and 6. `surpriseOf` and `interestOf` each appear in exactly one task and are consumed by name in Task 4. `LENSES` and `lensById` come from Task 1 and are used in Tasks 4, 5 and 6.

**The risk worth naming.** A metric that always reads zero invites an implementation that hard-codes zero, and a test suite that only ever checks the zero case would never notice. Task 2's fourth mutation proof exists for exactly this, and the lopsided-fight property is what gives it something to fail against.
