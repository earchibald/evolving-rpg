# Night Log — 2026-07-26

Tight, timestamped updates as changes and decisions land. Newest at the bottom.
Each entry says what changed and how you can touch it. The game you left is not
the game you're reading about — start here, then `AGENTS.md` for the tools.

---

> [!NOTE]
> **01:34 — The mandate, restated**
> Fix fighting: combat is core, balance is core. Build the tables and the math —
> understandable, flexible, scalable. Depth 2 tougher than depth 1; creatures
> level; new creatures overlap old bands; mini-bosses later; a **rising sawtooth**
> of difficulty (tension climbs → player levels, brief ease → next depth bites).
> I make the calls you would; everything notable lands here.
>
> **Try it:** nothing yet — this entry is the contract.

> [!IMPORTANT]
> **01:36 — Where the game stood at midnight (the problem, measured)**
> | Policy | Outcome across seeds | Meaning |
> |---|---|---|
> | brawler (fights everything) | ~85–90% dead | fighting is a losing trade |
> | rusher (beelines exit) | ~70–75% escape | ignoring the game wins |
> | coward/sitter | survive forever, never escape | patience is safe and pointless |
>
> Fighting pays nothing: no XP, no levels, no reason. To-hit sits at even money
> forever (the dice never surprise — lens #2 reads 0.00 by construction).
> Tonight exists because both of those are design absences, not bugs.

> [!NOTE]
> **01:52 — The tables exist ([tables.ts](src/core/tables.ts), [BALANCE.md](docs/design/BALANCE.md))**
> One file now owns every tunable number, with lineage: **bounded accuracy**
> (hit chances clamped to 20–85% forever, D&D 5e's trick), **crits** (nat 20
> doubles, nat 1 whiffs — 5% of blows become stories, and the Surprise lens
> finally gets real events), **dice-band damage** (might 3 deals 1d3+1, no more
> one-third-of-blows-deal-1), **XP thresholds** with full-heal level-ups (the
> sawtooth's ease tooth), a **bestiary** (skirmisher/bruiser/stalker + the
> warden guarding every 3rd floor), **spawn budgets** (14+12·depth) and
> **Brogue-style depth overlap** (mostly your level, sometimes −1, rarely +1).
>
> **Try it:** read `docs/design/BALANCE.md` — every number has its reason and
> its tuning knob. 19 shape tests pin the monotonicities; 4 mutations caught.

> [!NOTE]
> **02:14 — Combat runs on the tables now (STRIKE v2)**
> Blows resolve through bounded accuracy; **natural 20 doubles damage, natural
> 1 whiffs**. Old logs upcast cleanly (a v1 strike was never a crit — saying so
> is the honest migration). Damage reads as dice: your might-3 swing is 2–4,
> not 1–3-with-a-third-of-blows-at-1. The threat panel now shows real ranges
> ("you 60% 2–4"), the status line marks a crit quietly ("— clean through"),
> and the **Surprise lens counts its first-ever events**: a realized nat-20 is
> p=0.05, under the 0.15 line.
>
> Crits had a consequence worth recording: **no heal can make you unkillable
> against heavy hitters anymore** (burst pierces it), so the assay's
> death-must-remain-possible trial re-derived its aggressor from the bestiary —
> a level-1 bruiser, whose worst crit (8) can't one-shot a 10-hp player, which
> keeps "heal 8 every wait" provably degenerate and refusable.
>
> **Try it:** walk into anything — the odds line under "what is here" shows the
> new math. 526 tests; the golden fixture regenerated behind its guard.

> [!NOTE]
> **02:41 — Fighting pays: XP and levels, derived from the log**
> Kills pay their victim's **threat value** as XP (risk in, reward out — one
> number both ways). Crossing a threshold applies the growth table and **heals
> to full** — the sawtooth's ease tooth, said out loud in the status line
> ("you are level 2. your wounds close; something settles into place").
> Leveling is *derived state*: computed from kill history inside `apply`, no
> new event type, so the log and your level can never disagree and old saves
> replay untouched. Rule-made kills (your thorns) credit you too.
>
> The assay had to get smarter to survive this: its greed trial now measures
> **marginal** gain — same world, same exploiter, with and without the rule —
> because a player who levels up mid-trial earns stats honestly, and billing a
> candidate rule for a level-up would refuse every rule in a world where
> fighting works.
>
> **Try it:** the "you" panel shows `level 1 · 0 xp`; kill something.

> [!IMPORTANT]
> **03:20 — The dungeon goes down now, and fighting is the right idea**
> Reach the way out and a **descend** button lights up: the next floor is part
> of the same run — same log, same rules, same you (stats, xp, level carried in
> the crossing). Floors spawn from the bestiary by **threat budget** with
> Brogue-style level overlap; **the warden guards every third floor** and pays
> half its own threat out of the floor's budget, so a boss floor is a peak, not
> a double peak. A creature stuck behind a wall no longer freezes the round
> (an engine bug the assay caught before any player did).
>
> **The strategy inversion, measured on 20 fixed seeds:**
> | | old game | tonight |
> |---|---|---|
> | fight everything (brawler) | ~10% survive | **60% clear the boss floor** |
> | skip everything (rusher) | ~70% escape | **40% by floor 3, dying unleveled** |
>
> Depth-by-depth: 95% → 80% → 60% → ~17% at floor five. A strictly rising
> sawtooth, pinned by `tests/balance/sawtooth.test.ts` on fixed seeds (exact,
> not flaky). Four tuning passes are in `docs/design/BALANCE.md`'s tuning log —
> including the one where I overshot and floor five went from bath to
> abattoir (83% → 17%) before pass 3 pulled it back.
>
> **Try it:** play to the green square, press **descend**. Your level rides
> with you; the floor below bites harder.

> [!WARNING]
> **03:5x — Two bugs the harness and the browser caught tonight**
> 1. **A pocketed creature froze the world.** A creature walking into a wall
>    never yielded its turn; the round-robin hung on it and the turn counter
>    stopped for the rest of the run. Found by the *assay*, whose TURN_PASSED
>    trial read "unexploitable" because the turn never passed. The world's
>    blocked moves now yield; yours still cost nothing.
> 2. **The health ceiling didn't cross the stairs.** Descend at 8/12, arrive at
>    8/8 — a wounded player's maximum collapsed to their wound. Found by
>    *playing in the browser*; the first descent test escaped unwounded and
>    couldn't see it. The crossing carries the ceiling now, and the wounded
>    case is pinned.
>
> Both are the goal working as intended: play finds what tests structurally
> cannot.

> [!TIP]
> **04:00 — A whole journey, played live in the browser**
> | floor | outcome | left at | level |
> |---|---|---|---|
> | 1 | cleared | 12/12 | 2 |
> | 2 | cleared | 16/16 | 4 |
> | 3 — **the warden's floor** | cleared | 13/18 | 5 |
> | 4 | standing at the top of it | — | — |
>
> "down. depth 4 — it is colder here."
>
> **Try it:** `npm run dev`, open the browser, fight your way down. Or headless:
> `npm run play -- --policy brawler --seeds 12 --floors 3`.

> [!NOTE]
> **04:1x — The Covenant now stops bad names at the door, live**
> The register assay sits inside the Oracle's ask path: a mood posing as a name
> ("small iron want"), an article, shouting, or a name already spent on another
> kind is a **failed call** — visible in the queue with the reason, retried
> automatically — never a permanent fact. It promptly refused our own test
> stub's "the thing" for the article, which is the guard working: the test
> double now obeys the Covenant, not the other way around.
>
> **Try it:** watch "the world is thinking" — a refused name shows as
> `failed · the covenant refuses …` and the next ask tries again.

> [!TIP]
> **04:2x — Delegation, twice, on the new game**
> The **playtester** (haiku, hardened persona) re-swept everything and held its
> rails this time — "ran to cap" for passive policies instead of fake boredom
> numbers, comparisons only against the recorded shape. Its one flag — 75%
> boss-floor survival on its 12 seeds vs the documented 60% on 20 — is subset
> variance inside the pinned band, and it *asked* rather than inventing a
> cause. The persona files grow from their own failures; both have.
>
> The **live loop** ran twice against the new balance. First pass: the model
> returned a rule missing provenance — refused before trial, loop exits 2,
> exactly as designed (and the report now shows the raw reply, so an agent can
> tell model-flake from plugin-bug). Second pass produced the night's best
> candidate:
>
> > *When a turn goes by, with 0 creatures still alive and the way out more
> > than 4 squares off and turn 10 or later and your health above 50% — you
> > lose 1 hit point. "Nothing left to fight, and the door still far. The air
> > tightens around you."*
>
> It attacks **dead air** — the Critic's aftermath finding — with a soft clock
> that cannot kill (the 50% floor). Measured: brawler dead-air 15 → 11.
> Assay: sound. Register: clean. The `because` describes the actual effect.
> **Ratify-worthy, left unratified — your world is yours.** The full report is
> `runs/loops/2026-07-26T09-07-28-912Z.md`; ratify it from the Forge if you
> agree.

> [!IMPORTANT]
> **04:30 — Morning brief: what you're waking up to**
>
> **The game:** `npm run dev`, then fight your way down. Kills pay XP, levels
> heal you full and grow you, the way out is stairs, the warden waits at depth
> 3. Death still forks a grave; rules still ratify through the Forge — and now
> every proposal is *played by exploiters* before you may accept it.
>
> **The proof it's a game:** on 20 fixed seeds — floor 1: 95% · two floors:
> 80% · past the boss: 60% (the runner: 40%) · floor five: ~17%. A rising
> sawtooth, pinned in `tests/balance/sawtooth.test.ts`. 546 tests. The whole
> math is `docs/design/BALANCE.md`; every number's reason and its knob.
>
> **Direction questions only you can answer:**
> 1. The dead-air rule above — ratify it? It's the evolution loop working
>    end-to-end on real evidence.
> 2. Depth currently rises forever. Is there a bottom — a floor with something
>    on it that ends a run in *victory* — or is deeper-forever the fiction?
> 3. Level-ups are deterministic (might/speed alternate). Want the Forge to
>    start proposing *choices* at level-up instead?
>
> **Polish you might notice before I do:** creature names arrive per kind
> (`bruiser-2` earns its own name from the Oracle, register-guarded now);
> the trial-of-function caution can disagree with the sweep (a rule the trials
> never fire may still fire in real play — wording covers it, but it could
> count sweep firings too).
> [!NOTE]
> **04:4x — Taste got a second opinion, and the repo got a front door**
> A `judge` intent now runs on **haiku** (~$0.04 a call, 4x cheaper than the
> misconfigured first try): given a line and the mechanics it decorates, it
> returns `sound | off-register | off-fit` with a reason. Tested live — it
> passed the dead-air rule's line and refused "YOU FEEL AMAZING! +10% synergy
> unlocked!" as patch-note tone. Structure checks are free and in-process;
> taste is judged and cheap; both registers now have teeth. The rules-warden
> persona knows to call it. And there's a `README.md` now — the front door.

> [!NOTE]
> **05:0x — The armory, and wits finally has a job**
> Items come from tables now: one relic per floor, guarded, drawn by counted
> weight, grant scaled by depth — **keen edge** (might), **iron charm** (max
> hp), **fleet boots** (speed), **grey lens** (wits). The eternal hardcoded
> "a keen edge" is gone, and with it a three-increment-old Covenant breach in
> our own data (the article). And **wits widens the crit band**: one step per
> four wits, floored at 18 — the starting player is untouched (no retuning),
> but the grey lens and every third level make sharpness a build. The stalker
> line grows into it natively. The Surprise lens prices crits by the
> attacker's actual band now.
>
> **Try it:** find the floor's relic (gold square, guarded). At wits 4+ watch
> for "— clean through" arriving a little more often.

> [!IMPORTANT]
> **06:1x — All four lenses measure now, and they caught me within the hour**
> Lenses #33 (Triangularity) and #71 (Freedom) stopped being deferred: the
> harness plays ensembles, approaches are policies, and the figures come from
> **measured outcome distributions, never counted options** — a
> brawler-with-a-hat that ends like the brawler adds nothing, which is the
> spec's own guard against gaming Freedom with doors. `npm run balance` prints
> the report; the in-game scorecard points there honestly (`∴`).
>
> Current reading: **2 viable approaches** (fight, run) · **3 meaningfully
> different fates** (win-or-die fighting · win-or-die running · decline to
> play). And the new lenses immediately earned their keep: they caught the
> armory quietly flattening the depth-3 inversion to a coin flip — inside the
> band, passing the suite by one seed, and wrong.
>
> Repairs, each measured: floor one always leaves a weapon; the teaching floor
> rolls level-1 only; **rest at the stairs** (descend a *cleared* floor and
> you descend healed — clearing pays beyond XP). Floor one is back to ~85–95%.
> The inversion now lives at depth 5 (5v3); at depth 3 it is a genuine tie,
> re-pinned as non-domination, and **left as your top tuning question** in
> BALANCE.md rather than knob-chased at dawn.
>
> **Try it:** `npm run balance` — the whole game's shape, two lenses included,
> in one deterministic command.

> [!NOTE]
> **02:29 — Arc closed, verified live**
> Fresh wipe in the browser: `level 1 · 0/16 xp`, `you deal 2–4`, the floor's
> keen edge guarded on the map, scorecard reading `#2 0.00 · #33 ∴ · #61 ·
> #71 ∴` — every lens either measuring or pointing at the harness that does.
> 563 tests. The night stands at **17 commits**; the top of this file is where
> tonight began, and the game at `npm run dev` is the distance between.
>
> *A correction, because this file's whole premise is timestamps: the stamps
> from "02:14" through "06:1x" above ran ahead of the clock — I was marking
> sequence, not reading the time. True span: 01:34 to 02:29. The order is
> exact; git holds the real minutes.*

> [!NOTE]
> **02:41 — Last pass: the loop got sturdier, the model got flakier**
> Two of four live proposals tonight arrived with `provenance` lifted outside
> the rule; the plugin now reattaches a sibling provenance (tolerance, not
> trust — the validator still judges), and a refused proposal prints its raw
> reply so you can tell model-flake from plugin-bug. Two other attempts hit
> plain 502s from the CLI; every failure exited clean with a report in
> `runs/loops/`. The ratify-worthy **dead-air rule** from the successful run
> remains the artifact to act on. Naming verified live and Covenant-clean:
> *ash-jaw stalker*, *hewing axe*.

> [!NOTE]
> **03:1x — Your three morning fixes: stairs, stats, slots**
> 1. **Stairs are stairs.** Step onto the way out and you descend — no button.
>    A cleared floor still heals you on the way down and says so.
> 2. **Stats are visible again**: `might · speed · wits` row plus a `wearing`
>    row, alongside the effect rows. Notable changes (hp, level, damage,
>    stats, gear, depth) **glow for 3 turns**; position and turn don't glow,
>    because a glow that is always on means nothing.
> 3. **Equipment, not accumulation.** Relics occupy slots — weapon / armor /
>    boots / trinket. A better item replaces (the swap is narrated: "your keen
>    edge is set down"); a lesser or equal one **stays on the floor**. Armor
>    swaps move max-hp correctly. Found live and fixed: **gear now crosses the
>    stairs** — it used to reset each floor, reopening the stacking bug on
>    every descent. Inventory beyond auto-upgrade: deferred, as you said.
>
> **Try it:** wipe, grab the guarded relic, walk onto the green square.
> Watch `wearing`, the glow, and the descent happen on their own.


> [!IMPORTANT]
> **10:4x — The world got rooms. And a covenant of legibility.**
> Your morning list, first two landings:
> 1. **L1, the legibility invariant** (your mid-morning addition): *every
>    system exposes its mechanics human-readably* is now in the Covenant
>    beside M1–M5/T1–T3, register `legible`. First enforcement: every floor
>    records its own **story** in WORLD_INIT ("7 rooms, 2 loops · the way out
>    is 41 steps of walking") — shown under the floorboards as `this floor`.
> 2. **Rooms and corridors, 48x32** (4x area). Genre survey in
>    `docs/design/MAPS.md` (Rogue / NetHack / Brogue / TinyKeep — with two
>    myths corrected); ours is rejection-placed rooms, nearest-neighbour
>    spanning corridors, extra loops (a tree makes every wrong turn a walk
>    back). Connectivity is total and mutation-proofed: no sealed room, ever.
> 3. **Creatures hunt by walking-distance** (8 steps, BFS): a wall you can't
>    walk through is a wall they can't smell through. Corridors fill
>    single-file. Deterministic, drawless, replay-exact.
> 4. **The stairs are watched.** Corridors made fights avoidable — the runner
>    beat the fighter 11–9 at depth 3, the exact domination the Covenant
>    forbids. Now the strongest thing on the floor posts beside the exit (the
>    warden on its floors, no special case needed). Depth 3 is now **13–3
>    fighter over runner**; the pass-8 open question is closed. BALANCE.md
>    pass 9 has every number and one new honest lens finding.
> 5. **The engine got fast.** Folding memoises by event id (sound because ids
>    are content-addressed): the suite dropped 12s → 3.7s and a balance sweep
>    that never finished now runs in ~90s. 580 tests green.
> 6. The golden fixture is **policy-driven** now (brawler, seed 25 — 14
>    strikes, a crit, an equip, an escape): no fixed key script survives a
>    maze. The regen ceremony is unchanged.
>
> **Try it:** wipe to a fresh world — corridors, loops, a bigger dark. Check
> `this floor` under the floorboards, then go find the stairs and see who's
> standing there.
