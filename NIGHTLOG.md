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

