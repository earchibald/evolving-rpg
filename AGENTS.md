<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

# AGENTS.md — evolving-rpg

Any agent working here can play, judge and evolve this game without a browser.
This file is the map; the Covenant is the law.

## The model we work to

`src/assay/covenant.ts` — stated invariants, mechanical (M*) and thematic (T*),
each naming its enforcer. Every facility is validated against it: rules by the
assay's trials, names by the register checks, worlds by reachability, replay by
the chain. When you add a facility, add its invariant first. When an invariant
proves wrong, amend it there, visibly.

## Tools (all from repo root, JSON out where noted)

| Command | What it does |
|---|---|
| `npm run play -- --policy all --seeds 12 --json` | Sweep archetypal players over fresh worlds |
| `npm run play -- --world runs/latest.json --policy all` | Play the real world, rules in force |
| `npm run trial -- rule.json` | Assay one rule. Exit 0 sound / 2 refused / 1 malformed |
| `npm run loop -- --seed 7 [--rule r.json]` | Baseline → propose → trial → ratify → replay → deltas. Report to `runs/loops/` |
| `npx vitest run` | The suite. Mutation proofs are the local verification idiom |

The propose step of `loop` needs the dev server (`npm run dev`) for a real
model; `--rule` runs the loop offline.

## Personae (`.claude/agents/`)

- **playtester** (haiku) — plays sweeps, reports numbers and findings against
  the Covenant. Cheap; use freely.
- **rules-warden** (sonnet) — judges a candidate rule on both registers:
  mechanical (via the trial, then past it) and textual/thematic (voice, fit,
  whether it answers anything). Use before any ratification that matters.

The overseer stays the strongest model in the session: it dispatches these,
reads their reports critically, and owns the verdict. A subagent's report is
evidence, not a decision.

## The feedback loop, canonically

1. `npm run play` — what is true now.
2. `npm run loop` — what a candidate would change.
3. rules-warden — does it make SENSE, both registers.
4. Ratify (Forge, or `ratifyRule` in a script) only what survived 2 and 3.
5. `npm run play` again — did the numbers move the way the rule promised.
6. Everything notable goes in a commit message or `runs/loops/`; the user
   checks polish and direction, not mechanics.

## Known shape of the game (updated 2026-07-26, increment 5)

**Fighting pays.** Kills yield threat-value XP; levels grow the player and heal
to full; floors descend by threat budget with Brogue-style overlap; the warden
guards every third floor and pays half its threat out of the floor's budget.
Measured on 20 fixed seeds (pinned in tests/balance/sawtooth.test.ts):
depth-1 brawler survival 95%; two floors 80%; past the boss floor 60% (rusher
40% — the inversion); floor five ~17%. Crits exist (nat 20 doubles, nat 1
whiffs), so lens #2 finally counts real events. The old shape — brawler 90%
dead, rusher dominant — is history; if these numbers drift outside their
bands, that is a defect, not a mood.
