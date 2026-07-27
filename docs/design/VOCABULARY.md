# VOCABULARY — how a closed rule language grows without breaking

Research survey + the discipline this game adopts. Written 2026-07-26, before
the first widening of the R2 vocabulary past its second cut (`src/canon/rule.ts`).
Companions: BONES.md (the first condition this unblocks), GESTALT.md (the other
thing that grows), AGENTS.md (the loop that exercises all of it).

The question this answers: the Forge already grows the *ruleset* safely —
closed vocabulary, total validator, assay trials, player ratification. The next
power is growing the *vocabulary itself*: new triggers, conditions, effects.
Four decades of prior art say how that goes well and how it goes badly.

## 1. What the tradition did

| System | The move | What holds it together |
|---|---|---|
| **Nomic** (Suber, 1982) | rule-change is a legal move, not a break from play | immutable core (101–116) protecting the amendment procedure itself; changing an immutable rule means *transmuting* it to mutable first (unanimity), then amending like any other. ≥1 mutable rule must always exist; a contradictory ruleset is a **defined terminal state** (win-by-paradox), not a crash |
| **Fluxx** (1997) | every rule card overwrites the baseline | containment by **card type** (Rule / Keeper / Goal / Action): players always know which axis moved, even before reading the value. The win condition is a card like any other |
| **MtG keyword discipline** | hundreds of keywords minted over 30 years | three tiers — **evergreen** (always on), deciduous (in the toolbox), set-only (may never return); the evergreen list is revisited every core set and kept small forever. New World Order: complexity is a budget, spent by rarity. A keyword is minted only when reuse × comprehension-savings beats the cost of teaching a word |
| **Roguelike mutators** (DCSS, ToME, RoR2, Hades, StS) | rule changes as player-facing menu items | always an **enumerated, finite** space in legible categories; ranked (DCSS 1–3), priced (Hades' Heat budget), capped (RoR2's 20), or strictly ordered (StS's 20 ascensions). Scarcity is design: ToME grants exactly two prodigies per character, ever |
| **DF / CDDA worldgen** | the world's physics legislated before play | bounded sliders + rejection parameters; whole rule-bundles shareable as files. A community regrew one coarse slider into five granular ones without abandoning the bounded-slider idea |
| **Baba Is You** | rules are pushable objects in the level | one channel for everything — manipulating a rule is the same verb as pushing a rock. Designer-named failure mode: **too many active rules is overwhelming regardless of each rule's simplicity**. A surprising-but-valid parse got the parser rebuilt to honor it, not a ban |
| **Ludi / Ludii** (Browne) | games evolved from atomic ludemes, scored by self-play before humans see them | the vocabulary is generated from the implementation's own class hierarchy — it can only grow when someone adds a class. A natural growth-gate |
| **NomicLaw** (2025, LLM Nomic) | AI agents propose and vote rules | homogeneous proposer pools collude (self-vote to 0.87); diverse pools argue and self-deal far less (0.03–0.44). Free-text proposals produced malformed rules needing manual correction |

Also load-bearing: Burgun's lifecycle observation that long-lived rulesets
(MtG, LoL) extend life by **rebalancing what exists**, not perpetually adding;
and Suber's rule 103 — amending the amendment procedure uses the same
procedure, no privileged meta-layer.

## 2. The principles, fitted to this game

| Principle | Tradition | Here, concretely |
|---|---|---|
| **Categories over instances** | Fluxx's types, StS's categories | the slots are fixed — trigger, condition, effect — and new words fill an existing slot. A word wanting a new *axis* (a resource, an economy, a timer) is a design increment, not a vocabulary entry |
| **An immutable core, changed only expensively** | Nomic 101–116 | what never rides in a rule: the validator's totality, drawless firing, resolved-not-copied effects, no rule-fires-rule cascade, `MAX_RULES`. Changing those is a code change facing the Covenant — transmutation, with the suite as unanimity |
| **Bound the range, not just the type** | Hades' Heat, DCSS ranks | every numeric word gets its own `RANGES` row sized to its meaning (a distance is not a percentage); every wordless condition states which triggers it means anything under (`needsTriggers`) |
| **Legibility is a spendable budget** | Baba's overwhelm, NWO | every word ships all four exposures at once: validator case, interpreter case, `readRule` English, prompt line. A word that cannot be said plainly in `readRule` is not ready. `MAX_RULES = 16` is the active-rule budget Baba names |
| **Promote sparingly, retire actively** | MtG evergreen | the prompt in `oracle-plugin.ts` is our evergreen list — the Rulesmith reaches only for what it states. A word that never earns proposals can be dropped from the prompt without breaking old rules: ratified history replays from `RULE_FIRED`, never re-reads the vocabulary |
| **Simulate before ratifying** | Ludi's self-play scoring | already law: the assay (M1/M2/M6) trials every proposal. New *words* owe the assay more — a world where the word can hold at all, so M3's "never fired" caution stays honest (a `depthAtLeast 3` rule trialled only at depth 1 reads as dead weight and is not) |
| **No proposer is sole beneficiary** | NomicLaw's collusion finding | already law: proposer (Rulesmith), judge (rules-warden, a different register), and ratifier (the player) are distinct parties. Keep them distinct as models change |
| **The unresolvable case has a legal exit** | Nomic's win-by-paradox | rejection is total and typed (`Rejected`), on screen, never a throw. A contradictory pair of conditions inside one rule (two different `motifIs`) is refused at validation — it can never fire, and a rule that looks ratifiable but does nothing is the lie the validator exists to prevent |
| **Rebalance before expanding** | Burgun, MtG | widening comes *after* play shows an absence (the second cut's own rationale, kept: "widening again is cheap; narrowing after a model has learned to reach for something is not") |

## 3. What this buys now

The first widening under these principles: three conditions, each filling the
existing condition slot, each answering a named absence.

| Word | Absence it answers | Discipline applied |
|---|---|---|
| `bodyHere` | BONES.md option F — death proposals want to say "when you stand where you fell" and cannot | wordless, any trigger; bodies enter the fold via WORLD_INIT so replay, trials and bots all see the same truth |
| `depthAtLeast` | rules cannot know how far down the run is; the sawtooth and motifs both key on depth | own range row; trials born at the depth the rule names, so M3 stays honest |
| `motifIs` | floors have shapes with intent (increment 8) and rules cannot read them | closed motif set (`door`/`warren`/`halls`), matching the base motif — the deep is depth's business, expressed by composition (`motifIs warren` + `depthAtLeast 7`) |

What is deliberately **not** granted: no new triggers (the eight cover what a
turn contains), no new effects (effects move health, stats, position and words;
anything else is an axis), no condition reading another rule (no meta-layer).

## 4. Knobs, standing

- The prompt is the evergreen list: keep it exhaustive and small; a word the
  Rulesmith should stop reaching for leaves the prompt before it leaves the
  type.
- Ranked strength stays in `RANGES`, not in word variants — `heal 1..20`, never
  `heal` / `greaterHeal`.
- The active-rule budget (`MAX_RULES`) is the legibility ceiling; raising it is
  a Covenant conversation, not a constant edit.
- If the Forge ever proposes vocabulary (words, not rules), it goes through
  this document's own procedure: survey, table, bounded implementation, assay
  coverage — rule 103, no shortcut.

Sources: Suber's Nomic (legacy.earlham.edu); Fluxx rules wiki; Rosewater's
"New World Order" and "Evergreen Eggs & Ham"; CrawlWiki mutations; te4.org
prodigies; RoR2 wiki artifacts; Prima's Pact of Punishment table; StS wiki
ascensions; DF wiki advanced worldgen; CDDA region-settings docs; Game
Developer on Baba Is You; Browne's evolutionary game design + Ludii overview
(arXiv 1907.00240); Burgun's Clockwork Game Design; "Rulebook" (IEEE ToG 2024);
"NomicLaw" (arXiv 2508.05344); RogueBasin's Berlin Interpretation.
