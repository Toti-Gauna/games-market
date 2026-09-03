/**
 * PRNG sembrado.
 *
 * `Math.random()` y `gsap.utils.random()` no aceptan semilla, asi que no
 * sirven: sin semilla no hay dos jugadores resolviendo el mismo tablero, ni
 * bug reproducible ("con semilla abc7 el enemigo aparece dentro de la pared").
 *
 * FNV-1a para derivar el estado + mulberry32 para la secuencia.
 */

export type Rng = {
  /** [0, 1) */
  next(): number;
  /** [min, max) */
  range(min: number, max: number): number;
  /** Entero en [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates sobre una copia. No muta la entrada. */
  shuffle<T>(items: readonly T[]): T[];
  chance(probability: number): boolean;
};

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed) || 1;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error("rng.pick sobre una lista vacia");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        const b = copy[j] as (typeof copy)[number];
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
    chance: (probability) => next() < probability,
  };
}

/** Semilla corta y legible, del estilo que se dicta por telefono. */
export function randomSeed(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
