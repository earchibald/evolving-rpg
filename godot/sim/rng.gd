class_name SimRng
## splitmix32, addressed by (seed, counter) — the byte-twin of src/core/rng.ts.
##
## Addressed rather than held as a stream: any draw is reproducible from
## (seed, counter) alone, which is what makes a recorded counter enough to
## verify a replay. This is the ONLY randomness source permitted anywhere in
## sim/. No randi(), no RandomNumberGenerator, no Time — those belong to the
## stage, where nothing they touch can decide anything.

const GAMMA := 0x9E3779B9
const MASK32 := 0xFFFFFFFF


## Math.imul: a 32-bit truncated multiply. Split so no intermediate exceeds
## 2^48 — a straight a*b of two 32-bit values would overflow a 64-bit int and
## the low bits, which are the only ones that survive the mask, would be wrong.
##
## Why it is exact: write b as bh*2^16 + bl. Then a*b mod 2^32 equals
## (a*bl + (a*bh mod 2^16)*2^16) mod 2^32, which is what the two halves below
## add up to before the final mask.
static func imul32(a: int, b: int) -> int:
	a &= MASK32
	b &= MASK32
	var lo := a * (b & 0xFFFF)
	var hi := ((a * (b >> 16)) & 0xFFFF) << 16
	return (lo + hi) & MASK32


## Every JS intermediate in the reference is a 32-bit pattern: `| 0` reads it
## signed, `>>> k` reads it unsigned. Keeping the UNSIGNED pattern in a 64-bit
## int and masking after every add and multiply preserves the identical bits —
## and `>>` on a non-negative int is a logical shift, so it matches `>>>`.
## A negative seed masks to its two's-complement pattern, which is exactly what
## `(seed + …) | 0` leaves behind.
static func u32(seed: int, counter: int) -> int:
	var a := (seed + imul32(counter, GAMMA)) & MASK32
	a = (a + GAMMA) & MASK32
	var t := a ^ (a >> 16)
	t = imul32(t, 0x21F0AAAD)
	t = t ^ (t >> 15)
	t = imul32(t, 0x735A2D97)
	t = t ^ (t >> 15)
	return t & MASK32


static func float01(seed: int, counter: int) -> float:
	return u32(seed, counter) / 4294967296.0


## Inclusive on both ends. Uses modulo, which is biased — at the span sizes this
## game uses (under a few hundred against 2^32) the bias is around 1e-8 relative
## and not worth the counter-accounting rejection sampling would need. The same
## account the reference gives itself, kept deliberately so the streams agree.
static func int_between(seed: int, counter: int, min_v: int, max_v: int) -> int:
	assert(max_v >= min_v, "int_between: max %d is below min %d" % [max_v, min_v])
	var span := max_v - min_v + 1
	return min_v + (u32(seed, counter) % span)
