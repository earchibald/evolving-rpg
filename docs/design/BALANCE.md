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
