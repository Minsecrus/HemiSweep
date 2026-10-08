/** Stable, platform-independent FNV-1a hash followed by Mulberry32. */
export function seededRandom(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  }

  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates makes every mine selection reproducible for a seed and first cell. */
export function seededShuffle<T>(values: readonly T[], seed: string): T[] {
  const random = seededRandom(seed);
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
