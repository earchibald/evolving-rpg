const GAMMA = 0x9e3779b9;

/**
 * splitmix32, addressed by counter rather than held as a stream. Any draw is
 * reproducible from (seed, counter) alone, which is what makes a recorded
 * counter enough to verify a replay.
 */
export function u32(seed: number, counter: number): number {
  let a = (seed + Math.imul(counter, GAMMA)) | 0;
  a = (a + GAMMA) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return t >>> 0;
}

export function float01(seed: number, counter: number): number {
  return u32(seed, counter) / 4294967296;
}

/**
 * Inclusive on both ends. Uses modulo, which is biased — at the span sizes this
 * game uses (under a few hundred against 2^32) the bias is around 1e-8 relative
 * and not worth the counter-accounting that rejection sampling would need.
 */
export function intBetween(seed: number, counter: number, min: number, max: number): number {
  if (max < min) throw new Error(`intBetween: max ${max} is below min ${min}`);
  const span = max - min + 1;
  return min + (u32(seed, counter) % span);
}
