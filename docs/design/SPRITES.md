# SPRITES.md — the visual register, and how to add to it

The game renders as coloured cells today. This file is the standard any sprite
work must meet, so that art added months apart still looks like one game.

Source: §V of `new-designs-spec.md` (2026-07-29), kept as written — it needed no
correction. The two additions at the end are forced by the review in
`docs/superpowers/specs/2026-07-30-economy-mining-and-sprites.md`.

## 1. Art style definition

- **Format**: 16-bit era pixel art.
- **Perspective**: top-down orthographic RPG — slightly angled, so character
  faces and item details stay readable. Classic SNES/GBA framing.
- **Grid constraint**: square aspect. Designed natively on a 16×16 or 32×32
  grid, then upscaled cleanly.
- **Outlines**: every character, monster and item carries a thick solid dark
  outline (dark grey or black). This is not decoration — it is what separates a
  sprite from a dark dungeon floor tile.
- **Palette**: earthy base tones — greys, browns, deep greens — with vibrant
  high-saturation accents reserved for magic, gems and things that matter
  (bright blues, glowing yellows, crimson).

The palette rule and the outline rule are doing the same job as the game's
written register: the world is dim and quiet, and the few things that shout are
shouting on purpose.

## 2. The core prompting formula

When generating a new asset, use this template so consistency is enforced by the
prompt rather than hoped for:

> "A 16-bit pixel art sprite of **[SUBJECT]**, classic top-down RPG style. The
> sprite must have a thick dark outline and be isolated on a dark grey
> checkerboard background. Earthy colour palette with **[ACCENT COLOUR]**
> accents. Clean pixels, no blurring, centered in a square frame."

**A new boss:**

> "A 16-bit pixel art sprite of a massive Minotaur wielding an axe, classic
> top-down RPG style. The sprite must have a thick dark outline and be isolated
> on a dark grey checkerboard background. Earthy brown colour palette with bright
> red accents on the axe. Clean pixels, no blurring, centered in a square frame."

**A new material:**

> "A 16-bit pixel art sprite of a glowing Uranium Ore rock, classic top-down RPG
> style. The sprite must have a thick dark outline and be isolated on a dark grey
> checkerboard background. Dark stone palette with neon green accents. Clean
> pixels, no blurring."

## 3. Iteration and cleanup

- **Background removal.** Generated images arrive with the requested
  checkerboard or a solid backdrop. Key it out to true alpha `(0,0,0,0)` before
  the asset goes anywhere near the game.
- **Grid snapping.** If the asset does not land on the intended pixel scale,
  downsample **nearest-neighbour**, never with anti-aliasing. Smoothed pixel art
  stops being pixel art.

## 4. Output shape — per-entity files and a generated manifest

*Added by the 2026-07-30 review.*

The pipeline's deliverable is **one file per entity**, plus an atlas built by a
script that emits its own manifest:

```
{ "iron ore": [sx, sy, w, h], "shopkeeper": [sx, sy, w, h] }
```

The manifest is **generated with the atlas, never measured by hand off a
picture**. The review found a proposal specifying a 16-pixel slice of a
128-pixel sprite, on a file with captions and a title banner baked into the
raster — that is the failure mode this rule exists to prevent.

A shipped raster contains sprites and transparency. No labels, no title, no
margin annotations, no checkerboard.

`SPRITE_SIZE` is a **render constant** and lives beside the view. It never enters
`tables.ts`: no engine number may depend on how large a picture is.

## 5. Provenance and licence

*Added by the 2026-07-30 review.*

Every asset added here records where it came from and under what licence, in the
table below. An asset with neither does not ship.

The review refused a watermarked 2816×1536 collection image
(`watermarked_img_10516595601443928641.png`) on exactly this ground. A watermark
is a preview, not a licence — and the art was good, which is what makes the
missing licence worth a rule rather than a shrug.

| Asset | Source | Licence | Added |
|---|---|---|---|
| _(none yet)_ | | | |
