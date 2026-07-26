# GESTALT — deciding a world whole

A theoretical approach, documented before building: the world's creative and
mechanical *identity* decided up front in one act, with delegate agents
filling in detail during play — as an alternative to today's fully on-demand
decisions. Written 2026-07-26 at the designer's request. Nothing here is
implemented.

## 1. Today: on-demand

| Decision | When it happens | Who decides |
|---|---|---|
| floor shape | at descent | mapgen (tables + counted draws) |
| population, budget, keeper | at descent | tables + counted draws |
| names ("wire hound") | when first seen | model, one ask per kind |
| flavor lines | when named / when asked | model, per ask |
| rules | after a run, on request | Rulesmith, then trials, then you |

Strengths: lazy (pay only for what play touches), replay-exact, simple.
Weakness, observed in play: **no cross-floor intent**. The same bones get
unrelated names in different worlds ("wire hound" / "thin wolf"), the warden
has no identity before you meet it, floors never foreshadow, and the
gamemaster improvises tone per question. Coherent moments happen by luck.

## 2. The gestalt: a world bible at birth

One model act at world creation produces a **bible** — the world decided
whole:

| Bible section | Contains | Constrains |
|---|---|---|
| anchor | 2-3 sentences of what this world *is* (a drowned mine, a frost archive) | every later ask |
| lexicon | ~20 morphemes/words the world speaks in | naming palette |
| roster | an identity per bestiary archetype per depth band | creature names + lines |
| the warden | who the boss is, one set-piece sentence for its floor | boss naming, GM answers |
| prizes | identities for the armory's four relics | item names + lines |
| promises | 2-3 foreshadowings ("something below is counting") | GM answers, narration, later floors |
| register notes | tone words for the gamemaster | GM voice |

**Mechanics stay out of the bible.** Tables and counted draws still decide
every number, spawn, and layout — the bible constrains *flavor over the
mechanical skeleton*, so covenant M1–M5 and replay are untouched by
construction. The Oracle answers from the bible first; the model is asked
only when the bible has no answer (and a lesser model can name from a
palette — the gestalt makes haiku sufficient for grunt naming).

## 3. Where it lives

The bible is an **event** (`WORLD_BIBLE`, chain root, after floor 1's
WORLD_INIT or preceding it) — recorded, content-addressed, forked and
replayed like everything else. A fork inherits its world's identity; a wipe
loses it; two worlds never share one. Amendments (a mid-run note that
changes the world's direction) are further events, so the bible has history
rather than edits.

## 4. Validation — the gestalt's real advantage

Today names are assayed one at a time as they arrive. A bible is assayed
**whole at birth**:

- T1/T3 across the entire palette at once (no duplicate names *by
  construction*, article rules batch-checked)
- T2 register over every line in one pass
- the canon-consistency judge (a known gap — built but not auto-run) gets
  a natural home: judge the bible once, not every name forever
- a refused bible falls back to today's on-demand path, quietly — the
  game never blocks on it

## 5. A ladder, not a leap

| Level | Bible drives | Cost |
|---|---|---|
| L0 | nothing (today) | — |
| L1 | names + lines only | one call at birth (~$0.3–0.8), then near-free naming |
| L2 | + warden identity, set-piece, promises | same call, bigger prompt |
| L3 | + floor motifs: per-depth mapgen parameters (room size, loop count, density) chosen from motif tables | bible picks from *bounded* motif rows — still counted, still replayable |
| L4 | + campaign arc: a bottom, a goal, staged reveals | this is "later we will have stories" |

L1 is buildable now: `Oracle.ask` gains a bible-lookup layer; nothing in
core/ changes; replay is untouched. L3 is the first level that touches
mechanics, and it does so through tables (a motif is a row, not a freehand
number), keeping the Covenant's trials sufficient.

## 6. Honest costs

- One larger up-front call per world, spent even if the world is abandoned
  in ten turns.
- A bible written before play can read stale after the Forge changes the
  rules of the world mid-run — amendments help; drift is real.
- Batch validation front-loads refusal: a bad bible costs a retry where a
  bad single name cost one small re-ask.
- The Rulesmith should eventually cite the bible (rules that fit the
  world's identity) — which adds bible text to its prompt and its cost.

## 7. Recommendation

Build L1 behind the existing quiet-fallback pattern when naming coherence
next bothers play. Do not build L3 until the motif tables exist on paper in
BALANCE.md first — mechanics move through tables or not at all.
