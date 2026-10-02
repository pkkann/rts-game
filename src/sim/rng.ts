/** mulberry32: small, fast, deterministic PRNG. State lives in the world. */
export function nextU32(rng: { s: number }): number {
  let t = (rng.s = (rng.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Float in [0, 1). */
export function rand(rng: { s: number }): number {
  return nextU32(rng) / 4294967296;
}

/** Integer in [lo, hi]. */
export function randInt(rng: { s: number }, lo: number, hi: number): number {
  return lo + (nextU32(rng) % (hi - lo + 1));
}
