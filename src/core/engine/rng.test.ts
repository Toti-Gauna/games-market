import { describe, expect, it } from "vitest";
import { createRng, hashSeed, randomSeed } from "./rng";

/**
 * El PRNG es la pieza de la que dependen la reproducibilidad de un bug y la
 * comparabilidad de dos partidas. Si esto se rompe, todo el catalogo miente.
 */

describe("createRng", () => {
  it("la misma semilla da la misma secuencia", () => {
    const a = createRng("abc7");
    const b = createRng("abc7");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("semillas distintas divergen", () => {
    const a = createRng("abc7");
    const b = createRng("abc8");
    expect(a.next()).not.toBe(b.next());
  });

  it("next() se queda en [0, 1)", () => {
    const rng = createRng("rango");
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("int() es inclusivo en los dos extremos", () => {
    const rng = createRng("enteros");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("shuffle no muta la entrada y conserva los elementos", () => {
    const rng = createRng("mezcla");
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...original];
    const shuffled = rng.shuffle(original);
    expect(original).toEqual(copy);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(copy);
  });

  it("shuffle es reproducible con la misma semilla", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(createRng("s").shuffle(items)).toEqual(createRng("s").shuffle(items));
  });

  it("pick sobre una lista vacia falla en vez de devolver undefined", () => {
    expect(() => createRng("x").pick([])).toThrow();
  });

  it("chance(0) nunca y chance(1) siempre", () => {
    const rng = createRng("chance");
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe("hashSeed", () => {
  it("es estable y sin signo", () => {
    expect(hashSeed("abc7")).toBe(hashSeed("abc7"));
    expect(hashSeed("abc7")).toBeGreaterThanOrEqual(0);
  });
});

describe("randomSeed", () => {
  it("evita los caracteres que se confunden al dictarla", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomSeed()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{6}$/);
    }
  });
});
