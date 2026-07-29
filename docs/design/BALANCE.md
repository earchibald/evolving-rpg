# BALANCE — the tables, the math, the sawtooth

The numbers live in `src/core/tables.ts`; this file is why they are what they
are and how to tune them. Change both together. Verify any change with
`npm run balance` (sweeps) and the band tests in `tests/balance/`.

## The shape we are building

A **rising sawtooth**: tension climbs within a floor → kills pay XP → a
level-up gives a breath of ease (full heal, +stats) → the next floor bites
harder than the ease covered. Peaks come from combat (a bruiser at your
level+1), from floors (each depth's budget), and from bosses (the warden every
third floor). The Critic's interest curve should show teeth, not a plateau.

## To-hit: bounded accuracy

```
needed = clamp(10 + defender.speed − attacker.might, 4, 17)   d20 ≥ needed hits
natural 20 always hits and doubles damage; natural 1 always misses
```

- Chances live in **[20%, 85%]** forever, whatever the level gap (D&D 5e's
  bounded-accuracy insight). Scaling lives in hp/damage instead, so growth
  never turns hits into certainties.
- **Anchor**: starting player (might 3) vs depth-1 skirmisher (speed 2) →
  needed 9 → **60%**. If a tuning pass moves this anchor, the whole game's feel
  moves; the test suite pins it.
- Crits make the dice narratable — 5% of blows are stories — and give lens #2
  (Surprise) real events at last: a realized nat-20 has p=0.05 < 0.15.

## Damage: dice bands

| might | dice | range | mean |
|---|---|---|---|
| 1–2 | 1d2 | 1–2 | 1.5 |
| 3–4 | 1d3+1 | 2–4 | 2.5 |
| 5–6 | 1d4+2 | 3–6 | 4.5 |
| 7–8 | 1d6+3 | 4–9 | 6.5 |
| 9+ | 1d8+4 | 5–12 | 8.5 |

Replaces uniform 1..might, which put a third of starting blows at 1 damage and
grew variance with mean. Flats give a floor; dice keep the top end alive.

## Experience and levels

`XP_TO_REACH = [—, 0, 16, 40, 72, 112, 160, 224, 304, 400]` — early levels land
inside one floor; later ones demand deliberate risk. **XP = the threat value of
what you killed** (risk in, reward out, one number both ways).

Level-up (`growthAt`): **+2 maxHp every level; might on even levels, speed on
odd; wits every third; full heal on the moment of leveling.** The full heal is
the sawtooth's ease tooth. Deterministic (no choice UI) so replay stays exact;
choices are a thing the Forge may propose later.

## The bestiary

| archetype | base (hp/might/wits/speed) | growth per level | role |
|---|---|---|---|
| skirmisher | 4/2/1/3 | +2/+1/0/+1 | fast chaff, teaches spacing |
| bruiser | 7/4/1/1 | +3/+1/0/0 | slow wall, teaches when not to trade |
| stalker | 3/3/2/4 | +1/+1/+1/+1 | fragile hunter, teaches priority |
| slinger | 3/2/2/2 | +1/+1/+1/0 | fights from the ground between you (depth 2+), teaches approach |
| warden | 16/5/2/2 | +6/+1/+1/0 | the stairs' guard, every 3rd floor |

Kinds are mechanical bones; the Oracle names each kind as it is touched
(`skirmisher-2` is a new kind and earns its own name).

## The armory

One relic per floor, guarded, drawn by weight; its grant scales with depth.
Kinds are article-free — the Covenant's name rules bind the world's own data.

| relic | grants | at depth 1 | scaling |
|---|---|---|---|
| keen edge | might | +1 | +1 per 3 depths (slowest — might compounds through the damage bands) |
| iron charm | max hp | +3 | +1 per depth |
| fleet boots | speed | +1 | +1 per 3 depths |
| grey lens | wits | +1 | +1 per 2 depths |
| leaden sling | might | +1 | +1 per 3 depths — and the 'ranged' trait: the volley discipline. Weapon slot, so sword-or-sling is a `,` decision (the keen edge out-grants it; walking never swaps them) |

## The volley (covenant M7/M8)

Shots resolve on the same bounded dice as blows — `10 + speed − might`,
same bands, same two draws — so no second accuracy table exists to drift.
What prices distance is **tempo and geometry**, not arithmetic: a shot
costs two beats (draw, then loose; the draw visible to everyone, lost to
movement, damage or a stagger), flies only along a clear straight line
(walls, secrets and living bodies block; two walls kissing at a corner
block), reaches `SHOT_RANGE = 5` on the fog's own disc (dx²+dy² ≤ 30),
and refuses adjacency — the bump owns range 1. Kiting is dead by
construction: you cannot move and stay drawn. The slinger's verb prices
at ×1.25 (lunge-class: approach rounds become damage rounds); measured on
the 20-seed sawtooth the bands held unchanged — depth 1 gentle (17/20
brawler), depth 3 fighter over runner (10 v 4), depth 5 in [1,10].

## Wits: the crit band

`critFloor(wits) = max(18, 20 − ⌊wits/4⌋)` — a keen mind widens the opening.
The starting player (wits 3) crits only on the natural 20, so this changed no
tuning; the grey lens and every-third-level wits make it a build, and the
stalker line grows into it natively. Floored at 18: crits stay rare for
everyone, merely less rare for the sharp.

## Spawning: budgets and overlap

```
budget(depth) = 24 + 15·depth          threat is the currency
bands(depth)  = {depth ×6, depth−1 ×3, depth+1 ×1}   (Brogue-style blur)
warden at depths 3, 6, 9…
```

Depth 1 affords ~3 modest creatures; depth 2 four to five stronger ones.
The rare depth+1 spawn is the out-of-depth scare that keeps floors from
feeling solved.

## Target bands (what "balanced" means, measurably)

Revised after the first measured passes — the door is gentler than first
written, the deep is crueller, and both are on purpose. The bands live in
`tests/balance/sawtooth.test.ts` on fixed seeds, so a breach is a defect and a
drift inside the band is tuning.

| measure | band | measured (pass 4) | why |
|---|---|---|---|
| depth-1 brawler survival | 70–100% | 95% | the door is gentle; floor 1 teaches |
| depth-1 anchor hit chance | exactly 60% | 60% | feel anchor |
| cumulative to depth 3 (boss floor) | 30–85% | 60% | the warden is a peak, not a wall |
| brawler vs rusher at depth 3 | brawler strictly higher | 60% vs 40% | fighting must pay — the inversion |
| cumulative to depth 5 | 5–50% | ~17% | the deep is earned |

Tuning knobs, in order of bluntness: spawn budget slope → creature growth
rows → XP thresholds → damage bands → the to-hit clamp (touch last; it moves
everything).

## Tuning log

**Pass 1 (02:0x, first measured sweep).** Budget floor raised 14+12d → 22+14d:
one unlucky bruiser roll was eating floor 1's whole budget, and a
single-creature floor teaches nothing.

**Pass 2 (03:0x, band sweep).** Depth-1 brawler survival measured 95% (band
55–80) and five-floor survival 83% with *rising* hp — growth outpaced depth,
the ease tooth was a bath. Three knobs, one notch each: XP thresholds ×~1.6
(levels arrive a floor later), level hp +3 → +2 (the heal stays; the padding
shrinks), budget slope 22+14d → 20+18d (deeper floors gain a real creature,
depth 1 nearly unchanged).

**Pass 3.** Pass 2 overshot the deep end: five-floor survival fell 83% → 17%
with deaths at depth ~3.5. One knob back — slope 20+18d → 24+15d, floor 1
untouched, depth 5 about ten points of budget gentler.

**Passes 5–8 (the armory aftermath).** The armory's extra draw reshuffled the
whole generation stream, and the ensemble lenses caught the fallout: the
depth-3 inversion collapsed to a coin flip, and floor-one deaths ran 20%
because the fighter's guaranteed might band-jump had become a one-in-three
draw and one world in seven opened with a level-2 bruiser. Three design
repairs, each argued in its own commit: **floor one always leaves a weapon**
(variety starts at depth 2, where floors owe two relics); **the teaching
floor rolls level-1 only** (the out-of-depth scare starts once you have a
floor behind you); **rest at the stairs** (descend a cleared floor and you
descend healed — clearing pays beyond XP). Floor one is back to 85–95%.

**Open question for the designer**, measured and left honest: at depth 3 the
fighter and the runner now tie (8v8 on the pinned seeds, 16v15 on forty); the
fighter's margin shows at depth 5 (5v3), where XP, relics and the stairs-rest
compound. The band test pins non-domination at 3 and strict inversion at 5.
If the inversion should live at depth 3 again, the honest knobs are the XP
curve or creature growth rows — not another relic.

**Pass 9 (10:4x — rooms, corridors, and the watched stairs).** The 48x32
rooms-and-corridors boards (MAPS.md) invalidated the old numbers two ways.
First: corridors made every fight avoidable, and the runner out-survived the
fighter 11–9 at depth 3 — the exact domination the Covenant forbids. The
repair is placement, not arithmetic: **the strongest thing on the floor now
stands beside the way out** (the warden, on its floors, with no special case
— it out-threatens everything by construction; and the keeper is never a
relic guard, found the hard way on a floor with two prizes and two
creatures). Second: a linear budget on a 4x floor left depth 5 fielding four
creatures the snowballed fighter dueled one at a time — 13-in-20 survived a
band that says "rare". Budget gains a quadratic term anchored at depth 3
(`24 + 15d + 4(d−2)²`); anchoring it at depth 2 crushed the depth-3 runner
to 2-in-20 and lens #33 called the mid-game a corridor, so it was moved out
a floor.

Where the pinned seeds now stand (20 seeds, brawler/rusher):

| depth | fighter | runner | reading |
|---|---|---|---|
| 1 | 19 | 17 | the door is gentle |
| 3 | 13 | 3 | fighting pays, decisively — the old open question is closed |
| 5 | 9 | 1 | the deep is earned; lens #33 reads depth 5 as brawler-only |

The depth-3 tie from pass 8 is **resolved** — by the keeper, not by the XP
knobs the note proposed. New honest observation, left for the designer: at
depth 5 lens #33 reads "one viable path" (nobody runs past what they refused
to fight). That is the snowball thesis stated back as a critique; if the deep
should keep a runner's line open, the knob is keeper strength or corridor
loop count, not budget.

Creature behaviour on these boards: awareness is now **8 steps of walking**
(BFS through standable tiles, deterministic, drawless) — a wall you cannot
walk through is a wall you cannot hunt through, and a corridor fills
single-file. The bumper policy learned to walk to a wall before bumping it;
the golden fixture is policy-driven (brawler, seed 25) because no fixed key
script survives a maze.

## Depth motifs (pass 10 — the tables on paper, per GESTALT L3's gate)

Research (primary source, shipped code): Brogue blends room-shape weights,
corridor-attach chance (90%→10%) and whole-level cavern odds (29%→67%)
linearly over depth, unlocks hazards at thresholds (lava at 4), and ramps
secret doors 0%→67%. Rogue ramps dark rooms 0%→100% by level 11; Moria the
same by 25. Angband gates room types by min-depth inside weighted profiles;
NetHack and DCSS swap whole generators per region. Distilled knobs: shape
mix, connector style, openness, darkness, hazard unlock, special frequency,
secret density.

Ours, as bounded rows (one file: `src/core/tables.ts`), by depth band. The
teaching floors keep today's exact shape; the deep draws its motif per floor
(Brogue's variety, our counted draws):

| band | motif | tiles per room | room w | room h | loops per rooms | secret | sight |
|---|---|---|---|---|---|---|---|
| 1–2 | the door | 110 | 4–8 | 3–6 | 1 per 4 | 1 in 4 | 9 |
| 3–4 | the warren | 90 | 3–6 | 3–4 | 1 per 3 | 1 in 3 | 8 |
| 5–6 | the halls | 150 | 6–12 | 4–7 | 1 per 6 | 1 in 3 | 8 |
| 7+ | the deep | draws warren or halls per floor (counted) | | | | 1 in 2 | 7 |

Rationale by lineage: the warren's tight loops are Brogue's chase topology;
the halls are its big-chamber late-game (room 6–12 ≈ Brogue cross-arm
widths) and give the keeper an arena; the secret ramp is Brogue's 0→67%
compressed to our 25%→50%; **sight shrinking 9→7 is Rogue/Moria's darkness
ramp mapped onto our fog** — gentler than their eventual 100% dark, because
fog is already the tax. Motif is named in the floor's story (covenant L1).

Bands to re-measure after landing: d1 unchanged by construction; d3 (warren
density may bite the runner harder — watch the non-domination pin's spread);
d5 (halls' sparseness vs the quadratic budget — watch [1,10]).
