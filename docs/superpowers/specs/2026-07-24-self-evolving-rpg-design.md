# Self-Evolving RPG — Design

*2026-07-24. Status: approved in brainstorm, pending implementation plan.*

## Thesis

A turn-based grid RPG that starts near-empty and grows its own world, mechanics, and
fiction through play. Improvised content that proves itself gets promoted into permanent
data, then into rules, then into engine code. The player and an AI co-developer share
that promotion work, with the boundary drawn so each does what it is actually good at.

The game gets faster, cheaper, and more consistent the more it is played, because
novelty is the only thing that costs a model call.

## Non-goals

- Not multiplayer. Not agent-played — the human plays; agents run the world.
  (`~/Code/agent-adventures` covers the agent-played, spectator-facing case.)
- Not a content-generation demo. Generated material that does not earn promotion is discarded.
- No arbitrary generated code executing at runtime. Rules are data in a constrained vocabulary.
- Not real-time. Turn-based throughout.

## The Ladder

Every element of the game — a name, a monster, a mechanic — sits on a rung.

| Rung | What it is | Cost to use | Authored by |
|---|---|---|---|
| **R0** Improvised | model decides it fresh each time | one call, ~1–3 s | Oracle, at runtime |
| **R1** Recorded | that improvisation saved as canon | free, instant | Oracle, automatic |
| **R2** Ruled | pattern behind many R1s generalized into a declarative rule | free, deterministic | Rulesmith, player ratifies |
| **R3** Systemic | rule became engine code, with its own loop, UI and tests | free, fast | Claude Code session |

### Promotion policy

- **R0 → R1: automatic.** Names, descriptions and one-off details become canon as they are
  touched. Requiring approval here would stall play on paperwork and let the world contradict
  itself between turns.
- **R1 → R2: player ratifies.** Rules change how the game plays, so they need an explicit yes.
  The Rulesmith drafts; the player accepts, edits or rejects in the Forge.
- **R2 → R3: Claude Code session.** Promotion to code happens in a repo, with tests, by a human
  and an agent together. Never at runtime.

The player holds an absolute veto at every rung and may force-promote anything.

## Versioning and forking

Worlds are not git branches. Git branches cannot be created from inside a running browser,
would number in the hundreds within a week, cannot meaningfully merge two chronicles, and
cannot hold two worlds live at once for comparison. So the world log takes git's *semantics*
into the data model instead.

Every world is an **append-only event log**; each event is hashed with its parent, forming a chain.

- **A world is a ref** — a name pointing at one event hash.
- **Forking** creates a ref at an existing hash. Instant, no copying; both worlds share the prefix.
- **Reset** moves a ref backward. Non-destructive — abandoned events survive, so it can be undone.
- **Canon is derived, never stored:** `state = fold(events up to hash)`.

That single property yields time-travel, replay, forking, and "what was true on turn 40" at once,
and the Critic already needs the whole log to compute its metrics.

### Two version axes

| | Versioned by | A "branch" means |
|---|---|---|
| Engine — code, rules, lens registry | git | a mechanical experiment |
| Worlds — canon, chronicle, saves | refs in the event log | a playthrough |

Each ref records the engine version it was played under, so the axes multiply: *replay Ashfall's
first 200 turns under the new stealth system*. This is the only honest way to judge whether an
R3 promotion improved anything.

Replays are labelled **faithful** (same engine version, identical result guaranteed) or
**reinterpreted** (newer engine, result may differ). The label is never omitted.

## Engine

Pure functions. No DOM, no network, no clock. State changes exactly one way:
`apply(state, event) → state`.

- Square grid, 4-direction movement, turn order by Speed.
- Entities are plain records: `{id, kind, pos, stats, tags[]}`.
- Opening actions: move, strike, use skill, take, wait.

Four stats, each with a distinct job:

| Stat | Job |
|---|---|
| HP | what you can absorb before dying |
| Might | melee outcomes |
| Wits | skill success, noticing things |
| Speed | turn order *and* movement range |

One seeded generator supplies all randomness. Each event records the generator's counter before
it ran; replay asserts the counters realign. Without this, forks drift silently and every Critic
number is worthless.

## Oracle

The single place the model may touch the game: `ask(intent, context) → typed result`.

The "masters" are intents over one interface, not separate systems:

| Intent | Role |
|---|---|
| `describe` | Worldmaster — places, objects, atmosphere |
| `populate` | Dungeonmaster — encounters, layout, pacing |
| `speak` | NPC — dialogue and motive |
| `narrate` | Chronicler — prose for what just happened |
| `propose_rule` | Rulesmith — drafts R2 rules from R1 patterns |
| `critique` | Critic — judged lens passes |

Three invariants:

1. **Never block a turn on a call.** Mechanics resolve instantly; prose arrives a beat later.
2. **Every intent has a deterministic fallback.** If the call fails or times out, play continues
   degraded. No hard stops, ever.
3. **The cache is the canon.** Calls cache by `hash(intent + context)`. Promoting R0 → R1 is
   marking a cache entry permanent and naming it, so the store that makes play fast and the
   store that holds canon are the same store and cannot disagree.

Budget: one call per turn to start, bounding both cost and latency.

**Transports** implement one interface and swap freely:

| Transport | Use |
|---|---|
| `artifact` | `window.claude.complete` when the published page exposes it |
| `sdk` | local dev server holding an API key — the development default |
| `session` | file exchange with Claude Code, for R2 → R3 work |

### Canon consistency guard

Before any R1 commit, the Oracle receives a canon summary and must not contradict it. A detected
contradiction is rejected and re-asked once, then falls back. Canon is permanent, so a bad commit
is expensive — hence the guard, and hence forking.

## Critic

Fitness comes from Schell's lenses, extracted into a machine-readable registry from
`~/Code/maze-solver/artOfGameDesign.md` so the Critic cites real lens IDs rather than vibes.
Two tiers:

**Computed** — measured off the chronicle, deterministic, free, run every session:

| Lens | Metric |
|---|---|
| #61 Interest Curve | tension per turn (threat proximity, HP fraction, scarcity) correlated against a target shape |
| #71 Freedom | mean count, per decision point, of options whose observed outcome distributions differ beyond a threshold (threshold tuned in increment 6 against real logs) |
| #33 Triangularity | per encounter archetype, distinct viable approaches observed across all forks |
| #2 Surprise | rate of events whose modelled probability was under 0.15 |

**Judged** — no metric exists; occasional model passes over the chronicle: #63 Beauty,
#65 The Story Machine, #81 Character Transformation.

The computed tier supplies the gradient — which direction to evolve. The judged tier is the
conscience, catching the case where every metric looks healthy and the game is dull.

**Known failure mode:** "freedom" is trivially gamed by adding meaningless doors. Hence
*meaningful* is defined as materially different outcome distributions measured from real play,
never as options counted off the map. The veto and the judged tier are the backstop.

## Forge

The player-facing evolution surface: ladder state, pending promotion proposals with their
provenance, accept/edit/reject, force-promote, revert, and the lens scorecard over time.
Evolution is visible and steerable rather than hidden.

## Fiction

Starts under-specified and commits through play. No proper nouns in the seed.

The frame: *you wake on a grid you did not choose; you have a body that is four numbers;
something else is here; there is a way out.* Tone is fixed even though the nouns are open —
cold, quiet, attentive; second person; short sentences; the world answers when touched.

The first `describe` call that names a thing commits it forever. By roughly turn 30 the genre
has declared itself and cannot be un-declared. The fiction climbs the same ladder as the
mechanics.

## Data shapes

```
Event  { id, parent, seq, turn, type, schemaVersion, payload, rngCounter }
Ref    { name, head, engineVersion, createdAt, note }
R1     { id, kind: place|creature|item|name|fact, text, sourceEvent, uses, tags[] }
R2     { id, when, require[], then[], provenance[R1 ids], ratifiedBy, ratifiedAt }
```

`schemaVersion` is per event *type*, and is what upcasters key off when a rule changes.

R2 rules are data in a constrained vocabulary, schema-validated before storage. The effect
vocabulary is deliberately small and total, so a generated rule cannot crash or hang the engine.
This is the guard on letting a model write rules at all. The vocabulary itself is defined in
increment 7, once increments 1–5 have shown which effects real play actually needs — enumerating
it earlier would be guessing.

## Modules

| Module | Job | Depends on |
|---|---|---|
| `core/` | grid, entities, turns, stats, seeded RNG | nothing |
| `log/` | events, hashing, refs, fork/reset, fold | `core` |
| `canon/` | R1 records, R2 rules; doubles as Oracle cache | `core` |
| `oracle/` | `ask()`, schemas, fallbacks, budget, transports | `canon` |
| `critic/` | computed metrics, judged passes, lens registry | `log`, `oracle` |
| `forge/` | promotion proposals, veto, ladder view | all |
| `ui/` | grid, character sheet, chronicle, forge panel | all |

Repo is the source of truth; a build step inlines everything into one self-contained HTML for
artifact publishing. The artifact is a deploy target, not the source.

## Error handling

| Failure | Behaviour |
|---|---|
| Oracle call fails or times out | deterministic fallback, play continues, logged as degraded |
| Oracle returns schema-invalid output | one retry, then fallback |
| New R1 contradicts canon | reject, re-ask once, then fallback |
| R2 rule fails schema validation | never stored; surfaced in Forge as a rejected draft |
| Storage quota exceeded | snapshot, truncate log tail, warn; offer file export |
| Replay counters misalign | abort replay, report divergence point — never silently continue |

## Testing

- `core` and `log` carry the test weight; they must never regress.
- **Golden replay** is the single most important test: a recorded log must fold to an identical
  state, byte for byte.
- Property tests: fold determinism, fork prefix sharing, reset reversibility.
- Oracle tested against a stub transport. No test touches the network.
- Critic metrics tested against fixture logs with known-good and known-bad shapes.

## Increments

This spec covers a program, not a single plan. Each increment gets its own `writing-plans` pass
before any code, matching the practice in `~/Code/agent-adventures`. Each one ends playable.

| # | Delivers |
|---|---|
| 1 | `core` + `log` + golden replay test. Move on a grid. |
| 2 | Stats, opponent, strike, turn order, death. A real loop. |
| 3 | `canon` + Oracle on stub transport + fallbacks. Fiction appears, no network. |
| 4 | SDK transport, automatic R0 → R1, chronicle UI. |
| 5 | Refs: fork and reset in the UI. |
| 6 | Lens registry extraction + computed Critic tier. |
| 7 | Forge: R1 → R2 drafts, ratification, rule interpreter. |
| 8 | Artifact build target. Judged Critic tier. |

## Success criteria

- Thirty turns of play and the world has named itself, consistently.
- Fork a world at turn 20, diverge both, compare them side by side.
- A 200-event log replays byte-identical.
- At least one rule travels from improvisation to ratified canon.
- The Critic's scorecard tells the player something non-obvious and fair about their own game.

## Risks

| Risk | Mitigation |
|---|---|
| Replay divergence when rules change | version every event type, write upcasters, label faithful vs reinterpreted |
| `localStorage` ceiling (~5–10 MB) | snapshot and truncate; file-backed save in SDK mode |
| Critic optimises a proxy for fun | player veto, judged tier, metrics defined off real outcomes |
| Model latency or outage | non-blocking calls, fallbacks on every intent |
| Building all four rungs at once | increment discipline; each increment ends playable |
| Canon poisoned by a bad commit | consistency guard, plus forking as the escape hatch |

## Settled by probe

- **`localStorage` persists across reloads** in a page published from Claude Code — confirmed
  empirically at five successive loads, 2026-07-24. A world can therefore carry its own save
  between sessions with no export round-trip, and the `downloads` capability becomes a
  convenience for sharing rather than the primary save path. The quota ceiling (~5–10 MB) still
  applies, so snapshot-and-truncate stays in the design.

## Open

- Whether a page published from Claude Code exposes `window.claude.complete`. Anthropic's own
  documentation confirms AI-powered artifacts exist, with no API key needed and usage counted
  against each viewer's own subscription; what remains unverified is only whether that same
  ambient runtime reaches pages published through Claude Code rather than authored in a chat.
  Until it reports, the `sdk` transport is the development default. Nothing in this design
  depends on the answer — the Oracle's transports are interchangeable by construction.
