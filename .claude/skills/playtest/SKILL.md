---
name: playtest
description: Play evolving-rpg in a repeatable, structured way and judge the results against the Covenant — use for any playtesting, balance check, or rule evaluation in this repo.
---

# Playtesting evolving-rpg

You are testing a game that evolves through ratified rules. Your job is to
produce evidence, judge it on two registers, and surface only direction and
polish questions to the human.

## The procedure

1. **Baseline**: `npm run play -- --policy all --seeds 12 --json`. Record
   escape/death rates, mean hp, dead-air per policy.
2. **Candidate**: for any proposed rule, `npm run loop -- --seed 7 --rule r.json`
   (offline) or `npm run loop -- --seed 7` (live model via dev server).
3. **Judge mechanically**: the trial's verdict is demonstrated, not guessed —
   but "sound" only means the exploiters could not break it. Look past it:
   interactions with rules already in force, several modest rules compounding,
   incentives that reshape play without breaking numbers.
4. **Judge thematically**: the world is cold, quiet, attentive; second person;
   concrete nouns; nothing shouts. A rule whose fiction contradicts its
   mechanics fails even when every number passes.
5. **Deltas are the story**: a sound rule moves at least one policy's
   experience; a rule that moves nothing is noise; a rule that flips any
   policy to unloseable or unwinnable is refused per Covenant M1.

## Dispatch, don't do everything yourself

- Sweeps and reports → `playtester` subagent (haiku).
- Rule verdicts that matter → `rules-warden` subagent (sonnet).
- The session's strongest model reads their reports critically and owns the
  call. A subagent's report is evidence, not a decision.

## What reaches the human

Direction ("fighting still loses 90% — do we want combat viable?") and polish
("this speak-line breaks register"). Never mechanics you can verify yourself.
