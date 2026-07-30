extends GutTest
## Rules live in the log and nowhere else — the intended byte-twin of
## tests/canon/rules-in-log.test.ts (11 `it(...)` blocks).
##
## ALL 11 are deferred: every single one needs `fold()` (SimLog.fold, arriving
## on sim/log.gd — see log.gd's own docstring: "fold() and verify_chain() join
## in Phase 2 with apply") and/or `createWorld`/`ratifyRule` (owned by a
## sim/commands.gd that does not exist in godot/sim/ yet) and/or
## `verifyChain`. None of that surface is buildable from what Wave B shipped
## (SimRule, SimState, SimEvents, SimUpcast, SimRefs, SimTables, and now
## SimInterpret) — inventing any of it here would mean guessing at fold's and
## commands.gd's actual signatures rather than porting them, which the task
## brief for 2.B6 explicitly rules out. This is the legitimate "defer much or
## all of it" outcome the brief names as expected for this file, not a
## shortfall.
##
## Every case, by describe block, with the reference line and exactly what it
## is waiting on:
##
## describe('a rule entering play') — needs append + fold + createWorld +
## ratifyRule (plus verifyChain for the fourth):
##   - rules-in-log.test.ts:40  "arrives as an event and shows up in the
##     folded state"
##   - rules-in-log.test.ts:50  "consumes no randomness, so ratifying cannot
##     shift a later roll"
##   - rules-in-log.test.ts:59  "keeps them in the order they were ratified"
##   - rules-in-log.test.ts:70  "still verifies as a chain" (also needs
##     verifyChain)
##
## describe('not corrupting what came before') — needs fold + append +
## apply() directly, or createWorld + fold:
##   - rules-in-log.test.ts:78  "does not touch the state it was handed"
##   - rules-in-log.test.ts:99  "does not let a second apply reach back into
##     the first result"
##   - rules-in-log.test.ts:111 "leaves the shared empty baseline empty"
##     (also reads EMPTY_STATE directly — SimState.empty() is available now,
##     but the case's whole point is checking it stays empty across a
##     ratify+fold, which still needs fold)
##   - rules-in-log.test.ts:117 "starts a fresh world with no rules, whatever
##     came before it in the log" (needs createWorld + fold)
##
## describe('rules are a property of a world, not of the game') — needs fold +
## append + ratifyRule + emptyRefs/createRef/fork/getRef (the ref-graph half
## of this, SimRefs, IS already ported — ref.gd — but every case here also
## folds, which is the missing half):
##   - rules-in-log.test.ts:127 "gives a fork exactly the rules that existed
##     when it forked"
##   - rules-in-log.test.ts:149 "lets two timelines hold genuinely different
##     rulesets"
##
## describe('the cap') — needs append + fold + ratifyRule (validateRule's own
## MAX_RULES=16 bound is already ported and tested — test_rule.gd's
## test_publishes_the_per_world_rule_cap — but THIS case tests ratifyRule
## refusing the 17th ratification against a folded state, not validateRule
## refusing an oversized field):
##   - rules-in-log.test.ts:166 "refuses to ratify past the per-world limit"
##
## Owning task: Wave C's apply.gd (general reducer, including RULE_FIRED and
## RULE_RATIFIED folding) and, for fold()/verifyChain() specifically, SimLog
## per its own docstring. Task 2.C1 is confirmed (2.B6 brief) to own at least
## the WORLD_INIT/entity-construction slice of apply.gd; commands.gd
## (createWorld, ratifyRule) has no task number visible to this task. Every
## case above should be re-examined once those exist, rather than assumed
## still blocked.
