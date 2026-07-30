# The Godot migration — the spec, reviewed and corrected

Source: a Gemini-authored migration strategy shared at
`https://share.gemini.google/F29LZPs6Fjsn` (resolves to
`https://gemini.google.com/share/28acdfb7acc6`), titled *"Technical Migration
Strategy: TypeScript to Godot Engine"*. As with `new-designs-spec.md` before it,
this document is that proposal **checked against the code and the Covenant**,
corrected where it was wrong, and turned into an architecture the plan can be
written against. Where the two disagree, this one is the design.

The companion implementation plan is
`docs/superpowers/plans/2026-07-29-godot-migration-master-plan.md`.

## The decision

The game moves to **Godot 4.x, GDScript, as a `godot/` project inside this
repository**. The TypeScript engine is frozen at a tagged baseline and becomes
the *reference implementation*: every deterministic module is ported against
fixtures exported from it, and the migration is proven by **golden parity** —
the committed `tests/fixtures/golden-run.json` chain must re-hash, replay, and
fold to the identical `head` and `finalStateHash` in GDScript.

## What the proposal got right

- **Godot's fit is real.** TileMapLayer for the board, Control nodes for the
  HUD, Camera2D, tweens, 2D lights, particles, positional audio — everything in
  its §V ("Unlocking the Fun") is a genuine capability jump over a CSS-grid
  debug view, and maps cleanly onto this game's juice ambitions.
- **Decoupling via signals** is the right *presentation* pattern. An
  `EventBus`-style autoload is exactly how the render layer should learn that
  the world changed.
- **Turn logic must be decoupled from the frame loop.** Correct, and the
  proposed `PLAYER_TURN → … → PLAYER_TURN` state machine is a fine shell for
  the existing turn pipeline.
- **The API-key problem is real.** GDScript shipped to players cannot carry
  LLM keys. Its two options (BYOK or a proxy) are the actual option space; we
  choose the proxy for development (§ Oracle below).
- **Custom Resources (`.tres`)** are a reasonable home for *authored* content.
  (Not for chain-derived state — see corrections.)

## What the proposal got wrong

Six findings. Each checked against the code or against verifiable reality.

### 1. Xogot is real — but not what the proposal described, and not the whole toolchain

The proposal recommends `brew install xogot-engine`, describing Xogot as "the
community-maintained, highly optimized fork for Apple Silicon". Both specifics
are fabricated: there is no such Homebrew formula, and Xogot is not a
performance fork — it is **Xibbon's Godot-based development environment,
iPad-first, with a Mac build in preview** (docs.xogot.com; GDScript everywhere,
C#/Swift additionally on Mac). The `xattr -cr` Gatekeeper-bypass instruction is
likewise unnecessary for properly signed builds and bad advice to normalize.

What is true, verified on this machine (2026-07-29): **Xogot for Mac is
installed** (`/Applications/Xogot.app`, direct download), and it ships `xo` — a
command-line broker (`Contents/MacOS/xo`) that can launch instances and drive a
running editor: scene/node/script manipulation, TileSet/TileMapLayer editing,
resource and animation authoring, debug control, GDScript `eval`, editor
screenshots. That makes Xogot a genuinely useful *agent-facing editor surface*
for stage work, not just a human convenience.

What Xogot is **not** (verified: the app binary does not answer `--version`;
the docs describe a preview-release GUI product): a headless, CI-able
`godot --headless` replacement. Corrected toolchain, therefore:

- **Standard Godot 4.x CLI** (`brew install --cask godot`) is the
  determinism backbone — GUT tests, fixture runs, autoplay, golden
  generation, CI. Everything gating parity runs here.
- **Xogot + `xo`** is the interactive surface — human editing/play, and
  agent-driven scene authoring and screenshot verification during stage and
  juice phases. Committed `.tscn`/`.gd` files remain the only truth; `xo` is
  a tool that edits them, never a store.
- **GDScript-only** (no C#, even though Xogot for Mac would allow it) keeps
  the project runnable on every Xogot platform, iPad included.
- The project must stay loadable in **both** editors; Xogot embeds a specific
  Godot version, so record both versions at Phase 1 and pin
  `project.godot` features to the older of the two.

### 2. A mutable `GameState.gd` singleton as truth violates Covenant M4

The proposal's core state model — "Use a GameState.gd singleton to hold
persistent data, the state stack, and player inventory" — is the same mistake
this repo already refused once as *"gold as UI state"*
(`docs/superpowers/specs/2026-07-30-economy-mining-and-sprites.md` §I.1).
Every fact in this game folds out of a content-addressed, SHA-256-chained
event log (`fold = reduce(apply, EMPTY_STATE)`); replay is exact; `verifyChain`
recomputes every hash and rng counter. A mutable singleton would be invisible
to replay, absent from forks, lost on rewind, and unreadable by the assay, the
critic, and the listener.

Corrected: the **sim/stage split** (§ Architecture). The log, the reducer, and
the seeded RNG port *as they are*. Godot's node tree is a projection.

### 3. "Discard custom A* for AStarGrid2D" would silently fork the game's history

`src/core/reachability.ts` and `src/core/sight.ts` feed `decide()` — the AI's
choices depend on their exact outputs, and those choices become recorded
events. Swap in `AStarGrid2D` and every tie-break and path cost can differ:
golden generation, trials, and balance sweeps all diverge from the reference
engine. Corrected: **port `reachability` and `sight` verbatim into the sim.**
`AStarGrid2D` is permitted only for cosmetic, render-side motion, never for
anything that chooses.

### 4. The sprite-sheet instructions stay refused — for format, no longer for rights

The proposal builds its TileSet from `watermarked_img_10516595601443928641.png`
at a 16×16 grid. The 2026-07-30 review refused this on two grounds; the
designer has since (2026-07-29) clarified provenance — the sheet was generated
at their direction with Gemini's image model (Nano Banana) — so the
**licensing half is withdrawn**: there is no third-party licensor, and the
designer's own generations are freely shippable.

The **format half stands in full**: it is a 2816×1536 *presentation image* —
irregular ~128 px cells on no regular pitch, captions and a title banner baked
into the raster, checkerboard backdrop, visible watermark pixels. No `[sx, sy]`
dictionary can be written against it, and none of its pixels (watermark
included) may reach a shipped raster directly. The migration therefore remains
**art-independent**: the stage ships placeholder-first (flat tiles, the current
colour language), and real art arrives through the per-entity-file +
generated-manifest pipeline in `docs/design/SPRITES.md` — regenerate each
entity cleanly with the documented prompt formula (same model, per-entity
framing), key backgrounds to alpha, snap nearest-neighbour, build the atlas.
The presentation image demotes to what it actually is: the visual target on
the wall. Regeneration can be done by the designer or any agent with
image-generation access.

### 5. The mining "state stack" must be chain-derived, not a snapshot stack

"Push the current scene tree state … appends a monster instantiation command to
the saved MainDungeon state object" — a snapshot edit. The 2026-07-30 review
already ruled the suspended floor is chain-derived and the Deep Echo "is an
event, not a snapshot edit". Corrected: suspend/resume and Deep Echo risers are
**events on the chain**, folded like everything else, replayable like
everything else. Scene swapping in Godot is how the *stage* presents it.

### 6. `.tres` Resources are for authored content, not for chain facts

Items and monsters in this game are born from recorded `WORLD_INIT` payloads
and table draws with counted randomness (`src/core/tables.ts`), not from
hand-authored files. Corrected scope for `.tres`: static *presentation*
metadata (sprite lookups, sound banks, palette), and nothing the reducer
reads.

## Architecture: the sim and the stage

```
godot/
├── project.godot
├── sim/            # THE PORT. Pure, typed GDScript; RefCounted/static only.
│   │               # No Node, no signals, no Engine singletons, no Time, no
│   │               # randi(). Randomness enters exclusively as rng.gd(seed,
│   │               # counter). This directory is the TypeScript engine,
│   │               # re-spoken: rng, canonical, hash, log (append/chain/
│   │               # fold/verify), grid, entity, item, tables, state, events,
│   │               # apply, mapgen, reachability, sight, turns, ai, commands,
│   │               # rule, interpret.
│   └── ...
├── autoload/
│   ├── Chronicle.gd   # Owns {log, head}. append() → emits typed signals
│   │                  # (event_appended, state_refolded). The ONLY writer.
│   └── Oracle.gd      # HTTPRequest → local sidecar proxy; async, non-blocking,
│                      # graceful stub fallback (ports src/oracle semantics).
├── stage/          # THE PROJECTION. Board (TileMapLayer), EntitiesView,
│   │               # Hud, MessageLog, TurnManager shell, InputController,
│   │               # Camera2D, minimap, fog. Reads folds, listens to
│   │               # Chronicle signals, never holds authority. All juice
│   │               # (tweens, lights, particles, cosmetic physics, shaders,
│   │               # audio) lives here and may use LOCAL cosmetic RNG that
│   │               # never touches sim counters.
│   └── ...
├── test/           # GUT ports of the vitest suites + fixtures/ exported
│                   # from the frozen TS reference.
└── addons/gut/
```

The corrected mapping table:

| TypeScript concept | Godot home | Correction vs proposal |
|---|---|---|
| `log/` chain, `core/apply.ts`, `core/rng.ts` | `sim/` pure GDScript, byte-parity | Proposal had no equivalent — this is the part that must not change |
| `core/state.ts` GameState | Value produced by `fold()`, held by `Chronicle` | *Not* a mutable singleton |
| `core/events.ts` | `sim/events.gd` schema table + draft builders; Chronicle re-emits as signals | Signals are the repaint bus, never the truth |
| `core/reachability.ts`, `sight.ts` | Ported verbatim in `sim/` | AStarGrid2D refused for sim |
| `core/mapgen.ts` | `sim/mapgen.gd`; stage paints result via TileMapLayer | Proposal conflated generation with painting |
| `ui/debug.ts` CSS grid | `stage/` scenes | As proposed |
| Mining state stack | Chain events (suspend/resume/risers) | Snapshot-stack refused |
| Oracle transports | `Oracle.gd` → Node sidecar (extracted `server/oracle-plugin.ts`) | BYOK deferred as a distribution decision |

## The parity ladder (how we know the port is true)

1. **Fixture parity** — `scripts/export-fixtures.ts` dumps ground truth from
   the frozen TS engine (rng triples, canonical-JSON pairs, event hashes,
   table draws, mapgen boards). Every sim module's GUT suite asserts against
   them.
2. **Chain parity** — the golden run's 125 events re-hash in GDScript to the
   identical ids and `head`. (No reducer needed; this gates Phase 1.)
3. **Fold parity** — replaying the golden chain through `apply.gd` reproduces
   `finalStateHash` exactly. (Gates Phase 2.)
4. **Behavioural parity** — a fresh autoplay run generated in Godot verifies
   and folds identically in the frozen TS engine (bidirectional check), and
   the ported vitest suites (~40 files) are green under GUT, mutation-proof
   discipline intact.

## Oracle

Development: extract the existing CLI-proxy logic from
`server/oracle-plugin.ts` into a standalone Node sidecar; `Oracle.gd` speaks
to it over localhost HTTP. Mechanics never block on it — same fallback
contract as today. Distribution (BYOK settings screen vs hosted proxy) is
recorded as an open designer decision; nothing in the migration depends on it.

## Explicitly parked

- **Witness voice capture** (`src/witness/`, `scripts/transcribe.swift`):
  browser-API-bound; parked until the Godot build stabilizes. The listener
  agent keeps reading packets from archived web runs meanwhile.
- **Xogot on iPad**: unblocked by staying GDScript-only and by the
  both-editors compatibility rule, but not a gate for any phase. (Xogot for
  Mac is *in* the toolchain — see correction §1.)
- **Artifact publishing target** (single-file HTML): superseded by the engine
  change; struck from the backlog at cutover.

## Phases (detail in the master plan)

| Phase | What | Lead |
|---|---|---|
| 0 | Freeze & tag the TS baseline; export fixtures | Sonnet |
| 1 | Godot skeleton, GUT, deterministic kernel (rng/canonical/hash/log); chain parity | Opus |
| 2 | The sim port, module by module; fold + behavioural parity | Opus plans, Sonnet fans out |
| 3 | The stage: playable presentation MVP, placeholder art | Sonnet |
| 4 | Headless tooling: autoplay, golden generator, feedback packets, CI | Sonnet |
| 5 | Oracle sidecar + canon/critic/assay port | Opus designs, Sonnet ports |
| 6 | Economy & mining, Godot-native, per the corrected 2026-07-30 staging | Opus plans, Sonnet builds |
| 7 | Juice fan-out (tweens, lights, particles, shaders, audio) | Sonnet, parallel |
| 8 | Cutover: web UI retired to reference, docs/wiki updated | Sonnet |
