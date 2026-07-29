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

> [!NOTE]
> **11:2x — Your review, answered; and the first rule is law**
> 1. **The save bug is dead.** "diverges at seq 120" was the verifier
>    demanding rng continuity across the stairs — every saved run that had
>    descended was refused on reload. Fixed, and pinned by a save/load round
>    trip that crosses a floor.
> 2. **The journal.** The two-line status box is now a scrolling, kept
>    history with turn stamps — fresh lines lit, old lines dim, wheel or
>    PageUp/PageDown to read back. Nothing is clipped mid-sentence.
> 3. **Stats glow one number at a time** (a +2 edge no longer lights speed
>    and wits). **wielding** and **wearing** are separate rows and show what
>    each piece grants ("keen edge +2 might"). A refused prize explains
>    itself in the journal: "no better than your keen edge — it stays where
>    it lies." Item rows in *what is here* say their real grants (an iron
>    charm no longer reads "+0 might"). Loot is violet.
> 4. **The dead-air rule is ratified** — the first ratified rule in the
>    game's history. Your approval condition ("only down to half health")
>    is the rule's own require: it fires only above 50%. Your sentence went
>    in as a designer note and the rule cites it. It is live in your world:
>    clear a floor, dawdle 10 turns, feel the air tighten.
> 5. **The agent's hatch**: `window.evolve` — `note()`, `ratify()` (through
>    the full finalise gate; no side door), `state()`. Any agent driving a
>    browser can now play the whole loop. Loops also save their proposal as
>    `.rule.json` beside the report, so a ratify-worthy rule never needs
>    hand-reassembly again.
> 6. `npm run balance` reports progress to stderr while it grinds (~90s).
> 7. Noted: **forever dungeon is fine for now** — victory floors wait for
>    stories.

> [!IMPORTANT]
> **11:3x — Fog of war**
> The map went dark. You see 9 tiles of *walking* sight (shadowcast — walls
> block, corridors are tunnels, rooms light as you enter). What you have
> seen stays as dim geometry and still things; **creatures vanish from
> memory the moment they leave your sight**, because they move and your map
> of them would be a lie. Derived from the chain, not stored: **a rewind
> un-sees, a fork knows only its own path, and every new floor arrives
> dark.** The panels honour it — *what is here* lists only what the fog
> knows, "the way out" reads *not yet found* until found, and the
> gamemaster now answers from your character's knowledge, not the map's.
> Naming, too: the world christens only what you have actually met, which
> also stops spending model calls on strangers.
> **Developer eyes stay open**: the new *through the fog* panel lists every
> creature, prize and exit with positions, each marked "unseen by the
> player" until met — a fog bug shows as a disagreement between that list
> and the map. Shadowcasting, floor-reset and shove-following are all
> mutation-proofed (x-ray, pre-mapped descents, blind shoves: caught).

> [!NOTE]
> **11:4x — One world menu, keys for everything, and the ledger**
> 1. **world…** (<kbd>n</kbd>) is the one top-level control: *begin this
>    world again* / *another world* / *wipe everything*, each with a plain
>    sentence on what it keeps and what it costs. `run again` moved inside
>    (still one keystroke: <kbd>r</kbd>).
> 2. **Keys for everything**: <kbd>n</kbd> world · <kbd>g</kbd> forge ·
>    <kbd>r</kbd> again · <kbd>v</kbd> verify · <kbd>f</kbd> fork ·
>    <kbd>b</kbd> back 10 · <kbd>?</kbd> the key sheet · <kbd>PgUp/PgDn</kbd>
>    journal · <kbd>esc</kbd> closes sheets and leaves writing boxes ·
>    <kbd>enter</kbd> sends. One table drives both the dispatch and the help
>    sheet, so the help cannot drift from the truth. Buttons wear their keys.
> 3. **The ledger** (new panel): the run's decision chain read straight off
>    the event chain — every floor's birth with its recorded account, every
>    law with its why. And floors now record their *whole* account: rooms,
>    loops, the walk, the spawn budget and what it bought, **who watches the
>    stairs**, what lies guarded. Old floors honestly show the shorter story
>    they were born with.

> [!NOTE]
> **11:5x — Gestalt worldgen, documented**
> `docs/design/GESTALT.md`: the world decided whole at birth — a recorded
> **world bible** (anchor, lexicon, roster, warden identity, promises) that
> constrains flavor over the untouched mechanical skeleton. Assayed whole at
> birth (which finally gives the canon-consistency judge a home), stored as
> an event so forks inherit identity, with a five-level ladder from
> names-only (buildable now, makes haiku sufficient for naming) to full
> campaign arcs ("later we will have stories"). Recommendation inside:
> build L1 when naming coherence next bothers play; nothing mechanical
> moves except through tables.

> [!NOTE]
> **15:4x — The character rail, and numbers that show their history**
> 1. **Everything about you lives in one right-hand rail** — vitals, the
>    buttons (rearranged to fit), and *what is here* — beside the map, sticky
>    for the whole page: scroll to the lenses and you are still in view. No
>    more scrolling to find your own hit points. Narrow windows fall back to
>    stacking.
> 2. **Changes show BEFORE → AFTER**: pick up a blade and *you deal* reads
>    `2–4 → 3–6`, *might* reads `4 → 6` — what was, in orange; what is, in
>    green; for three turns. Same for gear ("— → keen edge +2 might"),
>    hit points, level, depth.
> 3. **Remembered rooms are readable now** (brightness 45% → 74%):
>    squinting is not a game feature.
> Verified by an agent playing through the browser: BFS-walked to the
> guarded blade, killed two wolves on the way, leveled mid-fight, equipped —
> every row told its story.

> [!NOTE]
> **16:0x — Numbers you can interrogate, and the gamemaster's screen**
> 1. **Hover any dotted-underlined number for its derivation, with today's
>    values in it**: *might* explains your dice and your to-hit; *speed* what
>    it costs a creature to touch you; *wits* your crit window; *hit points*
>    the full ceiling arithmetic (birth + levels + gear); *you deal* names
>    your band and what might reaches the next one. Separate tooltips per
>    stat — covenant L1 at the row level.
> 2. **The gamemaster's screen** (<kbd>m</kbd>): the two channels and every
>    machinery panel — lenses, rules, names, the ask queue, worlds, the
>    ledger, floorboards, through-the-fog — one wide modal. Inside it:
>    <kbd>1</kbd> writes to the designer, <kbd>2</kbd> the gamemaster,
>    <kbd>esc</kbd> steps out of a writing box *without* closing the sheet
>    (your draft survives), <kbd>esc</kbd> again returns to play. The play
>    surface is now just the map, the journal and you.
> 3. Two layout bugs found by playing: the sheet width cap squeezed the
>    screen to one column (CSS order — the cap came later in the file), and
>    the rail's overflow guard clipped tooltips to a sliver at its edge.
>    Both fixed; the whole pane verified by hover, key and screenshot.

> [!IMPORTANT]
> **16:2x — Your review batch: four fixes, two new muscles**
> 1. **The fog leak is found and sealed**: the sight-sweep recorded tiles one
>    past the map's east edge, and plain `y*width+x` wraps that to a real
>    tile rows away — your "discovered square in the void". Bounds-gated,
>    pinned by a test that decodes every lit tile back to coordinates,
>    mutation-proofed.
> 2. **Wielding speaks canon**: the rail and the swap line now use the
>    world's name ("whetted blade"), never the table's kind ("keen edge") —
>    two names for one thing was the exact contradiction canon forbids.
> 3. **One tooltip, the browser's own** (the styled double is gone), and
>    **the gamemaster's screen fills the window** with a single scrollbar —
>    nothing inside it scrolls on its own any more, so the wheel works
>    wherever the pointer rests.
> 4. **Trial of proportion (new Covenant M6)** — "the rule proposed was far
>    too strong" is now measurable *before* ratifying: every proposal is
>    played with and without across six rerolled fights, and the swing rides
>    with it ("swings hit points left by 4.7, flips 2 outcomes — heavier
>    than a relic; weigh it"). Caution, never refusal: how heavy is too
>    heavy is your call — blind was the only wrong way to make it.
>    (Found en route: the trial player must start mid-level, or the level-up
>    full heal launders every swing to zero.)
> 5. **Floor naming is one batched call** — every unnamed kind on the floor,
>    fog or no fog, named as a set in one ask instead of one call each.
>    Each name still faces the register guard individually, duplicates
>    inside a batch are refused, a batch of one takes the ordinary path.
>    Verified live to the transport (the singleton came home as **gristle
>    hound**, opus, register-clean); server timeout raised 45s → 120s for
>    batch-sized calls.

> [!NOTE]
> **16:4x — Change-glow no longer haunts across worlds**
> The before→after memory survived a wipe, so a fresh game diffed its empty
> hands against a dead game's gear ("iron charm +4 hp → —"). The memory now
> dies at every world boundary — wipe, new world, world switch, begin-again
> — and survives only the stairs, because descending is the same character's
> same run. Reproduced live (3 rows glowing), wiped, verified silent (0).

> [!IMPORTANT]
> **16:5x — Increment 6 lands: the Worldsmith. Worlds are founded now.**
> One structured call at a world's birth decides its identity whole
> (GESTALT.md, levels L1–L2), and it is REAL — the first founded world came
> back as **The Cold Larder**: *"A butchers' undercroft cut into the
> permafrost beneath a town that no longer eats. Thirteen chambers of hooks
> and meltwater, dug in loops so a carcass could be walked all the way round
> without ever turning back."* Thirteen chambers, dug in loops — the model
> wove the floor's REAL generated shape into the fiction unprompted.
> 1. **The bible is an event** (WORLD_BIBLE) — content-addressed, forked,
>    replayed; it crosses the stairs and survives begin-again ahead of the
>    rules, exactly the rules pattern. Hard-shelled validator before the log
>    (register-assayed prose, article-free lowercase lexicon, no duplicates).
> 2. **Every voice speaks from it**: naming (single and batched) draws on
>    the lexicon; the gamemaster receives the anchor, tone and promises;
>    an unfounded or refused world simply improvises as before.
> 3. **The warden is somebody before you meet it**: *"rime butcher — it
>    walks the loops with a whetstone."* And the promises fold mechanics
>    into foreshadowing: *"Every third floor down, the whetstone is heard
>    long before its owner is seen"* — that is wardenAt(3) wearing fiction.
> 4. **Naming waits for the founding** (floor one is the most-seen floor;
>    improvising its canon mid-founding writes off-palette names where the
>    palette matters most); a failed founding releases it, nothing blocks.
> 5. **The bible is on screen** — "this world" atop the gamemaster's screen.
> Known tension, said honestly: canon names are per-kind and GLOBAL, so a
> second world can inherit the first world's creature names despite its own
> bible. Per-world canon scoping is the open question this raises.
> 615 tests; chain with a bible verifies end to end.

> [!IMPORTANT]
> **17:1x — Increment 7: secret passages. And a confession.**
> Your inaccessible-rooms floor was **my fault, transiently**: mutation
> proofs sabotage the generator to check the tests notice, and vite's
> hot-reload served one sabotaged build to your live tab for a few seconds —
> your descent recorded a corridor-less floor forever. The shipped generator
> was never wrong. New practice: the dev server pauses during mutation runs.
> Your repair idea was better than the throw, so it is now the game:
> 1. **Illusory walls.** Roughly one floor in three, one room's every
>    doorway becomes a SECRET tile: paints as wall, blocks the fog until you
>    walk through it — the move simply succeeds ("the wall gives way — it
>    was never a wall") — and never fools you again (found passages render
>    edged, remembered across the whole run).
> 2. **Creatures were never fooled.** They path and hunt by passability, so
>    every secret door is known to everything that lives there — zero code,
>    by construction, exactly as you specified.
> 3. **Never load-bearing.** A room is sealed only if everything OUTSIDE it
>    stays walkable by someone who knows no secrets; start and exit rooms
>    are never sealed. The floor's story says "one room keeps itself secret".
> 4. **Your repair rule, verbatim**: a floor that truly arrives with
>    stranded rooms gets a hidden way cut through the wall instead of being
>    thrown away — defence in depth under the construction guarantee.
> All three properties mutation-proofed (fog illusion, stranding check,
> repair). Golden re-picked (seed 14 — fights, crits, equips, escapes).
> 623 tests. Old saves: broken freely, per your standing rule.

> [!IMPORTANT]
> **17:3x — Dying provokes the world. And your body waits.**
> 1. **Every death proposes a rule, unasked.** The run that killed you is
>    read back at the moment of burial; the Forge opens on its own when the
>    offer arrives. Verified by dying twice, live:
>    - Death one: the world saw a run of futile waiting and offered rest —
>      *hold still, nothing living within 4, below full health → recover 1*
>      — citing the dead-air lens. A genuinely good offer.
>    - Death two: the world offered a stat-minting engine and **the assay
>      refused it before it ever reached the screen** ("might climbed 18
>      past what the same play earns"). The whole gauntlet — death →
>      proposal → trial → refusal — ran without a hand on it.
>    One paid call per death (~40-90s); the one exception to "asking happens
>    when you press the button": you ruled that a death is the button.
> 2. **Finding your own body says so**: walk onto the tile where a previous
>    run of this world fell (same floor — the same seed rebuilds it) and the
>    journal says *"you find your own body. what that is worth, the world
>    has not yet decided."* What it CONFERS is deliberately undecided, per
>    your call — and the line leaves the door open for the Forge to be the
>    one that decides. Verified live: died behind a secret door, rose, and
>    had to re-discover the illusory wall to reach the corpse — the fog
>    honestly forgot it with the fresh run.

> [!NOTE]
> **17:5x — BONES.md: the body's meaning, researched and left to you**
> Four decades surveyed — Hack 1.0's bones (1984) through NetHack's cursed
> piles and ghosts, Shiren's rescues, Souls bloodstains, Diablo's corpse
> runs (and why D3 cut them), ZAngband player-ghosts, Hollow Knight shades,
> Spelunky's deliberate nothing, Death Stranding's craters. Distilled into
> six options in `docs/design/BONES.md`, each with tradition, upside,
> downside and the concrete shape it takes HERE. Option F is ours alone:
> **the Forge decides** — death proposals offering body-rules, so the
> meaning of your corpse becomes something each world ratifies for itself.
> The tradition's delight formula, for whichever you pick: danger, reward
> that is only what you already earned, continuity. No choice made — §9 of
> the WALKTHROUGH points here.

> [!IMPORTANT]
> **18:0x — Increment 8: the depth cuts the floor to a motif**
> Research first, per your rule — and from shipped source, not wikis:
> Brogue blends cave-weight 2%→48% and corridor-attach 90%→10% over its 26
> depths and ramps secret doors 0→67%; Rogue darkened rooms to 100% by
> level 11, Moria by 25; Angband gates room types by min-depth; NetHack and
> DCSS swap whole generators per region. MAPS.md §5 holds the numbers.
> Ours, as bounded rows in tables.ts (BALANCE.md pass 10):
> | depth | motif | feel |
> |---|---|---|
> | 1–2 | **the door** | today's exact shape — the teaching floors |
> | 3–4 | **the warren** | dense, tight, loopy — Brogue's chase topology |
> | 5–6 | **the halls** | broad sparse chambers — the keeper's arena |
> | 7+ | **the deep** | draws warren or halls per floor; secrets 1-in-2 |
> And **the dark closes in**: sight 9 → 8 → 7 by band — Rogue and Moria's
> darkness lineage mapped onto our fog, never fully black. Every floor
> names its motif in its story. Measured after: door 19/20 gentle, warren
> 12v4 fighter-over-runner, halls 6v0 deep — the sawtooth's shape intact
> with more character per band; all pins green, both new mutation proofs
> held (motif ignored, ramp flattened — caught). 631 tests.

> [!NOTE]
> **18:2x — Two bug reports run down**
> 1. **The stuck queries** ("world:main 1586s"): a hung CLI child ignored
>    the server's polite SIGTERM, so no response ever went back and the
>    browser's fetch waited forever — and while a founding hangs, its
>    world's naming stays gated shut. Two-sided fix: the server now kills
>    with SIGKILL at the deadline, and the transport carries its own
>    180-second abort so every ask SETTLES — success or failure, the gates
>    always clear.
> 2. **The "draw-outside-visible" rings**: I loaded your actual mirrored
>    chronicle from runs/latest.json and audited every world — the fog's
>    sets are sound (your two rings are genuinely trodden secret doorways
>    at (6,17) and (6,21) of main's depth-3 floor, neighbors genuinely
>    seen). The liar was contrast: a remembered passage kept its full ring
>    while its dim surroundings sank to near-veil, reading as marks drawn
>    in the void. Fixed by widening the veil/dim luminance gap and quieting
>    the ring to a quarter strength out of sight. The set-level property —
>    a trodden tile and all its neighbors are always seen — is now a
>    permanent test, so the honest half can never rot into the lying half.

> [!IMPORTANT]
> **19:2x — The vocabulary grows for the first time, under written law**
> The research on self-amending rule systems came home (Nomic's immutable
> core and win-by-paradox, Fluxx's categories, MtG's evergreen discipline,
> the mutator menus, Baba's legibility budget, Ludii, and a 2025 paper on
> LLM Nomic where identical proposers collude 0.87 and diverse ones argue) —
> distilled into **docs/design/VOCABULARY.md**: nine standing principles for
> widening a closed rule language, each mapped to machinery we already have.
> Then the first widening under them, three conditions:
> - **`bodyHere`** — "your own body lying where you stand." BONES option F
>   unblocked *without deciding it*: the fact is now expressible, so a death
>   proposal can offer what your fall site is worth and the Forge decides.
>   Bodies ride the chain as a new WORLD_BODIES event, appended when a run
>   is born or descends (identity, then the dead, then law) — replay, bots
>   and trials all see the same truth. One consequence said plainly: dying
>   the same way twice now digs two graves, because the second run walked a
>   haunted floor — genuinely different history, however identical the keys.
> - **`depthAtLeast`** — rules can finally know how far down the run is.
> - **`motifIs door|warren|halls`** — rules read the floor's cut, recorded
>   in WORLD_INIT (v7) beside the story; the deep stays depth's business,
>   said by composition. Two different cuts in one rule are refused at the
>   door — a rule that can never fire is not a rule.
> The assay learned to **meet a rule where it lives**: trial worlds are born
> at the depth, cut, and hauntedness the rule names (both sides of every
> marginal pair), so "never fired" stays an honest caution — while a
> body-gated wits engine still dies to M2 and a modest body-heal trials
> sound. Golden regenerated for v7 (same 47 actions, same escape — the
> stream didn't move, only what the birth event says). 655 tests.

> [!NOTE]
> **19:4x — The first agentic soak: the whole table, played by agents**
> The loop AGENTS.md promises, run end to end without a browser: the
> playtester (haiku) swept fresh worlds and your real one; four `npm run
> loop` runs asked the live Rulesmith for proposals; three rules-wardens
> (sonnet) judged the survivors adversarially — two of them handed the
> same pair of rival rest rules from opposite sides, and converged without
> conferring. What the table found:
> - **The shape holds.** Brawler 11/12 escapes ≈ the pinned 19/20; rusher
>   10/12; the four passive policies stall at the cap as always; your real
>   world plays the same pattern. No drift after the vocabulary widening.
> - **Three of four proposals answered the same absence** — "waiting is
>   never worth choosing" — the dead-air lens doing exactly what it is for.
>   The fourth was an **aftermath clock** (cleared floor + far exit + turn
>   20+ → lose 1 hp and a line about the quiet). None reached for the new
>   words: fresh depth-1 worlds have no bodies and one cut, honestly.
> - **M2 refused a live proposal on its own**: "might +1 per WAIT beside a
>   creature" exploited to +18 in the trial. The gate works on real model
>   output, unattended.
> - **Verdicts for you** (nothing ratified — that button is yours):
>   1. *Aftermath clock* — warden says **ratify** (runs/loops/
>      2026-07-27T02-25-26-533Z.rule.json). It also traced the composition
>      with rule-1: a wounded dawdler on a cleared floor nets +1/turn till
>      50%, then the clock bites — self-correcting, M1 intact.
>   2. *Rest when hurt* — **ratify with the band edit**: both wardens
>      refused the loose 99% twin ("topping-off wearing a heal-1 costume")
>      and chose the 60% gate; the warden's disjoint-band edit (add
>      hpAbovePercent 50) kills the guaranteed double-fire with rule-1 —
>      and I widened its ceiling to 65 because 50–60 is an EMPTY band at
>      maxHp 10 (no integer hp qualifies; checked). Trialled sound:
>      **runs/loops/rest-band-50-65.rule.json**.
>   3. *Rest after any scratch* (99%) — **refuse**, two wardens agreeing
>      independently.
> The haiku voice judge misfired once (off-fit for not quoting numbers in
> prose — a standard that would fail both ratified rules); the warden
> caught it and overruled with reasons. Its opinion is evidence, the
> verdict is the warden's — the separation held exactly as designed.

> [!NOTE]
> **19:4x — The gamemaster's clock learns to stop**
> Your report, run down: answered queries kept counting because the queue
> recomputed every entry's elapsed time forever — the number whose job had
> ended was the one that never stopped changing. Now every ending stamps
> its true duration once (answered and failed alike), and the live clock
> runs only while a call is genuinely in the air. Two clock tests pin it.
> One thing to know: your game tab had been quietly deferring its reloads
> (hidden tabs hold their breath), so the fix arrives next time you reload
> — and any entry stuck "asking" from before will clear with the reload,
> since the queue shows work, not history.

> [!NOTE]
> **20:1x — The body you can stand on is a body you can see**
> Closing a gap tonight's own work opened: `bodyHere` made your past falls
> a fact rules can read, but nothing showed them — covenant L1 does not
> allow a mechanical truth without a human-readable face. Now: the map
> paints a body where you fell (the quiet echo of your death square —
> same drained ochre, thinner ring), honestly fogged like everything else
> that holds still; the gamemaster's floorboards list it ("a body — yours
> — at 33,22") even while unseen; and the step-on message now reads the
> same chain-recorded truth as the rules, the bots and the map — the old
> grave-walking duplicate is gone. Verified live in a sandbox world: died
> to a skirmisher at 33,22, began again, and the floorboards said exactly
> that.

> [!NOTE]
> **23:2x — Every world names its own**
> Your open question, decided (you delegated the call): canon is now scoped
> per world. A name was a fact about the whole install — your second world
> inherited the first's "wire hound" despite having its own bible, which
> contradicted the gestalt's founding sentence: two worlds never share one
> identity. Names are filed under the world's root event — content-addressing
> already gives every fork and grave of a world the same root, so they share
> names by construction, while a wiped-and-remade world names afresh. The
> duplicate guard and the "no" veto scope the same way: two worlds may both
> know a slate otter (they never meet); one world naming two things the same
> is still refused. Old trans-world names are dropped on load rather than
> guessed about — the next floor names itself properly, once, from its own
> palette. Five new tests pin the seams.

> [!NOTE]
> **23:5x — The bestiary learns its verbs**
> Your complaint, taken to the tradition and back: four archetypes that
> differed only in stat rows were invisible at the resolution play happens
> at. Research (Brogue's source, DCSS's design doctrine, Sil's manual,
> NetHack's guardian code) chose the verbs — and rejected my first draft's
> hit-and-run as the tedium the genre already regrets. Now: the **bruiser
> tramples** (every landed blow drives you back a pace and it lumbers after
> — atomic, no dice, never through walls or onto the stairs); the
> **skirmisher lunges** (two tiles and the blow in one motion, the only
> thing that can — approach is what it punishes); the **stalker lies
> coiled** (visibly, perfectly still — the dread is the tell — springing
> when you come within three steps of walking, its first landed blow one
> damage band harder, spent once); the **warden keeps a vigil** (leashed
> five steps from its post; leave, and it walks home and its wounds knit
> shut — poking a boss and running now buys nothing). Every verb narrates
> itself in the journal and the rail warns of coiled things. The budget
> pays for verbs (a lunger rents at 1.25×), which mattered immediately:
> unpriced, depth-5 survival collapsed to 0 of 20; priced, every sawtooth
> pin holds. The proportion trial now weighs rules against verbless
> stand-ins — a scale that moved with the bestiary read heal-6-per-kill
> as weightless. 24 new tests.

> [!NOTE]
> **00:0x — The satchel: the first thing you use on purpose**
> "No choices, just monsters to bonk" — the research convicted my first
> draft here too: a plain healing potion is a solved non-decision (drink
> at low health, always), and this game's stair-heal and level-heal
> already pay for attrition. So the two provisions are built not to
> collapse: the **vital draught** mends you whole AND permanently raises
> your ceiling (+2/+3/+4 by depth) — drunk early it banks the ceiling,
> drunk late it banks the blood, no timing wastes it; the **still smoke**
> makes every hunt chase where you WERE for 6/8/10 turns — except
> whatever already has you in claws' reach, so it must rise before they
> arrive, never after. One satchel slot; walking over a provision swaps
> and leaves the old one lying there (one step back un-decides it); `q`
> spends it and spends the turn. One provision per floor, unguarded, far
> from the path — the armory pays for fighting, the satchel pays for
> scouting. The smoke is also the deep runner's answer: a scarce,
> spendable way past what lens #33 said only brawlers survive. Bots got
> deliberately dumb reflexes (drink under 35%, smoke at 3 tiles) — they
> are the canary: if a fixed threshold plays the satchel as well as you
> do, the design has failed and we will hear it. 28 new tests.

> [!NOTE]
> **00:2x — The world has a bottom, and the bottom has a heart**
> GESTALT's last rung. The dungeon is no longer forever: floor one now
> says it plainly — nine floors deep, and something beats at the bottom.
> The ninth floor turns around: the heart lies at the far end behind the
> last warden, and the stair you came down by is the way out. Taking the
> heart fills your hands and seals your satchel; every eight turns the
> seized world stirs — and the FIRST stir raises your own dead: an echo
> stands up from every body you left on that floor, wearing your full
> strength. Reach the stair carrying the heart and the world is won.
> (Instant-win-on-touch is the anticlimax DCSS diagnosed in its own orb
> run — the ending is the reversal, not the touch.) Along the way down,
> the bible keeps its word: promises whisper on the floors before each
> warden and are confirmed when the warden falls, first delivery per
> world only. Your bodies now lend you their eyes — stand where you fell
> and that life's explored map joins yours (knowledge, never stats: the
> BONES decision, made and documented). Also fixed under the same stone:
> the warden now keeps the door by ROLE (the by-construction claim had
> quietly broken — a depth-9 warden rated fourth-scariest on its own
> floor), and deep wardens finally grow with their floors. Bots can win
> worlds now; one does, in the tests, every run. Golden regenerated on a
> livelier seed (13 strikes, a crit, an item, a lunge on record).
> 707/707 green.

> [!NOTE]
> **00:3x — MANUAL.md: the game, in plain words**
> The deliverable you asked for by name: a player's manual and test guide
> with no machinery words in it. Every term the game uses gets one line
> (world, cut, relic, satchel, warden, heart, echo, forge, law, bench,
> founding, grave, body); the four creatures are described by what they
> DO and the line they say when they do it; the bottom gets its own page;
> and §9 is the test guide — eighteen do-this-expect-that checks you can
> run in one sitting, from "walk into a wall" to "carry the heart back
> out". The old WALKTHROUGH.md stays as the technical companion; GESTALT
> now says out loud that its ladder is climbed, L1 through L4.

> [!NOTE]
> **14:4x — the conversations know where you were standing**
> Two of your asks, landed. First: every entry in both chats now carries
> the moment it was said — floor, turn, level, health, and what you were
> carrying — stamped on new notes at write time, and derived for every
> OLD note by refolding the head it pinned (the Note docstring promised
> "lined up against what was happening later" since the day it was
> written; today it happens). The gamemaster is told the same standing
> line you can read, so its answers sit in your situation instead of
> floating. Second: talking to the gamemaster is top-level play now —
> `t` opens its own sheet, pen in hand; the screen behind `m` keeps the
> designer's channel. Found and fixed in passing: the world's founding
> was never actually reaching the gamemaster (the bible ride-along was
> dropped between the call site and the consult since the day it was
> plumbed — the comment claimed otherwise). Live-checked in the pane:
> asked the pane's sandbox world "what waits below this floor?" and it answered
> with the warden's pacing, stamped `floor 1 · turn 4 · level 1 ·
> 10/10 health`; stripped the stamps from storage, reloaded, and they
> came back derived. 713/713 green.

> [!NOTE]
> **15:5x — the namesmith: names come from code now**
> Your call, and the research agreed with you: the model was never adding
> value at the name level — the world's identity lives in its PALETTE (the
> founding's word-list, one model call), not in which words got glued
> together. So the gluing is code. Every creature and relic name is now
> composed on the spot: the world supplies the modifier from its lexicon,
> the code supplies the head noun from what the thing IS (a lunger ends in
> hound or cur, a blade in knife or edge), the same register guard the
> model faced gets the final say, and the same veto works — refusals are
> remembered so the deterministic smith can't re-offer what you refused.
> Founded worlds name in their own words the instant the founding lands
> ("ochre cur", "silt knife" in tonight's pane world); unfounded worlds
> improvise from a shipped default palette; the model is out of the naming
> business entirely — no cost, no forty-second wait, no off-palette names.
> Found and fixed while proving it: wiping used to let one last render of
> the dying world sneak names into the fresh canon (invisible before only
> because the model was slow). The founding now asks for ~40 palette words
> instead of 20, per the research's repetition math. 732/732 green.

> [!NOTE]
> **16:0x — the player gets verbs: shove and brace**
> The research's sharpest line: the monsters got verbs and the player got
> none, and no amount of loot fixes that asymmetry. So now — press x and a
> direction to SHOVE: drive what stands beside you one pace, no dice (a
> tool you position with cannot gamble — Into the Breach's rule, adopted
> whole). Open ground displaces; a wall slams (one harm and it reels); a
> body behind means both tangle and reel. Press z to BRACE: set against
> the coming round — harder to hit by two-plus-half-your-wits, a trample
> cannot drive you back, a coiled spring breaks on the guard, and any blow
> that misses a set guard staggers the attacker. Staggered things lose
> their next action, said in the journal as a reel. Wits finally earns its
> keep on defense. Zero new dice anywhere; bots don't use either yet, so
> the golden replay passed bit-identical and every balance pin held
> without retuning. 746/746 green.

> [!NOTE]
> **16:1x — two more verbs walk in: the stinger and the caller**
> The bestiary grows the way the research said it should — by what things
> DO. The stinger's bite is small and is not the problem: venom burns one
> hit point a round for three rounds after, so breaking off a fight no
> longer ends it, and the draught is suddenly worth more. The caller does
> not want to fight you at all — it wants you heard: one cry (once per
> life, said on the rail as an unspent voice) and the floor answers, two
> more things rising at a chase's distance. Kill it first or fight the
> room. Both wait past the teaching floor (stinger from 2, caller from 3
> — the ambush gate, generalized), both are priced into threat and XP,
> and the caller cries at your SMOKE trail if you fooled it, which is
> exactly what the smoke is for. Depth 1 stays gentle (16-17/20), depth 3
> still belongs to the fighter (11 v 4). 757/757 green, golden
> legitimately untouched — floor one's draws never changed.

> [!NOTE]
> **16:2x — loot learns to ask questions**
> The research's bluntest finding: auto-take-the-better-one produces zero
> decisions BY CONSTRUCTION — a total order is a conveyor belt. So walking
> now takes only strict upgrades (better or equal on every axis, better in
> total), and everything else waits on the floor for the , key: a chosen
> take, tradeoffs and downgrades included. What waits: the heavy edge, the
> one iconic tradeoff (a bigger blow, a pace of speed — "heavy" explains
> itself); the sure edge, whose crits send the survivor reeling; the
> steady boots, which no trample moves. Two named properties, capped low
> on purpose — twelve great ones beat forty adjectives, and each is a rule
> replay must honor. The satchel learns a third provision: the tallow
> flare — break it and the floor admits its shape for seven paces, layout
> but never occupants, knowledge the fog remembers and a rewind un-knows.
> The journal now tells a refused pickup from a standing question: "it
> stays where it lies" versus "asks a trade — , takes it deliberately."
> 769/769 green.

> [!NOTE]
> **16:2x — the journal finds its voice**
> Combat text now comes from pools instead of one fixed sentence per
> case: four tiers (miss, hit, clean-through, kill — a kill finally SAYS
> it is a kill), shared templates with one swing-word injected per verb —
> a bruiser slams, a skirmisher cuts, a stinger bites — so six words buy
> what thirty bespoke lines would. Picks hash off the event itself (never
> a counted draw — the vocabulary can grow forever without touching
> replay), a no-repeat rule keeps frequent lines from stuttering, and the
> dice stay on every line, because legible numbers are words too. And the
> thresholds now speak, once, as they are crossed: "first blood — yours",
> "below half — mind the arithmetic", "nearly spent — one wrong step ends
> this". 779/779 green.

> [!NOTE]
> **16:3x — the depth goal, closed out**
> The books brought current with everything the afternoon built: the
> manual now teaches six creatures, three provisions, the shove, the
> brace, the deliberate take and the trade rule, with seven new checks in
> its test guide; AGENTS carries the machinery truth (player verbs, the
> dominance rule, the namesmith, the two new archetypes); GESTALT records
> that naming left the model entirely, and keeps the future-work list in
> one place — the monument, the fuller reliquary, terrain hazards to
> shove things INTO, bots learning the player's verbs. Ensemble after
> everything: depth 1 gentle as pinned (16-17/20), depth 3 the fighter's
> floor still (9 v 2, decisive), every suite green at 779. Live in the
> pane: brace, shove-arm, and the free refusal all speak their lines;
> no console errors. Six commits this goal.

> [!NOTE]
> **19:5x — the chronicler: the world sets its dead down in words**
> Your gift goal, and the research question underneath it: where does an
> agent EARN its seat, given latency, cost, and everything the namesmith
> taught us about where it doesn't? The answer the precedents gave —
> NetHack's bones, Dwarf Fortress's memorial slabs, King of Dragon Pass's
> saga, Qud's rationalized histories — is the moment a finished chain
> becomes a story. So: every ended run now gets a one-line stone cut
> INSTANTLY by code (floor, turn, the killer by the world's own name — no
> grave is ever mute), and endings that matter — a first life, a new
> deepest floor, a warden's kill, every win — get the world's fuller
> words: a model reads the run's code-built facts and engraves two to
> four slab-voiced sentences onto the dead run's own chain, gated hard
> (register, length, slop blocklist, must-name-the-facts, must-not-open-
> like-the-last-stone). The journal announces first words only; the full
> text is read in exactly one place — standing where the body lies,
> fused to the borrowed-eyes beat. Found beats served.
> Live, tonight, the first stone of the pane's world: "Six hundred
> sixty-two turns on floor 1 of 9. Nothing slain. The worst blow it took
> dealt 2, and the ochre cur finished the rest. The wedge draught was
> still unbroached in its hand." The unbroached draught — the model
> finding the one detail code would never think to say. That is the
> value-add, and it cost one call, off the clock, after the end.
> 796/796 green.

> [!IMPORTANT]
> **12:0x — The witness and the listener: the feedback factory opens**
> Your goal, built end to end: the game can now hear you play. Press
> <kbd>c</kbd> (or click the new indicator in the header — dim off, red
> and breathing on) and the microphone keeps your words while every game
> beat is trace-marked beside them: wall clock, turn, head seq, and a
> sample-accurate offset into the take. Marks land mic-on or mic-off, so
> the silences between actions are data too. Stopping encodes a WAV in
> the page and hands it to the dev server, which transcribes it ON THIS
> MACHINE: `scripts/transcribe.swift` on SpeechAnalyzer (macOS 26+'s own
> engine — Swift-only API, which is why your hoped-for Python route
> cannot exist; PyObjC reaches only the legacy recogniser), compiled
> once, sub-second, then ~12x real-time per take. No model call, no fee,
> nothing leaves the machine — measured before designed.
> Ending a run — begin again, another world, a wipe; *choosing to be
> done*, never death, which already provokes the Forge — snapshots it
> BEFORE the world mutates and sends it to the **listener**: chain facts
> (summariseRun, the death-proposal machinery reused), your typed notes,
> the lens readings, and the woven timeline, speech interleaved with
> play, long pauses said out loud. Its report lands in `runs/feedback/`
> (git-tracked now — reports are design content, the bench precedent)
> with a one-line verdict in the journal and an index line for trends.
> A persona (`.claude/agents/listener.md`) can re-read any kept packet
> headless, or many at once for what recurs.
> Two things the live pass caught that the design had wrong:
> 1. The report rode INSIDE the reply's JSON and died to one unescaped
>    quote at position 6535 — a real sixty-second call, spent teaching
>    the contract its shape: one line of JSON, a divider, raw markdown.
>    The raw reply is kept on any parse failure now, the loop's lesson.
> 2. `getUserMedia` can hang FOREVER on a prompt nobody answers (found
>    in an embedded pane) — the button wedged silently. An eight-second
>    race stands it down honestly: "the witness cannot hear — the
>    microphone was refused, or never answered."
> Verified live twice: a voiced packet ("I think the warden fight is too
> easy… the shove never feels worth using") came back with the quote tied
> nine turns before the death it preceded — *"the danger is real and
> entirely invisible"* — two Forge-ready sketches and a table pointer;
> and a real silent 128-turn run submitted from the browser closed the
> whole loop in the journal. The chain is untouched by all of it: the
> trace is a sidecar, the golden replay bit-identical. 815/815 green.
>
> **Try it:** `npm run dev`, press <kbd>c</kbd>, complain out loud, die
> or don't, press <kbd>r</kbd> — then read what lands in `runs/feedback/`.

> [!IMPORTANT]
> **17:34 — Combat at every distance: the volley discipline**
> Your goal — a combat system both sides use, melee and ranged, magic
> not locked out — built end to end. One resolution still rules every
> blow (the same d20, the same bands, the same two draws); what a MODE
> decides is who can be hit from where, and STRIKE v4's `mode` field is
> an open string so a bolt or a blast later is a new value, not new
> machinery. Distance is priced in tempo and geometry, never a second
> table: a shot takes two beats — **draw** (a turn, visible to every
> eye, the Into-the-Breach warning made law as covenant M8), then
> **loose** — and the stance breaks on movement, damage or a reel, so
> kiting died in the design instead of the tuning. The line is law too
> (M7, `src/core/sight.ts`): integer supercover, symmetric both ways;
> walls, secrets and living bodies stop a stone, two walls kissing at
> a corner stop it, the reach disc is the fog's own circle at 5. The
> **slinger** (seventh archetype, volley ×1.25, depth 2+) stands and
> draws and never dances; the player answers with the **leaden sling**
> — weapon slot, so sword-or-sling is a `,` decision — on f (fork
> moved to k; fire owns the genre's key). The rail warns in words, the
> map rings the drawn in amber, the drawn player sees their mark.
> Two finds along the way: the old localStorage save was refused with
> the exact reason (STRIKE v3 in a v4 engine — pre-RC breakage said
> honestly), and a LATENT HUNT BUG fell — `firstStep` keyed neighbours
> y·width+x before bounds-checking, so a quarry at x=0 read reachable
> one step EAST off the world (the fog's wrap lesson, alive in the
> hunt; walled borders had been hiding it — borderless volley test
> grids exposed it).
> Proved live on a hand-cut proving floor: you draw, the felt slinger
> draws back its arm — a shot is coming, your stone finishes it where
> it stands (14 vs 8), the kill pays 12 xp, chain verified to the
> hash. Sawtooth re-pinned without touching a number: depth-1 gentle
> 17/20, depth-3 fighter 10 v runner 4, depth-5 in band. Golden
> regenerated (229 events, still escapes). 865/865 green.
>
> **Try it:** `npm run dev` — press <kbd>?</kbd> and find <kbd>f</kbd>;
> a slinger waits on any floor past the first. When it draws, you have
> one turn: break the line, close, brace, shove — or take the stone.

> [!IMPORTANT]
> **21:28 — Balanced from the get-go: the door reaches you, the Forge learns no**
> Your ruling, after the Forge's offers kept souring: baseline balance
> is the tables' to set, never the Forge's to spend. Two halves, built.
> **The teaching floor reaches the player.** Reviewing your Chalk
> Shambles run found the shape of the problem: 273 turns on floor 1,
> the keen edge — the fighter's whole early curve — lying unclaimed on
> a far drawn point, two deaths bare-handed to the rust ram. Now depth
> 1's edge and its guard stand ON the start→exit walk, eight steps in
> (walkPath, a drawless choice like every placement decision). Verified
> live on a fresh world: turn 1, and the rail already reads "cleaver of
> marrow · 8 away" with a tallow whippet standing on it. Deeper floors
> keep the detour economy; the provision stays off the path everywhere.
> **The scale learned to say no.** M3 and M6 amended, visibly: a rule
> that never fires in any trial is REFUSED, not cautioned (your
> ratified rest rule had spoken exactly zero times in three lives — the
> new law would have stopped it at the bench), and past MAX_RULE_SWING
> 6 / MAX_RULE_FLIPS 4 the proportion trial refuses instead of asking.
> Both standing bench offers re-assayed under the new law: both never
> fired, both withdrawn. The bench is clear.
> The honest ledger: the pinned survival curve moved 17/10/9 →
> 18/16/12 (door/mid/deep). The deep's per-floor bite is unchanged —
> the wider pipeline feeds it — so the d5 band re-pinned to [1,13]
> rather than tuning the deep against your own fix; budget inflation
> was tried and rejected on measurement (extra spawns pay the
> snowballing fighter more XP than they cost: coef 4→12, 5→11, 6→13).
> 870/870 green, golden regenerated, chain verified.
>
> **Try it:** wipe to a fresh world — the first fight and the first
> prize are on your road before turn ten. Your dead-letter rest rule
> still sits in Chalk Shambles' law; a wipe sheds it, or leave it as a
> monument.

> [!IMPORTANT]
> **22:18 — Both hands full: dual wield by panel, a second satchel slot, diagonals tabled**
> Your three rulings from the voiced run, executed. **Dual wield went to
> a competitive panel** — three independent reviewers, three lenses
> (mechanics & covenant, game feel & tradition, codebase & cost), three
> proposals: A strong-arms-throw-hard (a sling slot beside the blade,
> grants stack), B the-off-hand-grants-no-arm (trait only, zero grants),
> C both-hands-priced (a speed cost, the heavy-edge idiom). Unanimous:
> **A > C > B**. B died on the item-value grammar (a zero-grant relic
> misroutes, can never be walk-taken, and makes the tempo-expensive verb
> the weak-number verb); C died on feel and telemetry (every sling a ,
> ceremony forever, −1 defence on the archer, and no bot can ever be
> observed holding one). A shipped with all three panel improvements:
> ITEM_TAKEN v4 records gearSlot AND shed — so trait routing is
> replay-exact and the set-down relic finally LANDS ON THE FLOOR, grants
> intact, retiring the vanish-and-misname family you dictated into the
> mic ("nothing drops when we set down the old item… that's a bug").
> Depth 1 now guarantees the keen edge by name; depth 2 owes a ranged
> relic — the slinger's debut floor arms the answer.
> **The satchel holds two**: q spends the first hand, Q the second;
> walking fills a free hand; duplicates welcome (your two-flares wish);
> full hands refuse the walk-over out loud (your silence bug). ITEM_USED
> v2, WORLD_INIT v9, upcasts in place.
> **Diagonal movement: tabled**, on the record — it touches the
> supercover line, every BFS hunt, and every Manhattan-spoken range;
> designed whole or not at all.
> Proven live on a proving floor: wielding "keen edge +2 might", sling
> hand "leaden sling +1 might", you deal 3–6 off the stacked band, the
> satchel reading "vital draught — q · tallow flare — Q". 885/885
> green, sawtooth held inside the re-pinned bands, golden regenerated.
>
> **Try it:** next depth-2 floor owes you a sling; wear it beside the
> edge and press <kbd>f</kbd>. Your satchel has room for the flare AND
> the draught now — <kbd>Q</kbd> is the second hand.
