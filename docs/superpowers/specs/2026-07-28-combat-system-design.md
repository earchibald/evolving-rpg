# Combat, at every distance — design

*2026-07-28 · the goal: a comprehensive combat system both the player and
creatures use, melee and distance weapons, with the door left open for magic
(not built yet).*

## What research found

**The game's own laws** (openwiki, AGENTS.md, the code):

- One resolution for everyone: bumping is the attack; creatures and the player
  share `resolveStrike` (d20 vs `10 + speed − might` clamped [4,17], damage by
  might band, crit band by wits). A second combat path for anyone is drift.
- Creature decisions are deterministic and drawless; chance lives only in
  whether a blow lands, at a fixed draw cost (`STRIKE_DRAWS = 2`, hit or miss).
- Everything is resolved at command time and recorded whole; `apply` replays
  outcomes, never re-decides them (Covenant M4).
- Verbs are priced into threat or deep floors overdraw (measured: unpriced
  verbs collapsed depth-5 survival to 0/20).
- Every system ships with its human-readable exposure (Covenant L1).

**The feedback layer** (runs/feedback, the witness): fights carry no stake
until contact; *"the danger is real and entirely invisible"*; a verb that does
not legibly pay goes unused. Whatever ranged combat we add must create stakes
*before* adjacency and must telegraph.

**The tradition** (the lineage BALANCE.md and tables.ts already cite):

- DCSS spent fifteen years deleting ammo bookkeeping; modern launchers are
  quiverless. Ammo-as-inventory is tedium, not decision.
- Brogue and Sil put ranged monsters in early and made *approach* the cost;
  Sil's archery telegraphs by position and noise.
- Into the Breach (already this game's touchstone for shove/brace): every
  threat is announced one beat before it lands, and the game is answering it.
- The small-bestiary tradition warns against hit-and-run AI ("retreat AI reads
  as tedium") — a ranged creature should stand and shoot, not dance.

## Three approaches weighed

**A. Counted ammo** (DCSS-classic): a quiver stat, shots consumed, refills
found. Refused: inventory bookkeeping in a one-slot-satchel game; the
tradition itself deleted it; nothing about scarcity telegraphs.

**B. The thrown thing lies where it lands** (Sil's javelin): one projectile,
position is the ammo, walk to retrieve. Lovely and in-register, but it makes
distance an *opener* rather than a way of fighting — one shot per approach —
and retrieval is micro. Kept in the back pocket as a future provision.

**C. The volley discipline** (chosen): shooting takes two beats. You **draw**
(a stance, visible to everyone) and then you **loose**. No ammo, no counts —
the price of a shot is a turn of standing still, announced. Kiting dies by
construction (moving drops the draw), the archer's fantasy lives (hold a
corridor, loose every other beat), and every ranged threat is answerable one
full action before it lands — the Into the Breach discipline, made law.

## The system

### Attack modes, one resolution

Every blow, anyone's, resolves through the same dice: d20 vs
`10 + defender.speed − attacker.might` (clamped), damage by attacker's might
band, crit band by wits, brace raising the bar it faces. What a **mode**
decides is *eligibility* — who can be hit from where:

- **melee** — orthogonal adjacency; the bump is the attack (unchanged).
- **ranged** — a clear straight line within reach (below).
- *(later, not built)* **magic modes** — the mode field is an open string on
  the event and eligibility is a per-mode function, so a bolt (line), a blast
  (disc) or a touch (adjacency with a different stat) slot in without
  reworking resolution, events, or the reducer. Nothing anywhere switches
  exhaustively on the mode set except words.

### The honest line (Covenant M7)

A shot flies only along a clear straight line, center to center:

- **Walls block. Secret tiles block** — an illusory wall is real enough to
  stop a stone, in both directions, so the illusion never leaks by geometry.
- **Living bodies block** — no shooting through your enemies, theirs or ours.
  A corridor single-files a warband into cover for its own back rank; a
  bruiser between you and the slinger is a shield you walked into place.
- The line is computed by an integer supercover walk (symmetric: A→B iff
  B→A). Crossing exactly a corner is blocked only when **both** flanking
  cells are solid — two walls kissing stop the shot; a body never blocks at a
  corner, only where the line truly crosses it.
- **Reach** is the same disc the fog draws: `dx² + dy² ≤ R² + R` with
  `SHOT_RANGE = 5` — inside the deepest floor's sight (7), so nothing shoots
  out of the dark. Adjacency is refused: at range 1 the bump is the attack,
  and the sling wants the ground the sword owns.

### The volley discipline (Covenant M8)

One stance per body, held as a tag, written and cleared only by events:

- **draw** — an action (`DRAWN` event, like `BRACED`). The stance is visible:
  rendered on the map, said in the journal. Drawing drops a brace, bracing
  drops a draw.
- **loose** — an action, only from the drawn stance, at an eligible target:
  a `STRIKE` with `mode: 'ranged'`, two draws like every blow. The stance is
  spent by the shot.
- **the stance breaks** when its holder moves, melees, shoves, or uses a
  thing — and when *anything lands on them or staggers them* (the flinch).
  **Waiting holds it**: an archer may stand at full draw as long as they
  dare stand still.

Counterplay, both directions: seeing a draw, you have one full action —
break the line (step behind a wall or a body), close to adjacency (inside
the sling's reach), brace (the guard raises the bar the shot faces), shove
(the stagger spends the shot unfired), or eat it and pay. This answers the
feedback's exact complaint: distance danger exists, and it is *visible*.

### The creatures' side: the slinger

New archetype, seventh, in-register with the bestiary's plain names:

- **slinger** — verb **volley**. Base 3/2/2/2 (hp/might/wits/speed), growth
  +1/+1/+1/0, weight 2, `fromDepth: 2` (the teaching floor keeps teaching;
  depth 2 is where approach starts costing, beside the stinger).
- `decide()`, drawless as ever: fooled by smoke → hunt the scent. Adjacent →
  bump (a weak club — reaching it *is* the answer). In range with a clear
  line: draw if undrawn, loose if drawn. Otherwise hunt. **No retreat, ever**
  — the tradition regrets dancing AI; the slinger's whole menace is that it
  stands there, drawn.
- Emergent honesty: if the line breaks while drawn, its next decide hunts —
  the move drops the stance. It re-draws when it re-acquires. No bookkeeping.
- `VERB_THREAT.volley = 1.25` (lunge-class: it converts approach rounds into
  damage rounds, from farther). Threat pays XP symmetrically as always.

### The player's side: the leaden sling

- New armory relic: **leaden sling** — grants might (modest: base 1, +1 per
  3 depths), weight 2, and the trait `'ranged'` in `RELIC_TRAITS`. It lives
  in the weapon slot, so sword-or-sling is a real dominance-rule choice: the
  keen edge out-grants it, walking never swaps them, the `,` key decides.
  Bare hands and swords do not throw; the sling is why you can.
- One key, **f**: undrawn → draw (a turn); drawn with an eligible target →
  loose (a turn); drawn with no target → quiet refusal, stance holds, no
  turn (the mispress rule). Target is chosen deterministically — nearest
  eligible hostile by the disc, ties broken by entity order — and the UI
  highlights it while drawn.
- Bots abstain (no policy shoots), like shove and brace before it.

### Events and replay

- `STRIKE` → **v4**: optional `mode?: 'melee' | 'ranged'`, absence reads
  melee (the `motif` precedent — no upcaster needed, old chains fold
  unchanged). Shots record roll/needed/hit/crit/damage exactly as blows do;
  no movement riders ever ride on a shot.
- **`DRAWN` v1** `{ entityId }` — new type, reducer writes the tag.
- Reducer deltas, all mode-gated where melee-bodied: miss-vs-brace staggers
  only in melee (overcommitment is a fact about bodies, not arrows); venom
  and trample already key off verbs and never touch shots; damage or stagger
  strips `drawn` from the sufferer; `WAIT` keeps `drawn` (and still clears
  brace and stagger); every other act by the holder clears it.
- Rule triggers unchanged: a shot you loose is `STRIKE`/`KILLED`, a shot
  that finds you is `STRUCK`, `blowLanded`/`blowMissed` hold. The R2
  vocabulary needs no new words — distance rules can come later as new
  conditions, separately assayed.

### Covenant, added first (M7, M8)

- **M7 — Distance is honest.** A blow from afar flies only along a recorded
  straight line that walls, secrets and living bodies do not cross, within a
  stated reach, on the same bounded dice as every blow — and reach is priced
  into threat. *Enforced by:* the line/reach gates in the loose command;
  STRIKE v4's mode; `VERB_THREAT.volley`; the sawtooth pins.
- **M8 — No shot without a warning.** Every ranged blow, anyone's, is
  preceded by a visibly drawn stance at least one full action earlier; and
  moving, striking, flinching or reeling spends the shot unfired. *Enforced
  by:* the drawn-tag gate in the loose command; the reducer's stance
  clearing; tests on both.

### Legibility (L1)

The drawn stance renders on the map and speaks in the journal ("the slinger
draws"). The player's drawn state shows its chosen target. Shot lines join
`words.ts` (miss/hit/crit/kill tiers for the volley). Tooltip/ledger derive
the same "you need X" arithmetic for shots as for blows. MANUAL.md gains a
jargon-free section: *draw, loose, and what stops a stone*.

### Balance plan

Adding an archetype moves every spawn draw, so fixtures move — the stinger
and caller both set the precedent: regenerate the golden (seed 15), re-pin
the sawtooth on 20 seeds, and hold the stated bands: depth 1 gentle (16-17
of 20), depth 3 fighter decisively over runner, depth 5 in [1,10]. Tune
slinger stats and `VERB_THREAT.volley` until the bands hold; `npm run
balance` for the ensemble read. Threat at birth ≈ 12 (skirmisher-class
chaff, paid for by the volley multiplier).

## Test plan (mutation-proofed, per the suite's idiom)

- **the line**: symmetry (A→B ≡ B→A), wall/secret/body blocking, the
  both-corners rule, endpoint exclusion; reach disc edges.
- **the stance**: draw writes, loose requires and spends, move/melee/shove/
  use/flinch/stagger clear, wait holds, brace↔draw exclusivity.
- **the shot**: resolves on the shared dice (a braced target raises needed);
  no miss-stagger on the archer; kills pay XP; fixed two draws hit or miss;
  replay bit-exact through fold.
- **the slinger**: decide's ladder (smoke-fooled, adjacent, draw, loose,
  hunt); never retreats; drawn slinger that loses the line hunts (stance
  drops on the move).
- **the sling**: trait gates the player's draw; f-flow (draw/loose/refuse);
  dominance vs keen edge; depth-1 floor still guarantees the keen edge.
- **events**: STRIKE v3 folds unchanged (absent mode reads melee); DRAWN
  round-trips; apply exhaustiveness still compiles.
- **covenant**: M7/M8 present with named enforcers (the covenant test).

## Out of scope, stated

Magic (the mode abstraction is its door, nothing else built). New R2
distance conditions. Thrown-provision weapons (approach B, back pocket).
Manual target cycling. Bot archery.
