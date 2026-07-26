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

