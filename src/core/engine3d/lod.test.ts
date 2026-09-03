import { describe, expect, it } from "vitest";
import { applyLodBias, createLodBands, distanceSq, lodLevel, lodLevelStable } from "./lod";

describe("lodLevel", () => {
  const bands = createLodBands(10, 30);

  it("reparte los tres niveles por distancia", () => {
    expect(lodLevel(distanceSq(0, 0, 0, 5, 0, 0), bands)).toBe(0);
    expect(lodLevel(distanceSq(0, 0, 0, 20, 0, 0), bands)).toBe(1);
    expect(lodLevel(distanceSq(0, 0, 0, 50, 0, 0), bands)).toBe(2);
  });

  it("los limites entran en el nivel de mas detalle", () => {
    expect(lodLevel(100, bands)).toBe(0);
    expect(lodLevel(900, bands)).toBe(1);
  });
});

describe("applyLodBias", () => {
  it("un bias mayor a 1 acerca los cortes y baja el detalle antes", () => {
    const bands = createLodBands(10, 30);
    const biased = applyLodBias(bands, 2, createLodBands(0, 0));
    // Con bias 2 el corte cercano pasa de 10 a 5 unidades.
    expect(Math.sqrt(biased.nearSq)).toBeCloseTo(5, 10);
    expect(Math.sqrt(biased.farSq)).toBeCloseTo(15, 10);
    expect(lodLevel(distanceSq(0, 0, 0, 8, 0, 0), biased)).toBe(1);
  });

  it("escribe sobre el destino en vez de asignar por cuadro", () => {
    const bands = createLodBands(10, 30);
    const out = createLodBands(0, 0);
    expect(applyLodBias(bands, 1.6, out)).toBe(out);
    expect(bands.nearSq).toBe(100);
  });
});

describe("lodLevelStable", () => {
  const bands = createLodBands(10, 30);

  it("no parpadea con la camara parada justo en el corte", () => {
    // Un objeto a 10.2 con nivel 0 se queda en 0; recien cambia mas lejos.
    let level = lodLevelStable(10.2 * 10.2, bands, 0);
    expect(level).toBe(0);
    level = lodLevelStable(12 * 12, bands, level);
    expect(level).toBe(1);
    // Y para volver a 0 tiene que acercarse de verdad, no rozar el umbral.
    expect(lodLevelStable(9.8 * 9.8, bands, level)).toBe(1);
    expect(lodLevelStable(8 * 8, bands, level)).toBe(0);
  });

  it("un salto grande cambia de nivel igual", () => {
    expect(lodLevelStable(100 * 100, bands, 0)).toBe(2);
    expect(lodLevelStable(1, bands, 2)).toBe(0);
  });
});
