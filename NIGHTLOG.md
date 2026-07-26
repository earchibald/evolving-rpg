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

