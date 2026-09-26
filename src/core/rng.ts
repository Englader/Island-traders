import type { RngState } from './types.js';

/**
 * Seeded PRNG (mulberry32). The state lives inside GameState so the rules engine
 * stays a pure function of (state, action). It is stripped from player views.
 */
export function seedRng(seed: string | number): RngState {
  const str = String(seed);
  // cyrb53-style string hash folded to 32 bits
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return { s: h1 >>> 0 };
}

export function nextFloat(rng: RngState): number {
  let t = (rng.s = (rng.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(rng: RngState, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}

/** One fair six-sided die. */
export function rollDie(rng: RngState): number {
  return 1 + nextInt(rng, 6);
}

/** Fisher-Yates shuffle in place; returns the same array. */
export function shuffle<T>(rng: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function pick<T>(rng: RngState, arr: readonly T[]): T {
  return arr[nextInt(rng, arr.length)];
}
