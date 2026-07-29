# Dual wield — three proposals, one panel, one winner

*2026-07-28 · the designer's direction, spoken during the first voiced run:
"I think I want to be able to wield both a melee weapon and a ranged weapon
at the same time. I think that's what we want."*

The current law: one `weapon` slot, so the leaden sling and the keen edge
are exclusive — sword-or-sling is a `,` decision. The direction: both, at
once. Three shapes follow. Each keeps covenant M7/M8 (the honest line, the
drawn warning) untouched; what differs is the slot grammar, the stat
arithmetic, and what happens to the tradeoff that dies.

## Proposal A — strong arms throw hard

A new gear slot, `sling`, routed by trait: any relic carrying
`RELIC_TRAITS[kind] === 'ranged'` equips there; the `weapon` slot keeps
the blades. Grants stack exactly like all gear — a worn sling's might
adds to the one might stat, and shots and blows share it (one number, as
today; the stat model does not change).

- **For:** the game's whole grammar is stats-plus-traits; this adds a slot
  and nothing else. One might stat stays legible ("you deal 3–6" is still
  the truth for every blow you throw, near or far). Walking auto-equips a
  found sling like any dominant relic.
- **Against:** mild might inflation (sling grants stack on top of the
  edge's — +1..+3 by depth); sword-and-sling is strictly better than
  either alone, so the old tradeoff is simply gone.

## Proposal B — the off-hand grants no arm

Same new slot; a worn ranged relic grants **no stats at all** — the trait
is the entire grant. Shots resolve on your bare might.

- **For:** zero inflation; the sling is purely a tempo weapon, which is
  the volley's whole design (distance is priced in beats, not arithmetic).
- **Against:** violates a stated table law — "a prize that does nothing is
  a lie with a guard on it" (`relicGrant` is never zero); breaks
  `dominates`/`grantValue` comparisons (all slings weigh 0, replacement
  logic collapses); the depth scaling of ranged relics becomes
  meaningless. Needs carve-outs in exactly the places the tables promise
  none.

## Proposal C — both hands, priced

Same new slot, grants stack as in A — but every ranged relic carries a
`costs` row (speed −1, the heavy edge idiom): a loaded hand is a slow
foot.

- **For:** the sword-or-sling tradeoff survives as a *price* instead of an
  exclusivity; the dominance rule already speaks `costs`.
- **Against:** a costed relic is never taken by walking — every sling
  pickup becomes a deliberate `,` ceremony forever; speed is the defence
  stat, so archers get easier to hit, which fights the archer fantasy the
  change exists to serve; the price lands on exactly the player who
  finally got the toy.

## Also decided in this pass (the designer, same session)

- **Diagonal movement: TABLED.** Eight-way movement touches the supercover
  line, every BFS hunt, Manhattan-spoken verb ranges, and the four-input
  promise. Not refused — tabled, deliberately, until it can be designed
  whole rather than bolted on.
- **The satchel grows a second slot** (separate implementation, this
  session): two carried things, `q` spends the first, `Q` the second;
  duplicates allowed; full hands refuse the walk-over with a spoken line.

## Panel protocol

Three independent reviewers, each a different lens (mechanics & covenant;
game feel & tradition; codebase fit & cost), each ranking A/B/C after
trying to break all three, each naming one improvement to their winner.
The overseer reads the verdicts critically and owns the final call
(AGENTS.md: a subagent's report is evidence, not a decision). The winner
is implemented; the losers stay documented here with the panel's reasons.

## Verdict

*(filled after the panel)*
