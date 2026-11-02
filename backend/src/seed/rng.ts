// Générateur de nombres pseudo-aléatoires déterministe, seedé par chaîne, utilisé pour que les données de démonstration restent stables entre deux exécutions du seed.

/** Hache une chaîne en un entier 32 bits non signé (FNV-1a), utilisé comme graine du PRNG. */
export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Construit un générateur de nombres pseudo-aléatoires (mulberry32) à partir d'une graine entière. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
